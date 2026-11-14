import { DepartmentClearanceStatus } from '../../constants/statuses';

export enum WorkflowState {
  IDLE = 'IDLE',
  INTENT_IDENTIFIED = 'INTENT_IDENTIFIED',
  REQUIRED_INFORMATION_MISSING = 'REQUIRED_INFORMATION_MISSING',
  RECORD_RETRIEVED = 'RECORD_RETRIEVED',
  VALIDATION_IN_PROGRESS = 'VALIDATION_IN_PROGRESS',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  READY_FOR_CONFIRMATION = 'READY_FOR_CONFIRMATION',
  AWAITING_CONFIRMATION = 'AWAITING_CONFIRMATION',
  ACTION_EXECUTING = 'ACTION_EXECUTING',
  ACTION_SUCCEEDED = 'ACTION_SUCCEEDED',
  ACTION_FAILED = 'ACTION_FAILED',
  ALREADY_COMPLETED = 'ALREADY_COMPLETED'
}

export enum ActionLifecycleState {
  STAGED = 'STAGED',
  CONFIRMED = 'CONFIRMED',
  EXECUTED = 'EXECUTED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
  REVERSED = 'REVERSED',
  SUPERSEDED = 'SUPERSEDED',
  EXPIRED = 'EXPIRED'
}

export type AssistantWorkflowIntent =
  | 'CLEAR_DUE'
  | 'MARK_DUE'
  | 'STUDENT_LOOKUP'
  | 'VIEW_PENDING_DUES'
  | 'DEPARTMENT_REPORT'
  | 'CANCEL_ACTION'
  | 'EDIT_STAGED_ACTION'
  | 'CONTRADICTORY'
  | 'GENERAL_QUERY';

export interface ConversationTurnState {
  state: WorkflowState;
  intent: AssistantWorkflowIntent;
  usn: string | null;
  amount: number | null;
  reason: string | null;
  isContinuation: boolean;
  previousPendingField: 'USN' | 'AMOUNT' | 'REASON' | 'CONFIRMATION' | 'ACTION_DECISION' | null;
  originalRequestText?: string;
}

export class WorkflowStateMachine {
  private static readonly USN_REGEX = /\b(4MC\d{2}[A-Z]{2}\d{3})\b/i;
  private static readonly AMOUNT_REGEX = /(?:(?:rs\.?|inr|₹)\s*(\d+(?:,\d+)*(?:\.\d{1,2})?)|(\d+(?:,\d+)*(?:\.\d{1,2})?)\s*(?:rs\.?|inr|₹|rupees))/i;

