import api from './api';

export interface AssistantMessage {
  role: 'user' | 'model';
  content: string;
}

export interface ExtractedActionItem {
  actionId: string;
  action: 'CLEAR_DUE' | 'MARK_DUE' | 'HOLD';
  usn: string;
  studentId: string;
  studentName: string;
  clearanceId: string;
  amount?: number;
  reason: string;
  labName?: string;
  departmentCode: string;
  departmentName: string;
  consequences: string;
}

export interface ActionRequired {
  token: string;
  action: 'CLEAR_DUE' | 'MARK_DUE' | 'HOLD' | 'BATCH_OPERATION';
  studentId: string;
  studentName: string;
  usn: string;
  clearanceId: string;
  amount?: number;
  reason?: string;
  labName?: string;
  departmentName?: string;
  consequences?: string;
  expiresAt: string;
  batchActions?: ExtractedActionItem[];
  status?: 'STAGED' | 'CONFIRMED' | 'EXECUTED' | 'CANCELLED' | 'FAILED' | 'REVERSED' | 'SUPERSEDED' | 'EXPIRED';
  lifecycleStatus?: 'STAGED' | 'CONFIRMED' | 'EXECUTED' | 'CANCELLED' | 'FAILED' | 'REVERSED' | 'SUPERSEDED' | 'EXPIRED';
}

export interface AssistantResponse {
  reply: string;
  actionRequired?: ActionRequired | null;
  suggestions?: string[];
}

export interface ConversationLogItem {
  id: string;
  userId: string;
  departmentCode: string;
  role: 'user' | 'model';
  content: string;
  actionRequired?: ActionRequired | null;
  actionExecuted?: boolean;
  actionCancelled?: boolean;
  actionExpired?: boolean;
  metadata?: {
    suggestions?: string[];
    notification?: {
      deliveryStatus?: 'QUEUED' | 'ACCEPTED' | 'FAILED' | 'UNCERTAIN';
      messageId?: string;
      lastError?: string;
    };
  };
  createdAt: string;
}

export interface StageMetrics {
  detectedRowCount: number;
  candidateRowCount: number;
  validRowCount: number;
  crossedOutRowCount: number;
  blankLinesSkippedCount: number;
  discrepancyExplanation: string;
}

export interface BoundingBoxCoordinates {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export interface ExtractionRawEntry {
  pageNumber?: number;
  rowNumber?: number;
  sourceRegion?: string;
  boundingBox?: BoundingBoxCoordinates;
  rawText?: string;
  rawUsn?: string;
  normalizedUsn?: string;
  isUsnUncertain?: boolean;
  studentName?: string;
  amount?: number | null;
  isAmountUncertain?: boolean;
  reason?: string;
  date?: string;
  confidence?: number;
  confidenceMethod?: 'PROVIDER_CONFIDENCE' | 'HEURISTIC_ESTIMATE';
  isCrossedOut?: boolean;
  visualArtifacts?: string;
}

export interface ScanJobExtractionRaw {
  layoutType?: string;
  pageCount?: number;
  detectedRowCount?: number;
  visibleEntryCount?: number;
  stageMetrics?: StageMetrics;
  isRotated?: boolean;
  isLowLight?: boolean;
  lightingAdjusted?: boolean;
  entriesCount?: number;
  entries?: ExtractionRawEntry[];
  raw?: string;
}

export interface ScanEntry {
  id: string;
  scanJobId: string;
  entryIndex: number;
  status: 'PENDING_REVIEW' | 'MATCHED' | 'UNMATCHED' | 'CORRECTED' | 'APPROVED' | 'REJECTED' | 'APPLIED' | 'FAILED';
  extractedUsn: string;
  extractedName: string;
  extractedAmount: number;
  extractedReason: string;
  extractedDate: string;
  confidence: number;
  matchedStudentId?: string | null;
  matchedStudentUsn?: string | null;
  matchedStudentName?: string | null;
  correctedUsn?: string | null;
  correctedAmount?: number | null;
  correctedReason?: string | null;
  validationErrors?: string | null;
  clearanceId?: string | null;
  appliedAt?: string | null;
}

export interface ScanJob {
  id: string;
  lecturerUserId: string;
  departmentId: string;
  labId?: string | null;
  status: 'UPLOADING' | 'EXTRACTING' | 'EXTRACTED' | 'REVIEWING' | 'APPROVED' | 'PARTIALLY_APPROVED' | 'FAILED' | 'CANCELLED';
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  totalEntries: number;
  matchedEntries: number;
  unmatchedEntries: number;
  approvedEntries: number;
  appliedEntries: number;
  failedEntries: number;
  errorMessage?: string | null;
  extractionRaw?: ScanJobExtractionRaw | null;
  createdAt: string;
  entries: ScanEntry[];
}

export interface ParsedForensicDetails {
  pageNumber: number;
  rowNumber: number;
  sourceRegion: string;
  boundingBox?: BoundingBoxCoordinates;
  rawText: string;
  confidencePercent: number;
  confidenceMethod: 'PROVIDER_CONFIDENCE' | 'HEURISTIC_ESTIMATE';
  isCrossedOut: boolean;
  isUsnUncertain: boolean;
  isAmountUncertain: boolean;
  validationErrorMessages: string[];
}

/**
 * Parses forensic details from either the raw extraction entry metadata
 * or the formatted validationErrors string stored on the candidate record.
 */
export function parseEntryForensics(
  entry: ScanEntry,
  rawMeta?: ExtractionRawEntry | null
): ParsedForensicDetails {
  const errorsStr = entry.validationErrors || '';

  // 1. Page and Row
  let pageNumber = rawMeta?.pageNumber ?? 1;
  let rowNumber = rawMeta?.rowNumber ?? entry.entryIndex;
  let sourceRegion = rawMeta?.sourceRegion || `Row ${rowNumber}`;

  const pageMatch = errorsStr.match(/\[Page\s+(\d+)\s*\|\s*Row\s+(\d+)(?:\s*\|\s*Region:\s*([^\]]+))?\]/);
  if (pageMatch) {
    if (!rawMeta?.pageNumber && pageMatch[1]) pageNumber = parseInt(pageMatch[1], 10);
    if (!rawMeta?.rowNumber && pageMatch[2]) rowNumber = parseInt(pageMatch[2], 10);
    if (!rawMeta?.sourceRegion && pageMatch[3]) sourceRegion = pageMatch[3].trim();
  }

