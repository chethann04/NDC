import { Response } from 'express';
import prisma from '../config/prisma';
import { AuthRequest, invalidateUserCache } from '../middleware/auth';
import { AuditService } from '../services/AuditService';
import credentialOtpService from '../services/CredentialOtpService';
import { hashPassword } from '../utils/passwordUtils';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class CredentialController {
  /**
   * POST /api/v1/auth/credentials/request-email-otp
   * Authenticated user requests a 6-digit OTP to change their official login email.
   */
  public static async requestEmailChangeOtp(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user.id || req.user._id;
      const rawEmail = String(req.body.newEmail || '').trim().toLowerCase();

      if (!rawEmail) {
        res.status(400).json({ success: false, message: 'New email address is required.' });
        return;
      }

      if (!EMAIL_REGEX.test(rawEmail)) {
        res.status(400).json({ success: false, message: 'Please provide a valid email format (e.g. name@college.edu).' });
        return;
      }

      // Fetch user to check current email and account status
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        res.status(404).json({ success: false, message: 'User account not found.' });
        return;
      }

      if (!user.isActive) {
        res.status(403).json({ success: false, message: 'Account is deactivated. Cannot change credentials.' });
        return;
      }

      if (user.email.toLowerCase() === rawEmail) {
        res.status(400).json({
          success: false,
          message: 'The new email is identical to your current login email.'
        });
        return;
      }

      // Enforce global uniqueness: check if another account already uses this email
      const existingUser = await prisma.user.findFirst({
        where: {
          email: { equals: rawEmail, mode: 'insensitive' },
          id: { not: userId }
        }
      });

      if (existingUser) {
        res.status(409).json({
          success: false,
          message: 'This email is already associated with another account.'
        });
        return;
      }

      // Request OTP generation & email dispatch
      const result = await credentialOtpService.requestOtp({
        userId: user.id,
        currentEmail: user.email,
        newEmail: rawEmail,
        accountName: user.name,
        role: user.role,
        purpose: 'SELF_SERVICE_CHANGE'
      });

      // Audit log: Request initiated (never logging OTP)
      AuditService.log(
        req,
        'CREDENTIAL_CHANGE_OTP_REQUESTED',
        'USER',
        `User [${user.email}] requested OTP to change login email to [${rawEmail}].`,
        user.id
      ).catch(() => {});

      res.status(200).json(result);
    } catch (err: any) {
      console.error('[requestEmailChangeOtp Error]:', err);
      res.status(400).json({
        success: false,
        message: err.message || 'Failed to send verification code.'
      });
    }
  }

  /**
   * POST /api/v1/auth/credentials/verify-otp
   * Validates the 6-digit OTP code before proceeding to password update.
   */
  public static async verifyEmailChangeOtp(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user.id || req.user._id;
      const rawEmail = String(req.body.newEmail || '').trim().toLowerCase();
      const otp = String(req.body.otp || '').trim();

      if (!rawEmail || !otp) {
        res.status(400).json({ success: false, message: 'New email and verification code are required.' });
        return;
      }

      const verification = credentialOtpService.verifyOtp(userId, rawEmail, otp);

      if (!verification.valid) {
        res.status(400).json({ success: false, message: verification.message });
        return;
      }

      // Audit log: Successful verification
      AuditService.log(
        req,
        'CREDENTIAL_CHANGE_OTP_VERIFIED',
        'USER',
        `User verified OTP for new login email [${rawEmail}].`,
        userId
      ).catch(() => {});

      res.status(200).json({
        success: true,
        message: 'Email verified successfully. You may now enter your new password.'
      });
    } catch (err: any) {
      console.error('[verifyEmailChangeOtp Error]:', err);
      res.status(500).json({ success: false, message: err.message || 'Verification failed.' });
    }
  }

  /**
   * POST /api/v1/auth/credentials/update
   * Sets new password and commits the verified new email to the existing User record.
   */
  public static async updateCredentials(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user.id || req.user._id;
      const rawEmail = String(req.body.newEmail || '').trim().toLowerCase();
      const otp = String(req.body.otp || '').trim();
      const newPassword = String(req.body.newPassword || '').trim();
      const confirmPassword = String(req.body.confirmPassword || '').trim();

      if (!rawEmail || !otp) {
        res.status(400).json({ success: false, message: 'Email and verification code are required.' });
        return;
      }

      if (!newPassword || newPassword.length < 6) {
        res.status(400).json({
          success: false,
          message: 'New password must be at least 6 characters long.'
        });
        return;
      }

      if (confirmPassword && newPassword !== confirmPassword) {
        res.status(400).json({
          success: false,
          message: 'The new password and confirmation password do not match.'
        });
        return;
      }

      // Consume OTP (single use guarantee)
      const consumption = credentialOtpService.consumeVerifiedOtp(userId, rawEmail, otp);
      if (!consumption.success) {
        res.status(400).json({
          success: false,
          message: consumption.message || 'Invalid or expired verification session.'
        });
        return;
      }

      // Fetch user to update
      const targetUser = await prisma.user.findUnique({
        where: { id: userId },
        include: { associatedOfficer: true }
      });

      if (!targetUser) {
        res.status(404).json({ success: false, message: 'User account not found.' });
        return;
      }

      // Double-check email uniqueness right before commit
      const duplicate = await prisma.user.findFirst({
        where: {
          email: { equals: rawEmail, mode: 'insensitive' },
          id: { not: userId }
        }
      });

      if (duplicate) {
        res.status(409).json({
          success: false,
          message: 'This email is already associated with another account.'
        });
        return;
      }

      const oldEmail = targetUser.email;
      const newPasswordHash = await hashPassword(newPassword);

      // Atomic update of the EXISTING User record (User ID, role, department remain completely intact)
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: {
            email: rawEmail,
            passwordHash: newPasswordHash,
            mustChangePassword: false
          }
        });

        // If user is linked to an officer profile, synchronize the officer email as well
        if (targetUser.associatedOfficerId) {
          await tx.clearanceOfficer.update({
            where: { id: targetUser.associatedOfficerId },
            data: { email: rawEmail }
          });
        }
      });

      // Clear memory cache so current token & cached user reflect new state
      invalidateUserCache(userId);

      // Audit log the update
      await AuditService.log(
        req,
        'CREDENTIALS_CHANGED',
        'USER',
        `User [${targetUser.name}] successfully updated login credentials from [${oldEmail}] to [${rawEmail}]. Role: ${targetUser.role}.`,
        userId,
        { email: oldEmail },
        { email: rawEmail }
      );

      res.status(200).json({
        success: true,
        message: 'Login credentials updated successfully. Please log in with your new email and password.',
        data: {
          id: userId,
          email: rawEmail,
          name: targetUser.name,
          role: targetUser.role
        }
      });
    } catch (err: any) {
      console.error('[updateCredentials Error]:', err);
      res.status(500).json({ success: false, message: err.message || 'Failed to update credentials.' });
    }
  }

  /**
   * POST /api/v1/admin/section-logins/:id/request-email-otp
   * Super Admin initiates verified email change for an operational section account.
   */
  public static async adminRequestEmailChangeOtp(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const rawEmail = String(req.body.newEmail || '').trim().toLowerCase();

      if (!rawEmail) {
        res.status(400).json({ success: false, message: 'New email address is required.' });
        return;
      }

      if (!EMAIL_REGEX.test(rawEmail)) {
        res.status(400).json({ success: false, message: 'Please provide a valid email format.' });
        return;
      }

      const targetUser = await prisma.user.findUnique({
        where: { id }
      });

      if (!targetUser) {
        res.status(404).json({ success: false, message: 'Section account not found.' });
        return;
      }

      if (targetUser.email.toLowerCase() === rawEmail) {
        res.status(400).json({
          success: false,
          message: 'The new email is identical to the current email.'
        });
        return;
      }

      // Check uniqueness across database
      const duplicate = await prisma.user.findFirst({
        where: {
          email: { equals: rawEmail, mode: 'insensitive' },
          id: { not: id }
        }
      });

      if (duplicate) {
        res.status(409).json({
          success: false,
          message: 'This email is already associated with another account.'
        });
        return;
      }

      const result = await credentialOtpService.requestOtp({
        userId: targetUser.id,
        currentEmail: targetUser.email,
        newEmail: rawEmail,
        accountName: targetUser.name,
        role: targetUser.role,
        purpose: 'SUPER_ADMIN_RESET'
      });

      AuditService.log(
        req,
        'SUPER_ADMIN_REQUESTED_EMAIL_OTP',
        'USER',
        `Super Admin requested OTP to change email for [${targetUser.name}] to [${rawEmail}].`,
        id
      ).catch(() => {});

      res.status(200).json(result);
    } catch (err: any) {
      console.error('[adminRequestEmailChangeOtp Error]:', err);
      res.status(400).json({ success: false, message: err.message || 'Failed to dispatch verification code.' });
    }
  }

  /**
   * POST /api/v1/admin/section-logins/:id/verify-email-otp
   * Super Admin verifies OTP and updates the section account email.
   */
  public static async adminVerifyAndUpdateEmail(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const rawEmail = String(req.body.newEmail || '').trim().toLowerCase();
      const otp = String(req.body.otp || '').trim();

      if (!rawEmail || !otp) {
        res.status(400).json({ success: false, message: 'Email and verification code are required.' });
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

      // Verify and consume OTP
      const consumption = credentialOtpService.consumeVerifiedOtp(id, rawEmail, otp);
      if (!consumption.success) {
        res.status(400).json({
          success: false,
          message: consumption.message || 'Invalid or expired verification code.'
        });
        return;
      }

      // Check duplicate
      const duplicate = await prisma.user.findFirst({
        where: {
          email: { equals: rawEmail, mode: 'insensitive' },
          id: { not: id }
        }
      });

      if (duplicate) {
        res.status(409).json({
          success: false,
          message: 'This email is already associated with another account.'
        });
        return;
      }

      const oldEmail = targetUser.email;

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
        'SUPER_ADMIN_UPDATED_SECTION_EMAIL',
        'USER',
        `Super Admin verified and updated login email for ${targetUser.name} (${targetUser.role}) from ${oldEmail} to ${rawEmail}.`,
        id,
        { email: oldEmail },
        { email: rawEmail }
      );

      res.status(200).json({
        success: true,
        message: `Login email for ${targetUser.name} successfully updated to ${rawEmail}.`,
        data: { id, email: rawEmail }
      });
    } catch (err: any) {
      console.error('[adminVerifyAndUpdateEmail Error]:', err);
      res.status(500).json({ success: false, message: err.message || 'Failed to update email.' });
    }
  }
}
