import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AiAssistantService } from '../services/AiAssistantService';
import { UserRole } from '../constants/roles';
import prisma from '../config/prisma';
import { ContextResolutionService } from '../services/ai/ContextResolutionService';

export class AiAssistantController {
  /**
   * Authoritative AI context and metrics resolution
   */
  public static async getContext(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const requestedDept = (req.query.departmentCode as string) || undefined;
      const context = await ContextResolutionService.resolveUserContext(
        {
          id: user.id || user._id,
          role: user.role,
          departmentId: user.departmentId,
          name: user.name,
          email: user.email
        },
        requestedDept
      );

      const stats = await ContextResolutionService.getContextStats(context);

      res.status(200).json({
        success: true,
        data: {
          context,
          stats
        }
      });
    } catch (err: any) {
      console.error('[AiAssistantController] getContext error:', err);
      const isForbidden = err.message?.includes('Forbidden') || err.message?.includes('Unauthorized') || err.message?.includes('not permitted');
      res.status(isForbidden ? 403 : 500).json({
        success: false,
        message: err.message || 'Failed to resolve AI assistant context.'
      });
    }
  }

  /**
   * Conversational query endpoint with automatic conversation persistence
   */
  public static async chat(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      // Check officer/HOD/Admin role
      const allowedRoles = [
        UserRole.SUPER_ADMIN,
        UserRole.ADMIN,
        UserRole.HOD,
        UserRole.DEPARTMENT_OFFICER
      ];

      if (!allowedRoles.includes(user.role as any)) {
        res.status(403).json({
          success: false,
          message: 'Forbidden: AI Assistant access is restricted to department officers and administrators.'
        });
        return;
      }

      const { messages, departmentCode, conversationId } = req.body;

      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({
          success: false,
          message: 'Bad Request: "messages" array is required.'
        });
        return;
      }

      // Authoritative context resolution - never blindly trust frontend departmentCode or default to PHY
      const resolvedCtx = await ContextResolutionService.resolveUserContext(
        {
          id: user.id || user._id,
          role: user.role,
          departmentId: user.departmentId,
          name: user.name,
          email: user.email
        },
        departmentCode
      );

      const deptCode = resolvedCtx.department.code;
      const userId = user.id || user._id;

      // 1. Persist incoming user message to aiConversationLog
      const latestUserMsg = [...messages].reverse().find((m) => m.role === 'user');
      if (latestUserMsg && latestUserMsg.content) {
        try {
          await (prisma as any).aiConversationLog.create({
            data: {
              userId,
              departmentCode: deptCode,
              role: 'user',
              content: latestUserMsg.content,
              metadata: conversationId ? { conversationId } : undefined
            }
          });
        } catch (logErr) {
          console.warn('[AiAssistantController] Failed to log user message:', logErr);
        }
      }

      // 2. Process message through multi-agent assistant
      const result = await AiAssistantService.processMessage({
        user: {
          id: userId,
          role: user.role,
          name: user.name || 'Officer',
          departmentId: user.departmentId
        },
        messages,
        departmentCode: deptCode,
        reqObj: req
      });

      // 3. Persist model assistant reply to aiConversationLog
      if (result && result.reply) {
        try {
          await (prisma as any).aiConversationLog.create({
            data: {
              userId,
              departmentCode: deptCode,
              role: 'model',
              content: result.reply,
              actionRequired: result.actionRequired ? (result.actionRequired as any) : null,
              metadata: {
                suggestions: result.suggestions,
                ...(conversationId ? { conversationId } : {})
              }
            }
          });
        } catch (logErr) {
          console.warn('[AiAssistantController] Failed to log model reply:', logErr);
        }
      }

      res.status(200).json({
        success: true,
        data: result
      });
    } catch (err: any) {
      console.error('[AiAssistantController] chat error:', err);
      const isForbidden = err.message?.includes('Forbidden') || err.message?.includes('Unauthorized') || err.message?.includes('not permitted');
      res.status(isForbidden ? 403 : 500).json({
        success: false,
        message: isForbidden ? err.message : 'Unable to process your request at this time. Please try again later.'
      });
    }
  }

  /**
   * Retrieve stored conversation history for the officer's department
   */
  public static async getHistory(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const requestedDept = (req.query.departmentCode as string) || undefined;
      const resolvedCtx = await ContextResolutionService.resolveUserContext(
        {
          id: user.id || user._id,
          role: user.role,
          departmentId: user.departmentId,
          name: user.name,
          email: user.email
        },
        requestedDept
      );
      const departmentCode = resolvedCtx.department.code;
      const limit = req.query.list === 'true' ? 1000 : Math.min(parseInt((req.query.limit as string) || '50', 10), 100);
      const userId = user.id || user._id;

      const conversationId = typeof req.query.conversationId === 'string' ? req.query.conversationId : undefined;
      const storedLogs = await (prisma as any).aiConversationLog.findMany({
        where: {
          userId,
          departmentCode
        },
        orderBy: { createdAt: 'desc' },
        take: limit
      });

      storedLogs.reverse();
      let activeConversationId = 'legacy';
      const taggedLogs = storedLogs.map((log: any) => {
        if (log.role === 'user') activeConversationId = (log.metadata as any)?.conversationId || 'legacy';
        return { ...log, metadata: { ...((log.metadata as any) || {}), conversationId: activeConversationId } };
      });
      const logs = conversationId
        ? taggedLogs.filter((log: any) => log.metadata.conversationId === conversationId)
        : taggedLogs;

      if (req.query.list === 'true') {
        const groups = new Map<string, any>();
        for (const log of logs) {
          const id = (log.metadata as any)?.conversationId || 'legacy';
          const group = groups.get(id) || { id, title: '', updatedAt: log.createdAt, messageCount: 0 };
          if (!group.title && log.role === 'user') group.title = log.content.slice(0, 80);
          group.updatedAt = log.createdAt;
          group.messageCount += 1;
          groups.set(id, group);
        }
        res.status(200).json({ success: true, data: [...groups.values()].sort((a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()) });
        return;
      }

      // Synchronize actionRequired status with actual confirmation tokens from database
      const tokenStrings = logs
        .filter((l: any) => l.actionRequired?.token)
        .map((l: any) => l.actionRequired.token);

      let tokenMap = new Map<string, any>();
      if (tokenStrings.length > 0) {
        const tokenRecords = await prisma.aiConfirmationToken.findMany({
          where: { token: { in: tokenStrings } }
        });
        tokenMap = new Map(tokenRecords.map((t) => [t.token, t]));
      }

      const synchronizedLogs = logs.map((log: any) => {
        if (!log.actionRequired || !log.actionRequired.token) {
          return log;
        }

        const tokenRec = tokenMap.get(log.actionRequired.token);
        if (!tokenRec) {
          return {
            ...log,
            actionRequired: null,
            actionCancelled: true
          };
        }

        const p = (tokenRec.payload as any) || {};
        const isExpired = new Date() > tokenRec.expiresAt;
        const lifecycleStatus =
          p.lifecycleStatus ||
          (p.cancelled ? 'CANCELLED' : tokenRec.consumed ? 'EXECUTED' : isExpired ? 'EXPIRED' : 'STAGED');

        const isExecuted = lifecycleStatus === 'EXECUTED';
        const isCancelled = lifecycleStatus === 'CANCELLED' || lifecycleStatus === 'SUPERSEDED';
        const isExp = lifecycleStatus === 'EXPIRED' || (lifecycleStatus === 'STAGED' && isExpired);

        return {
          ...log,
          actionRequired: {
            ...log.actionRequired,
            lifecycleStatus,
            consumed: tokenRec.consumed,
            isExpired: isExp
          },
          actionExecuted: isExecuted,
          actionCancelled: isCancelled,
          actionExpired: isExp
        };
      });

      res.status(200).json({
        success: true,
        data: synchronizedLogs
      });
    } catch (err: any) {
      console.error('[AiAssistantController] getHistory error:', err);
      const isForbidden = err.message?.includes('Forbidden') || err.message?.includes('Unauthorized') || err.message?.includes('not permitted');
      res.status(isForbidden ? 403 : 500).json({
        success: false,
        message: err.message || 'Failed to retrieve conversation history.'
      });
    }
  }

  /**
   * Clear active conversation history for the officer's department
   */
  public static async clearHistory(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const requestedDept = (req.query.departmentCode as string) || req.body?.departmentCode || undefined;
      const resolvedCtx = await ContextResolutionService.resolveUserContext(
        {
          id: user.id || user._id,
          role: user.role,
          departmentId: user.departmentId,
          name: user.name,
          email: user.email
        },
        requestedDept
      );
      const departmentCode = resolvedCtx.department.code;
      const userId = user.id || user._id;

      await (prisma as any).aiConversationLog.deleteMany({
        where: {
          userId,
          departmentCode
        }
      });

      res.status(200).json({
        success: true,
        message: `Conversation history cleared for ${departmentCode}.`
      });
    } catch (err: any) {
      console.error('[AiAssistantController] clearHistory error:', err);
      const isForbidden = err.message?.includes('Forbidden') || err.message?.includes('Unauthorized') || err.message?.includes('not permitted');
      res.status(isForbidden ? 403 : 500).json({
        success: false,
        message: err.message || 'Failed to clear conversation history.'
      });
    }
  }

  /**
   * Explicit confirmation and execution of staged mutation
   */
  public static async confirmAction(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { token, action, usn, amount, reason } = req.body;
      if (!token || typeof token !== 'string') {
        res.status(400).json({
          success: false,
          message: 'Bad Request: "token" string is required to confirm action.'
        });
        return;
      }

      const result = await AiAssistantService.confirmAndExecute(
        token.trim(),
        user.id || user._id,
        req,
        action || usn || amount !== undefined || reason ? { action, usn, amount, reason } : undefined
      );

      // Persist verified completion to AI Conversation history
      try {
        const departmentCode = (req.body?.departmentCode as string) || (result.clearance?.department?.code as string) || (user.department?.code as string);
        if (departmentCode && result.completionReply) {
          await prisma.aiConversationLog.create({
            data: {
              userId: user.id || user._id,
              departmentCode,
              role: 'model',
              content: result.completionReply,
              metadata: {
                action: result.action,
                status: 'ACTION_SUCCEEDED',
                usn: result.usn,
                dueAmount: result.dueAmount,
                lifecycleStatus: 'EXECUTED'
              }
            }
          });

          // Mark any prior log containing this token as executed
          const priorLogs = await (prisma as any).aiConversationLog.findMany({
            where: { userId: user.id || user._id, departmentCode }
          });
          for (const l of priorLogs) {
            if (l.actionRequired && (l.actionRequired as any).token === token.trim()) {
              await (prisma as any).aiConversationLog.update({
                where: { id: l.id },
                data: {
                  actionRequired: {
                    ...(l.actionRequired as any),
                    lifecycleStatus: 'EXECUTED',
                    actionExecuted: true
                  }
                }
              });
            }
          }
        }
      } catch (logErr) {
        console.warn('[AiAssistantController] Notice: failed to persist confirmation log:', logErr);
      }

      res.status(200).json({
        success: true,
        data: result
      });
    } catch (err: any) {
      console.error('[AiAssistantController] confirmAction error:', err);
      res.status(400).json({
        success: false,
        message: err.message || 'Failed to execute confirmed action.'
      });
    }
  }

  /**
   * Explicit cancellation of staged mutation
   */
  public static async cancelAction(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { token } = req.body;
      if (!token || typeof token !== 'string') {
        res.status(400).json({
          success: false,
          message: 'Bad Request: "token" string is required to cancel action.'
        });
        return;
      }

      const result = await AiAssistantService.cancelAction(
        token.trim(),
        user.id || user._id,
        req
      );

      // Persist cancellation to AI Conversation history
      try {
        const departmentCode = (req.body?.departmentCode as string) || (user.department?.code as string);
        if (departmentCode && result.completionReply) {
          await prisma.aiConversationLog.create({
            data: {
              userId: user.id || user._id,
              departmentCode,
              role: 'model',
              content: result.completionReply,
              metadata: {
                action: result.action,
                status: 'ACTION_CANCELLED',
                usn: result.usn,
                lifecycleStatus: 'CANCELLED'
              }
            }
          });

          // Mark any prior log containing this token as cancelled
          const priorLogs = await (prisma as any).aiConversationLog.findMany({
            where: { userId: user.id || user._id, departmentCode }
          });
          for (const l of priorLogs) {
            if (l.actionRequired && (l.actionRequired as any).token === token.trim()) {
              await (prisma as any).aiConversationLog.update({
                where: { id: l.id },
                data: {
                  actionRequired: {
                    ...(l.actionRequired as any),
                    lifecycleStatus: 'CANCELLED',
                    actionCancelled: true
                  }
                }
              });
            }
          }
        }
      } catch (logErr) {
        console.warn('[AiAssistantController] Notice: failed to persist cancellation log:', logErr);
      }

      res.status(200).json({
        success: true,
        data: result
      });
    } catch (err: any) {
      console.error('[AiAssistantController] cancelAction error:', err);
      res.status(400).json({
        success: false,
        message: err.message || 'Failed to cancel staged action.'
      });
    }
  }

  /**
   * Modify a staged action before confirmation
   */
  public static async editAction(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { token, amount, reason, usn } = req.body;
      if (!token || typeof token !== 'string') {
        res.status(400).json({
          success: false,
          message: 'Bad Request: "token" string is required to edit staged action.'
        });
        return;
      }

      const result = await AiAssistantService.editStagedAction(
        token.trim(),
        user.id || user._id,
        {
          amount: amount !== undefined ? Number(amount) : undefined,
          reason,
          usn
        },
        req
      );

      // Persist updated staged action reply to AI conversation log
      try {
        const departmentCode = (req.body?.departmentCode as string) || (user.department?.code as string);
        if (departmentCode && result.reply) {
          await prisma.aiConversationLog.create({
            data: {
              userId: user.id || user._id,
              departmentCode,
              role: 'model',
              content: result.reply,
              actionRequired: result.actionRequired ? (result.actionRequired as any) : null,
              metadata: {
                suggestions: result.suggestions
              }
            }
          });
        }
      } catch (logErr) {
        console.warn('[AiAssistantController] Failed to log edit reply:', logErr);
      }

      res.status(200).json({
        success: true,
        data: result
      });
    } catch (err: any) {
      console.error('[AiAssistantController] editAction error:', err);
      res.status(400).json({
        success: false,
        message: err.message || 'Failed to edit staged action.'
      });
    }
  }

  /**
   * Create and trigger an agentic task
   */
  public static async createTask(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { goal, departmentCode, targetEntityId, idempotencyKey, maxSteps } = req.body;
      if (!goal || typeof goal !== 'string') {
        res.status(400).json({ success: false, message: 'goal is required and must be a string.' });
        return;
      }

      const effectiveDept = departmentCode || user.department?.code;
      if (!effectiveDept) {
        res.status(400).json({ success: false, message: 'departmentCode is required.' });
        return;
      }

      const { AgentTaskRunner } = await import('../services/ai/AgentTaskRunner');
      const { AgentBrainOrchestrator } = await import('../services/ai/AgentBrainOrchestrator');

      const task = await AgentTaskRunner.createTask({
        goal,
        userId: user.id || user._id,
        departmentCode: effectiveDept,
        targetEntityId,
        idempotencyKey,
        maxSteps: maxSteps ? Number(maxSteps) : 10
      });

      // Run orchestrator
      const runResult = await AgentBrainOrchestrator.runTask({
        taskId: task.id,
        ipAddress: req.ip
      });

      res.status(200).json({
        success: true,
        data: {
          task: runResult.task,
          status: runResult.status,
          waitingConfirmation: runResult.waitingConfirmation || false,
          token: runResult.token || null,
          summary: runResult.summary || null
        }
      });
    } catch (err: any) {
      console.error('[AiAssistantController] createTask error:', err);
      res.status(500).json({
        success: false,
        message: err.message || 'Failed to execute agent task.'
      });
    }
  }

  /**
   * Get task details and progress steps
   */
  public static async getTask(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { taskId } = req.params;
      const task = await prisma.aiAgentTask.findUnique({
        where: { id: taskId },
        include: {
          steps: { orderBy: { stepIndex: 'asc' } }
        }
      });

      if (!task) {
        res.status(404).json({ success: false, message: 'Task not found.' });
        return;
      }

      // Department & user scoping
      if (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPER_ADMIN) {
        if (task.userId !== (user.id || user._id)) {
          res.status(403).json({ success: false, message: 'Access denied: task belongs to another officer.' });
          return;
        }
      }

      res.status(200).json({
        success: true,
        data: task
      });
    } catch (err: any) {
      console.error('[AiAssistantController] getTask error:', err);
      res.status(500).json({
        success: false,
        message: err.message || 'Failed to retrieve task.'
      });
    }
  }

  /**
   * Resume task after user confirmation
   */
  public static async resumeTask(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { taskId } = req.params;
      const { token } = req.body;

      if (!token) {
        res.status(400).json({ success: false, message: 'Confirmation token is required to resume task.' });
        return;
      }

      const { AgentBrainOrchestrator } = await import('../services/ai/AgentBrainOrchestrator');
      const resumeResult = await AgentBrainOrchestrator.resumeConfirmedTask(
        taskId,
        token,
        user.id || user._id,
        req
      );

      res.status(200).json({
        success: true,
        data: resumeResult
      });
    } catch (err: any) {
      console.error('[AiAssistantController] resumeTask error:', err);
      res.status(400).json({
        success: false,
        message: err.message || 'Failed to resume task.'
      });
    }
  }
}
