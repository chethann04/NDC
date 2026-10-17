import { Resend } from 'resend';
import dotenv from 'dotenv';
import { getClientBaseUrl } from '../utils/urlHelper';

dotenv.config();

export interface EmailAttachment {
  filename: string;
  content: string; // base64 encoded
  contentType?: string;
}

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
}

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
  clientUrl?: string;
}

export interface CertificateEmailPayload {
  toEmail: string;
  studentName: string;
  usn: string;
  certificateNumber: string;
  issuedAt: Date;
  downloadUrl?: string;
  clientUrl?: string;
}

/**
 * Helper to retrieve Google Apps Script Web App URL from environment.
 * Supports both GOOGLE_APPS_SCRIPT_URL and legacy APPS_SCRIPT_URL.
 */
export const getAppsScriptUrl = (): string =>
  (process.env.GOOGLE_APPS_SCRIPT_URL || process.env.APPS_SCRIPT_URL || '').trim();

/**
 * Helper to retrieve Google Apps Script shared authentication secret from environment.
 * Supports both GOOGLE_APPS_SCRIPT_SECRET and legacy APPS_SCRIPT_SECRET.
 */
export const getAppsScriptSecret = (): string =>
  (process.env.GOOGLE_APPS_SCRIPT_SECRET || process.env.APPS_SCRIPT_SECRET || '').trim();

/**
 * Identifies synthetic, load-test, or RFC 2606 reserved domains
 * that must be skipped from delivery to avoid wasted credits and provider errors.
 */
export const isSyntheticOrTestEmail = (email: string): boolean => {
  if (!email || !email.includes('@')) return true;
  const lower = email.toLowerCase().trim();
  const domain = lower.split('@')[1] || '';
  return (
    domain.endsWith('.invalid') ||
    domain.endsWith('.example') ||
    domain.endsWith('.test') ||
    domain.endsWith('.local') ||
    domain === 'example.com' ||
    domain === 'example.org' ||
    domain === 'example.net' ||
    lower.includes('@loadtest.invalid') ||
    lower.includes('@demo.ndc.local') ||
    lower.includes('@benchmark.test')
  );
};

export interface SendMailDetailedResult {
  success: boolean;
  messageId?: string;
  skipped?: boolean;
  error?: string;
  rateLimited?: boolean;
  retryCount?: number;
}

export type SendMailResult = SendMailDetailedResult;

class EmailService {
  private resendClient: Resend | null = null;
  private mockClient: any = null;
  private _isConfigured: boolean = false;
  private activeProvider: 'apps_script' | 'resend' | 'mock' | 'none' = 'none';

  constructor() {
    this.initTransporter();
  }

  /**
   * Check if email service is configured and ready.
   */
  public isConfigured(): boolean {
    if (this.mockClient) return true;
    this.initTransporter();
    return this._isConfigured;
  }

  /**
   * Inject a mock client for automated unit and integration tests.
   * Ensures tests never trigger real emails or require live credentials.
   */
  public setMockClient(client: any): void {
    this.mockClient = client;
    this.activeProvider = 'mock';
    this._isConfigured = !!client;
  }

  /**
   * Reset mock client to default runtime state.
   */
  public clearMockClient(): void {
    this.mockClient = null;
    this.initTransporter();
  }

  /**
   * Check current active provider name.
   */
  public getActiveProvider(): 'apps_script' | 'resend' | 'mock' | 'none' {
    return this.activeProvider;
  }

