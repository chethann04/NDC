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
    expiresAt: string;
  } | null;
  suggestions?: string[];
}

export class AiAssistantService {
  /**
   * Main entrypoint for processing conversational messages with reliable intent detection
   */
  public static async processMessage(req: AssistantChatRequest): Promise<AssistantChatResponse> {
    const { user, messages, departmentCode = 'PHY' } = req;
    const lastMessage = messages[messages.length - 1]?.content || '';

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

    // 3. Extract entities from user prompt
    const mentionedUsn = this.extractUsnFromText(lastMessage);
    const extractedAmount = this.extractAmountFromText(lastMessage);
    const labName = this.extractLabNameFromText(lastMessage, department.name);
    const detectedIntent = this.detectIntent(lastMessage, extractedAmount);

    // 4. Resolve student context if USN or student name was mentioned
    let studentContext: any = null;
    if (mentionedUsn) {
      studentContext = await this.getStudentDetailContext(mentionedUsn, department.id);
    } else {
      const potentialName = this.extractPotentialName(lastMessage);
      if (potentialName) {
        studentContext = await this.searchStudentByName(potentialName, department.id);
      }
    }

    // 5. Handle Contradictory Requests (Requirement: Ask for clarification, never silently choose)
    if (detectedIntent.intent === 'CONTRADICTORY') {
      return this.handleContradictory(lastMessage, department, studentContext, extractedAmount, mentionedUsn);
    }

    // 6. Handle Deterministic Intents (Fast Semantic Path)
    if (detectedIntent.intent === 'ADD_DUE') {
      const extractedReason = this.extractReasonFromText(lastMessage, mentionedUsn, extractedAmount);
      return this.handleOperationalMutation(
        'MARK_DUE',
        mentionedUsn,
        extractedAmount,
        extractedReason,
        labName,
        department,
        user,
        studentContext
      );
    }

    if (detectedIntent.intent === 'CLEAR_DUE') {
      const extractedReason = this.extractReasonFromText(lastMessage, mentionedUsn, 0) || 'Clearance verified and approved as No Due';
      return this.handleOperationalMutation(
        'CLEAR_DUE',
        mentionedUsn,
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

    if ((detectedIntent.intent === 'STUDENT_LOOKUP' || (detectedIntent as any).intent === 'READ_LAB_CLEARANCE') && mentionedUsn) {
      return this.handleStudentLookup(studentContext, mentionedUsn, department);
    }

    // 7. Conversational & Complex Operational Model Invocation with Safe Grounded Fallback
    const topDues = await this.getTopDepartmentDues(department.id, 10);
    const systemPrompt = this.buildSystemPrompt({
      userName: user.name,
      userRole: user.role,
      departmentName: department.name,
      departmentCode: department.code,
      stats,
      topDues,
      studentContext
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
        : mentionedUsn;
      const modelAmount = typeof parsed.amount === 'number' && !isNaN(parsed.amount) && parsed.amount > 0
        ? parsed.amount
        : extractedAmount;
      const modelReason = typeof parsed.reason === 'string' && parsed.reason.trim().length > 0
        ? parsed.reason.trim()
        : this.extractReasonFromText(lastMessage, modelUsn, modelAmount);

      if (parsed.contradictionDetected || modelIntent === 'CONTRADICTORY') {
        return this.handleContradictory(lastMessage, department, studentContext, modelAmount, modelUsn);
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

    // 8. Grounded Fallback Response when LLM is unconfigured or returns unparsable output
    return this.buildGroundedGeneralReply(department, stats, studentContext, lastMessage);
  }

  /**
   * Execute an authorized mutation using a verified HMAC/durable confirmation token.
   * Enforces database transaction verification, clearance state machine, aggregate lab rules, and audit logging.
   */
  public static async confirmAndExecute(tokenString: string, userId: string, reqObj?: any): Promise<any> {
    const confirmation = await prisma.aiConfirmationToken.findUnique({
      where: { token: tokenString }
    });

    if (!confirmation) {
      throw new Error('Invalid or non-existent confirmation token.');
    }

    if (confirmation.consumed) {
      throw new Error('This action has already been confirmed and executed.');
    }

    if (new Date() > confirmation.expiresAt) {
      throw new Error('This confirmation token has expired. Please initiate the request again.');
    }

    if (confirmation.userId !== userId) {
      throw new Error('Unauthorized: This confirmation token was generated for a different officer account.');
    }

    if (!confirmation.clearanceId) {
      throw new Error('No target clearance record associated with this token.');
    }

    // Verify user authorization for target department
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, departmentId: true }
    });

    if (!user) {
      throw new Error('Executing user account not found.');
    }

    const payload = confirmation.payload as any;
    const targetDepartmentId = payload.departmentId;

    const isAuthorized = await DueManagementService.verifyOfficerDepartmentAuthorization(userId, {
      departmentId: targetDepartmentId,
      labId: null,
      studentId: confirmation.studentId
    });
    if (!isAuthorized.authorized) {
      throw new Error(`Unauthorized: You do not have permission to modify clearances for ${payload.departmentName || 'this department'}: ${isAuthorized.reason}`);
    }

    let targetStatus: DepartmentClearanceStatus;
    let remarks = payload.reason || 'Updated via Physics AI Assistant';
    let dueAmount = 0;
    let dueDetails = '';

    switch (confirmation.action) {
      case 'CLEAR_DUE':
        targetStatus = DepartmentClearanceStatus.CLEARED;
        remarks = payload.reason || 'Physics Lab clearance verified and approved as No Due via AI Assistant';
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

    // Mark token as consumed (Durable Replay Protection)
    await prisma.aiConfirmationToken.update({
      where: { token: tokenString },
      data: {
        consumed: true,
        consumedAt: new Date()
      }
    });

    // Record high-priority audit log
    await AuditService.log(
      reqObj || null,
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
      status: targetStatus,
      dueAmount,
      clearance: verifiedRecord,
      notification: notificationResult
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
            reason: reason || 'Apparatus / Lab Equipment Damage',
            departmentId: department.id,
            departmentName: department.name,
            labName
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
          `- **Apparatus / Reason**: ${reason}\n\n` +
          `⚠️ **Confirmation Required**: No changes have been made to the database yet. Please review the details in the confirmation card below and click **Confirm & Apply to Live Database** to execute.`,
        actionRequired: {
          token: tokenStr,
          action: 'MARK_DUE',
          studentId: student.id,
          studentName: student.fullName,
          usn: student.usn,
          clearanceId: clearance.id,
          amount: finalAmount,
          reason,
          labName,
          expiresAt: expiresAt.toISOString()
        },
        suggestions: [
          `Clear ${student.usn}'s Physics Lab clearance as No Due`,
          `Lookup student ${student.usn}`
        ]
      };
    }

    // CLEAR_DUE handling
    const currentDueAmount = Number(clearance.dueAmount || 0);
    const tokenStr = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

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
          reason: reason || 'Clearance verified and approved as No Due',
          departmentId: department.id,
          departmentName: department.name,
          labName
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
        `\n\n⚠️ **Confirmation Required**: Please confirm below to apply this clearance update to the live database.`,
      actionRequired: {
        token: tokenStr,
        action: 'CLEAR_DUE',
        studentId: student.id,
        studentName: student.fullName,
        usn: student.usn,
        clearanceId: clearance.id,
        amount: 0,
        reason: reason || 'Clearance verified and approved as No Due',
        labName,
        expiresAt: expiresAt.toISOString()
      },
      suggestions: [
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
    extractedAmount: number | null
  ): {
    intent: 'CONTRADICTORY' | 'ADD_DUE' | 'CLEAR_DUE' | 'VIEW_PENDING_DUES' | 'DEPARTMENT_REPORT' | 'LIST_RECORDS' | 'READ_LAB_CLEARANCE' | 'STUDENT_LOOKUP' | 'GENERAL_QUERY';
    reason?: string;
  } {
    const lower = text.toLowerCase();

    // Contradiction detection: both CLEAR/NO_DUE and ADD_DUE/FINE present
    const hasClearSignal =
      /\b(clear|cleared|approve|approved|waive|waived|forgive)\b/i.test(lower) ||
      /\bno[ _-]?dues?\b/i.test(lower) ||
      /\bmark\b.*?\b(?:as\s+)?cleared\b/i.test(lower);

    const hasDueSignal =
      /\b(add|mark|record|charge|impose|fine|penalize|bill)\b.*?\b(dues?|fine|penalty|fee)\b/i.test(lower) ||
      /\b(fine|penalty|due|charge|fee)\s+(?:of\s+)?(?:₹|rs\.?|inr)?\s*\d+/i.test(lower) ||
      /\b(?:fine|penalty|charge|impose|penalize)\b/i.test(lower) ||
      (/\b(broken|damage|breaking|damaged|breakage|lost|missing)\b/i.test(lower) && (extractedAmount !== null || /\b(charge|fine|fee|due|penalize|cost)\b/i.test(lower))) ||
      /\badding\s+(?:an\s+)?outstanding\s+due\b/i.test(lower) ||
      (/\b(add|record|charge|impose|bill)\b/i.test(lower) && extractedAmount !== null);

    if (hasClearSignal && hasDueSignal) {
      return {
        intent: 'CONTRADICTORY',
        reason: 'User requested both clearance approval (No Due) and due creation in the same query.'
      };
    }

    // 1. ADD_DUE
    if (
      hasDueSignal ||
      /\b(add|mark|charge|record|fine|impose|bill|penalize)\b.*?\bdues?\b/i.test(lower) ||
      /\bdues?\s+of\b/i.test(lower) ||
      /\b(fine|penalty)\s+(?:of\s+)?/i.test(lower) ||
      (/\b(add|mark|charge|record|impose|bill|penalize)\b/i.test(lower) && (extractedAmount !== null || /\b(thermometer|caliper|prism|beaker|apparatus|equipment|manual|lens|spectrometer|resistor)\b/i.test(lower))) ||
      (/\b(damage|breakage|broken|breaking|lost|missing)\b/i.test(lower) && (extractedAmount !== null || /\b(charge|fine|fee|due)\b/i.test(lower)))
    ) {
      return { intent: 'ADD_DUE' };
    }

    // 2. CLEAR_DUE
    if (
      hasClearSignal ||
      /\b(clear|approve|waive)\b.*?\b(clearance|dues?|status|lab)\b/i.test(lower) ||
      /\b(set|mark)\b.*?\bno[ _-]?dues?\b/i.test(lower) ||
      /\bmark\b.*?\b(?:as\s+)?cleared\b/i.test(lower) ||
      /\bclearance\s+as\s+no[ _-]?dues?\b/i.test(lower) ||
      /\bclear\b\s+[1-4][a-z]{2}\d{2}[a-z]{2}\d{3}/i.test(lower) ||
      /\bclear\s+all\s+(?:outstanding\s+)?dues\b/i.test(lower) ||
      /\b(grant|give)\s+(?:no[ _-]?due|clearance)\b/i.test(lower) ||
      /\bapprove\s+no[ _-]?dues?\b/i.test(lower)
    ) {
      return { intent: 'CLEAR_DUE' };
    }

    // 3. VIEW_PENDING_DUES
    if (
      /\bpending\s+dues?\b/i.test(lower) ||
      /\boutstanding\s+dues?\b/i.test(lower) ||
      /\bwho\s+has\s+dues?\b/i.test(lower) ||
      /\blist\s+(?:pending\s+)?dues?\b/i.test(lower) ||
      /\bshow\s+(?:pending\s+)?dues?\b/i.test(lower) ||
      /\bstudents?\s+with\s+(?:pending\s+)?dues?\b/i.test(lower)
    ) {
      return { intent: 'VIEW_PENDING_DUES' };
    }

    // 4. DEPARTMENT_REPORT
    if (
      /\b(department\s+report|clearance\s+report|authorized\s+report|report)\b/i.test(lower) ||
      /\b(summary|statistics|stats|overview)\b/i.test(lower) ||
      /\bhow\s+many\s+clearances?\b/i.test(lower) ||
      /\blist\s+(?:authorized\s+)?department\s+records\b/i.test(lower)
    ) {
      return { intent: 'DEPARTMENT_REPORT' };
    }

    // 5. READ_LAB_CLEARANCE
    if (
      /\b(read|check|inspect|view|get)\b.*?\b(clearance|physics\s+lab|details|status)\b/i.test(lower) ||
      /\bphysics\s+lab\s+(?:clearance\s+)?(?:details|record|status)\b/i.test(lower)
    ) {
      return { intent: 'READ_LAB_CLEARANCE' };
    }

    // 6. STUDENT_LOOKUP
    if (this.extractUsnFromText(text) !== null) {
      return { intent: 'STUDENT_LOOKUP' };
    }

    return { intent: 'GENERAL_QUERY' };
  }

  public static extractUsnFromText(text: string): string | null {
    const match = text.match(/\b([1-4][A-Z]{2}\d{2}[A-Z]{2}\d{3})\b/i);
    return match ? match[1].toUpperCase() : null;
  }

  public static extractAmountFromText(text: string): number | null {
    // Pattern 1: currency symbol before amount (e.g. ₹300, Rs. 300, INR 300)
    const currMatch = text.match(/(?:₹|rs\.?|inr)\s*(\d+(?:\.\d+)?)/i);
    if (currMatch) return parseFloat(currMatch[1]);

    // Pattern 2: due/fine/penalty/fee followed by optional "of" and number (e.g. due of 300, fine 500)
    const dueMatch = text.match(/(?:due|fine|penalty|fee|amount|charge)\s*(?:of)?\s*(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)/i);
    if (dueMatch) return parseFloat(dueMatch[1]);

    // Pattern 3: number followed by rupees/rs/inr
    const suffixMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:₹|rs\.?|inr|rupees?)/i);
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
    const [total, pending, due, cleared] = await Promise.all([
      prisma.ndcClearance.count({ where: { departmentId } }),
      prisma.ndcClearance.count({ where: { departmentId, status: DepartmentClearanceStatus.PENDING as any } }),
      prisma.ndcClearance.count({ where: { departmentId, status: DepartmentClearanceStatus.DUE as any } }),
      prisma.ndcClearance.count({ where: { departmentId, status: DepartmentClearanceStatus.CLEARED as any } })
    ]);

    return { total, pending, due, cleared };
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

OPERATIONAL GUIDELINES:
1. Identify the user's operational intent from the message:
   - "ADD_DUE": Officer wants to record or add an outstanding fee/due/fine for a student.
   - "CLEAR_LAB": Officer wants to clear clearance or approve No Due.
   - "READ_LAB_CLEARANCE": Officer wants to inspect clearance details for a student.
   - "SEARCH_STUDENT": Officer wants to find/search a student by USN or name.
   - "LIST_PENDING_DUES": Officer asks for pending dues or students with dues.
   - "DEPARTMENT_REPORT": Officer requests summary/report/statistics for the department.
   - "CONTRADICTORY": User requests conflicting operations in the same command (e.g. mark No Due AND add a due).
   - "CLARIFICATION_NEEDED": Command is missing essential parameters (like missing USN or missing due amount).
   - "CONVERSATIONAL": General greeting, FAQ, or query.
2. Formulate your output strictly as valid JSON matching this schema:
{
  "intent": "ADD_DUE" | "CLEAR_LAB" | "READ_LAB_CLEARANCE" | "SEARCH_STUDENT" | "LIST_PENDING_DUES" | "DEPARTMENT_REPORT" | "CONTRADICTORY" | "CLARIFICATION_NEEDED" | "CONVERSATIONAL",
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
