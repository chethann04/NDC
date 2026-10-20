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

      // Find the user turn that triggered this model message
      let priorUserTurn = '';
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
      const targetIntent = pendingIntent || (this.hasClearDueSignal(lastMessage) ? 'CLEAR_DUE' : this.hasAddDueSignal(lastMessage) ? 'MARK_DUE' : 'CLEAR_DUE');
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

  public static hasAddDueSignal(text: string): boolean {
    const lower = text.toLowerCase();
    const isClearingCharge =
      /\b(remove|waive|drop|cancel|clear)\s+(?:that\s+|the\s+)?(?:charge|due|fine)\b/i.test(lower) ||
      /\breturned\s+(?:the\s+)?apparatus\b/i.test(lower);

    if (isClearingCharge) return false;

    return (
      /\b(add|mark|record|charge|impose|fine|penalize|bill)\b.*?\b(dues?|fine|penalty|fee)\b/i.test(lower) ||
      /\b(fine|penalty|due|charge|fee)\s+(?:of\s+)?(?:₹|rs\.?|inr)?\s*\d+/i.test(lower) ||
      /\bput\s+(?:a\s+)?(?:fine|due|charge|penalty)\s+of\s+(?:₹|rs\.?|inr)?\s*\d+/i.test(lower) ||
      /\b(?:fine|penalty|charge|impose|penalize)\b/i.test(lower) ||
      (/\b(broke|damage|breaking|damaged|breakage|lost|missing|snapped)\b/i.test(lower) &&
        (this.extractAmount(text) !== null || /\b(charge|fine|fee|due|penalize|cost)\b/i.test(lower))) ||
      /\badding\s+(?:an\s+)?outstanding\s+due\b/i.test(lower) ||
      (/\b(add|record|charge|impose|bill)\b/i.test(lower) && this.extractAmount(text) !== null)
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

    const validationFormatted =
      validationChecks && validationChecks.length > 0
        ? validationChecks.map((c) => `   - ${c.passed ? '✅' : c.unverified ? '⏳' : '❌'} **${c.label}**: ${c.detail}`).join('\n')
        : `- **Current Status**: **${clearance.status}** with recorded due of **₹${Number(clearance.dueAmount || 0)}**.\n   - **Officer Authority**: Authorized for ${targetDesk}.\n   - **Action Validation**: Confirming certifies full clearance for this desk.`;

    const reply =
      `### 📋 Clearance Approval Staged\n\n` +
      `1. **Understood**: Request to approve departmental clearance as **No Due** for student.\n` +
      `2. **Student & Target Desk**:\n` +
      `   - Student: **${student.fullName}** (\`${student.usn}\`)\n` +
      `   - Student's Academic Department: **${studentAcademicDept}**\n` +
      `   - Target Clearance Desk: **${targetDesk}** (${department.code})\n` +
      `3. **Validation Established**:\n${validationFormatted}\n` +
      `4. **Proposed Action**: Approve clearance as **NO DUE** and stage database update.\n` +
      `5. **Expected Outcome & Consequences**: ${consequences}\n` +
      `6. **Pending Confirmation**: Consequential database mutation requires explicit officer confirmation.\n` +
      `7. **Next Step**: Click **Confirm & Save to Records** in the confirmation card below to apply changes, or click **Cancel** to abort.`;

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
   * Build complete response for staged MARK_DUE action
   */
  public static buildStagedDueResponse(params: {
    student: { fullName: string; usn: string; department?: { name?: string }; email?: string };
    department: { name: string; code: string };
    clearance: { status: string; dueAmount: number };
    amount: number;
    reason: string;
    consequences: string;
    tokenStr: string;
    expiresAt: Date;
    labName: string;
    studentAcademicDepartment?: string;
    targetClearanceDesk?: string;
    validationChecks?: any[];
    authorizedOfficer?: string;
    emailNotificationWillQueue?: boolean;
  }) {
    const {
      student,
      department,
      clearance,
      amount,
      reason,
      consequences,
      tokenStr,
      expiresAt,
      labName,
      studentAcademicDepartment,
      targetClearanceDesk,
      validationChecks,
      authorizedOfficer,
      emailNotificationWillQueue
    } = params;

    const studentAcademicDept =
      studentAcademicDepartment || student.department?.name || 'Academic Department';
    const targetDesk = targetClearanceDesk || labName || department.name;

    const validationFormatted =
      validationChecks && validationChecks.length > 0
        ? validationChecks.map((c) => `   - ${c.passed ? '✅' : c.unverified ? '⏳' : '❌'} **${c.label}**: ${c.detail}`).join('\n')
        : `   - Target Clearance Desk: **${targetDesk}**\n` +
          `   - Current Status: **${clearance.status}** (₹${clearance.dueAmount || 0} existing dues)\n` +
          `   - Officer Authority: Verified for ${department.name}`;

    const reply =
      `### ⚠️ Outstanding Due Staged\n\n` +
      `1. **Understood**: Request to record an outstanding due of **₹${amount}** for *"${reason}"*.\n` +
      `2. **Student & Target Desk**:\n` +
      `   - Student: **${student.fullName}** (\`${student.usn}\`)\n` +
      `   - Student's Academic Department: **${studentAcademicDept}**\n` +
      `   - Target Clearance Desk: **${targetDesk}** (${department.code})\n` +
      `3. **Validation Established**:\n${validationFormatted}\n` +
      `4. **Proposed Action**: Record due of **₹${amount}** and set status to **DUE**.\n` +
      `5. **Expected Outcome & Consequences**: ${consequences}\n` +
      `6. **Pending Confirmation**: Consequential financial due creation requires explicit officer confirmation.\n` +
      `7. **Next Step**: Review the details in the confirmation card below and click **Confirm & Save to Records** to apply, or click **Cancel** to abort.`;

    return {
      reply,
      actionRequired: {
        token: tokenStr,
        action: 'MARK_DUE' as const,
        studentId: (student as any).id,
        studentName: student.fullName,
        usn: student.usn,
        studentAcademicDepartment: studentAcademicDept,
        targetClearanceDesk: targetDesk,
        clearanceId: (clearance as any).id,
        amount,
        reason,
        labName: targetDesk,
        departmentName: department.name,
        consequences,
        expiresAt: expiresAt.toISOString(),
        validationResults: validationChecks || [],
        authorizedOfficer: authorizedOfficer || 'Authorized Officer',
        emailNotificationWillQueue: emailNotificationWillQueue ?? true,
        status: ActionLifecycleState.STAGED,
        lifecycleStatus: ActionLifecycleState.STAGED
      },
      suggestions: [
        `Change it to ₹${Math.round(amount * 1.2)}`,
        `Cancel that`,
        `Clear ${student.usn}'s ${department.name} clearance as No Due`,
        `Lookup student ${student.usn}`
      ]
    };
  }

  /**
   * Build complete 7-point response when validation fails
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
      action,
      student,
      department,
      reason,
      amount,
      checks,
      blockingReason,
      correctiveAction,
      studentAcademicDepartment,
      targetClearanceDesk
    } = params;

    const studentName = student?.fullName || 'Student';
    const usn = student?.usn || 'USN';
    const academicDept = studentAcademicDepartment || student?.department?.name || 'Information Science & Engineering';
    const desk = targetClearanceDesk || department.name;

    const checksFormatted = checks
      .map((c) => `   - ${c.passed ? '✅' : c.unverified ? '⏳' : '❌'} **${c.label}**: ${c.detail}`)
      .join('\n');

    const reply =
      `### ❌ Validation Failed: Operation Blocked\n\n` +
      `1. **Understood**: Request to ${action === 'MARK_DUE' ? `record due of **₹${amount || 0}** for *"${reason}"*` : 'clear clearance as No Due'} for student **${studentName}** (\`${usn}\`).\n` +
      `2. **Student & Target Desk**:\n` +
      `   - Student: **${studentName}** (\`${usn}\`)\n` +
      `   - Student's Academic Department: **${academicDept}**\n` +
      `   - Target Clearance Desk: **${desk}** (${department.code})\n` +
      `3. **Validation Results**:\n${checksFormatted}\n` +
      `4. **Blocking Reason**: ${blockingReason}\n` +
      `5. **Outcome**: Operation blocked. No actions were staged, and zero database mutations were committed.\n` +
      `6. **Corrective Action Required**: ${correctiveAction || 'Please adjust request parameters to satisfy clearance rules and retry.'}\n` +
      `7. **Next Step**: Review the above validation requirements and submit a valid clearance request.`;

    return {
      reply,
      actionRequired: null,
      suggestions: [
        `Lookup student ${usn}`,
        `Show pending dues in ${department.name}`,
        `How many clearances are pending review in ${department.name}?`
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
    const { student, department, clearance } = params;
    const reviewerName = clearance.reviewedBy?.name || 'Authorized Clearance Officer';
    const reviewDate = clearance.reviewedAt ? new Date(clearance.reviewedAt).toLocaleString() : 'Earlier';

    const reply =
      `### ✅ Clearance Already Completed\n\n` +
      `1. **Understood**: Request to clear clearance for student.\n` +
      `2. **Record Found**: **${student.fullName}** (\`${student.usn}\`) — ${student.department?.name || 'Academic Department'}.\n` +
      `3. **Validation Established**:\n` +
      `   - Desk: **${department.name}** (\`${department.code}\`)\n` +
      `   - Current Status: **CLEARED** (No Due)\n` +
      `   - Outstanding Dues: **₹0**\n` +
      `   - Previously Verified By: **${reviewerName}** on **${reviewDate}**\n` +
      `4. **Action Executed**: No mutation required.\n` +
      `5. **Outcome**: Student is already certified in verified good standing with zero recorded dues for this department.\n` +
      `6. **Remaining Requirements**: Clearance is complete and unblocked for ${department.name}.\n` +
      `7. **Next Steps**: You may check other department queues or inspect another student.`;

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
