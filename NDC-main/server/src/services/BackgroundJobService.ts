import prisma from '../config/prisma';
import { BackgroundJobStatus, Prisma } from '@prisma/client';
import { ImportRow, ImportService } from './ImportService';
import { emailService, isSyntheticOrTestEmail } from './EmailService';
import { getClientBaseUrl } from '../utils/urlHelper';

export interface CreateImportJobParams {
  initiatedByUserId?: string;
  rows: ImportRow[];
  duplicateAction?: 'SKIP' | 'UPDATE';
  autoInitiateClearances?: boolean;
  reqClientUrl?: string;
}

export interface SanitizedJobResponse {
  id: string;
  type: string;
  status: BackgroundJobStatus;
  totalRecords: number;
  processedRecords: number;
  insertedRecords: number;
  updatedRecords: number;
  skippedRecords: number;
  failedRecords: number;
  currentStage: string;
  currentBatch: number;
  totalBatches: number;
  lastError: string | null;
  resultSummary: any;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class BackgroundJobService {
  private static isWorkerLoopRunning = false;
  private static readonly CHUNK_SIZE = 1000;

  /**
   * Enqueue a new student bulk import background job.
   */
  public static async createImportJob(params: CreateImportJobParams): Promise<SanitizedJobResponse> {
    const { initiatedByUserId, rows, duplicateAction = 'SKIP', autoInitiateClearances = true, reqClientUrl } = params;

    const totalRecords = rows.length;
    const totalBatches = Math.ceil(totalRecords / this.CHUNK_SIZE) || 1;

    const job = await prisma.backgroundJob.create({
      data: {
        type: 'STUDENT_BULK_IMPORT',
        status: 'QUEUED',
        initiatedByUserId: initiatedByUserId || null,
        totalRecords,
        processedRecords: 0,
        insertedRecords: 0,
        updatedRecords: 0,
        skippedRecords: 0,
        failedRecords: 0,
        currentStage: 'QUEUED',
        currentBatch: 0,
        totalBatches,
        payload: {
          rows,
          duplicateAction,
          autoInitiateClearances,
          reqClientUrl: reqClientUrl || getClientBaseUrl()
        } as any,
        resultSummary: Prisma.DbNull
      }
    });

    // Asynchronously trigger the worker loop without blocking HTTP caller
    setImmediate(() => {
      this.processQueue().catch((err) => {
        console.error('[BackgroundJobService]: Error in background worker loop:', err);
      });
    });

    return this.sanitizeJob(job);
  }

  /**
   * Get sanitized job by ID.
   */
  public static async getJobById(jobId: string): Promise<SanitizedJobResponse | null> {
    const job = await prisma.backgroundJob.findUnique({
      where: { id: jobId }
    });
    if (!job) return null;
    return this.sanitizeJob(job);
  }

  /**
   * Get active/running/queued jobs (optionally filtered by user).
   */
  public static async getActiveJobs(userId?: string): Promise<SanitizedJobResponse[]> {
    const whereClause: any = {
      status: { in: ['QUEUED', 'RUNNING'] }
    };
    if (userId) {
      whereClause.initiatedByUserId = userId;
    }

    const jobs = await prisma.backgroundJob.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    return jobs.map((j) => this.sanitizeJob(j));
  }

  /**
   * Get latest job (active or recently completed within last hour).
   */
  public static async getLatestJob(userId?: string): Promise<SanitizedJobResponse | null> {
    const whereClause: any = {};
    if (userId) {
      whereClause.initiatedByUserId = userId;
    }

    const job = await prisma.backgroundJob.findFirst({
      where: whereClause,
      orderBy: { createdAt: 'desc' }
    });

    if (!job) return null;
    return this.sanitizeJob(job);
  }

  /**
   * Cancel an in-progress or queued job.
   */
  public static async cancelJob(jobId: string, reason = 'Cancelled by user'): Promise<boolean> {
    const updated = await prisma.backgroundJob.updateMany({
      where: {
        id: jobId,
        status: { in: ['QUEUED', 'RUNNING'] }
      },
      data: {
        status: 'CANCELLED',
        currentStage: 'CANCELLED',
        lastError: reason,
        completedAt: new Date()
      }
    });
    return updated.count > 0;
  }

  /**
   * Process all queued jobs in order.
   */
  private static async processQueue(): Promise<void> {
    if (this.isWorkerLoopRunning) return;
    this.isWorkerLoopRunning = true;

    try {
      while (true) {
        // Find oldest queued job
        const queuedJob = await prisma.backgroundJob.findFirst({
          where: { status: 'QUEUED' },
          orderBy: { createdAt: 'asc' }
        });

        if (!queuedJob) break;

        // Atomically transition from QUEUED to RUNNING
        const claim = await prisma.backgroundJob.updateMany({
          where: { id: queuedJob.id, status: 'QUEUED' },
          data: {
            status: 'RUNNING',
            startedAt: new Date(),
            heartbeatAt: new Date(),
            currentStage: 'STARTING'
          }
        });

        if (claim.count === 0) {
          // Another worker thread/process claimed it
          continue;
        }

        console.log(`[BackgroundJobService]: Started executing background job [${queuedJob.id}] (${queuedJob.type})`);
        await this.executeJob(queuedJob.id);
      }
    } finally {
      this.isWorkerLoopRunning = false;
    }
  }

  /**
   * Execute an individual import job in chunked checkpoints.
   */
  private static async executeJob(jobId: string): Promise<void> {
    const job = await prisma.backgroundJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== 'RUNNING') return;

    const payload: any = job.payload || {};
    const rows: ImportRow[] = payload.rows || [];
    const duplicateAction = payload.duplicateAction || 'SKIP';
    const autoInitiateClearances = payload.autoInitiateClearances ?? true;
    const clientUrl = payload.reqClientUrl || getClientBaseUrl();

    let accumulatedImported = 0;
    let accumulatedUpdated = 0;
    let accumulatedSkipped = 0;
    let accumulatedFailed = 0;
    const accumulatedErrors: any[] = [];
    const departmentSummaryMap: Record<string, any> = {};

    const totalRows = rows.length;
    const totalBatches = Math.ceil(totalRows / this.CHUNK_SIZE) || 1;

    try {
      for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
        // Check if job was cancelled mid-flight
        const currentCheck = await prisma.backgroundJob.findUnique({
          where: { id: jobId },
          select: { status: true }
        });
        if (currentCheck?.status === 'CANCELLED') {
          console.log(`[BackgroundJobService]: Job [${jobId}] was cancelled mid-execution.`);
          return;
        }

        const startIdx = batchIdx * this.CHUNK_SIZE;
        const endIdx = Math.min(startIdx + this.CHUNK_SIZE, totalRows);
        const batchRows = rows.slice(startIdx, endIdx);

        // Update progress checkpoint in DB
        await prisma.backgroundJob.update({
          where: { id: jobId },
          data: {
            currentStage: `IMPORTING_BATCH_${batchIdx + 1}_OF_${totalBatches}`,
            currentBatch: batchIdx + 1,
            heartbeatAt: new Date()
          }
        });

        // Execute bulk insert for this batch
        const batchResult = await ImportService.executeImport(
          batchRows,
          duplicateAction,
          job.initiatedByUserId || 'SYSTEM',
          { clientUrl },
          autoInitiateClearances
        );

        accumulatedImported += batchResult.imported;
        accumulatedUpdated += batchResult.updated;
        accumulatedSkipped += batchResult.skipped;
        accumulatedFailed += batchResult.failed;

        if (batchResult.errorReport && batchResult.errorReport.length > 0) {
          accumulatedErrors.push(...batchResult.errorReport.slice(0, 50));
        }

        // Aggregate department summaries
        if (batchResult.departmentSummary) {
          for (const ds of batchResult.departmentSummary) {
            if (!departmentSummaryMap[ds.code]) {
              departmentSummaryMap[ds.code] = { ...ds };
            } else {
              departmentSummaryMap[ds.code].total += ds.total;
              departmentSummaryMap[ds.code].imported += ds.imported;
              departmentSummaryMap[ds.code].updated += ds.updated;
              departmentSummaryMap[ds.code].skipped += ds.skipped;
              departmentSummaryMap[ds.code].failed += ds.failed;
            }
          }
        }

        const processedSoFar = endIdx;

        // Persist chunk checkpoint
        await prisma.backgroundJob.update({
          where: { id: jobId },
          data: {
            processedRecords: processedSoFar,
            insertedRecords: accumulatedImported,
            updatedRecords: accumulatedUpdated,
            skippedRecords: accumulatedSkipped,
            failedRecords: accumulatedFailed,
            heartbeatAt: new Date()
          }
        });

        console.log(
          `[BackgroundJobService]: Job [${jobId}] checkpoint: ${processedSoFar}/${totalRows} rows processed (${accumulatedImported} inserted, ${accumulatedSkipped} skipped, ${accumulatedFailed} failed)`
        );
      }

      // Mark Job Completion
      const finalStatus: BackgroundJobStatus =
        accumulatedFailed > 0 && accumulatedImported === 0
          ? 'FAILED'
          : accumulatedFailed > 0
          ? 'PARTIALLY_COMPLETED'
          : 'COMPLETED';

      const finalDepartmentSummary = Object.values(departmentSummaryMap);

      await prisma.backgroundJob.update({
        where: { id: jobId },
        data: {
          status: finalStatus,
          currentStage: 'COMPLETED',
          completedAt: new Date(),
          processedRecords: totalRows,
          insertedRecords: accumulatedImported,
          updatedRecords: accumulatedUpdated,
          skippedRecords: accumulatedSkipped,
          failedRecords: accumulatedFailed,
          resultSummary: {
            totalRows,
            imported: accumulatedImported,
            updated: accumulatedUpdated,
            skipped: accumulatedSkipped,
            failed: accumulatedFailed,
            errorReport: accumulatedErrors.slice(0, 100),
            departmentSummary: finalDepartmentSummary
          }
        }
      });

      console.log(
        `[BackgroundJobService]: Job [${jobId}] finished with status ${finalStatus}: ${accumulatedImported} inserted, ${accumulatedSkipped} skipped, ${accumulatedFailed} failed.`
      );

      // Decoupled Welcome Email Scheduling (Non-blocking background dispatch)
      this.scheduleWelcomeEmailsForImport(jobId, rows, clientUrl);
    } catch (err: any) {
      console.error(`[BackgroundJobService]: Unhandled failure in job [${jobId}]:`, err);
      await prisma.backgroundJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          currentStage: 'FAILED',
          lastError: err.message || 'Unknown execution error',
          completedAt: new Date()
        }
      });
    }
  }

  /**
   * Decoupled background email scheduler.
   * Filters out synthetic test addresses and rate-limits real emails safely.
   */
  private static scheduleWelcomeEmailsForImport(jobId: string, rows: ImportRow[], clientUrl: string): void {
    // Run completely in background
    setImmediate(async () => {
      try {
        const eligibleRows = rows.filter((r) => r.email && !isSyntheticOrTestEmail(r.email));
        if (eligibleRows.length === 0) {
          console.log(`[BackgroundJobService]: All ${rows.length} records in job [${jobId}] use synthetic addresses. Email queue dispatch skipped.`);
          return;
        }

        console.log(`[BackgroundJobService]: Queued ${eligibleRows.length} real welcome emails for job [${jobId}] (rate-limited dispatch).`);
        for (const row of eligibleRows) {
          try {
            await emailService.sendStudentWelcomeEmail({
              toEmail: row.email,
              studentName: row.fullName,
              usn: row.usn,
              departmentName: row.detectedDepartmentName,
              batch: row.batch,
              clientUrl
            });
            // Throttle with 550ms delay to adhere strictly to Resend rate limits (2 req/s on free tier)
            await new Promise((resolve) => setTimeout(resolve, 550));
          } catch (emailErr) {
            console.warn(`[BackgroundJobService]: Error sending welcome email to ${row.email}:`, emailErr);
          }
        }
      } catch (err) {
        console.warn(`[BackgroundJobService]: Background email dispatcher encountered error:`, err);
      }
    });
  }

  /**
   * Stale job recovery for process restarts (invoked at server boot).
   * Finds any job stuck in RUNNING with no heartbeat for > 3 minutes.
   */
  public static async recoverStaleJobs(): Promise<number> {
    const staleThreshold = new Date(Date.now() - 3 * 60 * 1000); // 3 minutes ago
    const staleJobs = await prisma.backgroundJob.findMany({
      where: {
        status: 'RUNNING',
        heartbeatAt: { lt: staleThreshold }
      }
    });

    if (staleJobs.length === 0) return 0;

    console.log(`[BackgroundJobService]: Found ${staleJobs.length} orphaned/stale running jobs from previous process. Recovering...`);

    for (const job of staleJobs) {
      await prisma.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: job.insertedRecords > 0 ? 'PARTIALLY_COMPLETED' : 'FAILED',
          currentStage: 'RECOVERED_AFTER_RESTART',
          lastError: 'Server restarted while job was in progress. Progress checkpoint preserved.',
          completedAt: new Date()
        }
      });
      console.log(`[BackgroundJobService]: Recovered stale job [${job.id}]: preserved ${job.insertedRecords} inserted records.`);
    }

    return staleJobs.length;
  }

  /**
   * Helper to strip large payload data from job before sending to client.
   */
  private static sanitizeJob(job: any): SanitizedJobResponse {
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      totalRecords: job.totalRecords,
      processedRecords: job.processedRecords,
      insertedRecords: job.insertedRecords,
      updatedRecords: job.updatedRecords,
      skippedRecords: job.skippedRecords,
      failedRecords: job.failedRecords,
      currentStage: job.currentStage,
      currentBatch: job.currentBatch,
      totalBatches: job.totalBatches,
      lastError: job.lastError,
      resultSummary: job.resultSummary,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    };
  }
}
