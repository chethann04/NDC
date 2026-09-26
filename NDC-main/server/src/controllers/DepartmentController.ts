import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { AuditService } from '../services/AuditService';
import { AuthRequest } from '../middleware/auth';
import { withId, withIds } from '../utils/formatters';
import { departmentCache } from '../utils/departmentCache';
import { NdcWorkflowService } from '../services/NdcWorkflowService';
import { invalidateStudentStatusCache, invalidateOfficerStatsCache } from './NdcController';

export class DepartmentController {
  private static cachedDepartments: any[] | null = null;
  private static cacheExpiry = 0;
  private static readonly TTL = 5 * 60 * 1000; // 5 minutes

  public static invalidateCache(): void {
    DepartmentController.cachedDepartments = null;
    DepartmentController.cacheExpiry = 0;
    departmentCache.invalidate();
    invalidateStudentStatusCache();
    invalidateOfficerStatsCache();
  }

  public static async getAllDepartments(req: Request, res: Response): Promise<void> {
    try {
      const now = Date.now();
      if (DepartmentController.cachedDepartments && now < DepartmentController.cacheExpiry) {
        res.status(200).json({ success: true, data: DepartmentController.cachedDepartments });
        return;
      }

      const departments = await prisma.clearanceDepartment.findMany({
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }]
      });
      const formatted = withIds(departments);
      DepartmentController.cachedDepartments = formatted;
      DepartmentController.cacheExpiry = now + DepartmentController.TTL;

