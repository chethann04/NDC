import crypto from 'crypto';
import prisma from '../config/prisma';
import { DepartmentClearanceStatus } from '../constants/statuses';
import { NdcWorkflowService } from './NdcWorkflowService';
import { AuditService } from './AuditService';
import { DueManagementService } from './DueManagementService';
import { GeminiService, ExtractedLogbookEntry, DocumentAnalysisResult } from './GeminiService';
import { ImagePreprocessingService } from './ImagePreprocessingService';
import { departmentCache } from '../utils/departmentCache';
import { DepartmentAgentRegistry } from './ai/DepartmentAgentRegistry';

export interface CreateScanJobParams {
  lecturerUserId: string;
  departmentId?: string;
  labId?: string;
  originalFilename: string;
  mimeType: string;
  fileBuffer: Buffer;
  reqObj?: any;
}

export interface UpdateScanEntryParams {
  entryId: string;
  correctedUsn?: string;
  correctedAmount?: number;
  correctedReason?: string;
  lecturerUserId: string;
}

export class LogbookScannerService {
  /**
   * Create a new scan job, preprocess image (rotation, contrast), extract visible entries with zero hallucinations,
   * and reconcile with real database student records.
   */
  public static async processUpload(params: CreateScanJobParams): Promise<any> {
    const {
      lecturerUserId,
      originalFilename,
      mimeType,
      fileBuffer,
      reqObj
    } = params;

    // 1. Validate Input File (size, mime type, PDF page counts)
    const fileValidation = ImagePreprocessingService.validateInputFile(
      fileBuffer,
      mimeType,
      originalFilename
    );
    if (!fileValidation.valid) {
      throw new Error(fileValidation.error || 'Invalid file format or size.');
    }

    // 2. Resolve target department (support code or UUID, never default to PHY)
    let departmentId: string = params.departmentId || '';
    if (departmentId) {
      const resolved = await departmentCache.getDepartmentByCodeOrName(departmentId);
      if (resolved) {
        departmentId = resolved.id;
      }
    } else {
      // Resolve officer's authorized department from database
      const userRecord = await prisma.user.findUnique({
        where: { id: lecturerUserId },
        include: {
          associatedOfficer: {
            include: { departmentMappings: true }
          }
        }
      });
      if (userRecord?.departmentId) {
        departmentId = userRecord.departmentId;
      } else if (userRecord?.associatedOfficer?.departmentMappings?.[0]?.departmentId) {
        departmentId = userRecord.associatedOfficer.departmentMappings[0].departmentId;
      } else if (userRecord?.role === 'SUPER_ADMIN' || userRecord?.role === 'ADMIN') {
        const adm = await prisma.clearanceDepartment.findFirst({ where: { code: 'ADM' } });
        departmentId = adm?.id || '';
      } else {
        throw new Error('Unable to resolve authorized department for scan job. Please select a department.');
      }
    }

    if (!departmentId) {
      throw new Error('Department ID is required to process scan job.');
    }

    const targetDept = departmentId ? await departmentCache.getDepartmentById(departmentId) : null;
    const deptName = targetDept?.name || 'Laboratory / Department';
    const isLibrary = targetDept?.code === 'LIB' || deptName.toLowerCase().includes('library');

    // 3. Initialize ScanJob in DB
    const jobId = crypto.randomUUID();
    const scanJob = await prisma.scanJob.create({
      data: {
        id: jobId,
        lecturerUserId,
        departmentId,
        labId: params.labId || null,
        status: 'EXTRACTING',
        originalFilename,
        mimeType: fileValidation.mimeType,
        fileSize: fileBuffer.length,
        startedAt: new Date()
      }
    });

    try {
      // 4. Preprocess Image: detect orientation, rotate upright, enhance contrast for faint handwriting,
      // analyze lighting, downscale oversized captures (> 2560px), and preserve original file for side-by-side human review
      const preprocessed = await ImagePreprocessingService.preprocess(
        fileBuffer,
        fileValidation.mimeType,
        jobId,
        originalFilename
      );

      // 5. Construct High-Precision Multi-Row Forensic Vision Prompt
      const base64Data = preprocessed.preprocessedBuffer.toString('base64');
      const deptConfig = DepartmentAgentRegistry.getConfig(targetDept?.code || '', {
        name: deptName
      });
      const scannerCustomInstructions = deptConfig?.scannerInstructions || '';
      const prompt = `You are an expert institutional register OCR model for ${deptName} (${targetDept?.code || 'GEN'}) at Malnad College of Engineering (MCE).
CRITICAL EXTRACTION INSTRUCTIONS FOR ${isLibrary ? 'CENTRAL LIBRARY REGISTER' : 'LABORATORY LOGBOOK / DUE REGISTER'}:
${scannerCustomInstructions || (isLibrary ? `
- This is an Institutional Library issue/return/due/overdue fine register.
- Columns typically include: Sl No / Date / Student USN / Student Name / Book Title & Accession Number / Fine or Due Amount.
- Reason: Book title, accession number, or overdue description (e.g. "Overdue book: Engineering Physics", "Lost textbook replacement", "Damaged binding").
` : `
- This is a laboratory apparatus, breakage, equipment damage, or practical logbook register.
- Columns typically include: Sl No / Date / Student USN / Student Name / Apparatus Damaged or Reason / Fine or Due Amount.
`)}

SPECIAL HANDLING FOR LIVE CAMERA & WEBCAM CAPTURES:
- Live camera snapshots or webcams may have angled perspective, shadows, slight blur, or horizontally mirrored/reversed text.
- If text appears horizontally mirrored/backwards, automatically read and normalize it as regular text.
- VTU / MCE University Seat Numbers (USNs) follow the format: 4MC{YY}{BRANCH}{NUM}
  Examples: 4MC22IS022, 4MC23CS101, 4MC21EC045, 4MC24AI010, 4MC22ME050.
  Common handwriting OCR confusions: '4' might look like 'A' or 'H'; 'MC' might look like 'NC' or 'MO'; 'IS' might look like '1S'; '0' might look like 'O'. Normalize to valid USNs.

PAGE & ROW EXTRACTION RULES:
1. Extract EVERY visible populated row with student dues or fines. Do NOT skip any rows.
2. For each row:
   - "usn": Legible student USN (e.g. "4MC22IS022").
   - "rawUsn": Verbatim USN text.
   - "studentName": Student full name as written.
   - "amount": Numeric fine amount (e.g. 300, 450, 100). Do NOT include currency symbols like ₹ or Rs in the number. If no amount is written, return null.
   - "reason": Apparatus damaged, book title, or reason for fine verbatim as written.
   - "date": Date as written (YYYY-MM-DD or DD/MM/YYYY), or null.
   - "isCrossedOut": true if line has a strike-through line or mark across it, else false.
   - "box_2d": [ymin, xmin, ymax, xmax] approximate normalized coordinates (0 to 1000).
   - "confidence": Estimated legibility score between 0.1 and 1.0.

OUTPUT FORMAT (STRICT JSON ONLY):
{
  "layoutType": "TABLE" | "LIST" | "IRREGULAR" | "SINGLE_ENTRY" | "EMPTY",
  "pageCount": ${preprocessed.pageCount},
  "detectedRowCount": number,
  "visibleEntryCount": number,
  "stageMetrics": {
    "detectedRowCount": number,
    "candidateRowCount": number,
    "blankLinesSkippedCount": number,
    "discrepancyExplanation": string
  },
  "orientation": "UPRIGHT" | "ROTATED_90" | "ROTATED_180" | "ROTATED_270",
  "entries": [
    {
      "pageNumber": 1,
      "rowNumber": 1,
      "sourceRegion": "Row 1",
      "box_2d": [120, 50, 190, 950],
      "rawText": "1 | 4MC24IS022 | Chethan N | 300 | Broken lens | 14/03/2026",
      "rawUsn": "4MC24IS022",
      "normalizedUsn": "4MC24IS022",
      "usn": "4MC24IS022",
      "isUsnUncertain": false,
      "studentName": "Chethan N",
      "rawAmount": "₹300",
      "amount": 300,
      "isAmountUncertain": false,
      "reason": "Broken lens",
      "date": "2026-03-14",
      "confidence": 0.95,
      "isCrossedOut": false
    }
  ]
}`;

      const rawJson = await GeminiService.analyzeDocument({
        prompt,
        mimeType: preprocessed.mimeType,
        base64Data,
        jsonMode: true,
        testHint: originalFilename
      });

      // 6. Parse and strictly validate structured output
      let layoutType = 'TABLE';
      let visibleEntryCount = 0;
      let detectedRowCount = 0;
      let detectedOrientation = 'UPRIGHT';
      let rawEntries: any[] = [];
      let stageMetrics: any = null;

      try {
        const cleanJson = rawJson.replace(/```json/gi, '').replace(/```/gi, '').trim();
        const parsed = JSON.parse(cleanJson);

        if (Array.isArray(parsed)) {
          rawEntries = parsed;
          visibleEntryCount = parsed.length;
          detectedRowCount = parsed.length;
        } else if (parsed && typeof parsed === 'object') {
          layoutType = parsed.layoutType || 'TABLE';
          visibleEntryCount = typeof parsed.visibleEntryCount === 'number' ? parsed.visibleEntryCount : 0;
          detectedRowCount = typeof parsed.detectedRowCount === 'number' ? parsed.detectedRowCount : visibleEntryCount;
          detectedOrientation = parsed.orientation || 'UPRIGHT';

          if (Array.isArray(parsed.entries)) {
            rawEntries = parsed.entries;
          } else if (Array.isArray(parsed.rows)) {
            rawEntries = parsed.rows;
          } else if (Array.isArray(parsed.data)) {
            rawEntries = parsed.data;
          }

          stageMetrics = parsed.stageMetrics;
        }

        if (!stageMetrics) {
          stageMetrics = {
            detectedRowCount: detectedRowCount || rawEntries.length,
            candidateRowCount: rawEntries.length,
            validRowCount: rawEntries.filter((e: any) => !e.isCrossedOut).length,
            crossedOutRowCount: rawEntries.filter((e: any) => e.isCrossedOut).length,
            blankLinesSkippedCount: Math.max(0, detectedRowCount - rawEntries.length),
            discrepancyExplanation: rawEntries.length > 0
              ? `Extracted ${rawEntries.length} candidate rows from physical register page.`
              : 'No populated student due entries found on this page.'
          };
        }
      } catch (parseErr) {
        console.error('[LogbookScannerService] JSON parse error from Gemini:', parseErr, 'Raw:', rawJson?.substring(0, 300));
        rawEntries = [];
        stageMetrics = {
          detectedRowCount: 0,
          candidateRowCount: 0,
          validRowCount: 0,
          crossedOutRowCount: 0,
          blankLinesSkippedCount: 0,
          discrepancyExplanation: 'Failed to parse structured JSON from OCR vision provider.'
        };
      }

      // CRITICAL GUARANTEE: NEVER silently drop or truncate candidate rows!
      const candidateEntries = rawEntries;

      // 7. Match each candidate row against database students strictly by normalized USN
      let matchedCount = 0;
      let unmatchedCount = 0;
      const createdEntries: any[] = [];

      for (let i = 0; i < candidateEntries.length; i++) {
        const item = candidateEntries[i];
        const rawUsn = String(item.rawUsn || item.usn || item.normalizedUsn || item.student_usn || item.rollNo || '').trim();
        const isUsnUncertain = Boolean(item.isUsnUncertain || rawUsn.includes('?') || rawUsn.length === 0);
        const normalizedUsn = isUsnUncertain ? '' : this.normalizeUsn(item.normalizedUsn || rawUsn);
        const isCrossedOut = Boolean(item.isCrossedOut || item.crossedOut || item.is_crossed_out);

        let student: any = null;

        // DB matching: match against real Student database by normalized USN
        if (normalizedUsn && !isUsnUncertain) {
          student = await prisma.student.findFirst({
            where: {
              usn: { equals: normalizedUsn, mode: 'insensitive' }
            },
            include: {
              ndcClearances: {
                where: { departmentId },
                take: 1
              }
            }
          });

          // Secondary fuzzy matching if exact USN failed (e.g. handwritten year or branch typo)
          if (!student && normalizedUsn.length >= 7) {
            const branchPart = normalizedUsn.substring(5, 7);
            const numPart = normalizedUsn.substring(7);
            student = await prisma.student.findFirst({
              where: {
                usn: { contains: `${branchPart}${numPart}`, mode: 'insensitive' }
              },
              include: {
                ndcClearances: {
                  where: { departmentId },
                  take: 1
                }
              }
            });
          }

          // If student exists but has no active clearance record in this department, auto-initialize
          if (student && student.ndcClearances.length === 0) {
            try {
              await NdcWorkflowService.ensureStudentNdcRequest(student.id);
              student = await prisma.student.findFirst({
                where: { id: student.id },
                include: {
                  ndcClearances: {
                    where: { departmentId },
                    take: 1
                  }
                }
              });
            } catch (syncErr) {
              console.warn('[LogbookScannerService] Auto-ensure clearance notice:', syncErr);
            }
          }
        }

        // Parse amount robustly from numbers or formatted strings
        let finalAmount = 0;
        let isAmountUncertain = false;
        const rawAmt = item.amount ?? item.rawAmount ?? item.fine ?? item.dueAmount;
        if (typeof rawAmt === 'number' && !isNaN(rawAmt)) {
          finalAmount = rawAmt;
        } else if (typeof rawAmt === 'string') {
          const cleaned = rawAmt.replace(/[^0-9.]/g, '');
          if (cleaned.length > 0) {
            const num = parseFloat(cleaned);
            if (!isNaN(num)) finalAmount = num;
          }
        }

        if (finalAmount <= 0) {
          isAmountUncertain = true;
          finalAmount = 0;
        }

        // Build detailed forensic validation notes and row positioning
        const errors: string[] = [];
        const pageNum = item.pageNumber || 1;
        const rowNum = item.rowNumber || i + 1;
        const regionDesc = item.sourceRegion || `Row ${rowNum}`;
        const box = item.boundingBox || (Array.isArray(item.box_2d) && item.box_2d.length === 4
          ? { ymin: item.box_2d[0], xmin: item.box_2d[1], ymax: item.box_2d[2], xmax: item.box_2d[3] }
          : null);
        const boxDesc = box ? `[Box: y:${box.ymin}-${box.ymax}, x:${box.xmin}-${box.xmax}]` : '';
        const rawTextDesc = item.rawText ? `[Raw Text: "${item.rawText.substring(0, 100)}"]` : '';

        if (isCrossedOut) {
          errors.push('[Crossed-Out Entry] Visibly struck through in source image. Requires confirmation before applying.');
        }

        if (isUsnUncertain) {
          errors.push(`[Unclear USN] USN characters partially obscured or smudged ("${rawUsn}"). Verification required.`);
        } else if (!student) {
          errors.push(`[Unknown Student] USN "${normalizedUsn || rawUsn}" could not be located in college records.`);
        } else if (student.ndcClearances.length === 0) {
          errors.push(`[No Clearance] Student found (${student.usn}) but clearance record could not be linked.`);
        }

        if (isAmountUncertain) {
          errors.push('[Uncertain Amount] Fine amount not visible or empty. Please enter amount during review.');
        }

        const hasClearance = Boolean(student && student.ndcClearances.length > 0);
        const isMatched = hasClearance && !isUsnUncertain && !isAmountUncertain && !isCrossedOut;
        const status = isMatched ? 'MATCHED' : 'UNMATCHED';

        if (isMatched) matchedCount++;
        else unmatchedCount++;

        const clearance = student?.ndcClearances?.[0];

        let confidence = typeof item.confidence === 'number' && item.confidence >= 0 && item.confidence <= 1
          ? item.confidence
          : this.calculateHeuristicConfidence(item, student);

        const confidenceMethod = item.confidenceMethod || (typeof item.confidence === 'number' ? 'PROVIDER_CONFIDENCE' : 'HEURISTIC_ESTIMATE');
        const forensicHeader = `[Page ${pageNum} | Row ${rowNum} | Region: ${regionDesc}] ${boxDesc} ${rawTextDesc} [Confidence: ${(confidence * 100).toFixed(0)}% via ${confidenceMethod}]`.trim();
        const fullValidationErrors = errors.length > 0
          ? `${forensicHeader} -- ${errors.join(' ')}`
          : `${forensicHeader} -- [Verified legible]`;

        const extractedName = item.studentName || item.name || student?.fullName || '';
        const extractedReason = item.reason || item.apparatus || item.description || (isLibrary ? 'Overdue Book / Library Fine' : 'Apparatus / Lab Due');
        const extractedDate = item.date || new Date().toISOString().split('T')[0];

        const scanEntry = await prisma.scanJobEntry.create({
          data: {
            scanJobId: jobId,
            entryIndex: i + 1,
            status: status as any,
            extractedUsn: normalizedUsn || rawUsn,
            extractedName,
            extractedAmount: finalAmount,
            extractedReason,
            extractedDate,
            confidence,
            matchedStudentId: student?.id || null,
            matchedStudentUsn: student?.usn || null,
            matchedStudentName: student?.fullName || null,
            clearanceId: clearance?.id || null,
            validationErrors: fullValidationErrors
          }
        });

        createdEntries.push(scanEntry);
      }

      // 8. Update ScanJob with final tally, rich layout metadata, stage metrics, and status
      const updatedJob = await prisma.scanJob.update({
        where: { id: jobId },
        data: {
          status: 'REVIEWING',
          totalEntries: createdEntries.length,
          matchedEntries: matchedCount,
          unmatchedEntries: unmatchedCount,
          completedAt: new Date(),
          extractionRaw: {
            layoutType,
            pageCount: preprocessed.pageCount,
            detectedRowCount: stageMetrics.detectedRowCount || detectedRowCount || createdEntries.length,
            visibleEntryCount: createdEntries.length,
            stageMetrics,
            isRotated: preprocessed.isRotated || detectedOrientation !== 'UPRIGHT',
            isLowLight: preprocessed.isLowLight || false,
            lightingAdjusted: preprocessed.lightingAdjusted || false,
            entriesCount: createdEntries.length,
            entries: candidateEntries as any,
            raw: rawJson
          } as any
        },
        include: {
          entries: {
            orderBy: { entryIndex: 'asc' }
          }
        }
      });

      await AuditService.log(
        reqObj,
        'SCAN_JOB_CREATED',
        'ScanJob',
        `Logbook scanned: ${originalFilename}. Layout: ${layoutType}. Pages: ${preprocessed.pageCount}. Detected Rows: ${stageMetrics.detectedRowCount}. Extracted: ${createdEntries.length}, Matched: ${matchedCount}, Needs Review: ${unmatchedCount}`,
        jobId,
        null,
        {
          total: createdEntries.length,
          matched: matchedCount,
          unmatched: unmatchedCount,
          layoutType,
          pageCount: preprocessed.pageCount,
          stageMetrics
        }
      );

      return updatedJob;
    } catch (err: any) {
      console.error('[LogbookScannerService] Scan failure:', err);
      await prisma.scanJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          errorMessage: err.message || 'Error occurred during extraction'
        }
      });
      throw err;
    }
  }

  /**
   * Get scan job details and all extracted entries
   */
  public static async getScanJob(jobId: string): Promise<any> {
    const job = await prisma.scanJob.findUnique({
      where: { id: jobId },
      include: {
        entries: {
          orderBy: { entryIndex: 'asc' }
        }
      }
    });

    if (!job) {
      throw new Error('Scan job not found');
    }

    return job;
  }

  /**
   * List recent scan jobs for an officer/department
   */
  public static async listScanJobs(departmentId?: string, limit = 20): Promise<any[]> {
    const where: any = {};
    if (departmentId) where.departmentId = departmentId;

    return prisma.scanJob.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { entries: true }
        }
      }
    });
  }

  /**
   * Update or correct an extracted scan entry
   */
  public static async updateEntry(params: UpdateScanEntryParams): Promise<any> {
    const { entryId, correctedUsn, correctedAmount, correctedReason } = params;

    const existing = await prisma.scanJobEntry.findUnique({
      where: { id: entryId },
      include: { scanJob: true }
    });

    if (!existing) {
      throw new Error('Scan entry not found');
    }

    const dataToUpdate: any = {
      status: 'CORRECTED'
    };

    if (correctedAmount !== undefined) {
      dataToUpdate.correctedAmount = Number(correctedAmount);
    }

    if (correctedReason !== undefined) {
      dataToUpdate.correctedReason = correctedReason.trim();
    }

    // If USN was updated, re-validate strictly against students table
    if (correctedUsn) {
      const normalized = this.normalizeUsn(correctedUsn);
      dataToUpdate.correctedUsn = normalized;

      const student = await prisma.student.findFirst({
        where: { usn: { equals: normalized, mode: 'insensitive' } },
        include: {
          ndcClearances: {
            where: { departmentId: existing.scanJob.departmentId },
            take: 1
          }
        }
      });

      if (student && student.ndcClearances.length > 0) {
        dataToUpdate.matchedStudentId = student.id;
        dataToUpdate.matchedStudentUsn = student.usn;
        dataToUpdate.matchedStudentName = student.fullName;
        dataToUpdate.clearanceId = student.ndcClearances[0].id;
        dataToUpdate.validationErrors = null;
        dataToUpdate.status = 'MATCHED';
      } else if (student) {
        dataToUpdate.matchedStudentId = student.id;
        dataToUpdate.matchedStudentUsn = student.usn;
        dataToUpdate.matchedStudentName = student.fullName;
        dataToUpdate.clearanceId = null;
        dataToUpdate.validationErrors = 'Student exists but has no active clearance in this department.';
        dataToUpdate.status = 'UNMATCHED';
      } else {
        dataToUpdate.validationErrors = `No student found for corrected USN "${normalized}".`;
        dataToUpdate.status = 'UNMATCHED';
      }
    }

    return prisma.scanJobEntry.update({
      where: { id: entryId },
      data: dataToUpdate
    });
  }

  /**
   * Apply approved logbook dues directly to real database clearances via NdcWorkflowService
   */
  /**
   * Apply approved logbook dues directly to real database clearances via DueManagementService.
   * Features:
   * 1. Revalidates authentication, department permissions, student identity, amount, reason, and state.
   * 2. Atomic database transactions per entry with rollback on failure.
   * 3. Multiple dues safety: accumulates rather than silently overwriting existing dues.
   * 4. Durable idempotency: skips already APPLIED entries, prevents duplicate writes.
   * 5. Tracks progress in BackgroundJob and ScanJob so jobs survive browser navigation and refresh.
   * 6. Returns accurate per-entry verified persisted states and failure diagnostics.
   * 7. Preserves separate lab records (Physics, Chemistry, Department Lab).
   */
  public static async applyApprovedEntries(
    jobId: string,
    entryIds: string[],
    lecturerUserId: string,
    reqObj?: any
  ): Promise<any> {
    const job = await prisma.scanJob.findUnique({
      where: { id: jobId },
      include: {
        entries: {
          where: { id: { in: entryIds } }
        }
      }
    });

    if (!job) {
      throw new Error('Scan job not found');
    }

    // Persist scan-job status using BackgroundJob infrastructure so jobs survive refresh
    let bgJob: any = null;
    try {
      bgJob = await prisma.backgroundJob.create({
        data: {
          type: 'LOGBOOK_OCR_APPLY',
          status: 'RUNNING',
          initiatedByUserId: lecturerUserId || null,
          totalRecords: job.entries.length,
          processedRecords: 0,
          insertedRecords: 0,
          updatedRecords: 0,
          skippedRecords: 0,
          failedRecords: 0,
          currentStage: 'PROCESSING_DUES',
          payload: {
            scanJobId: jobId,
            entryIds,
            originalFilename: job.originalFilename
          } as any
        }
      });
    } catch (bgErr) {
      console.warn('[LogbookScannerService] BackgroundJob creation notice:', bgErr);
    }

    const results: any[] = [];
    const applied: any[] = [];
    const failed: any[] = [];
    let appliedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const entry of job.entries) {
      // 1. Idempotency Check: Already applied entry must never duplicate due writes
      if (entry.status === 'APPLIED') {
        skippedCount++;
        results.push({
          entryId: entry.id,
          entryIndex: entry.entryIndex,
          usn: entry.correctedUsn || entry.extractedUsn,
          studentName: entry.matchedStudentName || entry.extractedName,
          amount: entry.correctedAmount ?? entry.extractedAmount,
          reason: entry.correctedReason || entry.extractedReason,
          clearanceId: entry.clearanceId,
          status: 'SKIPPED_ALREADY_APPLIED',
          message: 'Entry was already applied to departmental clearance records.'
        });
        continue;
      }

      // 2. Eligibility & Pre-flight Validation
      if (!entry.clearanceId) {
        failedCount++;
        const errMsg = 'Entry lacks a verified student departmental clearance record.';
        await prisma.scanJobEntry.update({
          where: { id: entry.id },
          data: { status: 'FAILED', errorMessage: errMsg }
        });
        failed.push({ entryId: entry.id, error: errMsg });
        results.push({
          entryId: entry.id,
          entryIndex: entry.entryIndex,
          usn: entry.correctedUsn || entry.extractedUsn,
          studentName: entry.extractedName,
          status: 'FAILED',
          error: errMsg
        });
        continue;
      }

      const amount = entry.correctedAmount ?? entry.extractedAmount;
      const reason = entry.correctedReason || entry.extractedReason || 'Apparatus / Logbook Due';
      const entryIdempotencyKey = `ocr_due_${jobId}_${entry.id}`;

      try {
        // 3. Revalidate auth, permissions, student identity, amount, reason and record due atomically
        const dueResult = await DueManagementService.recordClearanceDue({
          clearanceId: entry.clearanceId,
          amount,
          reason,
          officerUserId: lecturerUserId,
          source: 'LOGBOOK_OCR',
          sourceEntryId: entry.id,
          idempotencyKey: entryIdempotencyKey,
          conflictStrategy: 'ACCUMULATE',
          reqObj
        });

        // 4. Mark entry as APPLIED with durable idempotency key in database
        const updatedEntry = await prisma.scanJobEntry.update({
          where: { id: entry.id },
          data: {
            status: 'APPLIED',
            appliedAt: new Date(),
            idempotencyKey: entryIdempotencyKey,
            errorMessage: null
          }
        });

        appliedCount++;
        applied.push(updatedEntry);
        results.push({
          entryId: entry.id,
          entryIndex: entry.entryIndex,
          usn: dueResult.usn,
          studentName: dueResult.studentName,
          amount: dueResult.addedDueAmount,
          totalDueOnClearance: dueResult.newDueAmount,
          reason,
          clearanceId: entry.clearanceId,
          status: 'SUCCESS',
          persistedClearance: dueResult,
          notification: dueResult.notification
        });
      } catch (entryErr: any) {
        console.error(`[LogbookScannerService] Error applying entry ${entry.id}:`, entryErr);
        failedCount++;
        await prisma.scanJobEntry.update({
          where: { id: entry.id },
          data: {
            status: 'FAILED',
            errorMessage: entryErr.message
          }
        });
        failed.push({ entryId: entry.id, error: entryErr.message });
        results.push({
          entryId: entry.id,
          entryIndex: entry.entryIndex,
          usn: entry.correctedUsn || entry.extractedUsn,
          studentName: entry.matchedStudentName || entry.extractedName,
          status: 'FAILED',
          error: entryErr.message
        });
      }
    }

    // 5. Update BackgroundJob progress & stage
    if (bgJob) {
      try {
        await prisma.backgroundJob.update({
          where: { id: bgJob.id },
          data: {
            status: failedCount > 0 ? (appliedCount > 0 ? 'PARTIALLY_COMPLETED' : 'FAILED') : 'COMPLETED',
            processedRecords: job.entries.length,
            insertedRecords: appliedCount,
            skippedRecords: skippedCount,
            failedRecords: failedCount,
            currentStage: 'COMPLETED',
            completedAt: new Date(),
            resultSummary: { appliedCount, failedCount, skippedCount } as any
          }
        });
      } catch (bgUpdateErr) {
        console.warn('[LogbookScannerService] BackgroundJob update notice:', bgUpdateErr);
      }
    }

    // 6. Refresh scan job overall tally & status
    const allJobEntries = await prisma.scanJobEntry.findMany({
      where: { scanJobId: jobId }
    });
    const totalApplied = allJobEntries.filter((e) => e.status === 'APPLIED').length;
    const totalFailed = allJobEntries.filter((e) => e.status === 'FAILED').length;
    const finalJobStatus = totalApplied >= allJobEntries.length
      ? 'APPROVED'
      : totalApplied > 0
      ? 'PARTIALLY_APPROVED'
      : (totalFailed === allJobEntries.length ? 'FAILED' : 'REVIEWING');

    const updatedJob = await prisma.scanJob.update({
      where: { id: jobId },
      data: {
        status: finalJobStatus as any,
        appliedEntries: totalApplied,
        approvedEntries: totalApplied,
        failedEntries: totalFailed
      }
    });

    // 7. Write audit entry for batch completion
    await AuditService.log(
      reqObj,
      'SCAN_ENTRIES_APPLIED',
      'ScanJob',
      `Applied ${appliedCount} dues from Logbook scan (${job.originalFilename}) with ${failedCount} failures and ${skippedCount} skipped.`,
      jobId,
      null,
      { appliedCount, failedCount, skippedCount, totalApplied }
    );

    return {
      success: true,
      jobId,
      appliedCount,
      failedCount,
      skippedCount,
      job: updatedJob,
      applied,
      failed,
      results
    };
  }

  // ─────────────────────────────────────────────────────────────
  // HELPER OCR NORMALIZER
  // ─────────────────────────────────────────────────────────────

  public static normalizeUsn(raw: string): string {
    if (!raw) return '';
    let cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');

    // Common OCR misreads for Indian college USNs (e.g. 4MC21CS001, 4MC22IS022)
    if (
      cleaned.startsWith('AMC') ||
      cleaned.startsWith('HMC') ||
      cleaned.startsWith('4NC') ||
      cleaned.startsWith('4MO') ||
      cleaned.startsWith('IMC') ||
      cleaned.startsWith('LMC') ||
      cleaned.startsWith('4MG') ||
      cleaned.startsWith('4ME') ||
      cleaned.startsWith('4MD')
    ) {
      cleaned = '4MC' + cleaned.substring(3);
    } else if (cleaned.startsWith('4M') && cleaned.length >= 4 && !cleaned.startsWith('4MC')) {
      cleaned = '4MC' + cleaned.substring(2);
    }

    // Standard VTU format: 4MC{YY}{BRANCH}{NUM}
    const match = cleaned.match(/^([1-4][A-Z]{2})([A-Z0-9]{2})([A-Z0-9]{2})([A-Z0-9]{3})$/);
    if (match) {
      const college = match[1];
      let year = match[2].replace(/O/g, '0').replace(/[IL]/g, '1').replace(/Z/g, '2').replace(/S/g, '5');
      let dept = match[3];
      if (dept === '1S') dept = 'IS';
      if (dept === 'C5') dept = 'CS';
      if (dept === 'A1') dept = 'AI';
      if (dept === 'E0') dept = 'EC';
      let num = match[4].replace(/[OD]/g, '0').replace(/[IL]/g, '1').replace(/Z/g, '2').replace(/S/g, '5').replace(/B/g, '8');
      cleaned = `${college}${year}${dept}${num}`;
    }

    return cleaned;
  }

  /**
   * Deterministically calculate clearly labeled heuristic uncertainty score
   * when OCR provider confidence is absent or indeterminate
   */
  public static calculateHeuristicConfidence(item: ExtractedLogbookEntry, student?: any): number {
    let score = 0.50; // Base baseline

    // Exact USN match against registered student in database
    if (student) {
      score += 0.25;
    } else if (item.normalizedUsn && /^[1-4][A-Z]{2}\d{2}[A-Z]{2}\d{3}$/.test(item.normalizedUsn)) {
      score += 0.15; // Valid Karnataka VTU pattern even if not yet in DB
    }

    // Visible positive amount
    if (item.amount && item.amount > 0 && !item.isAmountUncertain) {
      score += 0.15;
    }

    // Visible reason
    if (item.reason && item.reason.trim().length > 2) {
      score += 0.10;
    }

    // Penalties for uncertainty
    if (item.isUsnUncertain) {
      score -= 0.30;
    }

    if (item.isAmountUncertain) {
      score -= 0.20;
    }

    if (item.isCrossedOut) {
      score -= 0.35;
    }

    return Math.max(0.05, Math.min(0.99, parseFloat(score.toFixed(2))));
  }
}
