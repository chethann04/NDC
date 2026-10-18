import crypto from 'crypto';
import prisma from '../config/prisma';
import { DepartmentClearanceStatus } from '../constants/statuses';
import { UserRole } from '../constants/roles';
import { NdcWorkflowService } from './NdcWorkflowService';
import { AuditService } from './AuditService';
import { GeminiService, GeminiMessage } from './GeminiService';
import { DueManagementService } from './DueManagementService';
import { departmentCache } from '../utils/departmentCache';
import { NotificationQueueService } from './NotificationQueueService';

export interface AssistantChatRequest {
  user: {
    id: string;
    role: string;
    name: string;
    departmentId?: string;
  };
  messages: Array<{ role: 'user' | 'model'; content: string }>;
  departmentCode?: string;
  reqObj?: any;
}

export interface AssistantChatResponse {
  reply: string;
  actionRequired?: {
    token: string;
    action: 'CLEAR_DUE' | 'MARK_DUE' | 'HOLD';
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
  } | null;
  suggestions?: string[];
}

export class AiAssistantService {
  /**
   * Main entrypoint for processing conversational messages with reliable multi-turn intent detection
   */
  public static async processMessage(req: AssistantChatRequest): Promise<AssistantChatResponse> {
    const { user, messages, departmentCode = 'PHY' } = req;
    const lastMessage = messages[messages.length - 1]?.content || '';
    const lowerLastMessage = lastMessage.toLowerCase().trim();

    // 1. Resolve Target Department (Default: Physics Lab 'PHY')
    const department = await this.resolveDepartment(user, departmentCode);
    if (!department) {
      return {
        reply: `⚠️ Unable to locate department matching code "${departmentCode}". Please ensure the department is configured and active.`,
        actionRequired: null
      };
    }

    // 2. Fetch real departmental stats & top dues for context
    const stats = await this.getDepartmentStats(department.id);

    // 3. Multi-turn context resolution:
    // Check if there is an active, unconsumed confirmation token for this officer
    const activeStagedToken = await prisma.aiConfirmationToken.findFirst({
      where: {
        userId: user.id,
        consumed: false,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: 'desc' }
    });

    const stagedPayload = (activeStagedToken?.payload as any) || null;

    // Resolve USN: directly in last message, or from previous turns, or from active staged token
    let contextUsn = this.extractUsnFromText(lastMessage);
    if (!contextUsn) {
      // Scan previous messages in reverse
      for (let i = messages.length - 2; i >= 0; i--) {
        const prevUsn = this.extractUsnFromText(messages[i].content);
        if (prevUsn) {
          contextUsn = prevUsn;
          break;
        }
      }
      if (!contextUsn && stagedPayload?.usn) {
        contextUsn = stagedPayload.usn;
      }
    }

    // 4. Extract entities from user prompt
    const extractedAmount = this.extractAmountFromText(lastMessage);
    const labName = this.extractLabNameFromText(lastMessage, department.name);
    const detectedIntent = this.detectIntent(
      lastMessage,
      extractedAmount,
      Boolean(contextUsn),
      Boolean(activeStagedToken)
    );

    // 5. Resolve student context if USN or student name was mentioned or resolved from context
    let studentContext: any = null;
    if (contextUsn) {
      studentContext = await this.getStudentDetailContext(contextUsn, department.id);
    } else {
      const potentialName = this.extractPotentialName(lastMessage);
      if (potentialName) {
        studentContext = await this.searchStudentByName(potentialName, department.id);
      }
    }

    // 6. Handle "Please do it" / "Confirm" in chat text (Strict Safety: Never execute directly from chat text)
    if (
      /\b(please\s+(?:do|execute|apply|confirm)\s+(?:it|this)|just\s+do\s+it|go\s+ahead|do\s+it\s+now)\b/i.test(lowerLastMessage) ||
      (lowerLastMessage === 'confirm' || lowerLastMessage === 'confirm it' || lowerLastMessage === 'please do it')
    ) {
      if (activeStagedToken) {
        return {
          reply: `⚠️ **Explicit Confirmation Required**:\n\nFor institutional compliance and audit integrity, administrative database modifications cannot be executed from chat text alone.\n\nPlease review the staged action summary in the confirmation card above and click **Confirm & Save to Records** to execute.`,
          actionRequired: {
            token: activeStagedToken.token,
            action: activeStagedToken.action as any,
            studentId: activeStagedToken.studentId,
            studentName: stagedPayload.studentName,
            usn: stagedPayload.usn,
            clearanceId: activeStagedToken.clearanceId!,
            amount: stagedPayload.amount,
            reason: stagedPayload.reason,
            labName: stagedPayload.labName || department.name,
            departmentName: stagedPayload.departmentName || department.name,
            consequences: stagedPayload.consequences,
            expiresAt: activeStagedToken.expiresAt.toISOString()
          },
          suggestions: [`Cancel that`, `Show me the pending details again`]
        };
      }
    }

    // 7. Handle Cancellation ("Cancel that", "Abort", "Cancel the due")
    if (detectedIntent.intent === 'CANCEL_ACTION') {
      if (activeStagedToken) {
        await this.cancelAction(activeStagedToken.token, user.id, req.reqObj);
        return {
          reply: `❌ **Action Cancelled**: The staged action (**${activeStagedToken.action === 'MARK_DUE' ? `Add Due of ₹${stagedPayload.amount}` : 'Clear Clearance'}**) for **${stagedPayload.studentName || 'the student'}** (\`${stagedPayload.usn}\`) has been cancelled.\n\nNo changes have been made to the live database.`,
          actionRequired: null,
          suggestions: [
            `Show pending dues in ${department.name}`,
            `Lookup student ${stagedPayload.usn || '4MC24IS022'}`,
            `Show ${department.name} clearance summary`
          ]
        };
      } else {
        return {
          reply: `There is currently no pending staged action to cancel. All live database records remain unchanged.`,
          actionRequired: null,
          suggestions: [
            `Show pending dues in ${department.name}`,
            `Show ${department.name} clearance summary`
          ]
        };
      }
    }

    // 8. Handle Conversational Action Edit ("Change it to ₹450", "The reason is a broken lens, not a thermometer")
    if (detectedIntent.intent === 'EDIT_STAGED_ACTION') {
      return this.handleEditStagedAction(
        lastMessage,
        activeStagedToken,
        stagedPayload,
        extractedAmount,
        department,
        user
      );
    }

    // 9. Handle Contradictory Requests (Requirement: Ask for clarification, never silently choose)
    if (detectedIntent.intent === 'CONTRADICTORY') {
      return this.handleContradictory(lastMessage, department, studentContext, extractedAmount, contextUsn);
    }

    // 10. Handle Deterministic Intents (Fast Grounded Semantic Path)
    if (detectedIntent.intent === 'ADD_DUE') {
      const extractedReason = this.extractReasonFromText(lastMessage, contextUsn, extractedAmount);
      return this.handleOperationalMutation(
        'MARK_DUE',
        contextUsn,
        extractedAmount,
        extractedReason,
        labName,
        department,
        user,
        studentContext
      );
    }

    if (detectedIntent.intent === 'CLEAR_DUE') {
      let extractedReason = this.extractReasonFromText(lastMessage, contextUsn, 0);
      if (/\breturned\s+(?:the\s+)?apparatus\b/i.test(lastMessage)) {
        extractedReason = 'Returned apparatus / charge removed';
      } else if (/\bmark\s+(?:this\s+student(?:'s)?\s+)?(?:physics\s+lab\s+)?clearance\s+as\s+complete\b/i.test(lastMessage)) {
        extractedReason = 'Physics Lab clearance marked as complete';
      } else if (!extractedReason || extractedReason === 'Apparatus / Lab Equipment Damage') {
        extractedReason = 'Clearance verified and approved as No Due';
      }

      return this.handleOperationalMutation(
        'CLEAR_DUE',
        contextUsn,
        0,
        extractedReason,
        labName,
        department,
        user,
        studentContext
      );
    }

    if (detectedIntent.intent === 'VIEW_PENDING_DUES') {
      return this.handleViewPendingDues(department);
    }

    if (detectedIntent.intent === 'LIST_RECORDS' || (detectedIntent as any).intent === 'DEPARTMENT_REPORT') {
      return this.handleDepartmentReport(department, stats);
    }

    if (
      (detectedIntent.intent === 'STUDENT_LOOKUP' || (detectedIntent as any).intent === 'READ_LAB_CLEARANCE') &&
      contextUsn
    ) {
      return this.handleStudentLookup(studentContext, contextUsn, department);
    }

    // 11. Conversational & Complex Operational Model Invocation with Safe Grounded Fallback
    const topDues = await this.getTopDepartmentDues(department.id, 10);
    const systemPrompt = this.buildSystemPrompt({
      userName: user.name,
      userRole: user.role,
      departmentName: department.name,
      departmentCode: department.code,
      stats,
      topDues,
      studentContext,
      activeStagedToken: activeStagedToken ? { action: activeStagedToken.action, payload: stagedPayload } : null
    });

    const geminiMessages: GeminiMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content
    }));

