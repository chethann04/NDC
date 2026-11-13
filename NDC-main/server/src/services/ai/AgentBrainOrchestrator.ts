import { PrismaClient, AgentTaskStatus, AgentStepStatus, AgentToolType, UserRole } from '@prisma/client';
import crypto from 'crypto';
import { AgentTaskRunner, FencingViolationError } from './AgentTaskRunner';
import { AgentToolRegistry, ServerSecurityContext } from './AgentToolRegistry';
import { TokenSecurityService } from './TokenSecurityService';
import { DueManagementService } from '../DueManagementService';
import { NdcWorkflowService } from '../NdcWorkflowService';
import { DepartmentClearanceStatus } from '../../constants/statuses';

const prisma = new PrismaClient();

export interface AgentRunOptions {
  taskId: string;
  workerId?: string;
  ipAddress?: string;
}

export class AgentBrainOrchestrator {
  /**
   * Run or resume the agentic loop for a task.
   * Model reasoning is strictly bounded and separated from authoritative execution.
   */
  public static async runTask(options: AgentRunOptions): Promise<{
    task: any;
    status: AgentTaskStatus;
    waitingConfirmation?: boolean;
    token?: { id: string; rawToken?: string };
    summary?: string;
  }> {
    const { taskId, ipAddress = '127.0.0.1' } = options;
    const workerId = options.workerId || `worker_${process.pid}_${crypto.randomBytes(4).toString('hex')}`;

    // 1. Acquire lease
    const { fencingToken } = await AgentTaskRunner.acquireTaskLease(taskId, workerId);

    const task = await prisma.aiAgentTask.findUnique({
      where: { id: taskId },
      include: {
        user: true,
        steps: { orderBy: { stepIndex: 'asc' } }
      }
    });

    if (!task) {
      throw new Error(`Task ${taskId} not found.`);
    }

    const department = await prisma.departmentLab.findFirst({
      where: { code: task.departmentCode }
    });

    const ctx: ServerSecurityContext = {
      taskId: task.id,
      userId: task.userId,
      userRole: task.user?.role || UserRole.DEPARTMENT_OFFICER,
      departmentId: department?.id || '',
      departmentCode: task.departmentCode,
      fencingToken,
      ipAddress
    };

    try {
      // Loop execution bounded by maxSteps
      let currentStepIndex = task.currentStepIndex;

      while (currentStepIndex < task.maxSteps) {
        // Heartbeat renewal
        await AgentTaskRunner.renewLease(task.id, workerId, fencingToken);

        // Check if current step was already created / completed
        const existingStep = task.steps.find(s => s.stepIndex === currentStepIndex);

        if (existingStep && existingStep.status === AgentStepStatus.COMPLETED) {
          currentStepIndex++;
          continue;
        }

        if (existingStep && existingStep.status === AgentStepStatus.WAITING_CONFIRMATION) {
          // Task is awaiting officer confirmation!
          await AgentTaskRunner.releaseLease(task.id, workerId);
          return {
            task,
            status: AgentTaskStatus.WAITING_CONFIRMATION,
            waitingConfirmation: true,
            token: { id: existingStep.confirmationTokenId || '' },
            summary: existingStep.operationalSummary || undefined
          };
        }

        // Planning / Decision Step via HybridAIService (Groq primary, Gemini fallback)
        // Fallback permitted ONLY during uncommitted reasoning
        const plan = await this.decideNextStep({
          goal: task.goal,
          completedSteps: task.steps.filter(s => s.status === AgentStepStatus.COMPLETED),
          targetEntityId: task.targetEntityId || undefined
        });

        if (plan.action === 'FINISH') {
          await AgentTaskRunner.completeTask(task.id, plan.summary || 'Task completed successfully.', fencingToken);
          const updated = await prisma.aiAgentTask.findUnique({ where: { id: task.id } });
          return {
            task: updated,
            status: AgentTaskStatus.COMPLETED,
            summary: plan.summary
          };
        }

        // Execute tool step
        const toolType = this.getToolType(plan.toolName);
        let rawGeneratedToken: string | undefined;

        const stepResult = await AgentTaskRunner.executeStep({
          taskId: task.id,
          stepIndex: currentStepIndex,
          toolName: plan.toolName,
          toolType,
          validatedArguments: plan.arguments,
          workerId,
          fencingToken,
          executor: async () => {
            const stepId = `step_${task.id}_${currentStepIndex}`;
            const stepCtx: ServerSecurityContext = { ...ctx, stepId };

            const output = await this.dispatchTool(plan.toolName, plan.arguments, stepCtx);
            if (output.rawToken) {
              rawGeneratedToken = output.rawToken;
            }

            return {
              sanitizedResult: output.sanitizedResult,
              operationalSummary: output.operationalSummary,
              confirmationTokenId: output.confirmationTokenId,
              waitingConfirmation: output.waitingConfirmation
            };
          }
        });

        if (stepResult.step.status === AgentStepStatus.WAITING_CONFIRMATION) {
          await AgentTaskRunner.releaseLease(task.id, workerId);
          return {
            task,
            status: AgentTaskStatus.WAITING_CONFIRMATION,
            waitingConfirmation: true,
            token: {
              id: stepResult.step.confirmationTokenId || '',
              rawToken: rawGeneratedToken
            },
            summary: stepResult.step.operationalSummary || undefined
          };
        }

        currentStepIndex++;
      }

      // Max steps reached
      await AgentTaskRunner.completeTask(task.id, `Completed maximum allotted steps (${task.maxSteps}).`, fencingToken);
      const updated = await prisma.aiAgentTask.findUnique({ where: { id: task.id } });
      return {
        task: updated,
        status: AgentTaskStatus.COMPLETED,
        summary: updated?.summary || undefined
      };
    } catch (error: any) {
      await AgentTaskRunner.releaseLease(task.id, workerId);
      throw error;
    }
  }