  /**
   * Initialize or refresh the active email transport.
   * 
   * Transport Selection Logic:
   * 1. Google Apps Script Web App (HTTPS Port 443) is the primary production delivery path.
   *    It dispatches emails via Google's MailApp service, bypassing Render Free outbound SMTP blocks
   *    (ENETUNREACH) without requiring a custom verified domain.
   * 2. Resend HTTPS API (Port 443) is available as an optional secondary alternative when configured.
   * 3. Outbound SMTP is completely disabled in production because Render blocks ports 25, 465, 587.
   */
  public initTransporter(): void {
    if (this.mockClient) {
      this.activeProvider = 'mock';
      this._isConfigured = true;
      return;
    }

    const isRender = process.env.RENDER === 'true' || process.env.RENDER_SERVICE_ID !== undefined;
    const providerPref = (process.env.EMAIL_PROVIDER || '').toLowerCase().trim();
    const appsScriptUrl = getAppsScriptUrl();
    const appsScriptSecret = getAppsScriptSecret();
    const hasValidAppsScript = !!(
      appsScriptUrl &&
      appsScriptUrl.startsWith('https://script.google.com') &&
      appsScriptSecret &&
      !appsScriptSecret.includes('placeholder')
    );
    const resendKey = process.env.RESEND_API_KEY?.trim();
    const hasValidResendKey = !!(resendKey && resendKey.startsWith('re_') && !resendKey.includes('placeholder'));

    // If legacy SMTP credentials are present in the environment, inform the user that SMTP is disabled
    if (process.env.SMTP_USER || process.env.SMTP_PASS) {
      console.log(
        '[EmailService]: Outbound SMTP is disabled (Render blocks ports 25, 465, 587). ' +
        'Production email delivery is routed via Google Apps Script HTTPS (Port 443).'
      );
    }

    // 1. Google Apps Script Web App (HTTPS Port 443 - Primary Production Provider)
    // Active if:
    // - Valid Apps Script URL and secret configured (prioritized)
    // - Or EMAIL_PROVIDER is explicitly 'apps_script', 'gas', or 'google_apps_script'
    if (hasValidAppsScript && (providerPref !== 'resend' || !hasValidResendKey)) {
      this.activeProvider = 'apps_script';
      this._isConfigured = true;
      console.log(`[EmailService]: Google Apps Script HTTPS client active (Port 443)${isRender ? ' [Render Environment Detected]' : ''}`);
      return;
    }

    // 2. Resend HTTPS API (Port 443 - Secondary Alternative):
    // Active if EMAIL_PROVIDER is explicitly 'resend' or if Apps Script is not configured
    if (hasValidResendKey && (providerPref === 'resend' || !hasValidAppsScript)) {
      try {
        this.resendClient = new Resend(resendKey);
        this.activeProvider = 'resend';
        this._isConfigured = true;
        console.log(`[EmailService]: Resend HTTPS client active (Port 443)${isRender ? ' [Render Environment Detected]' : ''}`);
        return;
      } catch (err: any) {
        console.warn('[EmailService]: Failed to init Resend:', err.message);
      }
    }

    // 3. Fallback to Google Apps Script if URL exists
    if (hasValidAppsScript) {
      this.activeProvider = 'apps_script';
      this._isConfigured = true;
      console.log(`[EmailService]: Fallback to Google Apps Script HTTPS client (Port 443)`);
      return;
    }

    // 4. Fallback to Resend if key exists
    if (hasValidResendKey) {
      try {
        this.resendClient = new Resend(resendKey);
        this.activeProvider = 'resend';
        this._isConfigured = true;
        console.log(`[EmailService]: Fallback to Resend HTTPS client (Port 443)`);
        return;
      } catch {
        // ignore
      }
    }

    this.activeProvider = 'none';
    this._isConfigured = false;
  }

  /**
   * Verify email service credentials and connection.
   */
  public async testConnection(): Promise<{ success: boolean; message: string; provider: string; mode?: string }> {
    if (this.mockClient) {
      return { success: true, message: 'Mock email client active for tests.', provider: 'Mock', mode: 'mock' };
    }

    this.initTransporter();
    if (!this._isConfigured) {
      return {
        success: false,
        provider: this.activeProvider,
        message: 'No valid HTTPS email credentials configured. Set GOOGLE_APPS_SCRIPT_URL and GOOGLE_APPS_SCRIPT_SECRET (or RESEND_API_KEY).',
        mode: 'unconfigured'
      };
    }

    if (this.activeProvider === 'apps_script') {
      const url = getAppsScriptUrl();
      try {
        const response = await fetch(url, { method: 'GET', redirect: 'follow' });
        if (!response.ok) {
          return {
            success: false,
            provider: 'Google Apps Script',
            message: `Google Apps Script returned HTTP ${response.status}: ${response.statusText}`,
            mode: 'error'
          };
        }
        const data: any = await response.json();
        if (data && data.status === 'ONLINE') {
          return {
            success: true,
            provider: 'Google Apps Script',
            message: `Google Apps Script HTTPS connection verified successfully (${data.service || 'NDC Email Service'}).`,
            mode: 'live'
          };
        }
        return {
          success: false,
          provider: 'Google Apps Script',
          message: `Google Apps Script returned unexpected payload: ${JSON.stringify(data)}`,
          mode: 'error'
        };
      } catch (err: any) {
        return {
          success: false,
          provider: 'Google Apps Script',
          message: `Google Apps Script connection test failed: ${err.message}`,
          mode: 'exception'
        };
      }
    }

    if (this.activeProvider === 'resend' && this.resendClient) {
      try {
        const result = await this.resendClient.apiKeys.list();
        if (result.error) {
          return {
            success: false,
            provider: 'Resend',
            message: result.error.message || 'Resend API authentication failed.',
            mode: 'error'
          };
        }
        return {
          success: true,
          provider: 'Resend',
          message: 'Resend HTTPS API connection verified successfully.',
          mode: 'live'
        };
      } catch (err: any) {
        return {
          success: false,
          provider: 'Resend',
          message: err.message || 'Resend API connection test failed.',
          mode: 'exception'
        };
      }
    }

    return { success: false, provider: 'None', message: 'Email service is unconfigured.', mode: 'unconfigured' };
  }

