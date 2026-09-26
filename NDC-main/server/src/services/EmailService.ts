import nodemailer, { Transporter } from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

export interface ClearanceEmailPayload {
  toEmail: string;
  studentName: string;
  usn: string;
  departmentName: string;
  departmentCode?: string;
  status: string;
  dueAmount?: number;
  dueDetails?: string;
  remarks?: string;
  officerName?: string;
  clearedCount?: number;
  totalCount?: number;
}

export interface CertificateEmailPayload {
  toEmail: string;
  studentName: string;
  usn: string;
  certificateNumber: string;
  issuedAt: Date;
  downloadUrl?: string;
}

class EmailService {
  private transporter: Transporter | null = null;
  private isConfigured: boolean = false;
  private lastUser: string | null = null;
  private lastPass: string | null = null;

  constructor() {
    this.getTransporter();
  }

  private getTransporter(): Transporter | null {
    dotenv.config({ override: true });
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;

    if (!user || !pass || user.includes('your-email')) {
      this.isConfigured = false;
      this.transporter = null;
      return null;
    }

    if (!this.transporter || this.lastUser !== user || this.lastPass !== pass) {
      try {
        this.transporter = nodemailer.createTransport({
          host,
          port,
          secure,
          auth: { user, pass },
          tls: { rejectUnauthorized: false }
        });
        this.lastUser = user;
        this.lastPass = pass;
        this.isConfigured = true;
        console.log(`[EmailService]: SMTP transporter initialized with host: ${host}, user: ${user}`);
      } catch (err) {
        console.warn('[EmailService]: Failed to initialize SMTP transporter:', err);
        this.transporter = null;
        this.isConfigured = false;
      }
    }

    return this.transporter;
  }

  public async testConnection(): Promise<{ success: boolean; message: string }> {
    const transporter = this.getTransporter();
    if (!transporter) {
      return { success: false, message: 'SMTP credentials not configured in environment.' };
    }
    try {
      await transporter.verify();
      return { success: true, message: `SMTP connection verified successfully with ${process.env.SMTP_USER}.` };
    } catch (err: any) {
      return { success: false, message: err.message || 'SMTP verification failed.' };
    }
  }

