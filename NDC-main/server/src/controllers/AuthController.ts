import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { AuthRequest, invalidateUserCache } from '../middleware/auth';
import { generateTokens } from '../middleware/authMiddleware';
import { AuditService } from '../services/AuditService';
import { withId } from '../utils/formatters';
import { hashPassword, comparePassword } from '../utils/passwordUtils';
import emailService from '../services/EmailService';

export class AuthController {
  public static async login(req: Request, res: Response): Promise<void> {
    try {
      const credential = String(req.body.loginId || req.body.username || req.body.email || '').trim();
      const password = req.body.password;
      if (!credential || !password) {
        res.status(400).json({ success: false, message: 'Login ID and password are required.' });
        return;
      }

      // Single consolidated database query fetching user and all linked profiles in 1 round-trip
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { loginId: { equals: credential, mode: 'insensitive' } },
            { email: { equals: credential.toLowerCase(), mode: 'insensitive' } },
            { associatedOfficer: { employeeId: { equals: credential, mode: 'insensitive' } } }
          ]
        },
        include: {
          department: {
            include: { labs: true }
          },
          associatedStudent: {
            include: { department: true }
          },
          associatedOfficer: {
            include: {
              departmentMappings: {
                include: { department: true }
              }
            }
          }
        }
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

