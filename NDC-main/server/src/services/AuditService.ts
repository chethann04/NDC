import prisma from '../config/prisma';
import { Request } from 'express';

export class AuditService {
  public static async log(
    req: Request | null,
    action: string,
    entityType: string,
    description: string,
    entityId?: any,
    oldValue?: any,
    newValue?: any
  ): Promise<void> {
    try {
      const user = (req as any)?.user;
      const ipAddress = req?.ip || req?.headers?.['x-forwarded-for']?.toString() || '127.0.0.1';
      const userAgent = req?.headers?.['user-agent'] || 'API Client';

      await prisma.auditLog.create({
        data: {
          userId: user ? (user.id || user._id) : undefined,
          userName: user ? user.name : 'SYSTEM',
          role: user ? user.role : 'SYSTEM',
          action,
          entityType,
          entityId: entityId ? String(entityId) : undefined,
          oldValue: oldValue ? (typeof oldValue === 'object' ? oldValue : { value: oldValue }) : undefined,
          newValue: newValue ? (typeof newValue === 'object' ? newValue : { value: newValue }) : undefined,
          description,
          ipAddress,
          userAgent,
          timestamp: new Date()
        }
      });
    } catch (err) {
      console.error('[AuditService Log Error]:', err);
    }
  }
}
