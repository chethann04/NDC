import prisma from '../config/prisma';
import { emailService, ClearanceEmailPayload, SendMailDetailedResult } from './EmailService';
import { extractOriginFromReq } from '../utils/urlHelper';

export type NotificationDeliveryStatus = 'QUEUED' | 'ACCEPTED' | 'FAILED' | 'UNCERTAIN';

export interface EnqueueNotificationParams {
  idempotencyKey: string;
  clearanceId: string;
  studentId: string;
  usn: string;
  studentName: string;
  toEmail: string;
  departmentName: string;
  departmentCode?: string;
  status: string;
  dueAmount?: number;
  dueDetails?: string;
  remarks?: string;
  officerName?: string;
  clearedCount?: number;
  totalCount?: number;
  clientUrl?: string;
  source: 'AI_ASSISTANT' | 'LOGBOOK_OCR' | 'CLEARANCE_WORKFLOW' | 'MANUAL' | 'MANUAL_OFFICER' | string;
  reqObj?: any;
}

export interface NotificationJobData {
  id: string;
  idempotencyKey: string;
  clearanceId: string;
  studentId: string;
  usn: string;
  studentName: string;
  toEmail: string;
  departmentName: string;
  departmentCode?: string;
  status: string;
  dueAmount?: number;
  dueDetails?: string;
  remarks?: string;
  officerName?: string;
  clearedCount?: number;
  totalCount?: number;
  clientUrl?: string;
  source: string;
  deliveryStatus: NotificationDeliveryStatus;
  messageId?: string;
  lastError?: string;
  attempts: number;
  remainingQuota?: number | null;
  deduplicated?: boolean;
  queuedAt: Date;
  processedAt?: Date;
  completedAt?: Date;
}

export class NotificationQueueService {
  private static jobsMap: Map<string, NotificationJobData> = new Map();
  private static queue: string[] = []; // queue of idempotencyKeys
  private static isWorkerRunning = false;
  private static remainingAppsScriptQuota: number | null = null;
  private static readonly THROTTLE_DELAY_MS = 500;

  /**
   * Enqueue a student clearance notification.
   * 
   * Strict Safety Guarantees:
   * 1. Must only be called AFTER corresponding database mutation succeeds.
   * 2. Re-validates student recipient email.
   * 3. Deduplicates against identical idempotencyKey (suppresses duplicate sends).
   * 4. Treats HTTP timeout as UNCERTAIN (never blindly retries).
   * 5. Asynchronous decoupled dispatch (never blocks caller or database transaction).
   */
  public static async enqueueClearanceNotification(
    params: EnqueueNotificationParams
  ): Promise<NotificationJobData> {
    const {
      idempotencyKey,
      clearanceId,
      studentId,
      usn,
      studentName,
      toEmail,
      departmentName,
      departmentCode,
      status,
      dueAmount,
      dueDetails,
      remarks,
      officerName,
      clearedCount,
      totalCount,
      clientUrl,
      source,
      reqObj
    } = params;

    // 1. Check idempotency: Have we already processed or queued this notification?
    const existing = await this.getJobByIdempotencyKey(idempotencyKey);
    if (existing) {
      // If already ACCEPTED, UNCERTAIN, or actively QUEUED, suppress duplicate send!
      if (
        existing.deliveryStatus === 'ACCEPTED' ||
        existing.deliveryStatus === 'UNCERTAIN' ||
        existing.deliveryStatus === 'QUEUED'
      ) {
        console.log(
          `[NotificationQueueService]: Notification with key [${idempotencyKey}] already exists in state [${existing.deliveryStatus}]. Suppressing duplicate notification.`
        );
        return {
          ...existing,
          deduplicated: true
        };
      }
    }

    const jobId = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const effectiveClientUrl = clientUrl || (reqObj ? extractOriginFromReq(reqObj) : undefined);

    // 2. Validate recipient address
    const cleanEmail = (toEmail || '').trim();
    const isEmailValid = cleanEmail.length > 0 && cleanEmail.includes('@') && cleanEmail.includes('.');

    const initialJob: NotificationJobData = {
      id: jobId,
      idempotencyKey,
      clearanceId,
      studentId,
      usn,
      studentName,
      toEmail: cleanEmail,
      departmentName,
      departmentCode,
      status,
      dueAmount,
      dueDetails,
      remarks,
      officerName: officerName || 'Clearance Officer',
      clearedCount,
      totalCount,
      clientUrl: effectiveClientUrl,
      source,
      deliveryStatus: isEmailValid ? 'QUEUED' : 'FAILED',
      lastError: isEmailValid ? undefined : 'INVALID_RECIPIENT_ADDRESS: Missing or invalid email address.',
      attempts: isEmailValid ? 0 : 1,
      remainingQuota: this.remainingAppsScriptQuota,
      queuedAt: new Date()
    };

    // Store in-memory map
    this.jobsMap.set(idempotencyKey, initialJob);

    // Persist to database BackgroundJob table (non-blocking if DB fails)
    try {
      await prisma.backgroundJob.create({
        data: {
          id: jobId,
          type: 'EMAIL_NOTIFICATION',
          status: isEmailValid ? 'QUEUED' : 'FAILED',
          currentStage: initialJob.deliveryStatus,
          totalRecords: 1,
          processedRecords: isEmailValid ? 0 : 1,
          failedRecords: isEmailValid ? 0 : 1,
          lastError: initialJob.lastError,
          payload: {
            idempotencyKey,
            clearanceId,
            studentId,
            usn,
            studentName,
            toEmail: cleanEmail,
            departmentName,
            departmentCode,
            status,
            dueAmount,
            dueDetails,
            remarks,
            source,
            clientUrl: effectiveClientUrl
          } as any
        }
      });
    } catch (dbErr: any) {
      console.warn(`[NotificationQueueService]: DB persistence notice for job [${jobId}]:`, dbErr.message);
    }

    // If email is invalid, do not queue for network dispatch
    if (!isEmailValid) {
      return initialJob;
    }

    // 3. Enqueue for asynchronous bounded-concurrency processing
    this.queue.push(idempotencyKey);

    // Trigger worker asynchronously without blocking HTTP caller
    setImmediate(() => {
      this.processQueue().catch((err) => {
        console.error('[NotificationQueueService]: Worker loop error:', err);
      });
    });

    return initialJob;
  }