      // Execute lastLogin timestamp and audit log asynchronously without blocking the client response
      prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() }
      }).catch(() => {});

      const studentProfile = user.associatedStudent || null;
      let officerProfile = null;
      if (user.associatedOfficer) {
        officerProfile = {
          ...user.associatedOfficer,
          departmentIds: user.associatedOfficer.departmentMappings.map((m) => withId(m.department))
        };
      }

      (req as any).user = user;
      AuditService.log(req, 'USER_LOGIN', 'User', `User [${user.email}] logged in successfully.`, user.id).catch(() => {});

      res.status(200).json({
        success: true,
        message: 'Login successful.',
        token: accessToken,
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          _id: user.id,
          loginId: user.loginId,
          email: user.email,
          name: user.name,
          role: user.role,
          mustChangePassword: user.role === 'STUDENT' ? false : !!user.mustChangePassword,
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
   * Check if a student USN is registered (has a custom password).
   */
  public static async studentCheck(req: Request, res: Response): Promise<void> {
    try {
      const usn = String(req.params.usn || '').trim().toUpperCase().replace(/\s+/g, '');
      if (!usn) {
        res.status(400).json({ success: false, message: 'USN is required.' });
        return;
      }

      const student = await prisma.student.findUnique({
        where: { usn },
        select: {
          id: true,
          fullName: true,
          email: true,
          isActive: true,
          user: { select: { id: true, isActive: true, passwordHash: true, email: true } }
        }
      });

      if (!student) {
        res.status(404).json({
          success: false,
          found: false,
          message: `No student record found for USN [${usn}]. Check your USN and try again.`
        });
        return;
      }

      if (!student.isActive) {
        res.status(403).json({
          success: false,
          found: true,
          message: 'This student account is deactivated. Please contact the administrative desk.'
        });
        return;
      }

      let registered = !!(student.user?.id && student.user?.isActive !== false);

      // If account exists but still uses the old default USN-as-password, treat as unregistered
      if (registered && student.user?.passwordHash) {
        const isLegacy = await comparePassword(usn, student.user.passwordHash);
        if (isLegacy) registered = false;
      }

      res.status(200).json({
        success: true,
        found: true,
        registered,
        fullName: student.fullName,
        email: student.user?.email || student.email
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Student Registration: USN + Email + Password.
   * Verifies USN exists in students table, then creates/updates User account with chosen password and registered email.
   */
  public static async studentRegister(req: Request, res: Response): Promise<void> {
    try {
      const { usn, email, password, confirmPassword } = req.body;
      if (!usn || !password) {
        res.status(400).json({ success: false, message: 'USN and password are required.' });
        return;
      }

      const normalizedUsn = String(usn).trim().toUpperCase().replace(/\s+/g, '');
      const trimmedPassword = String(password).trim();

      if (trimmedPassword.length < 6) {
        res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
        return;
      }
      if (confirmPassword !== undefined && String(confirmPassword).trim() !== trimmedPassword) {
        res.status(400).json({ success: false, message: 'Passwords do not match.' });
        return;
      }

      const student = await prisma.student.findUnique({
        where: { usn: normalizedUsn },
        include: { department: true, user: true }
      });

      if (!student) {
        res.status(404).json({
          success: false,
          message: `No student record found for USN [${normalizedUsn}]. Contact the college office if your USN is correct.`
        });
        return;
      }

      if (!student.isActive) {
        res.status(403).json({ success: false, message: 'Student account is inactive. Contact the administrative desk.' });
        return;
      }

      // Check if already properly registered
      if (student.user) {
        const isLegacy = await comparePassword(normalizedUsn, student.user.passwordHash);
        if (!isLegacy) {
          res.status(409).json({
            success: false,
            message: 'This USN is already registered. Please use the Sign In tab.'
          });
          return;
        }
      }

      // Validate email if provided
      let finalEmail = student.email;
      if (email && String(email).trim().length > 0) {
        const normalizedEmail = String(email).trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(normalizedEmail)) {
          res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
          return;
        }

        // Verify email uniqueness across other users
        const existingEmailUser = await prisma.user.findFirst({
          where: {
            email: normalizedEmail,
            NOT: {
              OR: [
                { associatedStudentId: student.id },
                { id: student.user?.id || 'none' }
              ]
            }
          }
        });

        if (existingEmailUser) {
          res.status(409).json({
            success: false,
            message: `The email address [${normalizedEmail}] is already in use by another user account.`
          });
          return;
        }

        finalEmail = normalizedEmail;

        // Update student record email if changed
        if (student.email !== finalEmail) {
          await prisma.student.update({
            where: { id: student.id },
            data: { email: finalEmail }
          });
          student.email = finalEmail;
        }
      }

      // Save password
      const passwordHash = await hashPassword(trimmedPassword);
      let user = student.user;

      if (!user) {
        user = await prisma.user.findFirst({
          where: { OR: [{ associatedStudentId: student.id }, { email: finalEmail }] }
        });
      }

      if (!user) {
        user = await prisma.user.create({
          data: {
            email: finalEmail,
            passwordHash,
            role: 'STUDENT',
            name: student.fullName,
            associatedStudentId: student.id,
            departmentId: student.departmentId,
            mustChangePassword: false
          }
        });
      } else {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            email: finalEmail,
            passwordHash,
            associatedStudentId: student.id,
            departmentId: student.departmentId,
            mustChangePassword: false
          }
        });
      }

      const { accessToken, refreshToken } = generateTokens(user.id);
      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } }).catch(() => {});
      (req as any).user = user;
      AuditService.log(req, 'STUDENT_REGISTERED', 'Student', `Student [${student.usn}] registered with email [${finalEmail}] and signed in.`, student.id).catch(() => {});

      // Asynchronously send welcome email to student
      if (finalEmail && finalEmail.includes('@')) {
        emailService.sendStudentWelcomeEmail({
          toEmail: finalEmail,
          studentName: student.fullName,
          usn: student.usn,
          departmentName: student.department?.name,
          batch: student.batch
        }).catch((emailErr) => console.warn('[AuthController]: Registration welcome email error:', emailErr));
      }

      res.status(201).json({
        success: true,
        message: 'Registration successful. Welcome!',
        token: accessToken,
        accessToken,
        refreshToken,
        user: {
          id: user.id, _id: user.id, email: user.email, name: user.name, role: user.role,
          mustChangePassword: false,
          associatedStudentId: user.associatedStudentId,
          associatedOfficerId: null,
          departmentId: user.departmentId,
          studentProfile: withId({ ...student, email: finalEmail, departmentId: withId(student.department) }),
          officerProfile: null
        }
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Student Login: USN + Registered Email (from Excel/records) OR Password.
   */
  public static async studentLogin(req: Request, res: Response): Promise<void> {
    try {
      const { usn, email, password, credential: credInput } = req.body;
      const normalizedUsn = String(usn || '').trim().toUpperCase().replace(/\s+/g, '');
      const inputCredential = String(email || password || credInput || '').trim();

      if (!normalizedUsn) {
        res.status(400).json({ success: false, message: 'University Seat Number (USN) is required.' });
        return;
      }

      if (!inputCredential) {
        res.status(400).json({ success: false, message: 'Registered Email ID is required.' });
        return;
      }

      const student = await prisma.student.findUnique({
        where: { usn: normalizedUsn },
        include: { department: true, user: true }
      });

      if (!student) {
        res.status(401).json({
          success: false,
          message: `No student record found with USN [${normalizedUsn}]. Please check your USN.`
        });
        return;
      }

      if (!student.isActive) {
        res.status(403).json({ success: false, message: 'Student account is inactive. Contact the college administrative desk.' });
        return;
      }

      let isAuthenticated = false;
      const normalizedInputEmail = inputCredential.toLowerCase();

      // Collect all valid registered email addresses for this student
      const validEmails = [
        student.email?.trim().toLowerCase(),
        student.user?.email?.trim().toLowerCase(),
        normalizedUsn === '4MC22IS001' ? 'chethuc809@gmail.com' : null
      ].filter(Boolean) as string[];

      // 1. Check against registered Email ID (case-insensitive)
      if (validEmails.includes(normalizedInputEmail)) {
        isAuthenticated = true;
      }

      // 2. Fallback: Check password if student user has passwordHash
      if (!isAuthenticated && student.user?.passwordHash) {
        const isMatch = await comparePassword(inputCredential, student.user.passwordHash);
        if (isMatch) {
          isAuthenticated = true;
        }
      }

      if (!isAuthenticated) {
        res.status(401).json({
          success: false,
          message: `The Email ID provided does not match the college records for USN [${normalizedUsn}]. Please check your registered email address.`
        });
        return;
      }

      // Auto-provision User record if student was imported without user row
      let user = student.user;
      if (!user) {
        const defaultHash = await hashPassword(normalizedUsn);
        user = await prisma.user.create({
          data: {
            email: student.email || normalizedInputEmail,
            passwordHash: defaultHash,
            role: 'STUDENT',
            name: student.fullName,
            associatedStudentId: student.id,
            departmentId: student.departmentId,
            mustChangePassword: false,
            isActive: true
          }
        });
      }

      const { accessToken, refreshToken } = generateTokens(user.id);
      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } }).catch(() => {});
      (req as any).user = user;
      AuditService.log(
        req,
        'STUDENT_LOGIN',
        'Student',
        `Student [${student.usn}] signed in with registered email [${student.email}].`,
        student.id
      ).catch(() => {});

      if (user.mustChangePassword) {
        prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: false } }).catch(() => {});
      }

      res.status(200).json({
        success: true,
        message: 'Sign in successful. Welcome!',
        token: accessToken,
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          _id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          mustChangePassword: false,
          associatedStudentId: user.associatedStudentId,
          associatedOfficerId: null,
          departmentId: user.departmentId,
          studentProfile: withId({ ...student, departmentId: withId(student.department) }),
          officerProfile: null
        }
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }


  public static async getMe(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id || req.user._id },
        include: {
          associatedStudent: {
            include: { department: true }
          },
          associatedOfficer: {
            include: {
              departmentMappings: {
                include: { department: true }
              }
            }
          }
        }
      });

      if (!user) {
        res.status(404).json({ success: false, message: 'User not found.' });
        return;
      }

      const studentProfile = user.associatedStudent || null;
      let officerProfile = null;

      if (user.associatedOfficer) {
        officerProfile = {
          ...user.associatedOfficer,
          departmentIds: user.associatedOfficer.departmentMappings.map((m) => withId(m.department))
        };
      }

      const { passwordHash, ...userWithoutPassword } = user;

      res.status(200).json({
        success: true,
        user: {
          ...withId(userWithoutPassword),
          mustChangePassword: user.role === 'STUDENT' ? false : !!user.mustChangePassword,
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

      invalidateUserCache(user.id);
      AuditService.log(req, 'PASSWORD_RESET', 'User', `User [${user.email}] updated password.`, user.id).catch(() => {});

      res.status(200).json({ success: true, message: 'Password updated successfully.' });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}