  // 2. Bounding Box
  let boundingBox = rawMeta?.boundingBox;
  if (!boundingBox) {
    const boxMatch = errorsStr.match(/\[Box:\s*y:(\d+)-(\d+),\s*x:(\d+)-(\d+)\]/);
    if (boxMatch) {
      boundingBox = {
        ymin: parseInt(boxMatch[1], 10),
        ymax: parseInt(boxMatch[2], 10),
        xmin: parseInt(boxMatch[3], 10),
        xmax: parseInt(boxMatch[4], 10)
      };
    }
  }

  // 3. Raw OCR Text
  let rawText = rawMeta?.rawText || '';
  if (!rawText) {
    const rawTextMatch = errorsStr.match(/\[Raw Text:\s*"([^"]*)"\]/);
    if (rawTextMatch) {
      rawText = rawTextMatch[1];
    }
  }

  // 4. Confidence and Method
  let confidenceMethod: 'PROVIDER_CONFIDENCE' | 'HEURISTIC_ESTIMATE' =
    rawMeta?.confidenceMethod || (errorsStr.includes('via PROVIDER_CONFIDENCE') ? 'PROVIDER_CONFIDENCE' : 'HEURISTIC_ESTIMATE');
  const confidencePercent = Math.round((entry.confidence ?? rawMeta?.confidence ?? 0.8) * 100);

  // 5. Semantic flags
  const isCrossedOut = Boolean(rawMeta?.isCrossedOut || errorsStr.includes('[Crossed-Out Entry]'));
  const isUsnUncertain = Boolean(
    rawMeta?.isUsnUncertain ||
    errorsStr.includes('[Unclear USN]') ||
    entry.extractedUsn.includes('?') ||
    !entry.extractedUsn.trim()
  );
  const amount = entry.correctedAmount ?? entry.extractedAmount;
  const isAmountUncertain = Boolean(
    rawMeta?.isAmountUncertain ||
    errorsStr.includes('[Uncertain Amount]') ||
    amount <= 0
  );

  // 6. Validation Error Messages (extracted after '--')
  const validationErrorMessages: string[] = [];
  const parts = errorsStr.split('--');
  if (parts.length > 1) {
    const errorText = parts.slice(1).join('--').trim();
    // Match individual bracketed errors like [Crossed-Out Entry] or [Unclear USN]
    const matches = errorText.match(/\[[^\]]+\][^[]*/g);
    if (matches && matches.length > 0) {
      for (const m of matches) {
        const trimmed = m.trim();
        if (trimmed && trimmed !== '[Verified legible]') {
          validationErrorMessages.push(trimmed);
        }
      }
    } else if (errorText && errorText !== '[Verified legible]') {
      validationErrorMessages.push(errorText);
    }
  }

  return {
    pageNumber,
    rowNumber,
    sourceRegion,
    boundingBox,
    rawText,
    confidencePercent,
    confidenceMethod,
    isCrossedOut,
    isUsnUncertain,
    isAmountUncertain,
    validationErrorMessages
  };
}

/**
 * Strict eligibility check for approving candidate OCR entries:
 * 1. Must not already be APPLIED
 * 2. Must have a real student matched in the database
 * 3. Must have an active departmental clearance record (clearanceId)
 * 4. Must have an unambiguous, non-empty USN
 * 5. Must have a fine amount > 0
 * 6. Must not be a crossed-out entry
 */
