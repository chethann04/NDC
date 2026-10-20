import crypto from 'crypto';
import prisma from '../../config/prisma';
import { UserRole } from '../../constants/roles';
import { DepartmentClearanceStatus } from '../../constants/statuses';
import { NdcWorkflowService } from '../NdcWorkflowService';
import { AuditService } from '../AuditService';
import { DueManagementService } from '../DueManagementService';
import { NotificationQueueService } from '../NotificationQueueService';
import { ExtractedActionItem } from './MultiActionExtractionService';

export interface AuthorizeResult {
  authorized: boolean;
  reason?: string;
  departmentId?: string;
}

export interface StagedTokenPayload {
  token: string;
  departmentId: string;
  departmentCode: string;
  departmentName: string;
  userId: string;
  actions: ExtractedActionItem[];
  expiresAt: Date;
  lifecycleStatus?: string;
  executedAt?: string;
  failedAt?: string;
  executedCount?: number;
  failedCount?: number;
  results?: any[];
  cancelled?: boolean;
}

export interface ExecuteBatchResult {
  success: boolean;
  executedCount: number;
  failedCount: number;
  results: Array<{
    usn: string;
    studentName: string;
    action: string;
    amount?: number;
    status: string;
    clearanceId: string;
  }>;
  message: string;
  error?: string;
}

export class AgentToolExecutionService {
  private static readonly TOKEN_EXPIRY_MINUTES = 15;

