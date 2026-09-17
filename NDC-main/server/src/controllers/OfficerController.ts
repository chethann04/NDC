import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma';
import { UserRole } from '../constants/roles';
import { AuditService } from '../services/AuditService';
import { AuthRequest } from '../middleware/auth';
import { withId, withIds } from '../utils/formatters';
import { hashPassword } from '../utils/passwordUtils';

export class OfficerController {
  public static async getAllOfficers(req: Request, res: Response): Promise<void> {
    try {
      const officers = await prisma.clearanceOfficer.findMany({
        include: {
          departmentMappings: {
            include: { department: true }
          },
          user: {
            select: { role: true }
          }
        },
        orderBy: { name: 'asc' }
      });

      const formatted = officers.map((o) => ({
        ...o,
        role: o.user?.role || 'DEPARTMENT_OFFICER',
        departmentIds: o.departmentMappings.map((m) => withId(m.department))
      }));

      res.status(200).json({ success: true, data: withIds(formatted) });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  public static async getOfficerById(req: Request, res: Response): Promise<void> {
    try {
      const officer = await prisma.clearanceOfficer.findUnique({
        where: { id: req.params.id },
        include: {
          departmentMappings: {
            include: { department: true }
          },
          user: {
            select: { role: true }
          }
        }
      });
      if (!officer) {
        res.status(404).json({ success: false, message: 'Clearance officer not found.' });
        return;
      }

      const formatted = {
        ...officer,
        role: officer.user?.role || 'DEPARTMENT_OFFICER',
        departmentIds: officer.departmentMappings.map((m) => withId(m.department))
      };

      res.status(200).json({ success: true, data: withId(formatted) });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  public static async createOfficer(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { employeeId, name, email, departmentIds, role } = req.body;
      const formattedEmpId = String(employeeId).toUpperCase().trim();
      const formattedEmail = String(email).toLowerCase().trim();

      const existingOfficer = await prisma.clearanceOfficer.findFirst({
        where: {
          OR: [{ employeeId: formattedEmpId }, { email: formattedEmail }]
        }
      });

      if (existingOfficer) {
        res.status(400).json({ success: false, message: `Officer with Employee ID [${formattedEmpId}] or Email [${formattedEmail}] already exists.` });
        return;
      }

      const defaultHash = await hashPassword('Officer@123');
      const userRole = role === 'HOD' ? UserRole.HOD : UserRole.DEPARTMENT_OFFICER;

      // Create associated User account first
      const user = await prisma.user.create({
        data: {
          email: formattedEmail,
          passwordHash: defaultHash,
          role: userRole as any,
          name,
          departmentId: Array.isArray(departmentIds) && departmentIds.length > 0 ? departmentIds[0] : undefined,
          isActive: true,
          mustChangePassword: true
        }
      });

      const officer = await prisma.clearanceOfficer.create({
        data: {
          userId: user.id,
          employeeId: formattedEmpId,
          name,
          email: formattedEmail,
          isActive: true
        }
      });

      await prisma.user.update({
        where: { id: user.id },
        data: { associatedOfficerId: officer.id }
      });

      // Add department mappings
      if (Array.isArray(departmentIds) && departmentIds.length > 0) {
        for (const deptId of departmentIds) {
          await prisma.clearanceOfficerDepartment.create({
            data: {
              officerId: officer.id,
              departmentId: deptId
            }
          });
        }
      }

      await AuditService.log(req, 'OFFICER_CREATED', 'ClearanceOfficer', `Created officer [${officer.employeeId}] - ${officer.name}.`, officer.id);

      res.status(201).json({ success: true, message: 'Officer created successfully.', data: withId(officer) });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  public static async updateOfficer(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { name, email, departmentIds, isActive, role } = req.body;
      const officer = await prisma.clearanceOfficer.findUnique({
        where: { id: req.params.id }
      });
      if (!officer) {
        res.status(404).json({ success: false, message: 'Officer not found.' });
        return;
      }

      const updateData: any = {};
      if (name) updateData.name = name;
      if (email) updateData.email = email.toLowerCase().trim();
      if (isActive !== undefined) updateData.isActive = isActive;

      const updated = await prisma.clearanceOfficer.update({
        where: { id: req.params.id },
        data: updateData
      });

      if (Array.isArray(departmentIds)) {
        await prisma.clearanceOfficerDepartment.deleteMany({
          where: { officerId: officer.id }
        });
        for (const deptId of departmentIds) {
          await prisma.clearanceOfficerDepartment.create({
            data: {
              officerId: officer.id,
              departmentId: deptId
            }
          });
        }
      }

      // Sync User record
      const user = await prisma.user.findUnique({ where: { id: officer.userId } });
      if (user) {
        const userUpdateData: any = {};
        if (name) userUpdateData.name = name;
        if (email) userUpdateData.email = email.toLowerCase().trim();
        if (role) userUpdateData.role = role === 'HOD' ? UserRole.HOD : UserRole.DEPARTMENT_OFFICER;
        if (isActive !== undefined) userUpdateData.isActive = isActive;
        if (Array.isArray(departmentIds) && departmentIds.length > 0) {
          userUpdateData.departmentId = departmentIds[0];
        }
        await prisma.user.update({
          where: { id: user.id },
          data: userUpdateData
        });
      }

      await AuditService.log(req, 'OFFICER_UPDATED', 'ClearanceOfficer', `Updated officer details for [${officer.employeeId}].`, officer.id, officer, updated);

      res.status(200).json({ success: true, message: 'Officer updated successfully.', data: withId(updated) });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  public static async deleteOfficer(req: AuthRequest, res: Response): Promise<void> {
    try {
      const officer = await prisma.clearanceOfficer.findUnique({
        where: { id: req.params.id }
      });
      if (!officer) {
        res.status(404).json({ success: false, message: 'Officer not found.' });
        return;
      }

      await prisma.user.delete({ where: { id: officer.userId } });
      await prisma.clearanceOfficer.delete({ where: { id: officer.id } });

      await AuditService.log(req, 'OFFICER_DELETED', 'ClearanceOfficer', `Deleted officer [${officer.employeeId}].`, officer.id);

      res.status(200).json({ success: true, message: 'Officer deleted successfully.' });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}
