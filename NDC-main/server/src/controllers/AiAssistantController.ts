import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AiAssistantService } from '../services/AiAssistantService';
import { UserRole } from '../constants/roles';
import prisma from '../config/prisma';

export class AiAssistantController {
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

      const { messages, departmentCode = 'PHY' } = req.body;

      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({
          success: false,
          message: 'Bad Request: "messages" array is required.'
        });
        return;
      }

      const deptCode = String(departmentCode).toUpperCase();
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
              content: latestUserMsg.content
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
                suggestions: result.suggestions
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
      res.status(500).json({
        success: false,
        message: err.message || 'Internal server error while processing AI assistant query.'
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

      const departmentCode = ((req.query.departmentCode as string) || 'PHY').toUpperCase();
      const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 100);
      const userId = user.id || user._id;

      const logs = await (prisma as any).aiConversationLog.findMany({
        where: {
          userId,
          departmentCode
        },
        orderBy: { createdAt: 'asc' },
        take: limit
      });

      res.status(200).json({
        success: true,
        data: logs
      });
    } catch (err: any) {
      console.error('[AiAssistantController] getHistory error:', err);
      res.status(500).json({
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

      const departmentCode = (
        (req.query.departmentCode as string) ||
        (req.body?.departmentCode as string) ||
        'PHY'
      ).toUpperCase();

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
      res.status(500).json({
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
}