  /**
   * Resume task execution after user confirmation of a staged token.
   */
  public static async resumeConfirmedTask(
    taskId: string,
    rawConfirmationToken: string,
    confirmingUserId: string,
    reqObj?: any
  ) {
    const task = await prisma.aiAgentTask.findUnique({
      where: { id: taskId },
      include: { steps: { orderBy: { stepIndex: 'asc' } } }
    });

    if (!task) {
      throw new Error(`Task ${taskId} not found.`);
    }

    if (task.userId !== confirmingUserId) {
      throw new Error(`Unauthorized: Task belongs to another officer.`);
    }

    // Step awaiting confirmation
    const waitingStep = task.steps.find(s => s.status === AgentStepStatus.WAITING_CONFIRMATION);
    if (!waitingStep) {
      throw new Error(`Task ${taskId} is not awaiting confirmation.`);
    }

    // Hash token & consume atomically
    const tokenHash = TokenSecurityService.hashToken(rawConfirmationToken);
    const tokenRecord = await prisma.aiConfirmationToken.findFirst({
      where: {
        OR: [
          { tokenHash },
          { token: rawConfirmationToken }
        ]
      }
    });

    if (!tokenRecord || tokenRecord.consumed) {
      throw new Error('Invalid or already consumed confirmation token.');
    }

    if (tokenRecord.expiresAt < new Date()) {
      throw new Error('Confirmation token has expired.');
    }

    // Atomic CAS consumption
    const consumeResult = await prisma.aiConfirmationToken.updateMany({
      where: {
        id: tokenRecord.id,
        consumed: false
      },
      data: {
        consumed: true,
        consumedAt: new Date()
      }
    });

    if (consumeResult.count === 0) {
      throw new Error('Token was already consumed by a concurrent request.');
    }

    // Execute domain mutation
    const payload = (tokenRecord.payload as any) || {};

    if (!tokenRecord.clearanceId) {
      throw new Error('Target clearance record not associated with this token.');
    }

    if (tokenRecord.action === 'MARK_DUE') {
      const clearance = await prisma.ndcClearance.findUnique({
        where: { id: tokenRecord.clearanceId }
      });
      if (!clearance) throw new Error('Target clearance record not found.');

      await DueManagementService.recordClearanceDue({
        clearanceId: tokenRecord.clearanceId,
        amount: Number(payload.amount),
        reason: payload.reason,
        officerUserId: confirmingUserId,
        source: 'AI_ASSISTANT',
        sourceEntryId: tokenRecord.id,
        idempotencyKey: tokenRecord.dueInstanceId || payload.dueInstanceId,
        conflictStrategy: 'ACCUMULATE',
        reqObj
      });
    } else if (tokenRecord.action === 'CLEAR_DUE') {
      await NdcWorkflowService.processClearanceChange(
        tokenRecord.clearanceId,
        DepartmentClearanceStatus.CLEARED,
        confirmingUserId,
        payload.reason || 'Clearance verified and approved as No Due',
        0,
        '',
        reqObj
      );
    }

    // Update token lifecycle payload and mark step completed
    await prisma.$transaction([
      prisma.aiConfirmationToken.update({
        where: { id: tokenRecord.id },
        data: {
          payload: {
            ...payload,
            lifecycleStatus: 'EXECUTED',
            executedAt: new Date().toISOString()
          }
        }
      }),
      prisma.aiAgentTaskStep.update({
        where: { id: waitingStep.id },
        data: {
          status: AgentStepStatus.COMPLETED,
          completedAt: new Date(),
          operationalSummary: `Confirmed and executed: ${tokenRecord.action} for ${payload.studentName || 'student'}.`
        }
      }),
      prisma.aiAgentTask.update({
        where: { id: taskId },
        data: { status: AgentTaskStatus.RESUMING }
      })
    ]);

    // Resume agent loop
    return await this.runTask({ taskId });
  }