      res.status(200).json({ success: true, data: formatted });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  public static async getDepartmentById(req: Request, res: Response): Promise<void> {
    try {
      const department = await prisma.clearanceDepartment.findUnique({
        where: { id: req.params.id }
      });
      if (!department) {
        res.status(404).json({ success: false, message: 'Department not found.' });
        return;
      }
      res.status(200).json({ success: true, data: withId(department) });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  public static async createDepartment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const {
        name,
        code,
        category,
        description,
        isAcademicBranch,
        requiresClearance,
        displayOrder,
        hodName,
        hodDesignation
      } = req.body;
      const formattedCode = String(code).toUpperCase().trim();

      const existing = await prisma.clearanceDepartment.findFirst({
        where: {
          OR: [{ name: name.trim() }, { code: formattedCode }]
        }
      });

      if (existing) {
        res.status(400).json({ success: false, message: `Department with name [${name}] or code [${formattedCode}] already exists.` });
        return;
      }

      const isBranch = Boolean(isAcademicBranch);
      const assignedCategory = category || (isBranch ? 'ACADEMIC_BRANCH' : 'CENTRAL_DESK');

      const department = await prisma.clearanceDepartment.create({
        data: {
          name: name.trim(),
          code: formattedCode,
          category: assignedCategory,
          description: description || '',
          isAcademicBranch: isBranch,
          requiresClearance: requiresClearance !== undefined ? Boolean(requiresClearance) : true,
          displayOrder: displayOrder !== undefined ? parseInt(displayOrder, 10) : 0,
          hodName: hodName ? String(hodName).trim() : '',
          hodDesignation: hodDesignation ? String(hodDesignation).trim() : 'Head of the Department',
          isActive: true
        }
      });

      // Auto-provision branch department lab if academic branch
      if (department.isAcademicBranch) {
        await prisma.departmentLab.create({
          data: {
            departmentId: department.id,
            code: `${department.code}-LAB`,
            name: `${department.name} Lab`,
            isActive: true,
            displayOrder: 1
          }
        });
      }

      await AuditService.log(req, 'DEPARTMENT_CREATED', 'ClearanceDepartment', `Created department [${department.code}] - ${department.name}.`, department.id);
      DepartmentController.invalidateCache();

      if (department.requiresClearance && department.isActive) {
        await NdcWorkflowService.syncDepartmentClearanceRequirement(
          department.id,
          true,
          req
        );
      }

      res.status(201).json({ success: true, message: 'Department created successfully.', data: withId(department) });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  public static async updateDepartment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const {
        name,
        code,
        category,
        description,
        isAcademicBranch,
        requiresClearance,
        displayOrder,
        isActive,
        hodName,
        hodDesignation
      } = req.body;

      const department = await prisma.clearanceDepartment.findUnique({
        where: { id: req.params.id }
      });
      if (!department) {
        res.status(404).json({ success: false, message: 'Department not found.' });
        return;
      }

      const updateData: any = {};

      if (name && name.trim() !== department.name) {
        const trimmedName = name.trim();
        const existingName = await prisma.clearanceDepartment.findFirst({
          where: { name: trimmedName, id: { not: req.params.id } }
        });
        if (existingName) {
          res.status(400).json({ success: false, message: `Department name "${trimmedName}" is already taken.` });
          return;
        }
        updateData.name = trimmedName;
      }

      if (code) {
        const formattedCode = String(code).toUpperCase().trim();
        if (formattedCode !== department.code) {
          const existingCode = await prisma.clearanceDepartment.findFirst({
            where: { code: formattedCode, id: { not: req.params.id } }
          });
          if (existingCode) {
            res.status(400).json({ success: false, message: `Department code "${formattedCode}" is already taken.` });
            return;
          }
          updateData.code = formattedCode;
        }
      }

      if (category !== undefined) updateData.category = String(category).trim();
      if (description !== undefined) updateData.description = description;
      if (isAcademicBranch !== undefined) updateData.isAcademicBranch = Boolean(isAcademicBranch);
      if (requiresClearance !== undefined) updateData.requiresClearance = Boolean(requiresClearance);
      if (displayOrder !== undefined) updateData.displayOrder = parseInt(displayOrder, 10);
      if (isActive !== undefined) updateData.isActive = Boolean(isActive);
      if (hodName !== undefined) updateData.hodName = String(hodName).trim();
      if (hodDesignation !== undefined) updateData.hodDesignation = String(hodDesignation).trim();

      const requiresClearanceChanged = requiresClearance !== undefined && updateData.requiresClearance !== department.requiresClearance;
      const isActiveChanged = isActive !== undefined && updateData.isActive !== department.isActive;
      const branchChanged = isAcademicBranch !== undefined && updateData.isAcademicBranch !== department.isAcademicBranch;

      const updated = await prisma.clearanceDepartment.update({
        where: { id: req.params.id },
        data: updateData
      });

      // If code changed and department is academic branch, update its default lab code
      if (updateData.code && updateData.code !== department.code) {
        await prisma.departmentLab.updateMany({
          where: { departmentId: updated.id, code: `${department.code}-LAB` },
          data: { code: `${updateData.code}-LAB` }
        });
      }

      // If department was turned into an academic branch, ensure unified department lab exists
      if (updated.isAcademicBranch) {
        const existingLab = await prisma.departmentLab.findFirst({
          where: { departmentId: updated.id }
        });
        if (!existingLab) {
          await prisma.departmentLab.create({
            data: {
              departmentId: updated.id,
              code: `${updated.code}-LAB`,
              name: `${updated.name} Lab`,
              isActive: true,
              displayOrder: 1
            }
          });
        }
      }

      await AuditService.log(req, 'DEPARTMENT_UPDATED', 'ClearanceDepartment', `Updated department [${updated.code}] - ${updated.name}.`, updated.id, department, updated);
      DepartmentController.invalidateCache();

      // Immediately sync all student clearance records if rules changed
      if (requiresClearanceChanged || isActiveChanged || branchChanged) {
        await NdcWorkflowService.syncDepartmentClearanceRequirement(
          updated.id,
          updated.requiresClearance && updated.isActive,
          req
        );
      }

      res.status(200).json({ success: true, message: 'Department updated successfully.', data: withId(updated) });
    } catch (err: any) {
      console.error('[updateDepartment Error]:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  }

  public static async toggleDepartmentStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      const department = await prisma.clearanceDepartment.findUnique({
        where: { id: req.params.id }
      });
      if (!department) {
        res.status(404).json({ success: false, message: 'Department not found.' });
        return;
      }

      const updated = await prisma.clearanceDepartment.update({
        where: { id: req.params.id },
        data: { isActive: !department.isActive }
      });

      await AuditService.log(req, 'DEPARTMENT_STATUS_TOGGLED', 'ClearanceDepartment', `Toggled department [${updated.code}] active state to ${updated.isActive}.`, updated.id);
      DepartmentController.invalidateCache();

      // Immediately sync workflow requirement when department is enabled/disabled
      await NdcWorkflowService.syncDepartmentClearanceRequirement(
        updated.id,
        updated.requiresClearance && updated.isActive,
        req
      );

      res.status(200).json({ success: true, message: `Department status updated to ${updated.isActive ? 'Active' : 'Inactive'}.`, data: withId(updated) });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Permanently delete any department (Super Admin only).
   * Cascades through department labs, clearance tasks, and detaches users.
   */
  public static async deleteDepartment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const force = req.query.force === 'true' || req.body?.force === true;

      const department = await prisma.clearanceDepartment.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              students: true,
              users: true,
              clearances: true,
              labs: true,
              officerMappings: true
            }
          }
        }
      });

      if (!department) {
        res.status(404).json({ success: false, message: 'Department not found.' });
        return;
      }

      const studentCount = department._count.students;
      if (studentCount > 0 && !force) {
        res.status(400).json({
          success: false,
          requiresConfirmation: true,
          message: `Department [${department.code}] has ${studentCount} enrolled student(s). Deleting it will permanently remove all associated records. Confirm force deletion to proceed.`,
          data: {
            studentCount,
            userCount: department._count.users,
            clearanceCount: department._count.clearances,
            labCount: department._count.labs
          }
        });
        return;
      }

      await prisma.$transaction(async (tx) => {
        // 1. Delete all clearance tasks associated with this department
        await tx.ndcClearance.deleteMany({
          where: { departmentId: id }
        });

        // 2. Delete all department labs and their clearances
        const deptLabs = await tx.departmentLab.findMany({
          where: { departmentId: id },
          select: { id: true }
        });
        if (deptLabs.length > 0) {
          const labIds = deptLabs.map((l) => l.id);
          await tx.ndcClearance.deleteMany({
            where: { labId: { in: labIds } }
          });
          await tx.departmentLab.deleteMany({
            where: { departmentId: id }
          });
        }

        // 3. Delete officer mappings for this department
        await tx.clearanceOfficerDepartment.deleteMany({
          where: { departmentId: id }
        });

        // 4. Detach users assigned to this department
        await tx.user.updateMany({
          where: { departmentId: id },
          data: { departmentId: null }
        });

        // 5. If force deleting and students exist, clean up students and their NDC requests
        if (studentCount > 0) {
          const students = await tx.student.findMany({
            where: { departmentId: id },
            select: { id: true }
          });
          const sIds = students.map((s) => s.id);

          await tx.ndcClearance.deleteMany({
            where: { studentId: { in: sIds } }
          });
          await tx.ndcRequest.deleteMany({
            where: { studentId: { in: sIds } }
          });
          await tx.user.deleteMany({
            where: { associatedStudentId: { in: sIds } }
          });
          await tx.student.deleteMany({
            where: { departmentId: id }
          });
        }

        // 6. Delete the department itself
        await tx.clearanceDepartment.delete({
          where: { id }
        });
      });

      await AuditService.log(
        req,
        'DEPARTMENT_DELETED',
        'ClearanceDepartment',
        `Super Admin permanently deleted department [${department.code}] - ${department.name}.`,
        department.id,
        department,
        null
      );

      DepartmentController.invalidateCache();

      res.status(200).json({
        success: true,
        message: `Department [${department.code}] - ${department.name} was successfully deleted.`
      });
    } catch (err: any) {
      console.error('[deleteDepartment Error]:', err);
      res.status(500).json({ success: false, message: err.message || 'Failed to delete department.' });
    }
  }
}