  /**
   * Send notification email when a department updates a student's clearance status.
   */
  public async sendClearanceUpdateEmail(payload: ClearanceEmailPayload): Promise<boolean> {
    const {
      toEmail,
      studentName,
      usn,
      departmentName,
      departmentCode,
      status,
      dueAmount,
      dueDetails,
      remarks,
      officerName,
      clearedCount,
      totalCount
    } = payload;

    if (!toEmail || !toEmail.includes('@')) {
      console.warn(`[EmailService]: Invalid student email [${toEmail}] for USN [${usn}]. Skipping email.`);
      return false;
    }

    const normalizedStatus = status.toUpperCase();
    const isCleared = normalizedStatus === 'CLEARED' || normalizedStatus === 'NOT_APPLICABLE';
    const isDue = normalizedStatus === 'DUE';
    const statusLabel = isCleared
      ? (normalizedStatus === 'NOT_APPLICABLE' ? 'Not Applicable / Exempt' : 'Cleared (No Due)')
      : isDue
      ? 'Outstanding Due'
      : normalizedStatus === 'ON_HOLD'
      ? 'On Hold'
      : 'Pending Review';

    const statusBadgeColor = isCleared ? '#10b981' : isDue ? '#ef4444' : '#f59e0b';
    const statusBadgeBg = isCleared ? '#ecfdf5' : isDue ? '#fef2f2' : '#fffbeb';

    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    const dashboardUrl = `${clientUrl}/student/dashboard`;

    const subject = `[NDC Update] ${departmentName}: ${statusLabel} - ${usn}`;

    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background-color: #f8fafc; border-radius: 16px; color: #1e293b;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="margin: 0; color: #0f172a; font-size: 20px; font-weight: 800; letter-spacing: -0.02em;">Malnad College of Engineering</h2>
          <p style="margin: 4px 0 0; color: #64748b; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Digital No Due Certificate (NDC) Portal</p>
        </div>

        <div style="background-color: #ffffff; padding: 24px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
          <div style="margin-bottom: 20px;">
            <p style="margin: 0; font-size: 14px; color: #64748b;">Dear <strong>${studentName}</strong> (${usn}),</p>
            <p style="margin: 8px 0 0; font-size: 14px; color: #334155; line-height: 1.5;">
              A department section officer has updated your institutional clearance record:
            </p>
          </div>

          <div style="background-color: #f1f5f9; padding: 16px; border-radius: 8px; margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <span style="font-size: 13px; font-weight: 700; color: #0f172a;">${departmentName} ${departmentCode ? `(${departmentCode})` : ''}</span>
              <span style="display: inline-block; padding: 4px 10px; font-size: 11px; font-weight: 700; border-radius: 9999px; color: ${statusBadgeColor}; background-color: ${statusBadgeBg}; text-transform: uppercase;">
                ${statusLabel}
              </span>
            </div>

            ${isDue ? `
              <div style="padding: 12px; background-color: #fee2e2; border-radius: 6px; margin-top: 8px;">
                <p style="margin: 0; font-size: 13px; font-weight: 700; color: #991b1b;">Outstanding Due Amount: ₹${dueAmount || 0}</p>
                ${dueDetails ? `<p style="margin: 4px 0 0; font-size: 12px; color: #b91c1c;">Details: ${dueDetails}</p>` : ''}
              </div>
            ` : ''}

            ${remarks ? `
              <p style="margin: 10px 0 0; font-size: 12px; color: #475569; font-style: italic;">
                Officer Note: "${remarks}"
              </p>
            ` : ''}

            ${officerName ? `
              <p style="margin: 8px 0 0; font-size: 11px; color: #94a3b8;">
                Reviewed by: ${officerName}
              </p>
            ` : ''}
          </div>

          ${clearedCount !== undefined && totalCount !== undefined ? `
            <div style="margin-bottom: 24px; padding: 12px; background-color: #f8fafc; border-radius: 8px; border: 1px dashed #cbd5e1; text-align: center;">
              <p style="margin: 0; font-size: 12px; font-weight: 600; color: #475569;">
                Clearance Progress: <strong style="color: #2563eb;">${clearedCount} of ${totalCount}</strong> sections cleared.
              </p>
            </div>
          ` : ''}

          <div style="text-align: center; margin-top: 24px;">
            <a href="${dashboardUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 24px; font-size: 13px; font-weight: 700; border-radius: 8px; box-shadow: 0 2px 4px rgba(37,99,235,0.2);">
              View My Clearance Dashboard
            </a>
          </div>
        </div>

        <div style="text-align: center; margin-top: 20px; font-size: 11px; color: #94a3b8;">
          <p style="margin: 0;">This is an automated notification from the Malnad College of Engineering No Due Portal.</p>
          <p style="margin: 4px 0 0;">Please do not reply directly to this email.</p>
        </div>
      </div>
    `;

    return this.sendMail(toEmail, subject, htmlContent);
  }

  /**
   * Send notification email when all clearances are cleared and the certificate is issued.
   */
  public async sendCertificateIssuedEmail(payload: CertificateEmailPayload): Promise<boolean> {
    const { toEmail, studentName, usn, certificateNumber, issuedAt, downloadUrl } = payload;

    if (!toEmail || !toEmail.includes('@')) {
      console.warn(`[EmailService]: Invalid student email [${toEmail}] for USN [${usn}]. Skipping email.`);
      return false;
    }

    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    const dashboardUrl = `${clientUrl}/student/dashboard`;
    const finalDownloadUrl = downloadUrl || dashboardUrl;

    const subject = `🎓 [NDC Complete] No Due Certificate Issued: ${certificateNumber} - ${usn}`;

    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background-color: #f0fdf4; border-radius: 16px; color: #1e293b;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="margin: 0; color: #065f46; font-size: 22px; font-weight: 800; letter-spacing: -0.02em;">Malnad College of Engineering</h2>
          <p style="margin: 4px 0 0; color: #047857; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Autonomous Institution Affiliated to VTU, Belagavi</p>
        </div>

        <div style="background-color: #ffffff; padding: 28px; border-radius: 12px; border: 1px solid #bbf7d0; box-shadow: 0 2px 6px rgba(16,185,129,0.08);">
          <div style="text-align: center; margin-bottom: 20px;">
            <div style="display: inline-block; padding: 12px; background-color: #dcfce7; border-radius: 50%; margin-bottom: 12px;">
              <span style="font-size: 32px;">🎓</span>
            </div>
            <h3 style="margin: 0; font-size: 18px; font-weight: 800; color: #065f46;">All Clearances Completed!</h3>
            <p style="margin: 6px 0 0; font-size: 13px; color: #166534; font-weight: 600;">Your official No Due Certificate has been approved and issued.</p>
          </div>

          <div style="margin-bottom: 20px; font-size: 14px; color: #334155; line-height: 1.6;">
            <p style="margin: 0;">Dear <strong>${studentName}</strong> (${usn}),</p>
            <p style="margin: 8px 0 0;">
              Congratulations! All institutional sections (Central Library, Laboratory, Sports, Accounts Counter, Hostel Administration, and Academic Department) have verified and completed your clearance with <strong>No Due</strong>.
            </p>
          </div>

          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
            <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
              <tr>
                <td style="padding: 6px 0; color: #64748b; font-weight: 500;">Certificate Reference:</td>
                <td style="padding: 6px 0; font-family: monospace; font-weight: 700; color: #0f172a; text-align: right;">${certificateNumber}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #64748b; font-weight: 500;">Issued On:</td>
                <td style="padding: 6px 0; font-weight: 600; color: #0f172a; text-align: right;">${new Date(issuedAt).toLocaleDateString()}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #64748b; font-weight: 500;">Status:</td>
                <td style="padding: 6px 0; font-weight: 700; color: #10b981; text-align: right;">✓ OFFICIAL & VERIFIED</td>
              </tr>
            </table>
          </div>

          <div style="text-align: center; margin-top: 24px;">
            <a href="${finalDownloadUrl}" style="display: inline-block; background-color: #059669; color: #ffffff; text-decoration: none; padding: 14px 28px; font-size: 14px; font-weight: 800; border-radius: 10px; box-shadow: 0 4px 6px rgba(5,150,105,0.25);">
              Download Official Certificate PDF
            </a>
          </div>
        </div>

        <div style="text-align: center; margin-top: 20px; font-size: 11px; color: #64748b;">
          <p style="margin: 0;">You can also verify your certificate at any time via the QR code on the certificate.</p>
          <p style="margin: 4px 0 0;">Malnad College of Engineering, Hassan, Karnataka - 573202</p>
        </div>
      </div>
    `;

    return this.sendMail(toEmail, subject, htmlContent);
  }