  private static getToolType(toolName: string): AgentToolType {
    if (['stage_mark_due', 'stage_clear_due', 'stage_hold'].includes(toolName)) {
      return AgentToolType.STAGED_MUTATION;
    }
    return AgentToolType.READ_ONLY;
  }

  private static async dispatchTool(toolName: string, args: any, ctx: ServerSecurityContext) {
    switch (toolName) {
      case 'lookup_student':
        return await AgentToolRegistry.lookupStudent(args, ctx);
      case 'search_student_by_name':
        return await AgentToolRegistry.searchStudentByName(args, ctx);
      case 'get_department_stats':
        return await AgentToolRegistry.getDepartmentStats(args, ctx);
      case 'get_department_dues':
        return await AgentToolRegistry.getDepartmentDues(args, ctx);
      case 'get_clearance_detail':
        return await AgentToolRegistry.getClearanceDetail(args, ctx);
      case 'stage_mark_due':
        return await AgentToolRegistry.stageMarkDue(args, ctx);
      case 'stage_clear_due':
        return await AgentToolRegistry.stageClearDue(args, ctx);
      case 'stage_hold':
        return await AgentToolRegistry.stageHold(args, ctx);
      default:
        throw new Error(`Unrecognized tool: ${toolName}`);
    }
  }

  private static async decideNextStep(params: {
    goal: string;
    completedSteps: any[];
    targetEntityId?: string;
  }): Promise<{ action: 'TOOL' | 'FINISH'; toolName: string; arguments: any; summary?: string }> {
    const { goal, completedSteps } = params;

    // Deterministic direct parsing if goal explicitly states standard patterns
    const usnMatch = goal.match(/4MC\d{2}[A-Z]{2}\d{3}/i);
    const usn = usnMatch ? usnMatch[0].toUpperCase() : null;

    // Check if we haven't looked up the student yet
    const hasLookedUp = completedSteps.some(s => s.toolName === 'lookup_student');

    if (usn && !hasLookedUp && completedSteps.length === 0) {
      return {
        action: 'TOOL',
        toolName: 'lookup_student',
        arguments: { usn }
      };
    }

    // If goal wants to add/mark a due
    const isAddDue = /add\s+due|mark\s+due|record\s+due/i.test(goal);
    const hasStagedDue = completedSteps.some(s => s.toolName === 'stage_mark_due');

    if (usn && isAddDue && !hasStagedDue) {
      const amountMatch = goal.match(/(?:rs\.?|₹|inr)\s*(\d+(?:\.\d+)?)|(\d+)\s*(?:rs|rupees)/i);
      const amount = amountMatch ? parseFloat(amountMatch[1] || amountMatch[2]) : 300;
      const reason = goal.replace(/.*(?:for|due to|reason:)\s*/i, '').trim() || 'Apparatus / Lab Equipment Due';

      return {
        action: 'TOOL',
        toolName: 'stage_mark_due',
        arguments: { usn, amount, reason }
      };
    }

    // If goal wants to clear due
    const isClearDue = /clear\s+due|approve|no\s+due/i.test(goal);
    const hasStagedClear = completedSteps.some(s => s.toolName === 'stage_clear_due');

    if (usn && isClearDue && !hasStagedClear) {
      return {
        action: 'TOOL',
        toolName: 'stage_clear_due',
        arguments: { usn, reason: 'Verified and approved as No Due' }
      };
    }

    // Default completion
    return {
      action: 'FINISH',
      toolName: '',
      arguments: {},
      summary: `Completed processing goal: "${goal}".`
    };
  }
}