  /**
   * Analyze conversation history to recover multi-turn workflow context.
   * If a user previously requested an operation (e.g. CLEAR_DUE) and the assistant asked for USN,
   * a subsequent message containing that USN will continue the original workflow rather than defaulting
   * to a dead-end record display.
   */
  public static analyzeHistory(
    messages: Array<{ role: string; content: string }>,
    activeTokenPayload?: any
  ): ConversationTurnState {
    if (!messages || messages.length === 0) {
      return {
        state: WorkflowState.IDLE,
        intent: 'GENERAL_QUERY',
        usn: null,
        amount: null,
        reason: null,
        isContinuation: false,
        previousPendingField: null
      };
    }

    const lastMessage = messages[messages.length - 1]?.content || '';
    const lowerLast = lastMessage.toLowerCase().trim();

    // 1. Extract entities directly present in the latest message
    const currentUsn = this.extractUsn(lastMessage);
    const currentAmount = this.extractAmount(lastMessage);

    // 2. Scan backwards for existing USN in earlier turns
    let contextUsn = currentUsn;
    if (!contextUsn) {
      for (let i = messages.length - 2; i >= 0; i--) {
        const u = this.extractUsn(messages[i].content);
        if (u) {
          contextUsn = u;
          break;
        }
      }
      if (!contextUsn && activeTokenPayload?.usn) {
        contextUsn = activeTokenPayload.usn;
      }
    }

    // Explicit negative instructions always stop due creation, even if another layer detects ADD_DUE.
    if (this.hasExplicitAddDueProhibition(lastMessage)) {
      return {
        state: WorkflowState.VALIDATION_FAILED,
        intent: 'CONTRADICTORY',
        usn: contextUsn,
        amount: currentAmount,
        reason: 'The current message explicitly prohibits creating or adding a due.',
        isContinuation: false,
        previousPendingField: null
      };
    }

    // 3. Inspect immediately preceding model turn (if any) to see what information was pending
    let previousPendingField: ConversationTurnState['previousPendingField'] = null;
    let pendingIntent: AssistantWorkflowIntent | null = null;
    let pendingAmount: number | null = null;
    let pendingReason: string | null = null;
    let originalRequestText: string | undefined;

    // Find the last model message and the user message preceding it
    let lastModelIndex = -1;
    for (let i = messages.length - 2; i >= 0; i--) {
      if (messages[i].role === 'model') {
        lastModelIndex = i;
        break;
      }
    }

    if (lastModelIndex !== -1) {
      const modelContent = messages[lastModelIndex].content;
      const lowerModel = modelContent.toLowerCase();

    // Check if the last model turn was a completion or final outcome message
    const isCompletedTurn =
      lowerModel.includes('approved successfully') ||
      lowerModel.includes('added successfully') ||
      lowerModel.includes('updated successfully') ||
      lowerModel.includes('action cancelled') ||
      lowerModel.includes('action was cancelled') ||
      lowerModel.includes('clearance already completed') ||
      lowerModel.includes('no changes have been made') ||
      lowerModel.includes('live records remain completely unchanged') ||
      lowerModel.includes('live records were updated');

    let priorUserTurn = '';
    if (!isCompletedTurn) {
      // Find the user turn that triggered this model message
      for (let j = lastModelIndex - 1; j >= 0; j--) {
        if (messages[j].role === 'user') {
          priorUserTurn = messages[j].content;
          break;
        }
      }

      // Check what operation was requested in earlier user turns
      if (this.hasClearDueSignal(priorUserTurn)) {
        pendingIntent = 'CLEAR_DUE';
        originalRequestText = priorUserTurn;
      } else if (this.hasAddDueSignal(priorUserTurn)) {
        pendingIntent = 'MARK_DUE';
        pendingAmount = this.extractAmount(priorUserTurn);
        originalRequestText = priorUserTurn;
      } else if (this.hasLookupSignal(priorUserTurn)) {
        pendingIntent = 'STUDENT_LOOKUP';
        originalRequestText = priorUserTurn;
      }

      if (
        lowerModel.includes('student usn') ||
        lowerModel.includes('missing student usn') ||
        lowerModel.includes('missing required information') ||
        lowerModel.includes('specify the student') ||
        lowerModel.includes('provide the student') ||
        lowerModel.includes('reply with the student') ||
        lowerModel.includes('student usn to clear') ||
        lowerModel.includes('student usn to add') ||
        lowerModel.includes('pending information')
      ) {
        previousPendingField = 'USN';
      } else if (
        lowerModel.includes('invalid due amount') ||
        lowerModel.includes('specify a valid due amount') ||
        lowerModel.includes('specify the due amount')
      ) {
        previousPendingField = 'AMOUNT';
        pendingIntent = 'MARK_DUE';
        originalRequestText = priorUserTurn;
      } else if (
        lowerModel.includes('student clearance record') ||
        lowerModel.includes('student institutional clearance') ||
        lowerModel.includes('currently focused student')
      ) {
        previousPendingField = 'ACTION_DECISION';
      } else if (
        lowerModel.includes('confirmation required') ||
        lowerModel.includes('review the details in the confirmation card')
      ) {
        previousPendingField = 'CONFIRMATION';
      }
    }
  }

    // 4. Determine Intent and Workflow State Transitions
    // A. Check for cancellation
    if (
      /\b(cancel\s+(?:that|it|action|due|the\s+due|request)|cancel|never\s*mind|abort|don't\s+do\s+that|drop\s+that\s+charge|dismiss)\b/i.test(lowerLast)
    ) {
      return {
        state: WorkflowState.IDLE,
        intent: 'CANCEL_ACTION',
        usn: contextUsn,
        amount: currentAmount,
        reason: null,
        isContinuation: false,
        previousPendingField
      };
    }

    // B. Check for contradictions in current message
    if (this.hasClearDueSignal(lastMessage) && this.hasAddDueSignal(lastMessage)) {
      return {
        state: WorkflowState.VALIDATION_FAILED,
        intent: 'CONTRADICTORY',
        usn: contextUsn,
        amount: currentAmount,
        reason: 'User requested both clearance approval and due creation in the same query.',
        isContinuation: false,
        previousPendingField
      };
    }

    // C. Follow-up after model asked for USN or when completing a pending operation
    if (
      currentUsn &&
      (previousPendingField === 'USN' || pendingIntent === 'CLEAR_DUE' || pendingIntent === 'MARK_DUE') &&
      !this.hasLookupSignal(lastMessage)
    ) {
      // Prioritize explicit action signal in current message if present
      const targetIntent = this.hasClearDueSignal(lastMessage)
        ? 'CLEAR_DUE'
        : this.hasAddDueSignal(lastMessage)
        ? 'MARK_DUE'
        : (pendingIntent || 'CLEAR_DUE');
      return {
        state: WorkflowState.RECORD_RETRIEVED,
        intent: targetIntent,
        usn: currentUsn,
        amount: currentAmount || pendingAmount,
        reason: pendingReason,
        isContinuation: true,
        previousPendingField: previousPendingField || 'USN',
        originalRequestText
      };
    }

    // D. Follow-up after model asked for Amount
    if (previousPendingField === 'AMOUNT' && (currentAmount !== null || currentUsn)) {
      return {
        state: WorkflowState.RECORD_RETRIEVED,
        intent: 'MARK_DUE',
        usn: currentUsn || contextUsn,
        amount: currentAmount,
        reason: null,
        isContinuation: true,
        previousPendingField,
        originalRequestText
      };
    }

    // E. Short affirmative follow-up to student lookup: "clear it", "approve it", "proceed", "yes, clear it"
    if (
      contextUsn && (
        /\b(clear\s+(?:it|this|clearance|dues?|the\s+clearance)|approve\s+(?:it|clearance|no\s*due)|mark\s+(?:as\s+)?cleared|grant\s+clearance)\b/i.test(lowerLast) ||
        ((lowerLast === 'yes' || lowerLast === 'proceed' || lowerLast === 'approve' || lowerLast === 'clear') && previousPendingField === 'ACTION_DECISION')
      )
    ) {
      return {
        state: WorkflowState.RECORD_RETRIEVED,
        intent: 'CLEAR_DUE',
        usn: contextUsn,
        amount: 0,
        reason: 'Clearance verified and approved as No Due',
        isContinuation: true,
        previousPendingField
      };
    }

    // F. Direct CLEAR_DUE command in current turn
    if (this.hasClearDueSignal(lastMessage)) {
      return {
        state: contextUsn ? WorkflowState.RECORD_RETRIEVED : WorkflowState.REQUIRED_INFORMATION_MISSING,
        intent: 'CLEAR_DUE',
        usn: contextUsn,
        amount: 0,
        reason: null,
        isContinuation: false,
        previousPendingField
      };
    }

    // G. Direct ADD_DUE command in current turn
    if (this.hasAddDueSignal(lastMessage)) {
      return {
        state: contextUsn && currentAmount !== null ? WorkflowState.RECORD_RETRIEVED : WorkflowState.REQUIRED_INFORMATION_MISSING,
        intent: 'MARK_DUE',
        usn: contextUsn,
        amount: currentAmount,
        reason: null,
        isContinuation: false,
        previousPendingField
      };
    }

    // H. Direct Student Lookup
    if (
      this.hasLookupSignal(lastMessage) ||
      (currentUsn && !previousPendingField && lowerLast.length <= 15)
    ) {
      return {
        state: contextUsn ? WorkflowState.RECORD_RETRIEVED : WorkflowState.REQUIRED_INFORMATION_MISSING,
        intent: 'STUDENT_LOOKUP',
        usn: contextUsn,
        amount: null,
        reason: null,
        isContinuation: false,
        previousPendingField
      };
    }

    // I. Inquiries (Pending Dues / Department Report)
    if (
      /\b(who\s+(?:hasn't|has\s+not|has)\s+(?:cleared|paid)|pending\s+dues?|outstanding\s+dues?|list\s+dues?|show\s+dues?)\b/i.test(lowerLast)
    ) {
      return {
        state: WorkflowState.INTENT_IDENTIFIED,
        intent: 'VIEW_PENDING_DUES',
        usn: null,
        amount: null,
        reason: null,
        isContinuation: false,
        previousPendingField
      };
    }

    if (
      /\b(department\s+report|clearance\s+report|summary|statistics|stats|overview|how\s+many\s+clearances?)\b/i.test(lowerLast)
    ) {
      return {
        state: WorkflowState.INTENT_IDENTIFIED,
        intent: 'DEPARTMENT_REPORT',
        usn: null,
        amount: null,
        reason: null,
        isContinuation: false,
        previousPendingField
      };
    }

    // Default fallback
    return {
      state: WorkflowState.IDLE,
      intent: 'GENERAL_QUERY',
      usn: contextUsn,
      amount: currentAmount,
      reason: null,
      isContinuation: false,
      previousPendingField
    };
  }

  // ─────────────────────────────────────────────────────────────
  // INTENT SIGNALS
  // ─────────────────────────────────────────────────────────────

  public static hasClearDueSignal(text: string): boolean {
    const lower = text.toLowerCase();
    const isClearingCharge =
      /\b(remove|waive|drop|cancel|clear)\s+(?:that\s+|the\s+)?(?:charge|due|fine)\b/i.test(lower) ||
      /\breturned\s+(?:the\s+)?apparatus\b/i.test(lower);

    return (
      isClearingCharge ||
      /\b(clear|cleared|approve|approved|waive|waived|forgive)\b/i.test(lower) ||
      /\bno[ _-]?dues?\b/i.test(lower) ||
      /\bmark\b.*?\b(?:as\s+)?(?:cleared|complete|completed|no[ _-]?due)\b/i.test(lower) ||
      /\bmark\s+(?:this\s+student(?:'s)?\s+)?(?:[a-z\s]+)?clearance\s+as\s+complete\b/i.test(lower) ||
      /\bclear\s+all\s+(?:outstanding\s+)?dues\b/i.test(lower) ||
      /\b(grant|give)\s+(?:no[ _-]?due|clearance)\b/i.test(lower) ||
      /\bapprove\s+no[ _-]?dues?\b/i.test(lower)
    );
  }

  public static hasExplicitAddDueProhibition(text: string): boolean {
    const patterns = [
      /\\b(?:do\\s+not|don['’]?t|never|must\\s+not|mustn['’]?t|should\\s+not|shouldn['’]?t|cannot|can['’]?t|refrain\\s+from)\\b.{0,100}\\b(?:add(?:ing)?|creat(?:e|ing)|record(?:ing)?|impos(?:e|ing)|charg(?:e|ing)|bill(?:ing)?|enter(?:ing)?|mak(?:e|ing))\\b.{0,50}\\b(?:any\\s+)?(?:new\\s+)?(?:dues?|fines?|charges?|fees?|penalt(?:y|ies))\\b/i,
      /\\b(?:no|zero)\\s+(?:new\\s+)?(?:dues?|fines?|charges?|fees?|penalt(?:y|ies))\\s+(?:entry|record|to\\s+be\\s+added)\\b/i,
      /\\bmake\\s+no\\s+(?:due|charge|fine|fee|penalty)\\s+entry\\b/i,
      /\\b(?:do\\s+not|don['’]?t|never|must\\s+not|mustn['’]?t|should\\s+not|shouldn['’]?t|cannot|can['’]?t)\\b.{0,40}\\b(?:charge|bill)\\b.{0,30}\\b(?:the\\s+)?(?:student|them|this\\s+person)\\b/i,
      /\\bnot\\s+to\\s+(?:add|create|record|impose)\\b.{0,50}\\b(?:dues?|fines?|charges?|fees?|penalt(?:y|ies))\\b/i,
      /\\bwithout\\s+(?:actually\\s+)?(?:add(?:ing)?|creat(?:e|ing)|record(?:ing)?)\\b.{0,40}\\b(?:dues?|fines?|charges?|fees?|penalt(?:y|ies))\\b/i
    ];
    return patterns.some((pattern) => pattern.test(text));
  }

  public static hasAddDueSignal(text: string): boolean {
    if (this.hasExplicitAddDueProhibition(text)) return false;
    const lower = text.toLowerCase();
    const isClearingCharge =
      /\b(remove|waive|drop|cancel|clear)\s+(?:that\s+|the\s+)?(?:charge|due|fine)\b/i.test(lower) ||
      /\breturned\s+(?:the\s+)?apparatus\b/i.test(lower);

    if (isClearingCharge) return false;

    return (
      /\b(add|mark|record|charge|impose|fine|penalize|bill|change|update|modify|set)\b.*?\b(dues?|fine|penalty|fee|amount)\b/i.test(lower) ||
      /\b(fine|penalty|due|charge|fee)\s+(?:of\s+)?(?:₹|rs\.?|inr)?\s*\d+/i.test(lower) ||
      /\bput\s+(?:a\s+)?(?:fine|due|charge|penalty)\s+of\s+(?:₹|rs\.?|inr)?\s*\d+/i.test(lower) ||
      /\b(?:fine|penalty|charge|impose|penalize)\b/i.test(lower) ||
      (/\b(broke|damage|breaking|damaged|breakage|lost|missing|snapped)\b/i.test(lower) &&
        (this.extractAmount(text) !== null || /\b(charge|fine|fee|due|penalize|cost)\b/i.test(lower))) ||
      /\b(?:adding|modifying|updating)\s+(?:an\s+)?outstanding\s+due\b/i.test(lower) ||
      (/\b(add|record|charge|impose|bill|change|update|modify|set)\b/i.test(lower) && this.extractAmount(text) !== null)
    );
  }

  public static hasLookupSignal(text: string): boolean {
    const lower = text.toLowerCase();
    return (
      /\b(lookup|search|find|inspect|check|view|get|read)\b.*?\b(student|usn|clearance|record|status)\b/i.test(lower) ||
      /\b(clearance|details|status)\s+for\b/i.test(lower) ||
      /\bcheck\s+(?:whether|if)\b/i.test(lower) ||
      /\bstatus\s+of\b/i.test(lower)
    );
  }

  public static extractUsn(text: string): string | null {
    const match = text.match(this.USN_REGEX);
    return match ? match[1].toUpperCase() : null;
  }

  public static extractAmount(text: string): number | null {
    const match = text.match(this.AMOUNT_REGEX);
    if (!match) return null;
    const rawNum = (match[1] || match[2] || '').replace(/,/g, '');
    const val = parseFloat(rawNum);
    return isNaN(val) ? null : val;
  }

  // ─────────────────────────────────────────────────────────────
  // STANDARDIZED 7-POINT USER-FACING RESPONSE BUILDERS
  // ─────────────────────────────────────────────────────────────

  /**
   * Build complete response for staged CLEAR_DUE action
   */
  public static buildStagedApprovalResponse(params: {
    student: { fullName: string; usn: string; department?: { name?: string } };
    department: { name: string; code: string };
    clearance: { status: string; dueAmount: number; dueDetails?: string | null; remarks?: string | null };
    consequences: string;
    tokenStr: string;
    expiresAt: Date;
    finalReason: string;
    studentAcademicDepartment?: string;
    targetClearanceDesk?: string;
    validationChecks?: any[];
    authorizedOfficer?: string;
  }) {
    const {
      student,
      department,
      clearance,
      consequences,
      tokenStr,
      expiresAt,
      finalReason,
      studentAcademicDepartment,
      targetClearanceDesk,
      validationChecks,
      authorizedOfficer
    } = params;

    const studentAcademicDept =
      studentAcademicDepartment || student.department?.name || 'Academic Department';
    const targetDesk = targetClearanceDesk || department.name;

    const reply =
      `I found the student's record and verified that this clearance can be approved.\n\n` +
      `**Clearance Approval**\n\n` +
      `Student: ${student.fullName}\n` +
      `Department: ${targetDesk}\n\n` +
      `Approving this clearance will certify that the student has No Due in ${targetDesk} and allow their NDC progress to advance.\n\n` +
      `Do you want to continue?`;

    return {
      reply,
      actionRequired: {
        token: tokenStr,
        action: 'CLEAR_DUE' as const,
        studentId: (student as any).id,
        studentName: student.fullName,
        usn: student.usn,
        studentAcademicDepartment: studentAcademicDept,
        targetClearanceDesk: targetDesk,
        clearanceId: (clearance as any).id,
        amount: 0,
        reason: finalReason,
        labName: targetDesk,
        departmentName: department.name,
        consequences,
        expiresAt: expiresAt.toISOString(),
        validationResults: validationChecks || [],
        authorizedOfficer: authorizedOfficer || 'Authorized Officer',
        emailNotificationWillQueue: true,
        status: ActionLifecycleState.STAGED,
        lifecycleStatus: ActionLifecycleState.STAGED
      },
      suggestions: [
        `Cancel that`,
        `Lookup student ${student.usn}`,
        `Show pending dues in ${department.name}`
      ]
    };
  }

  /**
   * Build complete response for staged MARK_DUE action (New Due or Modify Existing Due)
   */
  public static buildStagedDueResponse(params: {
    student: { fullName: string; usn: string; department?: { name?: string }; email?: string };
    department: { name: string; code: string };
    clearance: { status: string; dueAmount: number };
    amount: number;
    reason: string;
    consequences?: string;
    tokenStr: string;
    expiresAt: Date;
    labName: string;
    studentAcademicDepartment?: string;
    targetClearanceDesk?: string;
    validationChecks?: any[];
    authorizedOfficer?: string;
    emailNotificationWillQueue?: boolean;
    isModification?: boolean;
    currentAmount?: number;
    newAmount?: number;
    difference?: number;
  }) {
    const {
      student,
      department,
      clearance,
      amount,
      reason,
      tokenStr,
      expiresAt,
      labName,
      studentAcademicDepartment,
      targetClearanceDesk,
      validationChecks,
      authorizedOfficer,
      emailNotificationWillQueue,
      isModification
    } = params;

    const studentAcademicDept =
      studentAcademicDepartment || student.department?.name || 'Academic Department';
    const targetDesk = targetClearanceDesk || labName || department.name;

    const effectiveCurrentAmount = params.currentAmount !== undefined
      ? params.currentAmount
      : Number(clearance.dueAmount || 0);
    const effectiveNewAmount = params.newAmount !== undefined ? params.newAmount : amount;
    const effectiveDiff = params.difference !== undefined
      ? params.difference
      : (effectiveNewAmount - effectiveCurrentAmount);
    const diffText = effectiveDiff >= 0 ? `+₹${effectiveDiff}` : `-₹${Math.abs(effectiveDiff)}`;

    let reply = '';
    let consequenceText = '';

    if (isModification) {
      consequenceText = `Your change will update the outstanding amount. The NDC status will remain Blocked until the due is cleared.`;
      reply =
        `I found the existing ${reason} due. Here is the requested change.\n\n` +
        `**Update Due Amount**\n\n` +
        `Student: ${student.fullName}\n` +
        `Department: ${targetDesk}\n\n` +
        `Current Amount: ₹${effectiveCurrentAmount}\n` +
        `New Amount: ₹${effectiveNewAmount}\n` +
        `Difference: ${diffText}\n\n` +
        `${consequenceText}\n\n` +
        `Should I save this change?`;
    } else {
      consequenceText = `Adding this due will change the student's ${targetDesk} clearance to Due and temporarily block the NDC certificate until payment is completed.`;
      reply =
        `I found the student's record and verified that this due can be added.\n\n` +
        `**New Outstanding Due**\n\n` +
        `Student: ${student.fullName}\n` +
        `Department: ${targetDesk}\n` +
        `Reason: ${reason}\n` +
        `Amount: ₹${amount}\n\n` +
        `${consequenceText}\n\n` +
        `Do you want to continue?`;
    }

    return {
      reply,
      actionRequired: {
        token: tokenStr,
        action: 'MARK_DUE' as const,
        operationType: isModification ? ('MODIFY_DUE' as const) : ('NEW_DUE' as const),
        isModification: Boolean(isModification),
        currentAmount: isModification ? effectiveCurrentAmount : undefined,
        previousAmount: isModification ? effectiveCurrentAmount : undefined,
        newAmount: isModification ? effectiveNewAmount : amount,
        difference: isModification ? effectiveDiff : undefined,
        studentId: (student as any).id,
        studentName: student.fullName,
        usn: student.usn,
        studentAcademicDepartment: studentAcademicDept,
        targetClearanceDesk: targetDesk,
        clearanceId: (clearance as any).id,
        amount: isModification ? effectiveNewAmount : amount,
        reason,
        labName: targetDesk,
        departmentName: department.name,
        consequences: consequenceText,
        expiresAt: expiresAt.toISOString(),
        validationResults: validationChecks || [],
        authorizedOfficer: authorizedOfficer || 'Authorized Officer',
        emailNotificationWillQueue: emailNotificationWillQueue ?? true,
        status: ActionLifecycleState.STAGED,
        lifecycleStatus: ActionLifecycleState.STAGED
      },
      suggestions: [
        `Cancel that`,
        `Lookup student ${student.usn}`,
        `Show pending dues in ${department.name}`
      ]
    };
  }

  /**
   * Build clear, user-friendly response when validation fails
   */
  public static buildValidationFailedResponse(params: {
    action: 'MARK_DUE' | 'CLEAR_DUE' | 'HOLD';
    student?: { fullName?: string; usn: string; department?: { name?: string } } | null;
    department: { name: string; code: string };
    reason: string;
    amount?: number;
    checks: any[];
    blockingReason: string;
    correctiveAction?: string;
    studentAcademicDepartment?: string;
    targetClearanceDesk?: string;
  }) {
    const {
      blockingReason,
      correctiveAction,
      student,
      department
    } = params;

    const usn = student?.usn || '';

    const reply =
      `I could not process this request.\n\n` +
      `**${blockingReason}**` +
      (correctiveAction ? `\n\n${correctiveAction}` : '');

    return {
      reply,
      actionRequired: null,
      suggestions: [
        ...(usn ? [`Lookup student ${usn}`] : []),
        `Show pending dues in ${department.name}`
      ]
    };
  }

  /**
   * Build complete response for ALREADY_COMPLETED clearance
   */
  public static buildAlreadyClearedResponse(params: {
    student: { fullName: string; usn: string; department?: { name?: string } };
    department: { name: string; code: string };
    clearance: { status: string; dueAmount: number; reviewedBy?: any; reviewedAt?: Date | null };
  }) {
    const { student, department } = params;

    const reply =
      `**Clearance Already Completed**\n\n` +
      `**${student.fullName}** (\`${student.usn}\`) already has No Due under **${department.name}**. No changes are needed.`;

    return {
      reply,
      actionRequired: null,
      suggestions: [
        `Show pending dues in ${department.name}`,
        `Lookup student ${student.usn}`,
        `Show ${department.name} clearance summary`
      ]
    };
  }
}