export function checkEntryApprovalEligibility(entry: ScanEntry): {
  isEligible: boolean;
  blockerReason?: string;
} {
  if (entry.status === 'APPLIED') {
    return {
      isEligible: false,
      blockerReason: 'Already applied to departmental clearance records'
    };
  }

  const effectiveUsn = (entry.correctedUsn || entry.extractedUsn || '').trim();
  if (!effectiveUsn || effectiveUsn.includes('?') || entry.validationErrors?.includes('[Unclear USN]')) {
    return {
      isEligible: false,
      blockerReason: 'Ambiguous or unreadable USN. Manual USN correction required before approval.'
    };
  }

  if (!entry.matchedStudentName && !entry.matchedStudentId) {
    return {
      isEligible: false,
      blockerReason: 'Student could not be found in institutional database. Match required.'
    };
  }

  if (!entry.clearanceId) {
    return {
      isEligible: false,
      blockerReason: 'Student exists in registry but has no active clearance record in this department.'
    };
  }

  const effectiveAmount = entry.correctedAmount ?? entry.extractedAmount;
  if (!effectiveAmount || effectiveAmount <= 0 || entry.validationErrors?.includes('[Uncertain Amount]')) {
    return {
      isEligible: false,
      blockerReason: 'Amount is 0 or uncertain. Enter fine amount before approval.'
    };
  }

  if (entry.validationErrors?.includes('[Crossed-Out Entry]')) {
    return {
      isEligible: false,
      blockerReason: 'Candidate row was visibly crossed out in physical logbook.'
    };
  }

  return { isEligible: true };
}

export const aiService = {
  /**
   * Authoritative AI and scanner context resolution
   */
  async getAiContext(departmentCode?: string): Promise<{ context: any; stats: any }> {
    const res = await api.get('/ai/assistant/context', {
      params: departmentCode ? { departmentCode } : {}
    });
    return res.data?.data;
  },

  /**
   * Chat with Department or Administration AI Assistant
   */
  async chatWithAssistant(
    messages: AssistantMessage[],
    departmentCode?: string
  ): Promise<AssistantResponse> {
    const res = await api.post('/ai/assistant/chat', {
      messages,
      ...(departmentCode ? { departmentCode } : {})
    });
    return res.data?.data;
  },

  /**
   * Confirm and execute a staged mutation
   */
  async confirmAssistantAction(token: string): Promise<any> {
    const res = await api.post('/ai/assistant/confirm', { token });
    return res.data?.data;
  },

  /**
   * Cancel a staged mutation before execution
   */
  async cancelAssistantAction(token: string): Promise<any> {
    const res = await api.post('/ai/assistant/cancel', { token });
    return res.data?.data;
  },

  /**
   * Edit a staged mutation before confirmation
   */
  async editAssistantAction(params: {
    token: string;
    amount?: number;
    reason?: string;
    usn?: string;
  }): Promise<AssistantResponse> {
    const res = await api.post('/ai/assistant/edit', params);
    return res.data?.data;
  },

  /**
   * Retrieve stored conversation history for the officer's or admin's department
   */
  async getConversationHistory(departmentCode?: string, limit = 50): Promise<ConversationLogItem[]> {
    const res = await api.get('/ai/assistant/history', {
      params: { ...(departmentCode ? { departmentCode } : {}), limit }
    });
    return res.data?.data || [];
  },

  /**
   * Clear active conversation history for the officer's or admin's department
   */
  async clearConversationHistory(departmentCode?: string): Promise<void> {
    await api.delete('/ai/assistant/history', {
      params: departmentCode ? { departmentCode } : {}
    });
  },

  /**
   * Upload logbook file for AI extraction
   */
  async uploadLogbook(file: File, departmentId?: string, labId?: string): Promise<ScanJob> {
    const formData = new FormData();
    formData.append('file', file);
    if (departmentId) formData.append('departmentId', departmentId);
    if (labId) formData.append('labId', labId);

    const res = await api.post('/ai/scanner/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    return res.data?.data;
  },

  /**
   * Get scan job details and entries
   */
  async getScanJob(jobId: string): Promise<ScanJob> {
    const res = await api.get(`/ai/scanner/jobs/${jobId}`);
    return res.data?.data;
  },

  /**
   * List recent scan jobs
   */
  async listScanJobs(departmentId?: string): Promise<ScanJob[]> {
    const res = await api.get('/ai/scanner/jobs', {
      params: { departmentId }
    });
    return res.data?.data || [];
  },

  /**
   * Correct or edit an extracted entry
   */
  async updateScanEntry(
    entryId: string,
    corrections: {
      correctedUsn?: string;
      correctedAmount?: number;
      correctedReason?: string;
    }
  ): Promise<ScanEntry> {
    const res = await api.patch(`/ai/scanner/entries/${entryId}`, corrections);
    return res.data?.data;
  },

  /**
   * Batch apply approved entries to live student records
   */
  async applyScanEntries(jobId: string, entryIds: string[]): Promise<any> {
    const res = await api.post(`/ai/scanner/jobs/${jobId}/apply`, { entryIds });
    return res.data?.data;
  },

  /**
   * Get direct URL to view original or preprocessed logbook image
   */
  getJobImageUrl(jobId: string, processed = false): string {
    return `/api/ai/scanner/jobs/${jobId}/image${processed ? '?processed=true' : ''}`;
  }
};
