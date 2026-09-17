import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { AuthRequest } from '../middleware/auth';
import { generateTokens } from '../middleware/authMiddleware';
import { AuditService } from '../services/AuditService';
import { withId } from '../utils/formatters';
import { hashPassword, comparePassword } from '../utils/passwordUtils';

export class AuthController {
  public static async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ success: false, message: 'Email and password are required.' });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase().trim() }
      });

      if (!user) {
        res.status(401).json({ success: false, message: 'Invalid credentials.' });
        return;
      }

      if (!user.isActive) {
        res.status(403).json({ success: false, message: 'Your account has been deactivated. Please contact an administrator.' });
        return;
      }

      const trimmedPassword = String(password).trim();
      let isMatch = await comparePassword(trimmedPassword, user.passwordHash);
      if (!isMatch && user.role === 'STUDENT') {
        isMatch = (await comparePassword(trimmedPassword.toUpperCase(), user.passwordHash)) ||
                  (await comparePassword(trimmedPassword.toLowerCase(), user.passwordHash));
      }
      if (!isMatch) {
        res.status(401).json({ success: false, message: 'Invalid credentials.' });
        return;
      }

      const { accessToken, refreshToken } = generateTokens(user.id);
      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      await prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() }
      });

      // Fetch linked profile details if applicable
      let studentProfile = null;
      let officerProfile = null;

      if (user.associatedStudentId) {
        studentProfile = await prisma.student.findUnique({
          where: { id: user.associatedStudentId },
          include: { department: true }
        });
      }

      if (user.associatedOfficerId) {
        const officer = await prisma.clearanceOfficer.findUnique({
          where: { id: user.associatedOfficerId },
          include: {
            departmentMappings: {
              include: { department: true }
            }
          }
        });
        if (officer) {
          officerProfile = {
            ...officer,
            departmentIds: officer.departmentMappings.map((m) => withId(m.department))
          };
        }
      }

      (req as any).user = user;
      await AuditService.log(req, 'USER_LOGIN', 'User', `User [${user.email}] logged in successfully.`, user.id);

      res.status(200).json({
        success: true,
        message: 'Login successful.',
        token: accessToken,
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          _id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          mustChangePassword: !!user.mustChangePassword,
          associatedStudentId: user.associatedStudentId,
          associatedOfficerId: user.associatedOfficerId,
          departmentId: user.departmentId,
          studentProfile: withId(studentProfile),
          officerProfile: withId(officerProfile)
        }
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Server login error.' });
    }
  }

  /**
   * Dedicated Student Login using University Seat Number (USN) and Date of Birth (DOB)
   */
  public static async studentLogin(req: Request, res: Response): Promise<void> {
    try {
      const { usn, dob } = req.body;
      if (!usn || !dob) {
        res.status(400).json({
          success: false,
          message: 'University Seat Number (USN) and Date of Birth are required.'
        });
        return;
      }

      const normalizedUsn = String(usn).trim().toUpperCase().replace(/\s+/g, '');
      if (!normalizedUsn) {
        res.status(400).json({ success: false, message: 'Please enter a valid USN.' });
        return;
      }

      // Parse user's entered Date of Birth
      const str = String(dob).trim();
      let parsed: { year: number; month: number; day: number } | null = null;

      const ymd = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
      if (ymd) {
        parsed = { year: parseInt(ymd[1], 10), month: parseInt(ymd[2], 10), day: parseInt(ymd[3], 10) };
      } else {
        const dmy = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
        if (dmy) {
          parsed = { day: parseInt(dmy[1], 10), month: parseInt(dmy[2], 10), year: parseInt(dmy[3], 10) };
        } else {
          const d = new Date(str);
          if (!isNaN(d.getTime())) {
            parsed = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
          }
        }
      }

      if (!parsed) {
        res.status(400).json({
          success: false,
          message: 'Invalid Date of Birth format. Please select from calendar or enter as DD/MM/YYYY.'
        });
        return;
      }

      // Find student by USN
      const student = await prisma.student.findUnique({
        where: { usn: normalizedUsn },
        include: {
          department: true,
          user: true
        }
      });

      if (!student) {
        res.status(401).json({
          success: false,
          message: `No student record found with USN [${normalizedUsn}]. Please check your USN.`
        });
        return;
      }

      if (!student.isActive) {
        res.status(403).json({
          success: false,
          message: 'Student account is inactive. Please contact the college administrative desk.'
        });
        return;
      }

      // Validate Date of Birth
      if (student.dateOfBirth) {
        const stored = new Date(student.dateOfBirth);
        const matchUtc =
          stored.getUTCFullYear() === parsed.year &&
          stored.getUTCMonth() + 1 === parsed.month &&
          stored.getUTCDate() === parsed.day;

        const matchLocal =
          stored.getFullYear() === parsed.year &&
          stored.getMonth() + 1 === parsed.month &&
          stored.getDate() === parsed.day;

        if (!matchUtc && !matchLocal) {
          res.status(401).json({
            success: false,
            message: 'Date of Birth does not match institutional records for this USN.'
          });
          return;
        }
      } else {
        // If student record didn't have DOB stored yet, save the verified DOB
        const birthDate = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
        await prisma.student.update({
          where: { id: student.id },
          data: { dateOfBirth: birthDate }
        });
      }

      // Ensure linked User account exists for auth sessions
      let user = student.user;
      if (!user) {
        user = await prisma.user.findFirst({
          where: {
            OR: [
              { associatedStudentId: student.id },
              { email: student.email }
            ]
          }
        });
      }

      if (!user) {
        const usnHash = await hashPassword(student.usn);
        user = await prisma.user.create({
          data: {
            email: student.email,
            passwordHash: usnHash,
            role: 'STUDENT',
            name: student.fullName,
            associatedStudentId: student.id,
            departmentId: student.departmentId
          }
        });
      } else if (!user.associatedStudentId) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { associatedStudentId: student.id, departmentId: student.departmentId }
        });
      }

      const { accessToken, refreshToken } = generateTokens(user.id);
      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      await prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() }
      });

      // Automatically ensure student's NDC clearance workflow is active
      try {
        const { NdcWorkflowService } = await import('../services/NdcWorkflowService');
        await NdcWorkflowService.ensureStudentNdcRequest(student.id, req);
      } catch (workflowErr) {
        console.warn('Warning: Auto-init NDC request during student login:', workflowErr);
      }

      (req as any).user = user;
      await AuditService.log(
        req,
        'STUDENT_LOGIN',
        'Student',
        `Student [${student.usn}] (${student.fullName}) signed in via USN & Date of Birth.`,
        student.id
      );

      res.status(200).json({
        success: true,
        message: 'Student authentication successful.',
        token: accessToken,
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          _id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          mustChangePassword: !!user.mustChangePassword,
          associatedStudentId: user.associatedStudentId,
          associatedOfficerId: null,
          departmentId: user.departmentId,
          studentProfile: withId({
            ...student,
            departmentId: withId(student.department)
          }),
          officerProfile: null
        }
      });
    } catch (err: any) {
      console.error('Error during student login:', err);
      res.status(500).json({ success: false, message: err.message || 'Server error during student login.' });
    }
  }

  public static async getMe(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id || req.user._id }
      });

      if (!user) {
        res.status(404).json({ success: false, message: 'User not found.' });
        return;
      }

      let studentProfile = null;
      let officerProfile = null;

      if (user.associatedStudentId) {
        studentProfile = await prisma.student.findUnique({
          where: { id: user.associatedStudentId },
          include: { department: true }
        });
      }

      if (user.associatedOfficerId) {
        const officer = await prisma.clearanceOfficer.findUnique({
          where: { id: user.associatedOfficerId },
          include: {
            departmentMappings: {
              include: { department: true }
            }
          }
        });
        if (officer) {
          officerProfile = {
            ...officer,
            departmentIds: officer.departmentMappings.map((m) => withId(m.department))
          };
        }
      }

      const { passwordHash, ...userWithoutPassword } = user;

      res.status(200).json({
        success: true,
        user: {
          ...withId(userWithoutPassword),
          mustChangePassword: !!user.mustChangePassword,
          studentProfile: withId(studentProfile),
          officerProfile: withId(officerProfile)
        }
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  public static async resetPassword(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { oldPassword, newPassword } = req.body;
      const userId = req.user.id || req.user._id;
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        res.status(404).json({ success: false, message: 'User not found.' });
        return;
      }

      const isMatch = await comparePassword(oldPassword, user.passwordHash);
      if (!isMatch) {
        res.status(400).json({ success: false, message: 'Incorrect old password.' });
        return;
      }

      if (!newPassword || newPassword.length < 6) {
        res.status(400).json({ success: false, message: 'New password must be at least 6 characters long.' });
        return;
      }

      const newPasswordHash = await hashPassword(newPassword);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newPasswordHash,
          mustChangePassword: false
        }
      });

      await AuditService.log(req, 'PASSWORD_RESET', 'User', `User [${user.email}] updated password.`, user.id);

      res.status(200).json({ success: true, message: 'Password updated successfully.' });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}
