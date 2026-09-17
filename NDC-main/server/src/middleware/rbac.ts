import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { UserRole } from '../constants/roles';

import prisma from '../config/prisma';

export const isCashFeeOfficer = async (user: any): Promise<boolean> => {
  if (!user) return false;
  if (user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN) return true;
  if (user.role !== UserRole.DEPARTMENT_OFFICER) return false;

  // 1. Fast Email check (instant, 0 queries)
  if (user.email && (user.email.startsWith('cashfee') || user.email === 'accounts@mce.ac.in')) {
    return true;
  }

  // 2. In-memory department checks if present
  if (user.department?.code === 'ACC' || user.department?.name === 'Cash/Fee Section') return true;

  const mappings = user.associatedOfficer?.departmentMappings || [];
  
  if (mappings.some((m: any) => m.department?.code === 'ACC' || m.department?.name === 'Cash/Fee Section')) {
    return true;
  }

  // 3. Lazy single-row check ONLY if invoked on Cash/Fee endpoints
  if (user.associatedOfficerId) {
    const isMapped = await prisma.clearanceOfficerDepartment.findFirst({
      where: {
        officerId: user.associatedOfficerId,
        department: { OR: [{ code: 'ACC' }, { name: 'Cash/Fee Section' }] }
      }
    });
    if (isMapped) return true;
  }

  return false;
};

export const authorizeRoles = (...allowedRoles: UserRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    if (!allowedRoles.includes(req.user.role as UserRole)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Access restricted for role [${req.user.role}]. Required: [${allowedRoles.join(', ')}].`
      });
    }

    next();
  };
};

export const authorizeRolesOrCashFee = (...allowedRoles: UserRole[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const isAuthorizedRole = allowedRoles.includes(req.user.role as UserRole);
    if (isAuthorizedRole || (await isCashFeeOfficer(req.user))) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: `Forbidden: Access restricted. Required roles: [${allowedRoles.join(', ')}] or Cash/Fee Section Officer.`
    });
  };
};
