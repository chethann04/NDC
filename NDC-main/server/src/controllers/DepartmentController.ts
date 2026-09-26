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
      const { name, code, description, requiresClearance, displayOrder } = req.body;
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

      const department = await prisma.clearanceDepartment.create({
        data: {
          name: name.trim(),
          code: formattedCode,
          description: description || '',
          requiresClearance: requiresClearance !== undefined ? requiresClearance : true,
          displayOrder: displayOrder !== undefined ? parseInt(displayOrder, 10) : 0,
          isActive: true
        }
      });

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
      const { name, code, description, requiresClearance, displayOrder, isActive, hodName, hodDesignation } = req.body;
      const department = await prisma.clearanceDepartment.findUnique({
        where: { id: req.params.id }
      });
      if (!department) {
        res.status(404).json({ success: false, message: 'Department not found.' });
        return;
      }

      const requiresClearanceChanged = requiresClearance !== undefined && requiresClearance !== department.requiresClearance;
      const isActiveChanged = isActive !== undefined && isActive !== department.isActive;

      const updateData: any = {};
      if (name) updateData.name = name.trim();
      if (code) updateData.code = String(code).toUpperCase().trim();
      if (description !== undefined) updateData.description = description;
      if (requiresClearance !== undefined) updateData.requiresClearance = requiresClearance;
      if (displayOrder !== undefined) updateData.displayOrder = parseInt(displayOrder, 10);
      if (isActive !== undefined) updateData.isActive = isActive;
      if (hodName !== undefined) updateData.hodName = String(hodName).trim();
      if (hodDesignation !== undefined) updateData.hodDesignation = String(hodDesignation).trim();

      const updated = await prisma.clearanceDepartment.update({
        where: { id: req.params.id },
        data: updateData
      });

      await AuditService.log(req, 'DEPARTMENT_UPDATED', 'ClearanceDepartment', `Updated department [${updated.code}].`, updated.id, department, updated);
      DepartmentController.invalidateCache();

      // Immediately sync all student clearance records and recalculate NDC workflow if mandatory status or active state changed
      if (requiresClearanceChanged || isActiveChanged) {
        await NdcWorkflowService.syncDepartmentClearanceRequirement(
          updated.id,
          updated.requiresClearance && updated.isActive,
          req
        );
      }

      res.status(200).json({ success: true, message: 'Department updated successfully.', data: withId(updated) });
    } catch (err: any) {
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
}