  /**
   * Bounded concurrency worker loop.
   * Processes queued notification items sequentially (concurrency = 1)
   * with rate-limiting pauses and quota checks.
   */
  public static async processQueue(): Promise<void> {
    if (this.isWorkerRunning) {
      return;
    }

    this.isWorkerRunning = true;

    try {
      while (this.queue.length > 0) {
        const key = this.queue.shift();
        if (!key) continue;

        const job = this.jobsMap.get(key);
        if (!job || job.deliveryStatus !== 'QUEUED') {
          continue;
        }

        job.processedAt = new Date();
        job.attempts += 1;

        // Quota check: If Google Apps Script returned 0 remaining quota, fail fast
        if (this.remainingAppsScriptQuota !== null && this.remainingAppsScriptQuota <= 0) {
          const quotaError = 'QUOTA_EXCEEDED: Google daily email sending limit has been exhausted.';
          job.deliveryStatus = 'FAILED';
          job.lastError = quotaError;
          job.completedAt = new Date();
          await this.persistJobUpdate(job);
          continue;
        }

        const emailPayload: ClearanceEmailPayload = {
          toEmail: job.toEmail,
          studentName: job.studentName,
          usn: job.usn,
          departmentName: job.departmentName,
          departmentCode: job.departmentCode,
          status: job.status,
          dueAmount: job.dueAmount,
          dueDetails: job.dueDetails,
          remarks: job.remarks,
          officerName: job.officerName,
          clearedCount: job.clearedCount,
          totalCount: job.totalCount,
          clientUrl: job.clientUrl
        };

        try {
          const result: SendMailDetailedResult = await emailService.sendClearanceUpdateEmailDetailed(emailPayload);

          if (result.remainingQuota !== undefined && result.remainingQuota !== null) {
            this.remainingAppsScriptQuota = result.remainingQuota;
            job.remainingQuota = result.remainingQuota;
          }

          if (result.deliveryStatus === 'ACCEPTED' || (result.success && !result.error)) {
            job.deliveryStatus = 'ACCEPTED';
            job.messageId = result.messageId || `msg_${Date.now()}`;
            job.lastError = undefined;
            job.completedAt = new Date();
            console.log(
              `[NotificationQueueService]: Email delivered successfully for ${job.usn} (${job.toEmail}), messageId: ${job.messageId}`
            );
          } else if (result.deliveryStatus === 'UNCERTAIN' || result.isTimeout) {
            // CRITICAL: Timeout must be treated as UNCERTAIN. Blind retry is strictly aborted!
            job.deliveryStatus = 'UNCERTAIN';
            job.lastError = result.error || 'TIMEOUT_ABORTED: Request timed out; delivery state uncertain.';
            job.completedAt = new Date();
            console.warn(
              `[NotificationQueueService]: Delivery marked UNCERTAIN for ${job.usn} due to timeout. Blind retry aborted.`
            );
          } else {
            job.deliveryStatus = 'FAILED';
            job.lastError = result.error || 'Unknown email dispatch failure';
            job.completedAt = new Date();
            console.warn(
              `[NotificationQueueService]: Delivery FAILED for ${job.usn}:`, job.lastError
            );
          }
        } catch (dispatchErr: any) {
          const isTimeout =
            dispatchErr.name === 'AbortError' ||
            dispatchErr.name === 'TimeoutError' ||
            dispatchErr.message?.toLowerCase().includes('timeout') ||
            dispatchErr.message?.toLowerCase().includes('aborted');

          if (isTimeout) {
            job.deliveryStatus = 'UNCERTAIN';
            job.lastError = `TIMEOUT_ABORTED: Network request timed out. State is uncertain. Blind retry aborted.`;
            console.warn(`[NotificationQueueService]: Timeout exception for ${job.usn}. Marked UNCERTAIN.`);
          } else {
            job.deliveryStatus = 'FAILED';
            job.lastError = dispatchErr.message || String(dispatchErr);
            console.error(`[NotificationQueueService]: Exception sending email to ${job.toEmail}:`, dispatchErr);
          }
          job.completedAt = new Date();
        }

        // Persist final job state
        await this.persistJobUpdate(job);

        // Rate-limiting pause between outgoing dispatches (500ms)
        if (this.queue.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.THROTTLE_DELAY_MS));
        }
      }
    } finally {
      this.isWorkerRunning = false;
    }
  }

  /**
   * Persist job status update to Prisma BackgroundJob table.
   */
  private static async persistJobUpdate(job: NotificationJobData): Promise<void> {
    try {
      await prisma.backgroundJob.updateMany({
        where: { id: job.id },
        data: {
          currentStage: job.deliveryStatus,
          status:
            job.deliveryStatus === 'ACCEPTED'
              ? 'COMPLETED'
              : job.deliveryStatus === 'FAILED'
              ? 'FAILED'
              : 'PARTIALLY_COMPLETED',
          processedRecords: 1,
          failedRecords: job.deliveryStatus === 'FAILED' ? 1 : 0,
          lastError: job.lastError || null,
          resultSummary: {
            deliveryStatus: job.deliveryStatus,
            messageId: job.messageId || null,
            lastError: job.lastError || null,
            remainingQuota: job.remainingQuota ?? null,
            attempts: job.attempts,
            completedAt: job.completedAt
          } as any,
          completedAt: job.completedAt || new Date()
        }
      });
    } catch {
      // Ignore background persistence failure
    }
  }

  /**
   * Get job by idempotency key (checks memory cache, then database).
   */
  public static async getJobByIdempotencyKey(key: string): Promise<NotificationJobData | null> {
    if (this.jobsMap.has(key)) {
      return this.jobsMap.get(key)!;
    }

    try {
      const bgJob = await prisma.backgroundJob.findFirst({
        where: {
          type: 'EMAIL_NOTIFICATION',
          payload: {
            path: ['idempotencyKey'],
            equals: key
          }
        }
      });

      if (bgJob && bgJob.payload) {
        const payload: any = bgJob.payload;
        const resultSummary: any = bgJob.resultSummary || {};
        const job: NotificationJobData = {
          id: bgJob.id,
          idempotencyKey: key,
          clearanceId: payload.clearanceId,
          studentId: payload.studentId,
          usn: payload.usn,
          studentName: payload.studentName,
          toEmail: payload.toEmail,
          departmentName: payload.departmentName,
          departmentCode: payload.departmentCode,
          status: payload.status,
          dueAmount: payload.dueAmount,
          dueDetails: payload.dueDetails,
          remarks: payload.remarks,
          officerName: payload.officerName,
          source: payload.source,
          deliveryStatus: (bgJob.currentStage as NotificationDeliveryStatus) || 'QUEUED',
          messageId: resultSummary.messageId,
          lastError: bgJob.lastError || undefined,
          attempts: resultSummary.attempts || 1,
          remainingQuota: resultSummary.remainingQuota,
          queuedAt: bgJob.createdAt,
          completedAt: bgJob.completedAt || undefined
        };
        this.jobsMap.set(key, job);
        return job;
      }
    } catch {
      // Fall through if database JSON query fails
    }

    return null;
  }

  /**
   * Get all notifications associated with a clearance.
   */
  public static async getJobsForClearance(clearanceId: string): Promise<NotificationJobData[]> {
    const memoryJobs = Array.from(this.jobsMap.values()).filter(
      (j) => j.clearanceId === clearanceId
    );
    return memoryJobs;
  }

  /**
   * Wait for all queued jobs to finish processing (utility for automated tests).
   */
  public static async flushQueue(): Promise<void> {
    while (this.queue.length > 0 || this.isWorkerRunning) {
      if (!this.isWorkerRunning && this.queue.length > 0) {
        await this.processQueue();
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /**
   * Reset in-memory queue state (utility for automated tests).
   */
  public static resetForTesting(): void {
    this.jobsMap.clear();
    this.queue = [];
    this.isWorkerRunning = false;
    this.remainingAppsScriptQuota = null;
  }

  /**
   * Manually override simulated quota (utility for tests).
   */
  public static setRemainingQuotaForTesting(quota: number | null): void {
    this.remainingAppsScriptQuota = quota;
  }
}