  /**
   * Core email dispatch method.
   * Dispatches via Google Apps Script Web App (HTTPS Port 443) or Resend (custom domain).
   */
  public async sendMailDetailed(
    toOrOptions: string | SendMailOptions,
    subjectParam?: string,
    htmlParam?: string,
    headersParam?: Record<string, string>
  ): Promise<SendMailDetailedResult> {
    let to: string;
    let subject: string;
    let html: string;
    let text: string | undefined;
    let headers: Record<string, string> | undefined;
    let attachments: EmailAttachment[] | undefined;

    if (typeof toOrOptions === 'object' && toOrOptions !== null) {
      to = toOrOptions.to;
      subject = toOrOptions.subject;
      html = toOrOptions.html;
      text = toOrOptions.text;
      headers = toOrOptions.headers;
      attachments = toOrOptions.attachments;
    } else {
      to = toOrOptions;
      subject = subjectParam || '';
      html = htmlParam || '';
      headers = headersParam;
    }

    if (!to || !to.includes('@')) {
      return { success: false, error: 'INVALID_RECIPIENT_ADDRESS' };
    }

    const recipient = to.trim();

    // Skip synthetic/test domains without sending
    if (isSyntheticOrTestEmail(recipient)) {
      console.log(`[EmailService]: Skipped email dispatch to synthetic test address [${recipient}].`);
      return { success: true, skipped: true, messageId: `mock-skipped-synthetic-${Date.now()}` };
    }

    // 1. Dispatch via Mock Client with Apps Script simulation
    if (this.mockClient?.appsScript) {
      try {
        const payload: any = {
          secret: getAppsScriptSecret() || 'mock_secret',
          to: recipient,
          subject,
          html,
          text: text || '',
          senderName: process.env.EMAIL_SENDER_NAME || 'MCE No Due Portal'
        };
        if (attachments && Array.isArray(attachments) && attachments.length > 0) {
          payload.attachments = attachments;
        }
        const response = await this.mockClient.appsScript.send(payload);
        if (response && response.success === true && response.messageId) {
          console.log(`[Email Notification] -> Email accepted by Google Apps Script (Mock) for ${recipient} (MessageId: ${response.messageId})`);
          return { success: true, messageId: response.messageId, skipped: false };
        }
        const errorMsg = response?.error || 'Google Apps Script mock delivery failed';
        console.error(`[EmailService Error]: Google Apps Script (Mock) rejected email to [${recipient}]:`, errorMsg);
        return { success: false, error: errorMsg };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }

    // 2. Dispatch via Google Apps Script Web App (HTTPS Port 443)
    if (this.activeProvider === 'apps_script') {
      const appsScriptUrl = getAppsScriptUrl();
      const appsScriptSecret = getAppsScriptSecret();

      if (!appsScriptUrl || !appsScriptSecret) {
        console.error('[EmailService Error]: GOOGLE_APPS_SCRIPT_URL or GOOGLE_APPS_SCRIPT_SECRET is missing');
        return { success: false, error: 'APPS_SCRIPT_CONFIG_MISSING' };
      }

      const senderName = process.env.EMAIL_SENDER_NAME || 'MCE No Due Portal';
      const payload: any = {
        secret: appsScriptSecret,
        to: recipient,
        subject,
        html,
        text: text || '',
        senderName
      };

      if (attachments && Array.isArray(attachments) && attachments.length > 0) {
        payload.attachments = attachments;
      }

      const TIMEOUT_MS = 20000; // 20s abort timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const response = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload),
          redirect: 'follow',
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        const contentType = response.headers.get('content-type') || '';
        let result: any;
        if (contentType.includes('application/json')) {
          result = await response.json();
        } else {
          const rawText = await response.text();
          try {
            result = JSON.parse(rawText);
          } catch {
            result = { success: false, error: rawText.substring(0, 300) };
          }
        }

        if (result && result.success === true && result.messageId) {
          console.log(`[Email Notification] -> Email accepted by Google Apps Script for ${recipient} (MessageId: ${result.messageId}, Quota: ${result.remainingQuota ?? 'N/A'})`);
          return { success: true, messageId: result.messageId, skipped: false, retryCount: 0 };
        }

        const failureError = result?.error || `Google Apps Script returned failure with status ${result?.statusCode || response.status}`;
        console.error(`[EmailService Error]: Google Apps Script rejected email to [${recipient}]:`, failureError);
        return { success: false, error: failureError, retryCount: 0 };
      } catch (err: any) {
        clearTimeout(timeoutId);

        const isTimeout = err.name === 'AbortError' || err.name === 'TimeoutError' || err.message?.toLowerCase().includes('aborted');
        if (isTimeout) {
          const timeoutMsg = `TIMEOUT_ABORTED: Request to Google Apps Script timed out after ${TIMEOUT_MS}ms for [${recipient}]. Automatic retry was aborted to prevent sending duplicate emails.`;
          console.error(`[EmailService Error]: ${timeoutMsg}`);
          return {
            success: false,
            error: timeoutMsg,
            retryCount: 0
          };
        }

        const networkError = `Network error communicating with Google Apps Script: ${err.message || String(err)}`;
        console.error(`[EmailService Error]: ${networkError}`);
        return { success: false, error: networkError, retryCount: 0 };
      }
    }

    // 3. Dispatch via Mock Client or Resend HTTPS API
    const resendApi = this.mockClient || (this.activeProvider === 'resend' ? this.resendClient : null);
    if (resendApi) {
      const fromAddress = process.env.EMAIL_FROM || 'MCE No Due Portal <onboarding@resend.dev>';
      let attempt = 0;
      const maxAttempts = 2;
      let lastErrorMsg = 'Unknown dispatch failure';

      while (attempt < maxAttempts) {
        attempt++;
        try {
          const payload: any = {
            from: fromAddress,
            to: [recipient],
            subject,
            html
          };
          if (text) payload.text = text;
          if (headers) payload.headers = headers;

          const response = await resendApi.emails.send(payload);

          if (response.error) {
            lastErrorMsg = response.error.message || response.error.name || 'Resend API error';
            const isRateLimit =
              response.error.name === 'rate_limit_exceeded' ||
              response.error.message?.toLowerCase().includes('rate limit');

            if (isRateLimit && attempt < maxAttempts) {
              await new Promise((r) => setTimeout(r, 650));
              continue;
            }

            // Detect Resend Sandbox Restriction (e.g. sending to unverified recipient with onboarding@resend.dev)
            const lowerErr = lastErrorMsg.toLowerCase();
            const isSandboxRestriction =
              lowerErr.includes('only send testing emails') ||
              lowerErr.includes('own email address') ||
              lowerErr.includes('resend.com/domains') ||
              lowerErr.includes('verify a domain');

            if (isSandboxRestriction) {
              const sandboxMessage =
                `[Resend Sandbox Restriction]: ${lastErrorMsg}. ` +
                `In Resend sandbox mode, emails can only be sent to the verified account owner. ` +
                `To deliver emails to dynamic student recipients, verify a custom sending domain at https://resend.com/domains ` +
                `and configure EMAIL_FROM="MCE No Due Portal <noreply@yourdomain.com>".`;
              console.error(`[EmailService Error]: ${sandboxMessage}`);
              return { success: false, error: sandboxMessage, rateLimited: false, retryCount: attempt - 1 };
            }

            console.error(`[EmailService Error]: Resend rejected email to [${recipient}]:`, lastErrorMsg);
            return { success: false, error: lastErrorMsg, rateLimited: isRateLimit, retryCount: attempt - 1 };
          }

          if (response.data && response.data.id) {
            console.log(`[Email Notification] -> Email accepted by Resend for ${recipient} (MessageId: ${response.data.id})`);
            return { success: true, messageId: response.data.id, skipped: false, retryCount: attempt - 1 };
          }

          // If neither error nor message ID was returned, never report delivery as successful
          lastErrorMsg = 'Resend API returned empty confirmation without message ID';
        } catch (err: any) {
          lastErrorMsg = err?.message || 'Network error communicating with Resend HTTPS API';
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 650));
            continue;
          }
        }
      }

      return { success: false, error: lastErrorMsg, retryCount: attempt - 1 };
    }

    this.initTransporter();
    if (!this._isConfigured) {
      console.warn(`[EmailService]: Email service unconfigured. Email to [${recipient}] was not dispatched.`);
      return { success: false, error: 'EMAIL_SERVICE_UNCONFIGURED' };
    }

    return { success: false, error: 'NO_ACTIVE_EMAIL_PROVIDER' };
  }

  /**
   * Compatibility wrapper returning boolean success for existing callers.
   */
  public async sendMail(to: string, subject: string, html: string): Promise<boolean> {
    const res = await this.sendMailDetailed(to, subject, html);
    return res.success && !res.error;
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

    if (isSyntheticOrTestEmail(toEmail)) {
      console.log(`[EmailService]: Skipped clearance update email for synthetic test address [${toEmail}].`);
      return true;
    }

    const normalizedStatus = (status || '').toUpperCase();
    const isCleared = normalizedStatus === 'CLEARED';
    const isDue = normalizedStatus === 'DUE';
    const isOnHold = normalizedStatus === 'ON_HOLD';
    const isNa = normalizedStatus === 'NOT_APPLICABLE';

    let statusLabel = 'Cleared (No Due)';
    let statusBadgeColor = '#059669';
    let statusBadgeBg = '#ecfdf5';
    let subjectIcon = '✓';
    let statusSummaryTitle = 'Clearance Approved';
    let statusSummaryDesc = 'Your institutional clearance for this section has been approved with no outstanding dues.';

    if (isDue) {
      statusLabel = 'Outstanding Due';
      statusBadgeColor = '#dc2626';
      statusBadgeBg = '#fef2f2';
      subjectIcon = '⚠';
      statusSummaryTitle = 'Action Required: Outstanding Due Recorded';
      statusSummaryDesc = 'An outstanding due has been recorded by the clearance desk. Please settle this due to proceed with your No Due Certificate.';
    } else if (isOnHold) {
      statusLabel = 'Clearance On Hold';
      statusBadgeColor = '#d97706';
      statusBadgeBg = '#fffbeb';
      subjectIcon = '⏳';
      statusSummaryTitle = 'Notice: Clearance Put On Hold';
      statusSummaryDesc = 'Your clearance is temporarily on hold pending physical verification, library book return, or fee reconciliation.';
    } else if (isNa) {
      statusLabel = 'Not Applicable / Exempt';
      statusBadgeColor = '#4f46e5';
      statusBadgeBg = '#eef2ff';
      subjectIcon = 'ℹ';
      statusSummaryTitle = 'Section Clearance Exempted';
      statusSummaryDesc = 'Clearance for this institutional section is exempted for your enrollment category (e.g. Day Scholar Hostel Exemption).';
    }

    const clientUrl = getClientBaseUrl(payload.clientUrl);
    const dashboardUrl = `${clientUrl}/student-login`;

    const subject = `${subjectIcon} [NDC Update] ${departmentName}: ${statusLabel} - ${usn}`;

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
              A clearance section officer has updated your institutional clearance record:
            </p>
          </div>

          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 10px; margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <span style="font-size: 14px; font-weight: 700; color: #0f172a;">${departmentName} ${departmentCode ? `(${departmentCode})` : ''}</span>
              <span style="display: inline-block; padding: 4px 10px; font-size: 11px; font-weight: 700; border-radius: 9999px; color: ${statusBadgeColor}; background-color: ${statusBadgeBg}; text-transform: uppercase; border: 1px solid ${statusBadgeColor}22;">
                ${statusLabel}
              </span>
            </div>

            <div style="padding: 10px 12px; background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 10px;">
              <p style="margin: 0; font-size: 12px; font-weight: 700; color: ${statusBadgeColor};">${statusSummaryTitle}</p>
              <p style="margin: 4px 0 0; font-size: 12px; color: #475569; line-height: 1.4;">${statusSummaryDesc}</p>
            </div>

            ${isDue ? `
              <div style="padding: 12px; background-color: #fee2e2; border-radius: 8px; border: 1px solid #fecaca; margin-top: 8px;">
                <p style="margin: 0; font-size: 13px; font-weight: 700; color: #991b1b;">Outstanding Due Amount: ₹${dueAmount || 0}</p>
                ${dueDetails ? `<p style="margin: 4px 0 0; font-size: 12px; color: #b91c1c;"><strong>Details:</strong> ${dueDetails}</p>` : ''}
                <p style="margin: 6px 0 0; font-size: 11px; color: #7f1d1d;">Please settle dues with the respective department officer to obtain clearance.</p>
              </div>
            ` : ''}

            ${isOnHold ? `
              <div style="padding: 12px; background-color: #fef3c7; border-radius: 8px; border: 1px solid #fde68a; margin-top: 8px;">
                <p style="margin: 0; font-size: 13px; font-weight: 700; color: #92400e;">Status: On Hold</p>
                ${remarks ? `<p style="margin: 4px 0 0; font-size: 12px; color: #b45309;"><strong>Reason:</strong> ${remarks}</p>` : ''}
                <p style="margin: 6px 0 0; font-size: 11px; color: #78350f;">Please visit the department desk or contact the officer to resolve.</p>
              </div>
            ` : ''}

            ${remarks && !isOnHold ? `
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

          ${clearedCount !== undefined && totalCount !== undefined && totalCount > 0 ? `
            <div style="margin-bottom: 24px; padding: 12px; background-color: #f8fafc; border-radius: 8px; border: 1px dashed #cbd5e1; text-align: center;">
              <p style="margin: 0; font-size: 12px; font-weight: 600; color: #475569;">
                Clearance Progress: <strong style="color: #2563eb;">${clearedCount} of ${totalCount}</strong> sections cleared.
              </p>
            </div>
          ` : ''}

          <div style="text-align: center; margin-top: 24px;">
            <a href="${dashboardUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 24px; font-size: 13px; font-weight: 700; border-radius: 8px; box-shadow: 0 2px 4px rgba(37,99,235,0.2);">
              Sign In to View Clearance Dashboard
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
   * Dispatch a batch of clearance update emails sequentially through Resend HTTPS API.
   * Throttled with 550ms intervals to remain well within Resend free tier limits (2 req/s).
   */
  public async sendClearanceUpdateEmailsBatch(
    payloads: ClearanceEmailPayload[]
  ): Promise<{ total: number; sent: number; failed: number; skipped: number }> {
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const p of payloads) {
      try {
        if (isSyntheticOrTestEmail(p.toEmail)) {
          skipped++;
          continue;
        }

        const ok = await this.sendClearanceUpdateEmail(p);
        if (ok) sent++;
        else failed++;

        // Rate-limit throttle for Resend API
        await new Promise((resolve) => setTimeout(resolve, 550));
      } catch (err) {
        failed++;
        console.warn(`[EmailService]: Failed to dispatch batch email for USN ${p.usn}:`, err);
      }
    }

    console.log(`[EmailService]: Batch clearance dispatch completed: ${sent} sent, ${failed} failed, ${skipped} skipped out of ${payloads.length}`);
    return { total: payloads.length, sent, failed, skipped };
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

    if (isSyntheticOrTestEmail(toEmail)) {
      console.log(`[EmailService]: Skipped certificate email for synthetic test address [${toEmail}].`);
      return true;
    }

    const clientUrl = getClientBaseUrl(payload.clientUrl);
    const verifyUrl = `${clientUrl}/verify?certId=${encodeURIComponent(certificateNumber)}`;
    const finalDownloadUrl = downloadUrl || verifyUrl;

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
            <p style="margin: 12px 0 0; font-size: 12px; color: #64748b;">
              Or verify online at: <a href="${verifyUrl}" style="color: #059669; font-weight: 600; text-decoration: underline;">${verifyUrl}</a>
            </p>
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
    clientUrl?: string;
  }): Promise<boolean> {
    const { toEmail, studentName, usn, departmentName, batch, clientUrl: preferredClientUrl } = payload;
    if (!toEmail || !toEmail.includes('@')) return false;

    if (isSyntheticOrTestEmail(toEmail)) {
      console.log(`[EmailService]: Skipped student welcome email for synthetic test address [${toEmail}].`);
      return true;
    }

    const clientUrl = getClientBaseUrl(preferredClientUrl);
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
}

export const emailService = new EmailService();
export default emailService;