  /**
   * Send welcome / account initialized email when student profile is added or registered.
   */
  public async sendStudentWelcomeEmail(payload: {
    toEmail: string;
    studentName: string;
    usn: string;
    departmentName?: string;
    batch?: string;
  }): Promise<boolean> {
    const { toEmail, studentName, usn, departmentName, batch } = payload;
    if (!toEmail || !toEmail.includes('@')) return false;

    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    const loginUrl = `${clientUrl}/student-login`;

    const subject = `🎓 [MCE Portal] Welcome to No Due Certificate Portal - ${usn}`;
    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background-color: #f8fafc; border-radius: 16px; color: #1e293b;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="margin: 0; color: #0f172a; font-size: 20px; font-weight: 800;">Malnad College of Engineering</h2>
          <p style="margin: 4px 0 0; color: #64748b; font-size: 12px; font-weight: 600; text-transform: uppercase;">Digital No Due Certificate (NDC) Portal</p>
        </div>

        <div style="background-color: #ffffff; padding: 24px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
          <p style="margin: 0; font-size: 15px; color: #334155;">Dear <strong>${studentName}</strong>,</p>
          <p style="margin: 10px 0 0; font-size: 14px; color: #475569; line-height: 1.5;">
            Your student profile and clearance workflow have been successfully registered on the MCE Digital No Due Certificate portal.
          </p>

          <div style="background-color: #f1f5f9; padding: 16px; border-radius: 8px; margin: 20px 0;">
            <table style="width: 100%; font-size: 13px; color: #334155;">
              <tr>
                <td style="padding: 4px 0; font-weight: 600; color: #64748b;">USN:</td>
                <td style="padding: 4px 0; font-weight: 700; font-family: monospace; color: #0f172a;">${usn}</td>
              </tr>
              ${departmentName ? `
              <tr>
                <td style="padding: 4px 0; font-weight: 600; color: #64748b;">Department:</td>
                <td style="padding: 4px 0; font-weight: 700; color: #0f172a;">${departmentName}</td>
              </tr>
              ` : ''}
              ${batch ? `
              <tr>
                <td style="padding: 4px 0; font-weight: 600; color: #64748b;">Batch:</td>
                <td style="padding: 4px 0; font-weight: 600; color: #0f172a;">${batch}</td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding: 4px 0; font-weight: 600; color: #64748b;">Registered Email:</td>
                <td style="padding: 4px 0; font-weight: 600; color: #0f172a;">${toEmail}</td>
              </tr>
            </table>
          </div>

          <p style="font-size: 13px; color: #475569; line-height: 1.5;">
            You can log in to your student dashboard to track departmental clearance statuses, clear dues, and download your final No Due Certificate once all desks are approved.
          </p>

          <div style="text-align: center; margin-top: 24px;">
            <a href="${loginUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 24px; font-size: 13px; font-weight: 700; border-radius: 8px;">
              Access Student Portal
            </a>
          </div>
        </div>

        <div style="text-align: center; margin-top: 20px; font-size: 11px; color: #94a3b8;">
          <p style="margin: 0;">Malnad College of Engineering, Hassan, Karnataka - 573202</p>
        </div>
      </div>
    `;

    return this.sendMail(toEmail, subject, htmlContent);
  }

  /**
   * Send one-time verification code (OTP) for credential / email change.
   */
  public async sendCredentialChangeOtpEmail(payload: {
    toEmail: string;
    otpCode: string;
    accountName: string;
    role?: string;
    expiresMinutes?: number;
  }): Promise<boolean> {
    const { toEmail, otpCode, accountName, role, expiresMinutes = 10 } = payload;
    const subject = `MCE NDC Portal: Verification Code for Login Email Change - ${otpCode}`;

    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #0f172a; margin: 0 0 6px; font-size: 20px; font-weight: 700;">Malnad College of Engineering</h2>
          <p style="color: #64748b; margin: 0; font-size: 13px;">Autonomous Institution | Hassan, Karnataka</p>
          <div style="height: 1px; background: #e2e8f0; margin-top: 16px;"></div>
        </div>

        <div style="margin-bottom: 20px;">
          <span style="display: inline-block; background-color: #eff6ff; color: #1d4ed8; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.05em;">
            Security Verification
          </span>
          <h3 style="color: #0f172a; margin: 12px 0 8px; font-size: 16px; font-weight: 600;">
            Verify Your New Login Email Identity
          </h3>
          <p style="color: #475569; font-size: 14px; line-height: 1.5; margin: 0 0 16px;">
            Hello <strong>${accountName}</strong>${role ? ` (${role.replace(/_/g, ' ')})` : ''},
          </p>
          <p style="color: #475569; font-size: 14px; line-height: 1.5; margin: 0 0 20px;">
            A request was initiated to update your official login credentials on the MCE Digital No Due Certificate (NDC) portal to this email address (<strong>${toEmail}</strong>).
          </p>

          <div style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border: 1px solid #cbd5e1; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
            <p style="color: #64748b; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; margin: 0 0 8px;">
              Your 6-Digit Verification Code
            </p>
            <div style="font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #1e3a8a; padding: 6px 0;">
              ${otpCode}
            </div>
            <p style="color: #94a3b8; font-size: 12px; margin: 8px 0 0;">
              Valid for ${expiresMinutes} minutes • Single-use only
            </p>
          </div>

          <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; padding: 12px 16px; margin: 20px 0;">
            <p style="color: #92400e; font-size: 12px; line-height: 1.4; margin: 0;">
              <strong>Security Notice:</strong> If you did not initiate this credential change request, please disregard this email or report it immediately to the college administration. Never share this verification code with anyone.
            </p>
          </div>
        </div>

        <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; text-align: center; font-size: 11px; color: #94a3b8;">
          <p style="margin: 0 0 4px;">Malnad College of Engineering, Hassan, Karnataka - 573202</p>
          <p style="margin: 0;">Digital No Due Certificate (NDC) Management System</p>
        </div>
      </div>
    `;

    return this.sendMail(toEmail, subject, htmlContent);
  }

  /**
   * Send notification when password has been reset by Super Admin.
   */
  public async sendPasswordResetNoticeEmail(payload: {
    toEmail: string;
    accountName: string;
    resetBy: string;
  }): Promise<boolean> {
    const { toEmail, accountName, resetBy } = payload;
    const subject = `MCE NDC Portal: Password Reset Notification`;

    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #0f172a; margin: 0 0 6px; font-size: 20px; font-weight: 700;">Malnad College of Engineering</h2>
          <p style="color: #64748b; margin: 0; font-size: 13px;">Autonomous Institution | Hassan, Karnataka</p>
          <div style="height: 1px; background: #e2e8f0; margin-top: 16px;"></div>
        </div>

        <div style="margin-bottom: 20px;">
          <h3 style="color: #0f172a; margin: 12px 0 8px; font-size: 16px; font-weight: 600;">
            Security Notification: Password Updated
          </h3>
          <p style="color: #475569; font-size: 14px; line-height: 1.5; margin: 0 0 16px;">
            Hello <strong>${accountName}</strong>,
          </p>
          <p style="color: #475569; font-size: 14px; line-height: 1.5; margin: 0 0 20px;">
            Your account password on the MCE Digital No Due Certificate portal was reset by ${resetBy}. If you did not request or anticipate this change, please contact college administration immediately.
          </p>
        </div>

        <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; text-align: center; font-size: 11px; color: #94a3b8;">
          <p style="margin: 0 0 4px;">Malnad College of Engineering, Hassan, Karnataka - 573202</p>
          <p style="margin: 0;">Digital No Due Certificate (NDC) Management System</p>
        </div>
      </div>
    `;

    return this.sendMail(toEmail, subject, htmlContent);
  }

  private async sendMail(to: string, subject: string, html: string): Promise<boolean> {
    const transporter = this.getTransporter();
    const userEmail = process.env.SMTP_USER || '4MC24IS022@gmail.com';
    let envFrom = process.env.SMTP_FROM?.trim();
    if (!envFrom || envFrom.includes('@ac.in.com') || envFrom.includes('your-email')) {
      envFrom = `"MCE No Due Portal" <${userEmail}>`;
    }
    // Clean up extraneous quotes if needed
    const from = envFrom.replace(/^["']|["']$/g, '');

    console.log(`[Email Notification] -> To: ${to} | Subject: "${subject}" | From: ${from}`);

    if (this.isConfigured && transporter) {
      try {
        const info = await transporter.sendMail({
          from,
          to,
          subject,
          html
        });
        console.log(`[Email Notification] -> Email sent successfully to ${to} (MessageId: ${info.messageId})`);
        return true;
      } catch (err: any) {
        console.error(`[Email Notification Error] -> Failed sending to ${to}:`, err.message || err);
        return false;
      }
    } else {
      console.log(`[Email Notification (Dev Mode)]: SMTP credentials unconfigured. Mock email dispatched to ${to}`);
      return true;
    }
  }
}

export const emailService = new EmailService();
export default emailService;
