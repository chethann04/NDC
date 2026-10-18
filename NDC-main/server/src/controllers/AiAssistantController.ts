import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AiAssistantService } from '../services/AiAssistantService';
import { UserRole } from '../constants/roles';

export class AiAssistantController {
  /**
   * Conversational query endpoint
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

      const result = await AiAssistantService.processMessage({
        user: {
          id: user.id || user._id,
          role: user.role,
          name: user.name || 'Officer',
          departmentId: user.departmentId
        },
        messages,
        departmentCode,
        reqObj: req
      });

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
