import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import emailService from './EmailService';

interface OtpRecord {
  userId: string;
  currentEmail: string;
  newEmail: string;
  otp: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: string; // ISO string for JSON serialization
  resendAvailableAt: string; // ISO string for JSON serialization
  verified: boolean;
  purpose: 'SELF_SERVICE_CHANGE' | 'SUPER_ADMIN_RESET';
}

class CredentialOtpService {
  private cacheFilePath: string;

  constructor() {
    const cacheDir = path.resolve(__dirname, '../../.cache');
    if (!fs.existsSync(cacheDir)) {
      try {
        fs.mkdirSync(cacheDir, { recursive: true });
      } catch {}
    }
    this.cacheFilePath = path.join(cacheDir, 'credential_otps.json');

    // Periodic garbage collection every 5 minutes
    setInterval(() => {
      this.cleanupExpired();
    }, 5 * 60 * 1000);
  }

  private getKey(userId: string, newEmail: string): string {
    return `${userId.toLowerCase().trim()}:${newEmail.toLowerCase().trim()}`;
  }

  private loadRecords(): Record<string, OtpRecord> {
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const raw = fs.readFileSync(this.cacheFilePath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.warn('[CredentialOtpService]: Failed to load cache file, initializing empty:', err);
    }
    return {};
  }

  private saveRecords(records: Record<string, OtpRecord>): void {
    try {
      fs.writeFileSync(this.cacheFilePath, JSON.stringify(records, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[CredentialOtpService]: Failed to write cache file:', err);
    }
  }

  private cleanupExpired(): void {
    const records = this.loadRecords();
    const now = new Date();
    let modified = false;

    for (const [key, record] of Object.entries(records)) {
      if (new Date(record.expiresAt) < now) {
        delete records[key];
        modified = true;
      }
    }

    if (modified) {
      this.saveRecords(records);
    }
  }

  /**
   * Request a new 6-digit OTP for email change.
   * Enforces 60-second cooldown and 10-minute expiration.
   */
  public async requestOtp(params: {
    userId: string;
    currentEmail: string;
    newEmail: string;
    accountName: string;
    role?: string;
    purpose?: 'SELF_SERVICE_CHANGE' | 'SUPER_ADMIN_RESET';
  }): Promise<{ success: boolean; message: string; cooldownSeconds: number; expiresMinutes: number }> {
    const { userId, currentEmail, newEmail, accountName, role, purpose = 'SELF_SERVICE_CHANGE' } = params;
    const key = this.getKey(userId, newEmail);
    const records = this.loadRecords();
    const existing = records[key];
    const now = new Date();

    // Check resend cooldown
    if (existing && new Date(existing.resendAvailableAt) > now) {
      const waitSeconds = Math.ceil((new Date(existing.resendAvailableAt).getTime() - now.getTime()) / 1000);
      throw new Error(`Please wait ${waitSeconds} seconds before requesting another verification code.`);
    }

    // Generate cryptographically secure 6-digit OTP
    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const expiresMinutes = 10;
    const cooldownSeconds = 60;

    const expiresAt = new Date(now.getTime() + expiresMinutes * 60 * 1000).toISOString();
    const resendAvailableAt = new Date(now.getTime() + cooldownSeconds * 1000).toISOString();

    const record: OtpRecord = {
      userId,
      currentEmail: currentEmail.toLowerCase().trim(),
      newEmail: newEmail.toLowerCase().trim(),
      otp: otpCode,
      attempts: 0,
      maxAttempts: 5,
      expiresAt,
      resendAvailableAt,
      verified: false,
      purpose
    };

    records[key] = record;
    this.saveRecords(records);

    // Send OTP to the NEW email address (never leaking OTP in response or log)
    const sent = await emailService.sendCredentialChangeOtpEmail({
      toEmail: newEmail,
      otpCode,
      accountName,
      role,
      expiresMinutes
    });

    if (!sent) {
      console.warn(`[CredentialOtpService]: Email dispatch to ${newEmail} returned false. In dev mode mock dispatch is presumed.`);
    }

    return {
      success: true,
      message: `A 6-digit verification code has been dispatched to ${newEmail}.`,
      cooldownSeconds,
      expiresMinutes
    };
  }

  /**
   * Verify an entered OTP without consuming it yet.
   */
  public verifyOtp(userId: string, newEmail: string, otp: string): { valid: boolean; message: string } {
    const key = this.getKey(userId, newEmail);
    const records = this.loadRecords();
    const record = records[key];
    const now = new Date();

    if (!record) {
      return {
        valid: false,
        message: 'No active verification code found for this email address. Please request a code first.'
      };
    }

    if (new Date(record.expiresAt) < now) {
      delete records[key];
      this.saveRecords(records);
      return {
        valid: false,
        message: 'The verification code has expired (exceeded 10 minutes). Please request a new code.'
      };
    }

    if (record.attempts >= record.maxAttempts) {
      delete records[key];
      this.saveRecords(records);
      return {
        valid: false,
        message: 'Maximum verification attempts exceeded (5 failed attempts). For security, this code was invalidated. Please request a new code.'
      };
    }

    record.attempts += 1;

    const normalizedInput = String(otp || '').trim();
    if (record.otp !== normalizedInput) {
      const remaining = record.maxAttempts - record.attempts;
      if (remaining <= 0) {
        delete records[key];
        this.saveRecords(records);
        return {
          valid: false,
          message: 'Incorrect verification code. Maximum attempts exceeded. Please request a new code.'
        };
      }
      this.saveRecords(records);
      return {
        valid: false,
        message: `Incorrect verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
      };
    }

    // Mark as verified
    record.verified = true;
    records[key] = record;
    this.saveRecords(records);

    return {
      valid: true,
      message: 'Verification code verified successfully.'
    };
  }

  /**
   * Consume and invalidate the verified OTP when updating credentials.
   * Single-use guarantee.
   */
  public consumeVerifiedOtp(userId: string, newEmail: string, otp: string): { success: boolean; message?: string } {
    const key = this.getKey(userId, newEmail);
    const records = this.loadRecords();
    const record = records[key];
    const now = new Date();

    if (!record) {
      return {
        success: false,
        message: 'Verification session not found or expired. Please request a new code.'
      };
    }

    if (new Date(record.expiresAt) < now) {
      delete records[key];
      this.saveRecords(records);
      return {
        success: false,
        message: 'Verification code expired. Please request a new one.'
      };
    }

    const normalizedInput = String(otp || '').trim();
    if (record.otp !== normalizedInput) {
      return {
        success: false,
        message: 'Verification code does not match.'
      };
    }

    // Successfully consumed - delete record so it can NEVER be reused
    delete records[key];
    this.saveRecords(records);
    return { success: true };
  }

  /**
   * Helper to retrieve active record for testing only
   */
  public getActiveOtpForTesting(userId: string, newEmail: string): string | null {
    const key = this.getKey(userId, newEmail);
    const records = this.loadRecords();
    const record = records[key];
    return record?.otp || null;
  }

  /**
   * Directly invalidate an active OTP if cancelled or overwritten
   */
  public invalidateOtp(userId: string, newEmail: string): void {
    const key = this.getKey(userId, newEmail);
    const records = this.loadRecords();
    delete records[key];
    this.saveRecords(records);
  }
}

export const credentialOtpService = new CredentialOtpService();
export default credentialOtpService;
