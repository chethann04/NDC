import { Response } from 'express';
import prisma from '../config/prisma';
import { AuthRequest, invalidateUserCache } from '../middleware/auth';
import { AuditService } from '../services/AuditService';
import { hashPassword } from '../utils/passwordUtils';
import { withId, withIds } from '../utils/formatters';
import { UserRole } from '../constants/roles';
import { NdcWorkflowService } from '../services/NdcWorkflowService';
import { DepartmentController } from './DepartmentController';

export class SectionLoginController {
  /**
   * Helper to format section account into a consistent view model
   */
  private static formatAccount(user: any) {
    const officerDept = user.associatedOfficer?.departmentMappings?.[0]?.department;
    const directDept = user.department;
    const effectiveDept = directDept || officerDept || null;

    let sectionName = 'Central Administration';
    let sectionCategory = 'ADMINISTRATION';
    let isDepartmentFaculty = false;

    if (user.role === UserRole.HOD) {
      sectionName = effectiveDept ? `${effectiveDept.name} (HOD)` : 'Academic Department (HOD)';
      sectionCategory = 'ACADEMIC_HOD';
      isDepartmentFaculty = true;
    } else if (user.role === UserRole.DEPARTMENT_OFFICER) {
      const code = (effectiveDept?.code || '').toUpperCase();
      const name = effectiveDept?.name || '';

      if (code === 'PHY' || user.loginId === 'PHY001' || user.email.includes('physics')) {
        sectionName = 'Engineering Physics Laboratory';
        sectionCategory = 'COLLEGE_LAB';
      } else if (code === 'CHEM' || user.loginId === 'CHEM001' || user.email.includes('chemistry')) {
        sectionName = 'Engineering Chemistry Laboratory';
        sectionCategory = 'COLLEGE_LAB';
      } else if (code === 'LIB' || user.loginId === 'LIB001' || user.email.includes('library')) {
        sectionName = 'Central Library';
        sectionCategory = 'CENTRAL_DESK';
      } else if (code === 'HST' || user.loginId === 'HST001' || user.email.includes('hostel')) {
        sectionName = 'Hostel Section';
        sectionCategory = 'CENTRAL_DESK';
      } else if (code === 'SPT' || user.loginId === 'SPT001' || user.email.includes('sports')) {
        sectionName = 'Physical Education / Sports';
        sectionCategory = 'CENTRAL_DESK';
      } else if (code === 'ACC' || user.loginId?.startsWith('ACC') || user.email.includes('cash') || user.email.includes('accounts')) {
        sectionName = 'Cash/Fee Section';
        sectionCategory = 'CENTRAL_DESK';
      } else if (code === 'ADM' || user.loginId === 'ADM001' || user.email.includes('office')) {
        sectionName = 'College Office (ADM)';
        sectionCategory = 'ADMINISTRATION';
      } else if (code === 'LAB' || user.loginId === 'LAB001' || user.email.includes('lab@')) {
        sectionName = 'Laboratory Section';
        sectionCategory = 'CENTRAL_DESK';
      } else if (effectiveDept?.isAcademicBranch || effectiveDept?.category === 'ACADEMIC_BRANCH' || user.loginId?.startsWith('FAC-') || user.loginId?.endsWith('001')) {
        sectionName = effectiveDept ? `${effectiveDept.name} Faculty / Lab` : 'Department Faculty';
        sectionCategory = 'ACADEMIC_FACULTY';
        isDepartmentFaculty = true;
      } else {
        sectionName = name || 'Clearance Desk';
        sectionCategory = 'CENTRAL_DESK';
      }
    } else if (user.role === UserRole.ADMIN) {
      sectionName = 'Administration Block';
      sectionCategory = 'ADMINISTRATION';
    } else if (user.role === UserRole.SUPER_ADMIN) {
      sectionName = 'Super System Administration';
      sectionCategory = 'ADMINISTRATION';
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      loginId: user.loginId || null,
      employeeId: user.associatedOfficer?.employeeId || null,
      role: user.role,
      sectionName,
      sectionCategory,
      isDepartmentFaculty,
      departmentId: effectiveDept?.id || user.departmentId || null,
      department: effectiveDept ? {
        id: effectiveDept.id,
        name: effectiveDept.name,
        code: effectiveDept.code,
        isAcademicBranch: effectiveDept.isAcademicBranch
      } : null,
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
      lastLogin: user.lastLogin,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  }

  /**
   * GET /api/v1/admin/section-logins
   * List all operational login accounts (non-students) with search and filters.
   */
  public static async getAllSectionLogins(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { search, category, departmentId, status } = req.query;

      const where: any = {
        role: { not: UserRole.STUDENT }
      };

      if (status === 'ACTIVE') {
        where.isActive = true;
      } else if (status === 'INACTIVE') {
        where.isActive = false;
      }

      if (departmentId && departmentId !== 'ALL') {
        where.OR = [
          { departmentId: String(departmentId) },
          {
            associatedOfficer: {
              departmentMappings: {
                some: { departmentId: String(departmentId) }
              }
            }
          }
        ];
      }

      const users = await prisma.user.findMany({
        where,
        include: {
          department: true,
          associatedOfficer: {
            include: {
              departmentMappings: {
                include: { department: true }
              }
            }
          }
        },
        orderBy: [
          { role: 'asc' },
          { name: 'asc' }
        ]
      });

      let accounts = users.map(SectionLoginController.formatAccount);

      // Search filter (in-memory across mapped fields for maximum flexibility)
      if (search && String(search).trim()) {
        const q = String(search).trim().toLowerCase();
        accounts = accounts.filter((a) =>
          a.name.toLowerCase().includes(q) ||
          a.email.toLowerCase().includes(q) ||
          (a.loginId && a.loginId.toLowerCase().includes(q)) ||
          (a.employeeId && a.employeeId.toLowerCase().includes(q)) ||
          a.sectionName.toLowerCase().includes(q) ||
          (a.department?.code && a.department.code.toLowerCase().includes(q)) ||
          (a.department?.name && a.department.name.toLowerCase().includes(q))
        );
      }

      // Category filter
      if (category && category !== 'ALL') {
        accounts = accounts.filter((a) => a.sectionCategory === category);
      }

      const stats = {
        total: accounts.length,
        active: accounts.filter((a) => a.isActive).length,
        inactive: accounts.filter((a) => !a.isActive).length,
        centralDesks: accounts.filter((a) => a.sectionCategory === 'CENTRAL_DESK').length,
        collegeLabs: accounts.filter((a) => a.sectionCategory === 'COLLEGE_LAB').length,
        academicAccounts: accounts.filter((a) => a.sectionCategory === 'ACADEMIC_FACULTY' || a.sectionCategory === 'ACADEMIC_HOD').length
      };

      res.status(200).json({
        success: true,
        data: withIds(accounts),
        stats
      });
    } catch (err: any) {
      console.error('[getAllSectionLogins Error]:', err);
      res.status(500).json({ success: false, message: err.message || 'Failed to fetch section login accounts.' });
    }
  }