    let rawResponse = '';
    let parsed: any = null;

    try {
      rawResponse = await GeminiService.generateChat({
        systemPrompt,
        messages: geminiMessages,
        temperature: 0.1,
        jsonMode: true
      });

      const cleanJson = rawResponse.replace(/```json/gi, '').replace(/```/gi, '').trim();
      parsed = JSON.parse(cleanJson);
    } catch (err: any) {
      console.warn('[AiAssistantService] Model invocation notice, switching to grounded fallback:', err.message);
      parsed = null;
    }

    // Validate structured model output as UNTRUSTED input
    if (parsed && typeof parsed === 'object') {
      const modelIntent = typeof parsed.intent === 'string' ? parsed.intent.toUpperCase() : null;
      const modelUsn = typeof parsed.usn === 'string' && /^[1-4][A-Z]{2}\d{2}[A-Z]{2}\d{3}$/i.test(parsed.usn.trim())
        ? parsed.usn.trim().toUpperCase()
        : contextUsn;
      const modelAmount = typeof parsed.amount === 'number' && !isNaN(parsed.amount) && parsed.amount > 0
        ? parsed.amount
        : extractedAmount;
      const modelReason = typeof parsed.reason === 'string' && parsed.reason.trim().length > 0
        ? parsed.reason.trim()
        : this.extractReasonFromText(lastMessage, modelUsn, modelAmount);

      if (parsed.contradictionDetected || modelIntent === 'CONTRADICTORY') {
        return this.handleContradictory(lastMessage, department, studentContext, modelAmount, modelUsn);
      }

      if (modelIntent === 'CANCEL_ACTION') {
        if (activeStagedToken) {
          await this.cancelAction(activeStagedToken.token, user.id, req.reqObj);
          return {
            reply: `❌ **Action Cancelled**: The staged action for **${stagedPayload.studentName || 'the student'}** (\`${stagedPayload.usn}\`) has been cancelled.\n\nNo changes have been made to the live database.`,
            actionRequired: null,
            suggestions: [`Show pending dues in ${department.name}`, `Show ${department.name} clearance summary`]
          };
        }
      }

      if (modelIntent === 'EDIT_ACTION' && activeStagedToken) {
        return this.handleEditStagedAction(
          lastMessage,
          activeStagedToken,
          stagedPayload,
          modelAmount,
          department,
          user
        );
      }

      if (modelIntent === 'ADD_DUE') {
        return this.handleOperationalMutation(
          'MARK_DUE',
          modelUsn,
          modelAmount,
          modelReason,
          labName,
          department,
          user,
          studentContext
        );
      }

      if (modelIntent === 'CLEAR_LAB' || modelIntent === 'CLEAR_DUE') {
        return this.handleOperationalMutation(
          'CLEAR_DUE',
          modelUsn,
          0,
          modelReason,
          labName,
          department,
          user,
          studentContext
        );
      }

      if ((modelIntent === 'READ_LAB_CLEARANCE' || modelIntent === 'SEARCH_STUDENT' || modelIntent === 'STUDENT_LOOKUP') && modelUsn) {
        const resolvedStudentCtx = studentContext || (await this.getStudentDetailContext(modelUsn, department.id));
        return this.handleStudentLookup(resolvedStudentCtx, modelUsn, department);
      }

      if (modelIntent === 'LIST_PENDING_DUES' || modelIntent === 'VIEW_PENDING_DUES') {
        return this.handleViewPendingDues(department);
      }

      if (modelIntent === 'DEPARTMENT_REPORT' || modelIntent === 'LIST_RECORDS') {
        return this.handleDepartmentReport(department, stats);
      }

      if (modelIntent === 'CLARIFICATION_NEEDED' || parsed.clarificationQuestion) {
        return {
          reply: parsed.clarificationQuestion || parsed.reply,
          actionRequired: null,
          suggestions: this.generateSuggestions(stats, studentContext)
        };
      }

      if (typeof parsed.reply === 'string' && parsed.reply.trim().length > 0) {
        return {
          reply: parsed.reply,
          actionRequired: null,
          suggestions: this.generateSuggestions(stats, studentContext)
        };
      }
    }

