import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { withId, withIds } from '../utils/formatters';

export class AuditController {
  public static async getAuditLogs(req: Request, res: Response): Promise<void> {
    try {
      const { action, entityType, search, scope, department, page = '1', limit = '25' } = req.query;
      const where: any = {};

      if (action) where.action = String(action);
      if (entityType) where.entityType = String(entityType);

      const currentUser = (req as any).user;
      const isOfficer = currentUser && currentUser.role === 'DEPARTMENT_OFFICER';
      const isCashFeeOfficerUser =
        isOfficer &&
        (currentUser.email?.startsWith('cashfee') ||
          currentUser.email === 'accounts@mce.ac.in' ||
          currentUser.department?.code === 'ACC' ||
          currentUser.department?.name === 'Cash/Fee Section' ||
          currentUser.associatedOfficer?.departmentMappings?.some((m: any) => m.department?.code === 'ACC'));

      const andConditions: any[] = [];

      // If user is Cash/Fee Officer OR query requests Cash/Fee scope
      if (isCashFeeOfficerUser || scope === 'cashfee' || department === 'ACC') {
        const cashFeeDept = await prisma.clearanceDepartment.findUnique({
          where: { code: 'ACC' }
        });
        const deptId = cashFeeDept?.id;

        const cashFeeUsers = await prisma.user.findMany({
          where: {
            OR: [
              ...(deptId ? [{ departmentId: deptId }] : []),
              ...(deptId ? [{ associatedOfficer: { departmentMappings: { some: { departmentId: deptId } } } }] : []),
              { email: { in: ['cashfee1@mce.ac.in', 'cashfee2@mce.ac.in', 'cashfee3@mce.ac.in', 'accounts@mce.ac.in'] } },
              { email: { startsWith: 'cashfee' } }
            ]
          },
          select: { id: true }
        });
        const cashFeeUserIds = cashFeeUsers.map((u) => u.id);

        let clearanceIds: string[] = [];
        if (deptId) {
          const clearances = await prisma.ndcClearance.findMany({
            where: { departmentId: deptId },
            select: { id: true }
          });
          clearanceIds = clearances.map((c) => c.id);
        }

        andConditions.push({
          OR: [
            ...(cashFeeUserIds.length > 0 ? [{ userId: { in: cashFeeUserIds } }] : []),
            ...(clearanceIds.length > 0 ? [{ entityId: { in: clearanceIds } }] : []),
            { userName: { contains: 'Cash/Fee', mode: 'insensitive' } },
            { userName: { contains: 'Accounts', mode: 'insensitive' } },
            { description: { contains: 'accounts@mce.ac.in', mode: 'insensitive' } },
            { description: { contains: 'cashfee', mode: 'insensitive' } },
            { description: { contains: 'Cash/Fee Section', mode: 'insensitive' } }
          ]
        });
      } else if (isOfficer) {
        // Any other officer only sees actions associated with their own user account
        andConditions.push({
          userId: currentUser.id || currentUser._id
        });
      }

      if (search) {
        const searchStr = String(search).trim();
        andConditions.push({
          OR: [
            { userName: { contains: searchStr, mode: 'insensitive' } },
            { description: { contains: searchStr, mode: 'insensitive' } },
            { action: { contains: searchStr, mode: 'insensitive' } }
          ]
        });
      }

      if (andConditions.length > 0) {
        where.AND = andConditions;
      }

      const pageNum = Math.max(1, parseInt(String(page || '1'), 10));
      const limitNum = Math.min(500, Math.max(1, parseInt(String(limit || '25'), 10)));
      const skip = (pageNum - 1) * limitNum;

      const [total, logs] = await Promise.all([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({
          where,
          include: {
            user: {
              select: { id: true, name: true, email: true, role: true }
            }
          },
          orderBy: { timestamp: 'desc' },
          skip,
          take: limitNum
        })
      ]);

      const formatted = logs.map((l) => ({
        ...l,
        userId: withId(l.user)
      }));

      res.status(200).json({
        success: true,
        data: withIds(formatted),
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum)
        }
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}
