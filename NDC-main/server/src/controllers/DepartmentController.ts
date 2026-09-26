import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { AuditService } from '../services/AuditService';
import { AuthRequest, invalidateUserCache } from '../middleware/auth';
import { withId, withIds } from '../utils/formatters';
import { departmentCache } from '../utils/departmentCache';
import { NdcWorkflowService } from '../services/NdcWorkflowService';
import { invalidateStudentStatusCache, invalidateOfficerStatsCache } from './NdcController';
import { UserRole } from '../constants/roles';
import { hashPassword } from '../utils/passwordUtils';

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

  /**
   * Automatically provisions all required companion entities when a new department is created:
   * - Academic Branch: creates Department Lab, default HOD account, default Faculty section account, and links officer.
   * - Central / Non-Academic: creates default Clearance Officer account and officer department mapping.
   * - Clearance requirements: synchronizes student workflow queues so students immediately see the requirement.
   */
  public static async provisionDepartmentDefaults(department: any, req?: any): Promise<{
    lab?: any;
    hodUser?: any;
    officerUser?: any;
    officer?: any;
  }> {
    const result: any = {};
    const defaultPassword = 'Officer@123';
    const passwordHash = await hashPassword(defaultPassword);
    const cleanCode = department.code.toUpperCase().trim();
    const cleanLowerCode = cleanCode.toLowerCase();

    if (department.isAcademicBranch) {
      // 1. Ensure Department Lab exists
      let lab = await prisma.departmentLab.findFirst({
        where: { departmentId: department.id }
      });
      if (!lab) {
        lab = await prisma.departmentLab.create({
          data: {
            departmentId: department.id,
            code: `${cleanCode}-LAB`,
            name: `${department.name} Lab`,
            isActive: true,
            displayOrder: 1
          }
        });
      }
      result.lab = lab;

      // 2. Provision HOD Account if not exists
      const hodEmail = `hod.${cleanLowerCode}@mce.ac.in`;
      const hodLoginId = `HOD-${cleanCode}`;
      let existingHod = await prisma.user.findFirst({
        where: {
          OR: [
            { email: { equals: hodEmail, mode: 'insensitive' } },
            { loginId: hodLoginId }
          ]
        }
      });

      if (!existingHod) {
        const hodName = department.hodName?.trim() || `Head of Department (${cleanCode})`;
        existingHod = await prisma.user.create({
          data: {
            name: hodName,
            email: hodEmail,
            loginId: hodLoginId,
            role: UserRole.HOD,
            departmentId: department.id,
            passwordHash,
            isActive: true,
            mustChangePassword: false
          }
        });
        if (!department.hodName) {
          await prisma.clearanceDepartment.update({
            where: { id: department.id },
            data: { hodName }
          });
        }
      }
      result.hodUser = existingHod;

      // 3. Provision Department Faculty / Lab Officer Account if not exists
      const facultyEmail = `faculty.${cleanLowerCode}@mce.ac.in`;
      const facultyLoginId = `${cleanCode}001`;
      const facultyEmpId = `EMP-${cleanCode}-FAC`;

      const existingFaculty = await prisma.user.findFirst({
        where: {
          OR: [
            { email: { equals: facultyEmail, mode: 'insensitive' } },
            { loginId: facultyLoginId }
          ]
        },
        include: { associatedOfficer: true }
      });

      if (!existingFaculty) {
        const facultyName = `Department Faculty (${cleanCode})`;
        const newFaculty = await prisma.user.create({
          data: {
            name: facultyName,
            email: facultyEmail,
            loginId: facultyLoginId,
            role: UserRole.DEPARTMENT_OFFICER,
            departmentId: department.id,
            passwordHash,
            isActive: true,
            mustChangePassword: false
          }
        });

        // Create ClearanceOfficer record
        let officer = await prisma.clearanceOfficer.findFirst({
          where: {
            OR: [
              { userId: newFaculty.id },
              { employeeId: facultyEmpId },
              { email: facultyEmail }
            ]
          }
        });

        if (!officer) {
          officer = await prisma.clearanceOfficer.create({
            data: {
              userId: newFaculty.id,
              employeeId: facultyEmpId,
              name: facultyName,
              email: facultyEmail,
              isActive: true
            }
          });
        }

        await prisma.user.update({
          where: { id: newFaculty.id },
          data: { associatedOfficerId: officer.id }
        });

        await prisma.clearanceOfficerDepartment.upsert({
          where: {
            officerId_departmentId: {
              officerId: officer.id,
              departmentId: department.id
            }
          },
          update: {},
          create: {
            officerId: officer.id,
            departmentId: department.id
          }
        });

        result.officerUser = newFaculty;
        result.officer = officer;
      } else {
        result.officerUser = existingFaculty;
        result.officer = existingFaculty.associatedOfficer;
      }
    } else {
      // Non-academic clearance desk / section (e.g. Central Library, Sports, or a new section like Medical Center)
      const officerEmail = `${cleanLowerCode}.officer@mce.ac.in`;
      const officerLoginId = `${cleanCode}001`;
      const officerEmpId = `EMP-${cleanCode}-01`;
      const officerName = `${department.name} Officer`;

      const existingOfficerUser = await prisma.user.findFirst({
        where: {
          OR: [
            { email: { equals: officerEmail, mode: 'insensitive' } },
            { loginId: officerLoginId }
          ]
        },
        include: { associatedOfficer: true }
      });

      if (!existingOfficerUser) {
        const newOfficerUser = await prisma.user.create({
          data: {
            name: officerName,
            email: officerEmail,
            loginId: officerLoginId,
            role: UserRole.DEPARTMENT_OFFICER,
            departmentId: department.id,
            passwordHash,
            isActive: true,
            mustChangePassword: false
          }
        });

        let officer = await prisma.clearanceOfficer.findFirst({
          where: {
            OR: [
              { userId: newOfficerUser.id },
              { employeeId: officerEmpId },
              { email: officerEmail }
            ]
          }
        });

        if (!officer) {
          officer = await prisma.clearanceOfficer.create({
            data: {
              userId: newOfficerUser.id,
              employeeId: officerEmpId,
              name: officerName,
              email: officerEmail,
              isActive: true
            }
          });
        }

        await prisma.user.update({
          where: { id: newOfficerUser.id },
          data: { associatedOfficerId: officer.id }
        });

        await prisma.clearanceOfficerDepartment.upsert({
          where: {
            officerId_departmentId: {
              officerId: officer.id,
              departmentId: department.id
            }
          },
          update: {},
          create: {
            officerId: officer.id,
            departmentId: department.id
          }
        });

        result.officerUser = newOfficerUser;
        result.officer = officer;
      } else {
        result.officerUser = existingOfficerUser;
        result.officer = existingOfficerUser.associatedOfficer;
      }
    }

    // 4. Synchronize workflow clearance requirements if department is active and requires clearance
    if (department.requiresClearance && department.isActive) {
      await NdcWorkflowService.syncDepartmentClearanceRequirement(department.id, true, req);
    }

    return result;
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

      // Automatically provision companion entities (Department Lab, HOD, Faculty/Officer, and Clearances)
      const provisionDetails = await DepartmentController.provisionDepartmentDefaults(department, req);

      await AuditService.log(
        req,
        'DEPARTMENT_CREATED',
        'ClearanceDepartment',
        `Created department [${department.code}] - ${department.name} with auto-provisioned staff accounts.`,
        department.id,
        null,
        provisionDetails
      );

      DepartmentController.invalidateCache();

      res.status(201).json({
        success: true,
        message: `Department [${department.code}] created successfully with related faculty section and default officer accounts.`,
        data: withId(department),
        provisioned: {
          labCode: provisionDetails.lab?.code,
          hodLoginId: provisionDetails.hodUser?.loginId,
          hodEmail: provisionDetails.hodUser?.email,
          officerLoginId: provisionDetails.officerUser?.loginId,
          officerEmail: provisionDetails.officerUser?.email,
          defaultPassword: 'Officer@123'
        }
      });
    } catch (err: any) {
      console.error('[createDepartment Error]:', err);
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

        // 4. Clean up and permanently delete operational staff accounts (HOD & Department Faculty/Officers) created for this department
        const deptStaffUsers = await tx.user.findMany({
          where: {
            departmentId: id,
            role: { in: [UserRole.HOD, UserRole.DEPARTMENT_OFFICER] }
          },
          select: { id: true, associatedOfficerId: true }
        });

        if (deptStaffUsers.length > 0) {
          const staffUserIds = deptStaffUsers.map((u) => u.id);
          const staffOfficerIds = deptStaffUsers
            .map((u) => u.associatedOfficerId)
            .filter(Boolean) as string[];

          // Disconnect foreign references
          await tx.auditLog.updateMany({
            where: { userId: { in: staffUserIds } },
            data: { userId: null }
          });
          await tx.ndcClearance.updateMany({
            where: { reviewedById: { in: staffUserIds } },
            data: { reviewedById: null }
          });
          await tx.ndcCertificate.updateMany({
            where: { issuedById: { in: staffUserIds } },
            data: { issuedById: null }
          });
          await tx.ndcCertificate.updateMany({
            where: { revokedById: { in: staffUserIds } },
            data: { revokedById: null }
          });
          await tx.ndcCertificate.updateMany({
            where: { submittedById: { in: staffUserIds } },
            data: { submittedById: null }
          });
          await tx.notification.deleteMany({
            where: { recipientUserId: { in: staffUserIds } }
          });

          if (staffOfficerIds.length > 0) {
            await tx.ndcClearance.updateMany({
              where: { officerId: { in: staffOfficerIds } },
              data: { officerId: null }
            });
            await tx.clearanceOfficerDepartment.deleteMany({
              where: { officerId: { in: staffOfficerIds } }
            });
          }

          // Unlink associatedOfficerId from User to prevent FK constraint deadlock
          await tx.user.updateMany({
            where: { id: { in: staffUserIds } },
            data: { associatedOfficerId: null }
          });

          // Delete operational staff user accounts
          await tx.user.deleteMany({
            where: { id: { in: staffUserIds } }
          });

          if (staffOfficerIds.length > 0) {
            await tx.clearanceOfficer.deleteMany({
              where: { id: { in: staffOfficerIds } }
            });
          }

          staffUserIds.forEach((uid) => invalidateUserCache(uid));
        }

        // For any remaining users (e.g. admins with department pointer), detach them
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
      }, { maxWait: 15000, timeout: 60000 });

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