    // 12. Grounded Fallback Response when LLM is unconfigured or returns unparsable output
    return this.buildGroundedGeneralReply(department, stats, studentContext, lastMessage);
  }

  /**
   * Execute an authorized mutation using a verified HMAC/durable confirmation token.
   * Enforces database transaction verification, clearance state machine, aggregate lab rules, concurrency/replay protection, and audit logging.
   */
  public static async confirmAndExecute(
    tokenString: string,
    userId: string,
    reqObj?: any,
    expectedParams?: {
      action?: string;
      usn?: string;
      amount?: number;
      reason?: string;
    }
  ): Promise<any> {
    // 1. Atomic Concurrency & Replay Protection:
    // Update token to consumed atomically. Only the first concurrent caller will get count === 1.
    const updateResult = await prisma.aiConfirmationToken.updateMany({
      where: {
        token: tokenString,
        consumed: false,
        expiresAt: { gt: new Date() }
      },
      data: {
        consumed: true,
        consumedAt: new Date()
      }
    });

    if (updateResult.count === 0) {
      const existing = await prisma.aiConfirmationToken.findUnique({
        where: { token: tokenString }
      });

      if (!existing) {
        throw new Error('Invalid or non-existent confirmation token.');
      }

      const p = (existing.payload as any) || {};
      if (p.cancelled) {
        throw new Error('This confirmation token has been cancelled and cannot be executed.');
      }

      if (existing.consumed) {
        throw new Error('This action has already been confirmed and executed.');
      }

      if (new Date() > existing.expiresAt) {
        throw new Error('This confirmation token has expired. Please initiate the request again.');
      }

      throw new Error('Confirmation token is not available for execution.');
    }

    const confirmation = await prisma.aiConfirmationToken.findUnique({
      where: { token: tokenString }
    });

    if (!confirmation) {
      throw new Error('Invalid or non-existent confirmation token.');
    }

    // 2. User Account Binding Check
    if (confirmation.userId !== userId) {
      // Revert the consumption since user account didn't match
      await prisma.aiConfirmationToken.update({
        where: { token: tokenString },
        data: { consumed: false, consumedAt: null }
      });
      throw new Error('Unauthorized: This confirmation token was generated for a different officer account.');
    }

    if (!confirmation.clearanceId) {
      throw new Error('No target clearance record associated with this token.');
    }

    const payload = (confirmation.payload as any) || {};

    // 3. Staged Parameters Revalidation
    const effectiveParams = expectedParams || (reqObj && (reqObj.action || reqObj.usn || reqObj.amount !== undefined) ? reqObj : undefined);
    if (effectiveParams) {
      if (effectiveParams.action && effectiveParams.action !== confirmation.action) {
        throw new Error(`Parameter mismatch: Expected action [${confirmation.action}], but received [${effectiveParams.action}].`);
      }
      if (effectiveParams.usn && effectiveParams.usn.toUpperCase() !== String(payload.usn || '').toUpperCase()) {
        throw new Error(`Parameter mismatch: Expected USN [${payload.usn}], but received [${effectiveParams.usn}].`);
      }
      if (effectiveParams.amount !== undefined && confirmation.action === 'MARK_DUE') {
        if (Number(effectiveParams.amount) !== Number(payload.amount)) {
          throw new Error(`Parameter mismatch: Expected amount [₹${payload.amount}], but received [₹${effectiveParams.amount}].`);
        }
      }
    }

    // 4. Live Record and Authorization Revalidation
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, role: true, departmentId: true }
    });

    if (!user) {
      throw new Error('Executing user account not found.');
    }

    const student = await prisma.student.findUnique({
      where: { id: confirmation.studentId },
      include: { department: true }
    });

    if (!student || !student.isActive) {
      throw new Error('Student record not found or student account is inactive.');
    }

    const clearance = await prisma.ndcClearance.findUnique({
      where: { id: confirmation.clearanceId },
      include: { department: true }
    });

    if (!clearance) {
      throw new Error('Target clearance record not found in database.');
    }

    const targetDepartmentId = payload.departmentId || clearance.departmentId;
    const isAuthorized = await DueManagementService.verifyOfficerDepartmentAuthorization(userId, {
      departmentId: targetDepartmentId,
      labId: clearance.labId,
      studentId: confirmation.studentId
    });

    if (!isAuthorized.authorized) {
      throw new Error(`Unauthorized: You do not have permission to modify clearances for ${payload.departmentName || clearance.department?.name || 'this department'}: ${isAuthorized.reason}`);
    }

    // 5. Execute Business Mutation via Canonical Services
    let targetStatus: DepartmentClearanceStatus;
    let remarks = payload.reason || 'Updated via Physics AI Assistant';
    let dueAmount = 0;
    let dueDetails = '';

    switch (confirmation.action) {
      case 'CLEAR_DUE':
        targetStatus = DepartmentClearanceStatus.CLEARED;
        remarks = payload.reason || 'Clearance verified and approved as No Due via AI Assistant';
        dueAmount = 0;
        dueDetails = '';
        break;

      case 'MARK_DUE':
        targetStatus = DepartmentClearanceStatus.DUE;
        dueAmount = Number(payload.amount || 0);
        dueDetails = payload.reason || 'Apparatus / Lab Equipment Due';
        remarks = `Due of ₹${dueAmount} added via AI Assistant: ${dueDetails}`;
        break;

      case 'HOLD':
        targetStatus = DepartmentClearanceStatus.ON_HOLD;
        remarks = payload.reason || 'Placed on hold via AI Assistant';
        dueAmount = 0;
        dueDetails = '';
        break;

      default:
        throw new Error(`Unsupported action type: ${confirmation.action}`);
    }

    let verifiedRecord: any = null;
    let finalDueAmount = dueAmount;
    let notificationResult: any = null;

    if (confirmation.action === 'MARK_DUE') {
      const dueRes = await DueManagementService.recordClearanceDue({
        clearanceId: confirmation.clearanceId,
        amount: dueAmount,
        reason: dueDetails,
        officerUserId: userId,
        source: 'AI_ASSISTANT',
        sourceEntryId: confirmation.id,
        conflictStrategy: 'ACCUMULATE',
        reqObj
      });
      finalDueAmount = dueRes.newDueAmount;
      notificationResult = dueRes.notification;

      verifiedRecord = await prisma.ndcClearance.findUnique({
        where: { id: confirmation.clearanceId }
      });

      if (!verifiedRecord || verifiedRecord.status !== ('DUE' as any) || Number(verifiedRecord.dueAmount) !== finalDueAmount) {
        throw new Error(`Database verification failed: Due record not found or amount mismatch. Expected ₹${finalDueAmount}, found ₹${verifiedRecord?.dueAmount}.`);
      }
    } else {
      await NdcWorkflowService.processClearanceChange(
        confirmation.clearanceId,
        targetStatus,
        userId,
        remarks,
        0,
        '',
        reqObj
      );

      verifiedRecord = await prisma.ndcClearance.findUnique({
        where: { id: confirmation.clearanceId }
      });

      if (!verifiedRecord) {
        throw new Error('Database verification failed: Clearance record not found after mutation.');
      }

      if (verifiedRecord.status !== (targetStatus as any)) {
        throw new Error(`Database verification failed: Clearance status is ${verifiedRecord.status}, expected ${targetStatus}.`);
      }

      if (confirmation.action === 'CLEAR_DUE' && Number(verifiedRecord.dueAmount) !== 0) {
        throw new Error(`Database verification failed: Due amount is ₹${verifiedRecord.dueAmount}, expected ₹0.`);
      }

      // Look up enqueued clearance notification
      const notifKey = `notif_clearance_${confirmation.clearanceId}_${targetStatus}_${verifiedRecord.updatedAt.getTime()}`;
      notificationResult = await NotificationQueueService.getJobByIdempotencyKey(notifKey);
    }

    // 6. Record High-Priority Audit Log
    await AuditService.log(
      reqObj || ({ user: { id: userId, name: user.name || user.role, role: user.role } } as any),
      `AI_ASSISTANT_${confirmation.action}`,
      'NdcClearance',
      `Officer confirmed AI Assistant action [${confirmation.action}] for student ${payload.usn} (${payload.studentName}) in ${payload.labName || 'Physics Lab'}. Status: ${verifiedRecord.status}. Amount: ₹${verifiedRecord.dueAmount}`,
      confirmation.clearanceId,
      null,
      { action: confirmation.action, payload, verifiedRecord }
    );

    return {
      success: true,
      message: `Successfully executed and verified ${confirmation.action === 'CLEAR_DUE' ? 'No Due clearance approval' : 'due creation'} for ${payload.studentName} (${payload.usn}).`,
      action: confirmation.action,
      usn: payload.usn,
      studentName: payload.studentName,
      labName: payload.labName || 'Physics Lab',
      departmentName: payload.departmentName || clearance.department?.name,
      status: targetStatus,
      dueAmount: finalDueAmount,
      clearance: verifiedRecord,
      notification: notificationResult
    };
  }

  /**
   * Cancel an active confirmation token explicitly before execution.
   */
  public static async cancelAction(tokenString: string, userId: string, reqObj?: any): Promise<any> {
    const confirmation = await prisma.aiConfirmationToken.findUnique({
      where: { token: tokenString }
    });

    if (!confirmation) {
      throw new Error('Invalid or non-existent confirmation token.');
    }

    if (confirmation.userId !== userId) {
      throw new Error('Unauthorized: This confirmation token belongs to a different officer account.');
    }

    const payload = (confirmation.payload as any) || {};

    if (confirmation.consumed) {
      if (payload.cancelled) {
        return {
          success: true,
          message: 'This action was already cancelled.',
          cancelled: true,
          token: tokenString,
          action: confirmation.action,
          usn: payload.usn,
          studentName: payload.studentName
        };
      }
      throw new Error('Cannot cancel: This action has already been confirmed and executed.');
    }

    await prisma.aiConfirmationToken.update({
      where: { token: tokenString },
      data: {
        consumed: true,
        consumedAt: new Date(),
        payload: {
          ...payload,
          cancelled: true,
          cancelledAt: new Date().toISOString(),
          cancellationReason: 'Explicitly cancelled by officer'
        }
      }
    });

    await AuditService.log(
      reqObj || null,
      'AI_ASSISTANT_CANCEL_ACTION',
      'AiConfirmationToken',
      `Officer cancelled staged AI Assistant action [${confirmation.action}] for student ${payload.usn} (${payload.studentName}) in ${payload.labName || 'Physics Lab'}.`,
      confirmation.id,
      null,
      { token: tokenString, action: confirmation.action, payload }
    );

    return {
      success: true,
      message: `Cancelled staged action [${confirmation.action}] for ${payload.studentName} (${payload.usn}). No changes were made to the database.`,
      cancelled: true,
      token: tokenString,
      action: confirmation.action,
      usn: payload.usn,
      studentName: payload.studentName
    };
  }

  /**
   * Helper to invalidate any previous active tokens for this officer
   */
  public static async invalidateActiveStagedTokens(
    userId: string,
    clearanceId?: string | null,
    reason: string = 'Superseded by new staged action'
  ): Promise<void> {
    const whereClause: any = {
      userId,
      consumed: false,
      expiresAt: { gt: new Date() }
    };
    if (clearanceId) {
      whereClause.clearanceId = clearanceId;
    }

    const activeTokens = await prisma.aiConfirmationToken.findMany({
      where: whereClause
    });

    for (const t of activeTokens) {
      const p = (t.payload as any) || {};
      await prisma.aiConfirmationToken.update({
        where: { id: t.id },
        data: {
          consumed: true,
          consumedAt: new Date(),
          payload: {
            ...p,
            cancelled: true,
            cancelledAt: new Date().toISOString(),
            cancellationReason: reason
          }
        }
      });
    }
  }

  /**
   * Handle Conversational Staged Action Editing ("Change it to ₹450", "The reason is a broken lens, not a thermometer")
   */
  private static async handleEditStagedAction(
    text: string,
    activeStagedToken: any,
    stagedPayload: any,
    extractedAmount: number | null,
    department: any,
    user: any
  ): Promise<AssistantChatResponse> {
    if (!activeStagedToken) {
      return {
        reply: `⚠️ There is no currently pending staged action to modify. Please specify what action you would like to stage (e.g. \`Add ₹450 due for broken lens for USN 4MC24IS022\`).`,
        actionRequired: null,
        suggestions: [
          `Show pending dues in ${department.name}`,
          `Lookup student 4MC24IS022`
        ]
      };
    }

    const currentAction = activeStagedToken.action as 'MARK_DUE' | 'CLEAR_DUE';
    const newAmount = extractedAmount !== null && extractedAmount > 0 ? extractedAmount : (stagedPayload.amount || 0);
    const newReason = this.extractEditedReason(text) || stagedPayload.reason || 'Apparatus / Lab Equipment Due';

    // Invalidate old token
    await this.invalidateActiveStagedTokens(user.id, null, 'Superseded by user edit');

    const updatedStudent = await prisma.student.findUnique({
      where: { id: activeStagedToken.studentId },
      include: { department: true }
    });

    const tokenStr = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const labName = stagedPayload.labName || department.name;

    const consequences = currentAction === 'MARK_DUE'
      ? `Recording an outstanding due of ₹${newAmount} for "${newReason}" will set ${updatedStudent?.fullName || stagedPayload.studentName}'s (${stagedPayload.usn}) status in ${labName} to DUE. Overall NDC status will become BLOCKED, and an official notification will be queued.`
      : `Setting clearance to NO DUE will approve clearance as CLEARED with ₹0 dues. Overall NDC status will advance towards APPROVED.`;

    await prisma.aiConfirmationToken.create({
      data: {
        token: tokenStr,
        userId: user.id,
        action: currentAction,
        studentId: activeStagedToken.studentId,
        clearanceId: activeStagedToken.clearanceId,
        payload: {
          studentName: updatedStudent?.fullName || stagedPayload.studentName,
          usn: stagedPayload.usn,
          amount: newAmount,
          reason: newReason,
          departmentId: stagedPayload.departmentId || department.id,
          departmentName: stagedPayload.departmentName || department.name,
          labName,
          consequences
        },
        expiresAt
      }
    });

    return {
      reply: `I have updated the staged action for **${updatedStudent?.fullName || stagedPayload.studentName}** (\`${stagedPayload.usn}\`) in **${labName}**.\n\n` +
        `The previous confirmation token has been invalidated. Please review the updated details below and confirm to apply to the live database:\n\n` +
        `- **Student**: ${updatedStudent?.fullName || stagedPayload.studentName} (\`${stagedPayload.usn}\`)\n` +
        `- **Target Laboratory**: ${labName}\n` +
        `- **Operation**: ${currentAction === 'MARK_DUE' ? 'Add Outstanding Due' : 'Set Clearance to NO DUE'}\n` +
        (currentAction === 'MARK_DUE' ? `- **Updated Due Amount**: ₹${newAmount}\n` : '') +
        `- **Updated Apparatus / Reason**: ${newReason}\n\n` +
        `⚠️ **Consequences**: ${consequences}\n\n` +
        `*No changes have been committed to the live database yet. Please click Confirm below to execute.*`,
      actionRequired: {
        token: tokenStr,
        action: currentAction,
        studentId: activeStagedToken.studentId,
        studentName: updatedStudent?.fullName || stagedPayload.studentName,
        usn: stagedPayload.usn,
        clearanceId: activeStagedToken.clearanceId!,
        amount: newAmount,
        reason: newReason,
        labName,
        departmentName: stagedPayload.departmentName || department.name,
        consequences,
        expiresAt: expiresAt.toISOString()
      },
      suggestions: [
        `Cancel that`,
        `Show me the pending details again`
      ]
    };
  }

  // ─────────────────────────────────────────────────────────────
  // OPERATIONAL ACTION HANDLERS
  // ─────────────────────────────────────────────────────────────

  /**
   * Handle operational mutations (ADD_DUE or CLEAR_DUE) safely with pre-flight checks and staging
   */
  private static async handleOperationalMutation(
    action: 'MARK_DUE' | 'CLEAR_DUE',
    usn: string | null,
    amount: number | null,
    reason: string,
    labName: string,
    department: any,
    user: any,
    studentContext: any
  ): Promise<AssistantChatResponse> {
    // 1. Validate USN presence
    if (!usn) {
      return {
        reply: `⚠️ **Missing Student USN**: Please specify the student's USN (e.g. \`4MC24IS022\`) to ${action === 'MARK_DUE' ? 'add a due' : 'clear clearance'}.`,
        actionRequired: null,
        suggestions: [
          `Add ₹300 due for breaking a thermometer for USN 4MC24IS022`,
          `Clear 4MC24IS022's Physics Lab clearance as No Due`
        ]
      };
    }

    // 2. Validate Student Existence
    const student = await prisma.student.findFirst({
      where: { usn: { equals: usn.trim(), mode: 'insensitive' } },
      include: {
        department: true,
        ndcClearances: {
          where: { departmentId: department.id },
          take: 1
        }
      }
    });

    if (!student) {
      return {
        reply: `❌ **Student Not Found**: No student record found for USN **${usn}** in the institutional database. Please verify the USN and try again.`,
        actionRequired: null,
        suggestions: [`Show all students with outstanding Physics dues`, `How many clearances are pending review in Physics Lab?`]
      };
    }

    // 3. Ensure NDC Clearance Record Exists
    let clearance = student.ndcClearances[0];
    if (!clearance) {
      await NdcWorkflowService.ensureStudentNdcRequest(student.id);
      clearance = await prisma.ndcClearance.findFirst({
        where: { studentId: student.id, departmentId: department.id }
      }) as any;
    }

    if (!clearance) {
      return {
        reply: `⚠️ **Clearance Record Unavailable**: Student **${student.fullName}** (${student.usn}) does not have an active clearance workflow for **${department.name}**.`,
        actionRequired: null
      };
    }

    // 4. Validate Officer Authorization for this Department
    const isAuthorized = await this.verifyDepartmentAuthorization(user, department.id);
    if (!isAuthorized) {
      return {
        reply: `⛔ **Unauthorized Action**: Your account is not authorized to modify clearance records for **${department.name}**. Clearance verification and due creation in this laboratory are strictly restricted to designated departmental clearance officers.`,
        actionRequired: null
      };
    }

    // Invalidate any previously unconsumed active tokens for this officer
    await this.invalidateActiveStagedTokens(user.id, clearance.id, 'Superseded by new staged action');

    // 5. Action-specific validation
    if (action === 'MARK_DUE') {
      const finalAmount = amount && amount > 0 ? amount : 0;
      if (finalAmount <= 0) {
        return {
          reply: `⚠️ **Invalid Due Amount**: Please specify a valid due amount (e.g. \`₹300\`) to record an outstanding due for **${student.fullName}** (${student.usn}).`,
          actionRequired: null,
          suggestions: [`Add ₹300 due for breaking a thermometer for USN ${student.usn}`]
        };
      }

      // Generate confirmation token (Action Staged — NO DATABASE MUTATION YET)
      const tokenStr = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      const finalReason = reason || 'Apparatus / Lab Equipment Damage';
      const consequences = `Recording an outstanding due of ₹${finalAmount} for "${finalReason}" will update ${student.fullName}'s (${student.usn}) status in ${labName} to DUE. Overall NDC status will become BLOCKED, preventing certificate generation until dues are settled. An official email notification will be queued to ${student.email || student.usn}.`;

      await prisma.aiConfirmationToken.create({
        data: {
          token: tokenStr,
          userId: user.id,
          action: 'MARK_DUE',
          studentId: student.id,
          clearanceId: clearance.id,
          payload: {
            studentName: student.fullName,
            usn: student.usn,
            amount: finalAmount,
            reason: finalReason,
            departmentId: department.id,
            departmentName: department.name,
            labName,
            consequences
          },
          expiresAt
        }
      });

      return {
        reply: `I have prepared an outstanding due record for **${student.fullName}** (${student.usn}) in **${labName}**:\n\n` +
          `- **Student**: ${student.fullName} (${student.usn})\n` +
          `- **Academic Branch**: ${student.department?.name || 'General'}\n` +
          `- **Target Laboratory**: ${labName}\n` +
          `- **Operation**: Add Outstanding Due\n` +
          `- **Due Amount**: ₹${finalAmount}\n` +
          `- **Apparatus / Reason**: ${finalReason}\n\n` +
          `⚠️ **Consequences**: ${consequences}\n\n` +
          `⚠️ **Confirmation Required**: No changes have been made to the live database yet. Please review the details in the confirmation card below and click **Confirm & Save to Records** to execute, or **Cancel** to abort.`,
        actionRequired: {
          token: tokenStr,
          action: 'MARK_DUE',
          studentId: student.id,
          studentName: student.fullName,
          usn: student.usn,
          clearanceId: clearance.id,
          amount: finalAmount,
          reason: finalReason,
          labName,
          departmentName: department.name,
          consequences,
          expiresAt: expiresAt.toISOString()
        },
        suggestions: [
          `Change it to ₹450`,
          `Cancel that`,
          `Clear ${student.usn}'s Physics Lab clearance as No Due`,
          `Lookup student ${student.usn}`
        ]
      };
    }

    // CLEAR_DUE handling
    const currentDueAmount = Number(clearance.dueAmount || 0);
    const tokenStr = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const finalReason = reason || 'Clearance verified and approved as No Due';
    const consequences = `Approving clearance as NO DUE will set outstanding dues to ₹0 and update ${student.fullName}'s (${student.usn}) status in ${labName} to CLEARED. If all other department clearances are satisfied, the student's NDC request will advance towards APPROVED, enabling final certificate generation. An official notification will be queued.`;

    await prisma.aiConfirmationToken.create({
      data: {
        token: tokenStr,
        userId: user.id,
        action: 'CLEAR_DUE',
        studentId: student.id,
        clearanceId: clearance.id,
        payload: {
          studentName: student.fullName,
          usn: student.usn,
          amount: 0,
          reason: finalReason,
          departmentId: department.id,
          departmentName: department.name,
          labName,
          consequences
        },
        expiresAt
      }
    });

    let contextNote = '';
    if (clearance.status === (DepartmentClearanceStatus.DUE as any) && currentDueAmount > 0) {
      contextNote = `\n\n*(Note: Student currently has an outstanding due of **₹${currentDueAmount}** for "${clearance.dueDetails || clearance.remarks}". Confirming this action will set dues to ₹0 and approve the clearance.)*`;
    }

    return {
      reply: `I have verified the clearance status for **${student.fullName}** (${student.usn}) in **${labName}**.\n\n` +
        `- **Student**: ${student.fullName} (${student.usn})\n` +
        `- **Target Laboratory**: ${labName}\n` +
        `- **Operation**: Set Clearance to NO DUE (Approval)\n` +
        `- **Resulting Dues**: ₹0` +
        contextNote +
        `\n\n⚠️ **Consequences**: ${consequences}` +
        `\n\n⚠️ **Confirmation Required**: Please confirm below to apply this clearance update to the live database.`,
      actionRequired: {
        token: tokenStr,
        action: 'CLEAR_DUE',
        studentId: student.id,
        studentName: student.fullName,
        usn: student.usn,
        clearanceId: clearance.id,
        amount: 0,
        reason: finalReason,
        labName,
        departmentName: department.name,
        consequences,
        expiresAt: expiresAt.toISOString()
      },
      suggestions: [
        `Cancel that`,
        `Add ₹300 due for breaking a thermometer for USN ${student.usn}`,
        `Lookup student ${student.usn}`
      ]
    };
  }

  /**
   * Handle Contradictory Requests (Requirement 4)
   */
  private static handleContradictory(
    text: string,
    department: any,
    studentContext: any,
    amount: number | null,
    usn: string | null
  ): AssistantChatResponse {
    const studentLabel = studentContext
      ? `**${studentContext.name}** (${studentContext.usn})`
      : usn
      ? `student USN **${usn}**`
      : 'this student';

    return {
      reply: `⚠️ **Contradictory Operations Requested**\n\n` +
        `Your request asks to both **clear the clearance as No Due** and **add an outstanding due**${amount ? ` of ₹${amount}` : ''} for ${studentLabel} in ${department.name}.\n\n` +
        `Because setting a clearance to **NO DUE** and adding an outstanding due are mutually conflicting operations, no action has been staged and no changes were made to the database.\n\n` +
        `Please clarify which action you would like to proceed with:\n` +
        `1. **Add Due**: Record the outstanding fine or apparatus breakage due.\n` +
        `2. **Clear Clearance**: Approve clearance with No Due (₹0).`,
      actionRequired: null,
      suggestions: [
        usn ? `Add ₹${amount || 300} due for breaking a thermometer for USN ${usn}` : `Show pending dues in Physics Lab`,
        usn ? `Clear ${usn}'s Physics Lab clearance as No Due` : `Show Physics Lab clearance summary`
      ]
    };
  }

  /**
   * Handle Student Lookup / Query Status
   */
  private static async handleStudentLookup(
    studentContext: any,
    usn: string,
    department: any
  ): Promise<AssistantChatResponse> {
    if (!studentContext) {
      return {
        reply: `❌ **Student Not Found**: No student record found for USN **${usn}** in the institutional database.`,
        actionRequired: null,
        suggestions: [`Show all students with outstanding Physics dues`, `How many clearances are pending review in Physics Lab?`]
      };
    }

    const clearance = studentContext.clearance;
    const status = clearance ? clearance.status : 'NO RECORD';
    const dueAmount = clearance ? clearance.dueAmount : 0;
    const dueDetails = clearance?.dueDetails || clearance?.remarks || 'None';
    const reviewer = clearance?.reviewedBy || 'Unreviewed';
    const reviewedAt = clearance?.reviewedAt ? new Date(clearance.reviewedAt).toLocaleString() : 'N/A';

    return {
      reply: `### 📋 Student Clearance Record\n\n` +
        `- **Student Name**: **${studentContext.name}**\n` +
        `- **USN**: \`${studentContext.usn}\`\n` +
        `- **Academic Branch**: ${studentContext.academicBranch || 'N/A'}\n` +
        `- **${department.name} Status**: **${status}**\n` +
        `- **Outstanding Due**: **₹${dueAmount}**\n` +
        `- **Due Details / Remarks**: ${dueDetails}\n` +
        `- **Reviewed By**: ${reviewer}\n` +
        `- **Reviewed At**: ${reviewedAt}`,
      actionRequired: null,
      suggestions: [
        `Clear ${studentContext.usn}'s Physics Lab clearance as No Due`,
        `Add ₹300 due for breaking a thermometer for USN ${studentContext.usn}`,
        `Show pending dues in Physics Lab`
      ]
    };
  }

  /**
   * Handle Viewing Pending Dues
   */
  private static async handleViewPendingDues(department: any): Promise<AssistantChatResponse> {
    const dues = await this.getTopDepartmentDues(department.id, 20);

    if (dues.length === 0) {
      return {
        reply: `✅ **No Outstanding Dues**: There are currently no students with recorded dues in **${department.name}**. All active student clearances are either cleared or pending verification.`,
        actionRequired: null,
        suggestions: [`How many clearances are pending review in Physics Lab?`, `Show Physics Lab clearance summary`]
      };
    }

    const rows = dues
      .map(
        (d) =>
          `| \`${d.usn}\` | ${d.name} | ${d.branch} | **₹${d.amount}** | ${d.details} |`
      )
      .join('\n');

    return {
      reply: `### ⚠️ Outstanding Dues in ${department.name}\n\n` +
        `Found **${dues.length}** student(s) with recorded dues:\n\n` +
        `| USN | Student Name | Branch | Due Amount | Apparatus / Remarks |\n` +
        `| :--- | :--- | :--- | :--- | :--- |\n` +
        rows +
        `\n\n*To update or clear any of these dues, simply tell me the student USN and desired operation.*`,
      actionRequired: null,
      suggestions: [
        `Clear ${dues[0].usn}'s Physics Lab clearance as No Due`,
        `Lookup student ${dues[0].usn}`
      ]
    };
  }

  /**
   * Handle Generating Department Records / Statistics Summary Report
   */
  private static async handleDepartmentReport(department: any, stats: any): Promise<AssistantChatResponse> {
    const totalCount = stats.total || 0;
    const clearedCount = stats.cleared || 0;
    const pendingCount = stats.pending || 0;
    const dueCount = stats.due || 0;
    const clearedPercent = totalCount > 0 ? ((clearedCount / totalCount) * 100).toFixed(1) : '0.0';
    const pendingPercent = totalCount > 0 ? ((pendingCount / totalCount) * 100).toFixed(1) : '0.0';
    const duePercent = totalCount > 0 ? ((dueCount / totalCount) * 100).toFixed(1) : '0.0';

    const topDues = await this.getTopDepartmentDues(department.id, 10);
    const totalDueSum = topDues.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);

    let duesTable = '';
    if (topDues.length > 0) {
      duesTable =
        `\n\n**Top Outstanding Dues**:\n` +
        `| USN | Student Name | Branch | Due Amount | Details |\n` +
        `| :--- | :--- | :--- | :--- | :--- |\n` +
        topDues
          .slice(0, 5)
          .map((d) => `| \`${d.usn}\` | ${d.name} | ${d.branch} | **₹${d.amount}** | ${d.details} |`)
          .join('\n');
    }

    return {
      reply:
        `### 📊 ${department.name} Authorized Clearance Report\n\n` +
        `**Generated**: ${new Date().toLocaleString()} | **Desk**: ${department.name} (\`${department.code}\`)\n\n` +
        `| Metric | Count | Share |\n` +
        `| :--- | :--- | :--- |\n` +
        `| **Total Students** | **${totalCount}** | 100% |\n` +
        `| **Cleared (No Due)** | **${clearedCount}** | ${clearedPercent}% |\n` +
        `| **Pending Verification** | **${pendingCount}** | ${pendingPercent}% |\n` +
        `| **Flagged With Dues** | **${dueCount}** | ${duePercent}% |\n\n` +
        `- **Total Outstanding Dues Value**: **₹${totalDueSum}**\n` +
        `- **Compliance / Clearance Rate**: **${clearedPercent}%**` +
        duesTable +
        `\n\n*This report reflects real-time database state for the ${department.name} clearance desk.*`,
      actionRequired: null,
      suggestions: [
        `Show all students with outstanding Physics dues`,
        `Lookup student 4MC24IS022`,
        `Clear 4MC24IS022's Physics Lab clearance as No Due`
      ]
    };
  }

  // Backward compatibility alias
  private static async handleListRecords(department: any, stats: any): Promise<AssistantChatResponse> {
    return this.handleDepartmentReport(department, stats);
  }

  /**
   * Grounded fallback response when LLM is unavailable or non-responsive
   */
  private static buildGroundedGeneralReply(
    department: any,
    stats: any,
    studentContext: any,
    userQuery: string
  ): AssistantChatResponse {
    let studentSnippet = '';
    if (studentContext) {
      studentSnippet = `\n\n**Currently Focused Student**: **${studentContext.name}** (\`${studentContext.usn}\`) — Status: **${studentContext.clearance?.status || 'Pending'}**, Dues: **₹${studentContext.clearance?.dueAmount || 0}**.`;
    }

    return {
      reply: `I have analyzed your query regarding the **${department.name}** desk.\n\n` +
        `**Live Desk Status**:\n` +
        `- Total Records: **${stats.total}**\n` +
        `- Pending Review: **${stats.pending}**\n` +
        `- With Dues: **${stats.due}**\n` +
        `- Cleared: **${stats.cleared}**` +
        studentSnippet +
        `\n\n**Available Actions**:\n` +
        `1. Add a due: \`Add ₹300 due for breaking a thermometer for USN 4MC24IS022\`\n` +
        `2. Clear clearance: \`Clear 4MC24IS022's Physics Lab clearance as No Due\`\n` +
        `3. View dues: \`Show pending dues in Physics Lab\`\n` +
        `4. Lookup student: \`Lookup student 4MC24IS022\``,
      actionRequired: null,
      suggestions: this.generateSuggestions(stats, studentContext)
    };
  }

  // ─────────────────────────────────────────────────────────────
  // HELPER METHODS & NLP ENTITY EXTRACTORS
  // ─────────────────────────────────────────────────────────────

  public static detectIntent(
    text: string,
    extractedAmount: number | null,
    hasContextStudent: boolean = false,
    hasActiveToken: boolean = false
  ): {
    intent:
      | 'CONTRADICTORY'
      | 'CANCEL_ACTION'
      | 'EDIT_STAGED_ACTION'
      | 'ADD_DUE'
      | 'CLEAR_DUE'
      | 'VIEW_PENDING_DUES'
      | 'DEPARTMENT_REPORT'
      | 'LIST_RECORDS'
      | 'READ_LAB_CLEARANCE'
      | 'STUDENT_LOOKUP'
      | 'GENERAL_QUERY';
    reason?: string;
  } {
    const lower = text.toLowerCase().trim();

    // 1. Cancellation Check ("Cancel that", "Cancel the due", "Abort", "Never mind")
    if (
      /\b(cancel\s+(?:that|it|action|due|the\s+due|request)|cancel|never\s*mind|abort|don't\s+do\s+that|drop\s+that\s+charge|dismiss)\b/i.test(lower)
    ) {
      return { intent: 'CANCEL_ACTION' };
    }

    // 2. Edit Staged Action Check ("Change it to ₹450", "The reason is a broken lens, not a thermometer")
    if (
      hasActiveToken &&
      (/\b(change|update|make|set)\s+(?:it\s+)?to\s+(?:₹|rs\.?|inr)?\s*\d+/i.test(lower) ||
        /\b(?:the\s+)?reason\s+is\s+.*?(?:not\s+.*?)?$/i.test(lower) ||
        /\bchange\s+reason\s+to\b/i.test(lower) ||
        /\b(change|update|make|set)\s+(?:the\s+)?amount\b/i.test(lower))
    ) {
      return { intent: 'EDIT_STAGED_ACTION' };
    }

    // 3. Contradiction detection: both CLEAR/NO_DUE and ADD_DUE/FINE present in same message
    const isClearingCharge =
      /\b(remove|waive|drop|cancel|clear)\s+(?:that\s+|the\s+)?(?:charge|due|fine)\b/i.test(lower) ||
      /\breturned\s+(?:the\s+)?apparatus\b/i.test(lower);

    const hasClearSignal =
      isClearingCharge ||
      /\b(clear|cleared|approve|approved|waive|waived|forgive)\b/i.test(lower) ||
      /\bno[ _-]?dues?\b/i.test(lower) ||
      /\bmark\b.*?\b(?:as\s+)?(?:cleared|complete|completed|no[ _-]?due)\b/i.test(lower) ||
      /\bmark\s+(?:this\s+student(?:'s)?\s+)?(?:physics\s+lab\s+)?clearance\s+as\s+complete\b/i.test(lower);

    const hasDueSignal = !isClearingCharge && (
      /\b(add|mark|record|charge|impose|fine|penalize|bill)\b.*?\b(dues?|fine|penalty|fee)\b/i.test(lower) ||
      /\b(fine|penalty|due|charge|fee)\s+(?:of\s+)?(?:₹|rs\.?|inr)?\s*\d+/i.test(lower) ||
      /\bput\s+(?:a\s+)?(?:fine|due|charge|penalty)\s+of\s+(?:₹|rs\.?|inr)?\s*\d+/i.test(lower) ||
      /\b(?:fine|penalty|charge|impose|penalize)\b/i.test(lower) ||
      (/\b(broke|damage|breaking|damaged|breakage|lost|missing|snapped)\b/i.test(lower) &&
        (extractedAmount !== null || /\b(charge|fine|fee|due|penalize|cost)\b/i.test(lower))) ||
      /\badding\s+(?:an\s+)?outstanding\s+due\b/i.test(lower) ||
      (/\b(add|record|charge|impose|bill)\b/i.test(lower) && extractedAmount !== null)
    );

    if (hasClearSignal && hasDueSignal) {
      return {
        intent: 'CONTRADICTORY',
        reason: 'User requested both clearance approval (No Due) and due creation in the same query.'
      };
    }

    // 4. VIEW_PENDING_DUES / WHO HASN'T CLEARED
    if (
      !hasContextStudent && (
        /\bwho\s+(?:hasn't|has\s+not|has)\s+(?:cleared|paid)\b/i.test(lower) ||
        /\bwho\s+has\s+(?:pending\s+)?dues?\b/i.test(lower) ||
        /\bpending\s+dues?\b/i.test(lower) ||
        /\boutstanding\s+dues?\b/i.test(lower) ||
        /\blist\s+(?:pending\s+)?dues?\b/i.test(lower) ||
        /\bshow\s+(?:pending\s+)?dues?\b/i.test(lower) ||
        /\bstudents?\s+with\s+(?:pending\s+)?dues?\b/i.test(lower)
      )
    ) {
      return { intent: 'VIEW_PENDING_DUES' };
    }

    // 5. PENDING DETAILS AGAIN
    if (
      /\bshow\s+(?:me\s+)?(?:the\s+)?pending\s+details\s+again\b/i.test(lower) ||
      /\bshow\s+details\s+again\b/i.test(lower)
    ) {
      return hasContextStudent ? { intent: 'STUDENT_LOOKUP' } : { intent: 'VIEW_PENDING_DUES' };
    }

    // 6. CLEAR_DUE / REMOVE CHARGE / APPROVE CLEARANCE
    if (
      isClearingCharge ||
      hasClearSignal ||
      /\breturned\s+(?:the\s+)?apparatus\b/i.test(lower) ||
      /\bremove\s+(?:that\s+)?(?:charge|due|fine)\b/i.test(lower) ||
      /\b(clear|approve|waive)\b.*?\b(clearance|dues?|status|lab)\b/i.test(lower) ||
      /\b(set|mark)\b.*?\bno[ _-]?dues?\b/i.test(lower) ||
      /\bclearance\s+as\s+no[ _-]?dues?\b/i.test(lower) ||
      /\bclear\b\s+[1-4][a-z]{2}\d{2}[a-z]{2}\d{3}/i.test(lower) ||
      /\bclear\s+all\s+(?:outstanding\s+)?dues\b/i.test(lower) ||
      /\b(grant|give)\s+(?:no[ _-]?due|clearance)\b/i.test(lower) ||
      /\bapprove\s+no[ _-]?dues?\b/i.test(lower)
    ) {
      return { intent: 'CLEAR_DUE' };
    }

    // 7. ADD_DUE
    if (
      hasDueSignal ||
      /\b(add|mark|charge|record|fine|impose|bill|penalize)\b.*?\bdues?\b/i.test(lower) ||
      /\bdues?\s+of\b/i.test(lower) ||
      /\b(fine|penalty)\s+(?:of\s+)?/i.test(lower) ||
      (/\b(add|mark|charge|record|impose|bill|penalize)\b/i.test(lower) &&
        (extractedAmount !== null ||
          /\b(thermometer|caliper|prism|beaker|apparatus|equipment|manual|lens|spectrometer|resistor)\b/i.test(lower))) ||
      (/\b(damage|breakage|broken|breaking|lost|missing)\b/i.test(lower) &&
        (extractedAmount !== null || /\b(charge|fine|fee|due)\b/i.test(lower)))
    ) {
      return { intent: 'ADD_DUE' };
    }

    // 8. DEPARTMENT_REPORT
    if (
      /\b(department\s+report|clearance\s+report|authorized\s+report|report)\b/i.test(lower) ||
      /\b(summary|statistics|stats|overview)\b/i.test(lower) ||
      /\bhow\s+many\s+clearances?\b/i.test(lower) ||
      /\blist\s+(?:authorized\s+)?department\s+records\b/i.test(lower)
    ) {
      return { intent: 'DEPARTMENT_REPORT' };
    }

    // 9. READ_LAB_CLEARANCE
    if (
      /\b(read|check|inspect|view|get)\b.*?\b(clearance|physics\s+lab|details|status)\b/i.test(lower) ||
      /\bphysics\s+lab\s+(?:clearance\s+)?(?:details|record|status)\b/i.test(lower) ||
      /\bcheck\s+(?:whether|if)\b/i.test(lower)
    ) {
      return { intent: 'READ_LAB_CLEARANCE' };
    }

    // 10. STUDENT_LOOKUP
    if (this.extractUsnFromText(text) !== null) {
      return { intent: 'STUDENT_LOOKUP' };
    }

    return { intent: 'GENERAL_QUERY' };
  }

  public static extractEditedReason(text: string): string | null {
    const isMatch = text.match(/\breason\s+is\s+(?:a\s+)?(.+?)(?:,\s*not\s+.*|\.|$)/i);
    if (isMatch && isMatch[1]) {
      let r = isMatch[1].trim();
      return r.charAt(0).toUpperCase() + r.slice(1);
    }
    const toMatch = text.match(/(?:change|update|set|make)\s+(?:the\s+)?reason\s+to\s+(?:a\s+)?(.+?)(?:\.|$)/i);
    if (toMatch && toMatch[1]) {
      let r = toMatch[1].trim();
      return r.charAt(0).toUpperCase() + r.slice(1);
    }
    return null;
  }

  public static extractUsnFromText(text: string): string | null {
    const match = text.match(/\b([1-4][A-Z]{2}\d{2}[A-Z]{2}\d{3})\b/i);
    return match ? match[1].toUpperCase() : null;
  }

  public static extractAmountFromText(text: string): number | null {
    // Strip USN first so digits in USN (e.g. 4MC24IS022) are never mistakenly matched as an amount
    const textWithoutUsn = text.replace(/\b([1-4][A-Z]{2}\d{2}[A-Z]{2}\d{3})\b/gi, '');

    // Pattern 1: currency symbol before amount (e.g. ₹300, Rs. 300, INR 300)
    const currMatch = textWithoutUsn.match(/(?:₹|rs\.?|inr)\s*(\d+(?:\.\d+)?)/i);
    if (currMatch) return parseFloat(currMatch[1]);

    // Pattern 2: "to ₹450" or "to 450" (e.g. Change it to ₹450)
    const toMatch = textWithoutUsn.match(/(?:to|it\s+to|amount\s+to|fine\s+to|due\s+to)\s*(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)/i);
    if (toMatch) return parseFloat(toMatch[1]);

    // Pattern 3: due/fine/penalty/fee followed by optional "of" and number (e.g. due of 300, fine 500)
    const dueMatch = textWithoutUsn.match(/(?:due|fine|penalty|fee|amount|charge)\s*(?:of)?\s*(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)(?!\w)/i);
    if (dueMatch) return parseFloat(dueMatch[1]);

    // Pattern 4: number followed by rupees/rs/inr
    const suffixMatch = textWithoutUsn.match(/(\d+(?:\.\d+)?)\s*(?:₹|rs\.?|inr|rupees?)/i);
    if (suffixMatch) return parseFloat(suffixMatch[1]);

    return null;
  }

  public static extractReasonFromText(text: string, usn?: string | null, amount?: number | null): string {
    let cleaned = text;

    if (usn) {
      cleaned = cleaned.replace(new RegExp(`\\b${usn}\\b`, 'gi'), '');
    }

    cleaned = cleaned.replace(/(?:₹|rs\.?|inr)\s*\d+(?:\.\d+)?/gi, '');
    cleaned = cleaned.replace(/\b\d+(?:\.\d+)?\s*(?:₹|rs\.?|inr|rupees?)\b/gi, '');

    // Pattern for "broke a thermometer", "missing prism", "lost manual", etc.
    const brokeMatch = cleaned.match(/\b(broke|breaking|damaged?|lost|missing|snapped)\s+(?:a\s+|an\s+|the\s+)?([a-z\s]+?)(?:\.|\s+charge|\s+fine|\s+bill|\s+for|$)/i);
    if (brokeMatch && brokeMatch[2]) {
      const verb = brokeMatch[1].toLowerCase();
      let r = brokeMatch[2].trim();
      let prefix = 'Broken ';
      if (verb === 'missing') prefix = 'Missing ';
      else if (verb === 'lost') prefix = 'Lost ';
      else if (verb.startsWith('damage')) prefix = 'Damaged ';
      else if (verb === 'snapped') prefix = 'Snapped ';

      if (!r.toLowerCase().startsWith(prefix.toLowerCase().trim())) {
        return prefix + r;
      }
      return r.charAt(0).toUpperCase() + r.slice(1);
    }

    const reasonPatterns = [
      /(?:due\s+for|dues\s+for|fine\s+for|penalty\s+for|fee\s+for)\s+(.+?)(?:\s+(?:for|to|at)\s+(?:usn|student)?\s*$|$)/i,
      /(?:due\s+to|because\s+of|reason\s*[:\-]?)\s+(.+?)(?:\s+(?:for|to|at)\s+(?:usn|student)?\s*$|$)/i,
      /(?:for)\s+(.+?)(?:\s+(?:for|to|at)\s+(?:usn|student)?\s*$|$)/i
    ];

    for (const pattern of reasonPatterns) {
      const match = cleaned.match(pattern);
      if (match && match[1]) {
        let r = match[1]
          .replace(/^(the|a|an)\s+/i, '')
          .replace(/\b(for\s+usn|for\s+student|usn|student)\b.*$/i, '')
          .replace(/[.,;!?]+$/, '')
          .trim();
        if (r.length > 2 && !/^(usn|student|clearance|physics|chemistry)$/i.test(r)) {
          return r.charAt(0).toUpperCase() + r.slice(1);
        }
      }
    }

    const damageMatch = cleaned.match(/\b((?:broken|breakage|breaking|damaged?|lost|missing)\s+[a-z\s]+)/i);
    if (damageMatch) {
      let r = damageMatch[1].replace(/[.,;!?]+$/, '').trim();
      return r.charAt(0).toUpperCase() + r.slice(1);
    }

    return 'Apparatus / Lab Equipment Damage';
  }

  public static extractLabNameFromText(text: string, defaultName: string): string {
    const lower = text.toLowerCase();
    if (lower.includes('physics')) return 'Physics Lab';
    if (lower.includes('chemistry')) return 'Chemistry Lab';
    if (lower.includes('department lab') || lower.includes('dept lab')) return 'Department Lab';
    return defaultName;
  }

  private static extractPotentialName(text: string): string | null {
    const clean = text.replace(/clear|dues?|approve|hold|for|of|the|check|status|student|amount|rs|rupees/gi, '').trim();
    if (clean.length >= 3 && clean.length <= 30 && /^[a-zA-Z\s]+$/.test(clean)) {
      return clean;
    }
    return null;
  }

  private static async verifyDepartmentAuthorization(user: { id: string; role: string; departmentId?: string | null }, departmentId: string): Promise<boolean> {
    if (user.role === UserRole.SUPER_ADMIN || user.role === UserRole.ADMIN) {
      return true;
    }

    if (user.role === UserRole.DEPARTMENT_OFFICER) {
      // 1. Direct primary department match
      if (user.departmentId === departmentId) {
        return true;
      }

      // 2. Mapped officer department match
      const officer = await prisma.clearanceOfficer.findUnique({
        where: { userId: user.id },
        include: { departmentMappings: true }
      });

      if (officer && officer.departmentMappings.some((m) => m.departmentId === departmentId)) {
        return true;
      }
    }

    return false;
  }

  private static async resolveDepartment(user: any, code: string) {
    if (code) {
      const targetDept = await departmentCache.getDepartmentByCodeOrName(code);
      if (targetDept) return targetDept;
    }

    if (user.role === UserRole.DEPARTMENT_OFFICER && user.departmentId) {
      const dept = await departmentCache.getDepartmentById(user.departmentId);
      if (dept) return dept;
    }

    return prisma.clearanceDepartment.findFirst({
      where: {
        OR: [
          { code: { equals: 'PHY', mode: 'insensitive' } },
          { name: { contains: 'Physics', mode: 'insensitive' } }
        ]
      }
    });
  }

  private static async getDepartmentStats(departmentId: string) {
    try {
      const groups = await prisma.ndcClearance.groupBy({
        by: ['status'],
        where: { departmentId },
        _count: { _all: true }
      });

      let total = 0;
      let pending = 0;
      let due = 0;
      let cleared = 0;

      for (const g of groups) {
        const count = g._count._all;
        total += count;
        if (g.status === DepartmentClearanceStatus.PENDING) pending += count;
        else if (g.status === DepartmentClearanceStatus.DUE) due += count;
        else if (g.status === DepartmentClearanceStatus.CLEARED) cleared += count;
      }

      return { total, pending, due, cleared };
    } catch {
      return { total: 0, pending: 0, due: 0, cleared: 0 };
    }
  }

  private static async getTopDepartmentDues(departmentId: string, limit = 10) {
    const dues = await prisma.ndcClearance.findMany({
      where: {
        departmentId,
        status: DepartmentClearanceStatus.DUE as any
      },
      take: limit,
      orderBy: { dueAmount: 'desc' },
      select: {
        id: true,
        dueAmount: true,
        dueDetails: true,
        remarks: true,
        reviewedAt: true,
        student: {
          select: {
            id: true,
            usn: true,
            fullName: true,
            department: { select: { code: true, name: true } }
          }
        }
      }
    });

    return dues.map((d) => ({
      clearanceId: d.id,
      usn: d.student.usn,
      name: d.student.fullName,
      branch: d.student.department?.code || 'N/A',
      amount: d.dueAmount,
      details: d.dueDetails || d.remarks || 'No details specified',
      date: d.reviewedAt
    }));
  }

  private static async getStudentDetailContext(usn: string, departmentId: string) {
    const student = await prisma.student.findFirst({
      where: { usn: { equals: usn.trim(), mode: 'insensitive' } },
      include: {
        department: true,
        ndcClearances: {
          where: { departmentId },
          include: {
            reviewedBy: { select: { name: true, role: true } }
          }
        }
      }
    });

    if (!student) return null;

    const clearance = student.ndcClearances[0];
    return {
      studentId: student.id,
      usn: student.usn,
      name: student.fullName,
      email: student.email,
      academicBranch: student.department?.name,
      clearance: clearance
        ? {
            id: clearance.id,
            status: clearance.status,
            dueAmount: clearance.dueAmount,
            dueDetails: clearance.dueDetails,
            remarks: clearance.remarks,
            reviewedBy: clearance.reviewedBy?.name || 'Unreviewed',
            reviewedAt: clearance.reviewedAt
          }
        : null
    };
  }

  private static async searchStudentByName(name: string, departmentId: string) {
    const student = await prisma.student.findFirst({
      where: { fullName: { contains: name.trim(), mode: 'insensitive' } },
      include: {
        department: true,
        ndcClearances: {
          where: { departmentId },
          include: {
            reviewedBy: { select: { name: true, role: true } }
          }
        }
      }
    });

    if (!student) return null;

    const clearance = student.ndcClearances[0];
    return {
      studentId: student.id,
      usn: student.usn,
      name: student.fullName,
      email: student.email,
      academicBranch: student.department?.name,
      clearance: clearance
        ? {
            id: clearance.id,
            status: clearance.status,
            dueAmount: clearance.dueAmount,
            dueDetails: clearance.dueDetails,
            remarks: clearance.remarks,
            reviewedBy: clearance.reviewedBy?.name || 'Unreviewed',
            reviewedAt: clearance.reviewedAt
          }
        : null
    };
  }

  private static buildSystemPrompt(ctx: {
    userName: string;
    userRole: string;
    departmentName: string;
    departmentCode: string;
    stats: { total: number; pending: number; due: number; cleared: number };
    topDues: any[];
    studentContext: any;
    activeStagedToken?: { action: string; payload: any } | null;
  }): string {
    return `You are the specialized AI Assistant for the ${ctx.departmentName} (${ctx.departmentCode}) clearance desk at Malnad College of Engineering (MCE).
Officer Interacting: ${ctx.userName} (${ctx.userRole}).

REAL-TIME DATABASE CONTEXT:
- Total Student Records in Desk: ${ctx.stats.total}
- Currently Pending Clearances: ${ctx.stats.pending}
- Currently Flagged With Dues: ${ctx.stats.due}
- Successfully Cleared: ${ctx.stats.cleared}

CURRENT OUTSTANDING DUES IN ${ctx.departmentCode}:
${
  ctx.topDues.length > 0
    ? ctx.topDues.map((d) => `- ${d.usn} (${d.name}, ${d.branch}): ₹${d.amount} for "${d.details}"`).join('\n')
    : 'No outstanding dues currently recorded in this department.'
}

${
  ctx.studentContext
    ? `SPECIFIC STUDENT IN FOCUS:
- USN: ${ctx.studentContext.usn}
- Name: ${ctx.studentContext.name}
- Branch: ${ctx.studentContext.academicBranch}
- Current Clearance Status: ${ctx.studentContext.clearance ? ctx.studentContext.clearance.status : 'No clearance record'}
- Recorded Due: ₹${ctx.studentContext.clearance ? ctx.studentContext.clearance.dueAmount : 0} (${ctx.studentContext.clearance?.dueDetails || 'None'})
- Remarks: ${ctx.studentContext.clearance?.remarks || 'None'}
- Reviewed By: ${ctx.studentContext.clearance?.reviewedBy || 'N/A'}`
    : ''
}

${
  ctx.activeStagedToken
    ? `ACTIVE PENDING CONFIRMATION TOKEN IN DESK:
- Action: ${ctx.activeStagedToken.action}
- Student: ${ctx.activeStagedToken.payload.studentName} (${ctx.activeStagedToken.payload.usn})
- Amount: ₹${ctx.activeStagedToken.payload.amount}
- Reason: ${ctx.activeStagedToken.payload.reason}
- Note: If the user says "change it to ₹X", "the reason is Y", or "cancel that", interpret as EDIT_ACTION or CANCEL_ACTION for this pending action.`
    : ''
}

OPERATIONAL GUIDELINES:
1. Identify the user's operational intent from the message and conversation context:
   - "CANCEL_ACTION": Officer wants to cancel or abort a staged action ("cancel that", "cancel the due", "never mind").
   - "EDIT_ACTION": Officer wants to modify a pending staged action ("change it to ₹450", "reason is a broken lens, not a thermometer").
   - "ADD_DUE": Officer wants to record or add an outstanding fee/due/fine for a student.
   - "CLEAR_LAB": Officer wants to clear clearance, approve No Due, or remove a charge because apparatus was returned.
   - "READ_LAB_CLEARANCE": Officer wants to inspect clearance details for a student.
   - "SEARCH_STUDENT": Officer wants to find/search a student by USN or name.
   - "LIST_PENDING_DUES": Officer asks for pending dues or students who haven't cleared dues.
   - "DEPARTMENT_REPORT": Officer requests summary/report/statistics for the department.
   - "CONTRADICTORY": User requests conflicting operations in the same command (e.g. mark No Due AND add a due).
   - "CLARIFICATION_NEEDED": Command is missing essential parameters (like missing USN or missing due amount).
   - "CONVERSATIONAL": General greeting, FAQ, or query.
2. Formulate your output strictly as valid JSON matching this schema:
{
  "intent": "CANCEL_ACTION" | "EDIT_ACTION" | "ADD_DUE" | "CLEAR_LAB" | "READ_LAB_CLEARANCE" | "SEARCH_STUDENT" | "LIST_PENDING_DUES" | "DEPARTMENT_REPORT" | "CONTRADICTORY" | "CLARIFICATION_NEEDED" | "CONVERSATIONAL",
  "usn": "Student USN if mentioned or in context, else null",
  "amount": "Numeric amount if mentioned (e.g. 300), else null",
  "reason": "Apparatus or due reason if mentioned, else null",
  "contradictionDetected": false,
  "contradictionReason": null,
  "clarificationQuestion": null,
  "reply": "Clear, markdown-formatted explanation or response to the officer."
}`;
  }

  private static generateSuggestions(stats: any, studentContext: any): string[] {
    if (studentContext) {
      return [
        `Clear ${studentContext.usn}'s Physics Lab clearance as No Due`,
        `Add ₹300 due for breaking a thermometer for USN ${studentContext.usn}`,
        `Show pending dues in Physics Lab`
      ];
    }

    return [
      `Show pending dues in Physics Lab`,
      `Show Physics Lab clearance summary`,
      `Add ₹300 due for breaking a thermometer for USN 4MC24IS022`,
      `Clear 4MC24IS022's Physics Lab clearance as No Due`
    ];
  }
}