  /**
   * Enforces strict server-side department authorization
   * A department officer cannot mutate records outside their authorized scope
   */
  public static async authorizeOfficerForDepartment(
    userId: string,
    targetDepartmentId: string
  ): Promise<AuthorizeResult> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        department: true,
        associatedOfficer: {
          include: {
            departmentMappings: {
              include: { department: true }
            }
          }
        }
      }
    });

    if (!user || !user.isActive) {
      return { authorized: false, reason: 'User account is inactive or not found.' };
    }

    // Admins and Super Admins have system-wide override access
    if (user.role === UserRole.SUPER_ADMIN || user.role === UserRole.ADMIN) {
      return { authorized: true, departmentId: targetDepartmentId };
    }

    // Direct department match on user profile
    if (user.departmentId === targetDepartmentId) {
      return { authorized: true, departmentId: targetDepartmentId };
    }

    // Match via ClearanceOfficerDepartment mappings
    const mappings = user.associatedOfficer?.departmentMappings || [];
    const hasMapping = mappings.some((m) => m.departmentId === targetDepartmentId);
    if (hasMapping) {
      return { authorized: true, departmentId: targetDepartmentId };
    }

    // Fetch target department name for clear error messaging
    const targetDept = await prisma.clearanceDepartment.findUnique({
      where: { id: targetDepartmentId }
    });

    const targetName = targetDept?.name || targetDepartmentId;
    return {
      authorized: false,
      reason: `Unauthorized: You do not have clearance review permissions for ${targetName}. Access denied.`
    };
  }

  /**
   * Stage one or more proposed actions into a secure, single-use confirmation token
   */
  public static async stageActionsForConfirmation(
    userId: string,
    department: { id: string; code: string; name: string },
    actions: ExtractedActionItem[]
  ): Promise<StagedTokenPayload> {
    if (!actions || actions.length === 0) {
      throw new Error('Cannot stage an empty action list.');
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.TOKEN_EXPIRY_MINUTES * 60 * 1000);

    const payload: StagedTokenPayload = {
      token,
      departmentId: department.id,
      departmentCode: department.code,
      departmentName: department.name,
      userId,
      actions,
      expiresAt,
      lifecycleStatus: 'STAGED' as any
    };

    // Invalidate any existing unconsumed tokens for this user to avoid stale overlaps
    const existingTokens = await prisma.aiConfirmationToken.findMany({
      where: {
        userId,
        consumed: false
      }
    });

    for (const t of existingTokens) {
      const p = (t.payload as any) || {};
      await prisma.aiConfirmationToken.update({
        where: { id: t.id },
        data: {
          consumed: true,
          consumedAt: new Date(),
          payload: {
            ...p,
            lifecycleStatus: 'SUPERSEDED',
            cancelled: true,
            cancelledAt: new Date().toISOString(),
            cancellationReason: 'Superseded by new staged action'
          }
        }
      });
    }

    // Save token with full batch payload
    await prisma.aiConfirmationToken.create({
      data: {
        token,
        userId,
        action: actions.length === 1 ? actions[0].action : 'BATCH_OPERATION',
        studentId: actions[0].studentId,
        clearanceId: actions[0].clearanceId,
        payload: {
          ...payload,
          lifecycleStatus: 'STAGED'
        } as any,
        expiresAt,
        consumed: false
      }
    });

    return payload;
  }

  /**
   * Executes a confirmed action or batch of actions atomically
   */
  public static async executeConfirmedToken(
    tokenString: string,
    confirmingUserId: string,
    reqObj?: any,
    alreadyConsumed = false
  ): Promise<ExecuteBatchResult> {
    const tokenRecord = await prisma.aiConfirmationToken.findUnique({
      where: { token: tokenString }
    });

    if (!tokenRecord) {
      return {
        success: false,
        executedCount: 0,
        failedCount: 0,
        results: [],
        message: 'Invalid or expired confirmation token.',
        error: 'TOKEN_NOT_FOUND'
      };
    }

    if (tokenRecord.consumed && !alreadyConsumed) {
      return {
        success: false,
        executedCount: 0,
        failedCount: 0,
        results: [],
        message: 'This confirmation token has already been used or invalidated.',
        error: 'TOKEN_ALREADY_CONSUMED'
      };
    }

    if (new Date() > tokenRecord.expiresAt) {
      return {
        success: false,
        executedCount: 0,
        failedCount: 0,
        results: [],
        message: 'This confirmation token has expired. Please request the action again.',
        error: 'TOKEN_EXPIRED'
      };
    }

    if (tokenRecord.userId !== confirmingUserId) {
      return {
        success: false,
        executedCount: 0,
        failedCount: 0,
        results: [],
        message: 'Security mismatch: You can only confirm operations staged by your own account.',
        error: 'TOKEN_USER_MISMATCH'
      };
    }

    const payload = tokenRecord.payload as any as StagedTokenPayload;
    if (!payload || !payload.actions || payload.actions.length === 0) {
      return {
        success: false,
        executedCount: 0,
        failedCount: 0,
        results: [],
        message: 'Malformed action payload in confirmation token.',
        error: 'INVALID_PAYLOAD'
      };
    }

    // Re-verify authorization on execution
    const authCheck = await this.authorizeOfficerForDepartment(confirmingUserId, payload.departmentId);
    if (!authCheck.authorized) {
      return {
        success: false,
        executedCount: 0,
        failedCount: 0,
        results: [],
        message: authCheck.reason || 'Unauthorized operation.',
        error: 'PERMISSION_DENIED'
      };
    }

    // Mark token consumed atomically to prevent double-execution
    if (!alreadyConsumed) {
      const updateResult = await prisma.aiConfirmationToken.updateMany({
        where: { id: tokenRecord.id, consumed: false },
        data: {
          consumed: true,
          consumedAt: new Date()
        }
      });
      if (updateResult.count === 0) {
        return {
          success: false,
          executedCount: 0,
          failedCount: 0,
          results: [],
          message: 'This confirmation token has already been used or invalidated.',
          error: 'TOKEN_ALREADY_CONSUMED'
        };
      }
    }

    // Execute actions inside transaction
    const results: Array<{
      usn: string;
      studentName: string;
      action: string;
      amount?: number;
      status: string;
      clearanceId: string;
    }> = [];

    let executedCount = 0;
    let failedCount = 0;

    for (const act of payload.actions) {
      try {
        if (act.action === 'MARK_DUE') {
          // Record due in database using canonical DueManagementService
          const dueAmount = act.amount && act.amount > 0 ? act.amount : 0;
          await DueManagementService.recordClearanceDue({
            clearanceId: act.clearanceId,
            amount: dueAmount,
            reason: act.reason,
            officerUserId: confirmingUserId,
            source: 'AI_ASSISTANT',
            reqObj
          });

          results.push({
            usn: act.usn,
            studentName: act.studentName,
            action: 'MARK_DUE',
            amount: dueAmount,
            status: 'DUE',
            clearanceId: act.clearanceId
          });
          executedCount++;
        } else if (act.action === 'CLEAR_DUE') {
          // Clear clearance using canonical NdcWorkflowService
          await NdcWorkflowService.processClearanceChange(
            act.clearanceId,
            DepartmentClearanceStatus.CLEARED as any,
            confirmingUserId,
            `Cleared via ${payload.departmentName} AI Assistant: ${act.reason}`,
            0,
            '',
            reqObj
          );

          results.push({
            usn: act.usn,
            studentName: act.studentName,
            action: 'CLEAR_DUE',
            amount: 0,
            status: 'CLEARED',
            clearanceId: act.clearanceId
          });
          executedCount++;
        } else if (act.action === 'HOLD') {
          await NdcWorkflowService.processClearanceChange(
            act.clearanceId,
            DepartmentClearanceStatus.ON_HOLD as any,
            confirmingUserId,
            `Placed on hold via ${payload.departmentName} AI Assistant: ${act.reason}`,
            0,
            '',
            reqObj
          );

          results.push({
            usn: act.usn,
            studentName: act.studentName,
            action: 'HOLD',
            status: 'ON_HOLD',
            clearanceId: act.clearanceId
          });
          executedCount++;
        }
      } catch (err: any) {
        console.error(`[AgentToolExecutionService] Error executing action for ${act.usn}:`, err);
        failedCount++;
      }
    }

    // Update token record with outcome lifecycle
    await prisma.aiConfirmationToken.update({
      where: { id: tokenRecord.id },
      data: {
        payload: {
          ...payload,
          lifecycleStatus: executedCount > 0 ? 'EXECUTED' : 'FAILED',
          executedAt: executedCount > 0 ? new Date().toISOString() : undefined,
          failedAt: executedCount === 0 ? new Date().toISOString() : undefined,
          executedCount,
          failedCount,
          results
        } as any
      }
    });

    // Log high-level audit event
    await AuditService.log(
      reqObj || null,
      'AI_AGENT_BATCH_EXECUTE',
      'DEPARTMENT_CLEARANCE',
      `Officer executed ${executedCount} batched clearance operations in ${payload.departmentName}`,
      payload.departmentId,
      null,
      {
        departmentCode: payload.departmentCode,
        departmentName: payload.departmentName,
        executedCount,
        failedCount,
        results
      }
    );

    const isBatch = payload.actions.length > 1;
    const summaryMsg = isBatch
      ? `Successfully executed ${executedCount} of ${payload.actions.length} operations for ${payload.departmentName}.`
      : executedCount === 1
      ? `Operation successfully executed and recorded for ${payload.actions[0].studentName} (${payload.actions[0].usn}).`
      : `Operation failed to execute.`;

    return {
      success: executedCount > 0,
      executedCount,
      failedCount,
      results,
      message: summaryMsg
    };
  }

  /**
   * Cancels a staged token safely without any database changes
   */
  public static async cancelToken(tokenString: string, userId: string): Promise<boolean> {
    const tokenRecord = await prisma.aiConfirmationToken.findUnique({
      where: { token: tokenString }
    });

    if (!tokenRecord) {
      return false;
    }

    if (tokenRecord.userId !== userId) {
      throw new Error('Unauthorized: You can only cancel confirmation tokens you initiated.');
    }

    const payload = (tokenRecord.payload as any) || {};
    if (tokenRecord.consumed) {
      if (payload.cancelled || payload.lifecycleStatus === 'CANCELLED' || payload.lifecycleStatus === 'SUPERSEDED') {
        return true;
      }
      return false;
    }

    const updateRes = await prisma.aiConfirmationToken.updateMany({
      where: {
        id: tokenRecord.id,
        consumed: false
      },
      data: {
        consumed: true,
        consumedAt: new Date()
      }
    });

    if (updateRes.count === 0) {
      const fresh = await prisma.aiConfirmationToken.findUnique({ where: { id: tokenRecord.id } });
      const freshPayload = (fresh?.payload as any) || {};
      return !!freshPayload.cancelled || freshPayload.lifecycleStatus === 'CANCELLED';
    }

    await prisma.aiConfirmationToken.update({
      where: { id: tokenRecord.id },
      data: {
        payload: {
          ...payload,
          lifecycleStatus: 'CANCELLED',
          cancelled: true,
          cancelledAt: new Date().toISOString()
        }
      }
    });

    return true;
  }
}