  /**
   * PUT /api/v1/admin/section-logins/:id/email
   * Update the login email of a section account.
   */
  public static async updateLoginEmail(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const rawEmail = String(req.body.email || '').trim().toLowerCase();

      if (!rawEmail) {
        res.status(400).json({ success: false, message: 'New email address is required.' });
        return;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(rawEmail)) {
        res.status(400).json({ success: false, message: 'Please provide a valid email address format.' });
        return;
      }

      const targetUser = await prisma.user.findUnique({
        where: { id },
        include: { associatedOfficer: true }
      });

      if (!targetUser) {
        res.status(404).json({ success: false, message: 'Account not found.' });
        return;
      }

      if (targetUser.email.toLowerCase() === rawEmail) {
        res.status(400).json({ success: false, message: 'The new email is identical to the current email.' });
        return;
      }

      // Check uniqueness across User table
      const duplicate = await prisma.user.findFirst({
        where: {
          email: { equals: rawEmail, mode: 'insensitive' },
          id: { not: id }
        }
      });

      if (duplicate) {
        res.status(409).json({ success: false, message: 'This email is already in use by another user account.' });
        return;
      }

      const oldEmail = targetUser.email;

      // Atomic update
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id },
          data: { email: rawEmail }
        });

        if (targetUser.associatedOfficerId) {
          await tx.clearanceOfficer.update({
            where: { id: targetUser.associatedOfficerId },
            data: { email: rawEmail }
          });
        }
      });

      invalidateUserCache(id);

      await AuditService.log(
        req,
        'UPDATE_SECTION_LOGIN_EMAIL',
        'USER',
        `Super Admin updated login email for ${targetUser.name} (${targetUser.role}) from ${oldEmail} to ${rawEmail}`,
        id,
        { email: oldEmail },
        { email: rawEmail }
      );

      res.status(200).json({
        success: true,
        message: `Login email for ${targetUser.name} updated to ${rawEmail}.`,
        data: { id, email: rawEmail }
      });
    } catch (err: any) {
      console.error('[updateLoginEmail Error]:', err);
      res.status(500).json({ success: false, message: err.message || 'Failed to update login email.' });
    }
  }

  /**
   * PATCH /api/v1/admin/section-logins/:id/status
   * Activate or deactivate a section operational account.
   */
  public static async toggleAccountStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { isActive } = req.body;

      if (typeof isActive !== 'boolean') {
        res.status(400).json({ success: false, message: 'isActive boolean value is required.' });
        return;
      }

      // Prevent Super Admin from deactivating own account
      if (req.user.id === id || req.user._id === id) {
        res.status(400).json({ success: false, message: 'You cannot deactivate your own Super Admin account.' });
        return;
      }

      const targetUser = await prisma.user.findUnique({
        where: { id },
        include: { associatedOfficer: true }
      });

      if (!targetUser) {
        res.status(404).json({ success: false, message: 'Account not found.' });
        return;
      }

      const oldStatus = targetUser.isActive;

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id },
          data: { isActive }
        });

        if (targetUser.associatedOfficerId) {
          await tx.clearanceOfficer.update({
            where: { id: targetUser.associatedOfficerId },
            data: { isActive }
          });
        }
      });

      invalidateUserCache(id);

      await AuditService.log(
        req,
        isActive ? 'ACTIVATE_SECTION_ACCOUNT' : 'DEACTIVATE_SECTION_ACCOUNT',
        'USER',
        `Super Admin ${isActive ? 'activated' : 'deactivated'} login account for ${targetUser.name} (${targetUser.email})`,
        id,
        { isActive: oldStatus },
        { isActive }
      );

      res.status(200).json({
        success: true,
        message: `Account for ${targetUser.name} is now ${isActive ? 'Active' : 'Deactivated'}.`,
        data: { id, isActive }
      });
    } catch (err: any) {
      console.error('[toggleAccountStatus Error]:', err);
      res.status(500).json({ success: false, message: err.message || 'Failed to update account status.' });
    }
  }

  /**
   * PUT /api/v1/admin/section-logins/:id/department
   * Assign or update department scope for Department Faculty or HOD accounts.
   */
  public static async updateDepartmentAssignment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { departmentId } = req.body;

      if (!departmentId) {
        res.status(400).json({ success: false, message: 'Department ID is required.' });
        return;
      }

      const targetDept = await prisma.clearanceDepartment.findUnique({
        where: { id: String(departmentId) }
      });

      if (!targetDept) {
        res.status(404).json({ success: false, message: 'Target department does not exist.' });
        return;
      }

      const targetUser = await prisma.user.findUnique({
        where: { id },
        include: {
          department: true,
          associatedOfficer: {
            include: { departmentMappings: true }
          }
        }
      });

      if (!targetUser) {
        res.status(404).json({ success: false, message: 'Account not found.' });
        return;
      }

      const oldDeptName = targetUser.department?.name || 'Unassigned';

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id },
          data: { departmentId: targetDept.id }
        });

        // If user is linked to an officer profile, update officer mapping
        if (targetUser.associatedOfficerId) {
          await tx.clearanceOfficerDepartment.deleteMany({
            where: { officerId: targetUser.associatedOfficerId }
          });

          await tx.clearanceOfficerDepartment.create({
            data: {
              officerId: targetUser.associatedOfficerId,
              departmentId: targetDept.id
            }
          });
        }
      });

      invalidateUserCache(id);

      await AuditService.log(
        req,
        'UPDATE_ACCOUNT_DEPARTMENT_ASSIGNMENT',
        'USER',
        `Super Admin changed department scope for ${targetUser.name} from "${oldDeptName}" to "${targetDept.name}" (${targetDept.code})`,
        id,
        { departmentId: targetUser.departmentId, departmentName: oldDeptName },
        { departmentId: targetDept.id, departmentName: targetDept.name, code: targetDept.code }
      );

      res.status(200).json({
        success: true,
        message: `Department scope for ${targetUser.name} updated to ${targetDept.name} (${targetDept.code}).`,
        data: {
          id,
          departmentId: targetDept.id,
          department: withId(targetDept)
        }
      });
    } catch (err: any) {
      console.error('[updateDepartmentAssignment Error]:', err);
      res.status(500).json({ success: false, message: err.message || 'Failed to update department assignment.' });
    }
  }

  /**
   * POST /api/v1/admin/section-logins/:id/reset-password
   * Directly reset password for a section account.
   */
  public static async resetAccountPassword(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { password } = req.body;

      if (!password || String(password).trim().length < 6) {
        res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
        return;
      }

      const targetUser = await prisma.user.findUnique({
        where: { id }
      });

      if (!targetUser) {
        res.status(404).json({ success: false, message: 'Account not found.' });
        return;
      }

      const passwordHash = await hashPassword(String(password).trim());

      await prisma.user.update({
        where: { id },
        data: {
          passwordHash,
          mustChangePassword: false
        }
      });

      invalidateUserCache(id);

      await AuditService.log(
        req,
        'RESET_SECTION_ACCOUNT_PASSWORD',
        'USER',
        `Super Admin reset password for ${targetUser.name} (${targetUser.email})`,
        id,
        undefined,
        undefined
      );

      res.status(200).json({
        success: true,
        message: `Password reset successfully for ${targetUser.name}.`
      });
    } catch (err: any) {
      console.error('[resetAccountPassword Error]:', err);
      res.status(500).json({ success: false, message: err.message || 'Failed to reset password.' });
    }
  }

  /**
   * POST /api/v1/admin/section-logins/department
   * Super Admin creates a new Department / Section (Academic Branch, Central Desk, or College Lab)
   */
  public static async createDepartment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { name, code, category, description, requiresClearance, hodName, hodDesignation } = req.body;

      if (!name || !String(name).trim()) {
        res.status(400).json({ success: false, message: 'Department name is required.' });
        return;
      }
      if (!code || !String(code).trim()) {
        res.status(400).json({ success: false, message: 'Department code is required.' });
        return;
      }

      const formattedName = String(name).trim();
      const formattedCode = String(code).toUpperCase().trim();
      const selectedCategory = category || 'ACADEMIC_BRANCH';
      const isAcademic = selectedCategory === 'ACADEMIC_BRANCH';

      // Check uniqueness
      const existing = await prisma.clearanceDepartment.findFirst({
        where: {
          OR: [
            { name: { equals: formattedName, mode: 'insensitive' } },
            { code: { equals: formattedCode, mode: 'insensitive' } }
          ]
        }
      });

      if (existing) {
        res.status(400).json({
          success: false,
          message: `Department with name "${formattedName}" or code "${formattedCode}" already exists.`
        });
        return;
      }

      // Find max displayOrder
      const maxOrder = await prisma.clearanceDepartment.aggregate({
        _max: { displayOrder: true }
      });
      const nextOrder = (maxOrder._max.displayOrder || 0) + 1;

      const department = await prisma.clearanceDepartment.create({
        data: {
          name: formattedName,
          code: formattedCode,
          category: selectedCategory,
          description: description ? String(description).trim() : '',
          requiresClearance: requiresClearance !== undefined ? Boolean(requiresClearance) : true,
          isAcademicBranch: isAcademic,
          displayOrder: nextOrder,
          isActive: true,
          hodName: hodName ? String(hodName).trim() : '',
          hodDesignation: hodDesignation ? String(hodDesignation).trim() : 'Head of the Department'
        }
      });

      // Automatically provision companion entities (Department Lab, HOD, Faculty/Officer, and Clearances)
      const provisionDetails = await DepartmentController.provisionDepartmentDefaults(department, req);

      DepartmentController.invalidateCache();

      await AuditService.log(
        req,
        'CREATE_DEPARTMENT_SECTION',
        'ClearanceDepartment',
        `Super Admin created new ${selectedCategory} section: [${formattedCode}] - ${formattedName} with auto-provisioned staff accounts.`,
        department.id,
        undefined,
        { department, provisionDetails }
      );

      res.status(201).json({
        success: true,
        message: `Department "${department.name}" (${department.code}) created successfully with related faculty section and default officer accounts.`,
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
      res.status(500).json({ success: false, message: err.message || 'Failed to create department.' });
    }
  }

  /**
   * POST /api/v1/admin/section-logins/hod
   * Super Admin creates a new Head of Department (HOD) login account
   */
  public static async createHodAccount(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { name, email, loginId, departmentId, password } = req.body;

      if (!name || !String(name).trim()) {
        res.status(400).json({ success: false, message: 'HOD name is required.' });
        return;
      }
      if (!email || !String(email).trim()) {
        res.status(400).json({ success: false, message: 'Email address is required.' });
        return;
      }
      if (!departmentId) {
        res.status(400).json({ success: false, message: 'Department selection is required.' });
        return;
      }

      const formattedName = String(name).trim();
      const formattedEmail = String(email).toLowerCase().trim();

      // Check department exists
      const targetDept = await prisma.clearanceDepartment.findUnique({
        where: { id: departmentId }
      });
      if (!targetDept) {
        res.status(404).json({ success: false, message: 'Selected department not found.' });
        return;
      }

      // Check email uniqueness
      const existingUser = await prisma.user.findFirst({
        where: { email: { equals: formattedEmail, mode: 'insensitive' } }
      });
      if (existingUser) {
        res.status(400).json({ success: false, message: `Account with email ${formattedEmail} already exists.` });
        return;
      }

      // Generate or validate loginId
      let formattedLoginId = loginId ? String(loginId).toUpperCase().trim() : `HOD-${targetDept.code}`;
      const existingLoginId = await prisma.user.findFirst({
        where: { loginId: formattedLoginId }
      });
      if (existingLoginId) {
        if (loginId) {
          res.status(400).json({ success: false, message: `Login ID ${formattedLoginId} is already in use.` });
          return;
        }
        formattedLoginId = `HOD-${targetDept.code}-${Date.now().toString().slice(-4)}`;
      }

      const rawPassword = (password && String(password).trim().length >= 6) ? String(password).trim() : 'Admin@123';
      const passwordHash = await hashPassword(rawPassword);

      const newUser = await prisma.user.create({
        data: {
          name: formattedName,
          email: formattedEmail,
          loginId: formattedLoginId,
          role: UserRole.HOD,
          departmentId: targetDept.id,
          passwordHash,
          isActive: true,
          mustChangePassword: false
        },
        include: {
          department: true,
          associatedOfficer: {
            include: {
              departmentMappings: {
                include: { department: true }
              }
            }
          }
        }
      });

      // Update Department HOD name
      await prisma.clearanceDepartment.update({
        where: { id: targetDept.id },
        data: { hodName: formattedName }
      });

      invalidateUserCache(newUser.id);
      DepartmentController.invalidateCache();

      await AuditService.log(
        req,
        'CREATE_HOD_ACCOUNT',
        'USER',
        `Super Admin created HOD account for ${formattedName} (${formattedEmail}) in ${targetDept.name}`,
        newUser.id,
        undefined,
        { email: formattedEmail, loginId: formattedLoginId, department: targetDept.name }
      );

      res.status(201).json({
        success: true,
        message: `HOD account for ${formattedName} created successfully with login ID: ${formattedLoginId}.`,
        data: SectionLoginController.formatAccount(newUser)
      });
    } catch (err: any) {
      console.error('[createHodAccount Error]:', err);
      res.status(500).json({ success: false, message: err.message || 'Failed to create HOD account.' });
    }
  }

  /**
   * POST /api/v1/admin/section-logins/faculty
   * Super Admin creates a new Department Faculty / Section Officer account
   */
  public static async createFacultyAccount(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { name, email, loginId, employeeId, departmentId, password } = req.body;

      if (!name || !String(name).trim()) {
        res.status(400).json({ success: false, message: 'Faculty / Officer name is required.' });
        return;
      }
      if (!email || !String(email).trim()) {
        res.status(400).json({ success: false, message: 'Email address is required.' });
        return;
      }
      if (!employeeId || !String(employeeId).trim()) {
        res.status(400).json({ success: false, message: 'Employee ID is required.' });
        return;
      }
      if (!departmentId) {
        res.status(400).json({ success: false, message: 'Department / Section selection is required.' });
        return;
      }

      const formattedName = String(name).trim();
      const formattedEmail = String(email).toLowerCase().trim();
      const formattedEmpId = String(employeeId).toUpperCase().trim();

      // Check department exists
      const targetDept = await prisma.clearanceDepartment.findUnique({
        where: { id: departmentId }
      });
      if (!targetDept) {
        res.status(404).json({ success: false, message: 'Selected department not found.' });
        return;
      }

      // Check email uniqueness in User and ClearanceOfficer
      const existingUser = await prisma.user.findFirst({
        where: { email: { equals: formattedEmail, mode: 'insensitive' } }
      });
      if (existingUser) {
        res.status(400).json({ success: false, message: `Account with email ${formattedEmail} already exists.` });
        return;
      }

      // Check employeeId uniqueness
      const existingOfficer = await prisma.clearanceOfficer.findUnique({
        where: { employeeId: formattedEmpId }
      });
      if (existingOfficer) {
        res.status(400).json({ success: false, message: `Officer with Employee ID [${formattedEmpId}] already exists.` });
        return;
      }

      // Generate or validate loginId
      let formattedLoginId = loginId ? String(loginId).toUpperCase().trim() : `FAC-${targetDept.code}-${formattedEmpId.replace(/[^A-Z0-9]/g, '').slice(-4)}`;
      const existingLoginId = await prisma.user.findFirst({
        where: { loginId: formattedLoginId }
      });
      if (existingLoginId) {
        if (loginId) {
          res.status(400).json({ success: false, message: `Login ID ${formattedLoginId} is already in use.` });
          return;
        }
        formattedLoginId = `FAC-${targetDept.code}-${Date.now().toString().slice(-4)}`;
      }

      const rawPassword = (password && String(password).trim().length >= 6) ? String(password).trim() : 'Officer@123';
      const passwordHash = await hashPassword(rawPassword);

      // Create User
      const newUser = await prisma.user.create({
        data: {
          name: formattedName,
          email: formattedEmail,
          loginId: formattedLoginId,
          role: UserRole.DEPARTMENT_OFFICER,
          departmentId: targetDept.id,
          passwordHash,
          isActive: true,
          mustChangePassword: false
        }
      });

      // Create linked ClearanceOfficer
      const officer = await prisma.clearanceOfficer.create({
        data: {
          userId: newUser.id,
          employeeId: formattedEmpId,
          name: formattedName,
          email: formattedEmail,
          isActive: true
        }
      });

      // Link ClearanceOfficer to User
      await prisma.user.update({
        where: { id: newUser.id },
        data: { associatedOfficerId: officer.id }
      });

      // Create mapping in ClearanceOfficerDepartment
      await prisma.clearanceOfficerDepartment.create({
        data: {
          officerId: officer.id,
          departmentId: targetDept.id
        }
      });

      invalidateUserCache(newUser.id);

      await AuditService.log(
        req,
        'CREATE_FACULTY_ACCOUNT',
        'USER',
        `Super Admin created Faculty/Officer account for ${formattedName} (${formattedEmail}, Emp ID: ${formattedEmpId}) in ${targetDept.name}`,
        newUser.id,
        undefined,
        { email: formattedEmail, employeeId: formattedEmpId, loginId: formattedLoginId, department: targetDept.name }
      );

      // Fetch complete user for formatAccount
      const fullUser = await prisma.user.findUnique({
        where: { id: newUser.id },
        include: {
          department: true,
          associatedOfficer: {
            include: {
              departmentMappings: {
                include: { department: true }
              }
            }
          }
        }
      });

      res.status(201).json({
        success: true,
        message: `Faculty account for ${formattedName} created successfully with Employee ID: ${formattedEmpId}.`,
        data: SectionLoginController.formatAccount(fullUser)
      });
    } catch (err: any) {
      console.error('[createFacultyAccount Error]:', err);
      res.status(500).json({ success: false, message: err.message || 'Failed to create faculty account.' });
    }
  }
}

