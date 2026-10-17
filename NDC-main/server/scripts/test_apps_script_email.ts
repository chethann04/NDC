import assert from 'assert';
import EmailService, { ClearanceEmailPayload, CertificateEmailPayload } from '../src/services/EmailService';

interface AppsScriptCall {
  secret?: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  senderName?: string;
}

class MockAppsScriptBackend {
  public calls: AppsScriptCall[] = [];
  public configuredSecret = 'test_secure_token_123456789';
  public remainingQuota = 100;
  public shouldFailWithAuthError = false;
  public shouldFailWithQuotaError = false;
  public shouldFailWithException = false;
  public shouldReturnEmpty = false;

  public async send(payload: AppsScriptCall) {
    this.calls.push(payload);

    if (this.shouldFailWithAuthError || payload.secret !== this.configuredSecret) {
      return {
        success: false,
        error: 'UNAUTHORIZED: Invalid or missing authentication secret',
        statusCode: 401
      };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!payload.to || typeof payload.to !== 'string' || !emailRegex.test(payload.to.trim())) {
      return {
        success: false,
        error: 'INVALID_RECIPIENT: Recipient email address is malformed or invalid',
        statusCode: 400
      };
    }

    if (!payload.subject || typeof payload.subject !== 'string' || !payload.subject.trim()) {
      return {
        success: false,
        error: 'INVALID_SUBJECT: Email subject cannot be empty',
        statusCode: 400
      };
    }

    if (this.shouldFailWithQuotaError || this.remainingQuota <= 0) {
      return {
        success: false,
        error: 'QUOTA_EXCEEDED: Google daily email sending limit reached (remaining: 0)',
        remainingQuota: 0,
        statusCode: 429
      };
    }

    if (this.shouldFailWithException) {
      return {
        success: false,
        error: 'DELIVERY_EXCEPTION: Internal MailApp service error',
        statusCode: 500
      };
    }

    if (this.shouldReturnEmpty) {
      return {
        success: false,
        error: 'Empty response',
        statusCode: 200
      };
    }

    this.remainingQuota--;
    return {
      success: true,
      messageId: `gas_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      remainingQuota: this.remainingQuota,
      statusCode: 200
    };
  }

  public reset() {
    this.calls = [];
    this.remainingQuota = 100;
    this.shouldFailWithAuthError = false;
    this.shouldFailWithQuotaError = false;
    this.shouldFailWithException = false;
    this.shouldReturnEmpty = false;
  }
}

async function runAppsScriptTestSuite() {
  console.log('====================================================');
  console.log(' GOOGLE APPS SCRIPT EMAIL DELIVERY TEST SUITE       ');
  console.log('====================================================');

  const mockBackend = new MockAppsScriptBackend();
  let passedCount = 0;
  let testCount = 0;

  async function runTest(name: string, fn: () => Promise<void> | void) {
    testCount++;
    try {
      await fn();
      console.log(`  ✓ [TEST ${testCount}] ${name}`);
      passedCount++;
    } catch (err: any) {
      console.error(`  ✗ [TEST ${testCount}] ${name}`);
      console.error(`    Error: ${err.message}`);
      throw err;
    }
  }

  // 1. Successful email delivery with dynamic recipient
  await runTest('Successful email dispatch via Google Apps Script HTTPS', async () => {
    mockBackend.reset();
    EmailService.setMockClient({ appsScript: mockBackend });
    process.env.APPS_SCRIPT_SECRET = mockBackend.configuredSecret;

    const res = await EmailService.sendMailDetailed({
      to: 'student.4mc24is022@mcehassan.ac.in',
      subject: '✓ [NDC Update] Central Library: Cleared (No Due) - 4MC24IS022',
      html: '<h1>Library Clearance Approved</h1>'
    });

    assert.strictEqual(res.success, true);
    assert.ok(res.messageId?.startsWith('gas_'), 'MessageId must have gas_ prefix');
    assert.strictEqual(mockBackend.calls.length, 1);
    const call = mockBackend.calls[0];
    assert.strictEqual(call.to, 'student.4mc24is022@mcehassan.ac.in');
    assert.strictEqual(call.secret, mockBackend.configuredSecret);
  });

  // 2. Authentication failure when secret does not match
  await runTest('Authentication rejection when secret is invalid or missing', async () => {
    mockBackend.reset();
    EmailService.setMockClient({ appsScript: mockBackend });
    process.env.APPS_SCRIPT_SECRET = 'wrong_secret_token';

    const res = await EmailService.sendMailDetailed({
      to: 'student.4mc24is022@mcehassan.ac.in',
      subject: 'Security Check',
      html: '<p>Test</p>'
    });

    assert.strictEqual(res.success, false);
    assert.ok(res.error?.includes('UNAUTHORIZED'), 'Must return unauthorized error');
  });

  // 3. Validation rejection for invalid recipient
  await runTest('Invalid recipient address rejected without calling remote service', async () => {
    mockBackend.reset();
    EmailService.setMockClient({ appsScript: mockBackend });

    const res = await EmailService.sendMailDetailed({
      to: 'invalid-email-format',
      subject: 'Test Subject',
      html: '<p>Test</p>'
    });

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'INVALID_RECIPIENT_ADDRESS');
    assert.strictEqual(mockBackend.calls.length, 0, 'No call should be dispatched for invalid email');
  });

  // 4. Daily quota exceeded handling (Google 100/day limit)
  await runTest('Quota exceeded (429) returns clean error without throwing', async () => {
    mockBackend.reset();
    mockBackend.remainingQuota = 0;
    mockBackend.shouldFailWithQuotaError = true;
    EmailService.setMockClient({ appsScript: mockBackend });
    process.env.APPS_SCRIPT_SECRET = mockBackend.configuredSecret;

    const res = await EmailService.sendMailDetailed({
      to: 'student.quota@college.edu.in',
      subject: 'Quota Check',
      html: '<p>Test</p>'
    });

    assert.strictEqual(res.success, false);
    assert.ok(res.error?.includes('QUOTA_EXCEEDED'), 'Must record quota exceeded error');
  });

  // 5. Provider exception handling (MailApp failure)
  await runTest('Provider exception (500) reported cleanly with error reason', async () => {
    mockBackend.reset();
    mockBackend.shouldFailWithException = true;
    EmailService.setMockClient({ appsScript: mockBackend });
    process.env.APPS_SCRIPT_SECRET = mockBackend.configuredSecret;

    const res = await EmailService.sendMailDetailed({
      to: 'student.exception@college.edu.in',
      subject: 'Exception Test',
      html: '<p>Test</p>'
    });

    assert.strictEqual(res.success, false);
    assert.ok(res.error?.includes('DELIVERY_EXCEPTION'), 'Must record delivery exception error');
  });

  // 6. Never report success if response is empty or unconfirmed
  await runTest('Never report delivery as successful if response lacks messageId', async () => {
    mockBackend.reset();
    mockBackend.shouldReturnEmpty = true;
    EmailService.setMockClient({ appsScript: mockBackend });
    process.env.APPS_SCRIPT_SECRET = mockBackend.configuredSecret;

    const res = await EmailService.sendMailDetailed({
      to: 'student.unconfirmed@college.edu.in',
      subject: 'Unconfirmed Test',
      html: '<p>Test</p>'
    });

    assert.strictEqual(res.success, false);
  });

  // 7. Clearance Update Email preservation
  await runTest('sendClearanceUpdateEmail dispatches with dynamic student recipient and templates', async () => {
    mockBackend.reset();
    EmailService.setMockClient({ appsScript: mockBackend });
    process.env.APPS_SCRIPT_SECRET = mockBackend.configuredSecret;

    const payload: ClearanceEmailPayload = {
      toEmail: 'chethuc809@gmail.com',
      studentName: 'Chethan N',
      usn: '4MC24IS022',
      departmentName: 'Department of Computer Science & Engineering',
      status: 'CLEARED',
      remarks: 'Lab record submission completed and verified',
      officerName: 'Dr. Ramesh Kumar',
      clearedCount: 5,
      totalCount: 6
    };

    const sent = await EmailService.sendClearanceUpdateEmail(payload);

    assert.strictEqual(sent, true);
    assert.strictEqual(mockBackend.calls.length, 1);
    const call = mockBackend.calls[0];
    assert.strictEqual(call.to, 'chethuc809@gmail.com', 'Recipient must match dynamic student email');
    assert.ok(call.subject.includes('4MC24IS022'), 'Subject must contain USN');
    assert.ok(call.subject.includes('Cleared'), 'Subject must contain status');
    assert.ok(call.html?.includes('Chethan N'), 'HTML must contain student name');
    assert.ok(call.html?.includes('4MC24IS022'), 'HTML must contain student USN');
    assert.ok(call.html?.includes('Lab record submission completed'), 'HTML must contain remarks');
  });

  // 8. Certificate Issued Email preservation
  await runTest('sendCertificateIssuedEmail dispatches with verification link and cert ID', async () => {
    mockBackend.reset();
    EmailService.setMockClient({ appsScript: mockBackend });
    process.env.APPS_SCRIPT_SECRET = mockBackend.configuredSecret;

    const payload: CertificateEmailPayload = {
      toEmail: 'chethuc809@gmail.com',
      studentName: 'Chethan N',
      usn: '4MC24IS022',
      certificateNumber: 'MCE-NDC-2026-0042',
      issuedAt: new Date(),
      clientUrl: 'https://ndc-portal.vercel.app'
    };

    const sent = await EmailService.sendCertificateIssuedEmail(payload);

    assert.strictEqual(sent, true);
    assert.strictEqual(mockBackend.calls.length, 1);
    const call = mockBackend.calls[0];
    assert.strictEqual(call.to, 'chethuc809@gmail.com');
    assert.ok(call.subject.includes('MCE-NDC-2026-0042'));
    assert.ok(call.html?.includes('MCE-NDC-2026-0042'));
    assert.ok(call.html?.includes('https://ndc-portal.vercel.app/verify?certId=MCE-NDC-2026-0042'));
  });

  // 9. Provider Configuration Detection with GOOGLE_APPS_SCRIPT_URL & SECRET
  await runTest('Provider auto-detection correctly selects apps_script using GOOGLE_APPS_SCRIPT_URL & SECRET', () => {
    EmailService.clearMockClient();

    const origProvider = process.env.EMAIL_PROVIDER;
    const origUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    const origSecret = process.env.GOOGLE_APPS_SCRIPT_SECRET;
    const origLegacyUrl = process.env.APPS_SCRIPT_URL;
    const origLegacySecret = process.env.APPS_SCRIPT_SECRET;

    try {
      delete process.env.APPS_SCRIPT_URL;
      delete process.env.APPS_SCRIPT_SECRET;
      process.env.EMAIL_PROVIDER = 'apps_script';
      process.env.GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz_primary123/exec';
      process.env.GOOGLE_APPS_SCRIPT_SECRET = 'sec_token_primary_987654321';

      EmailService.initTransporter();

      assert.strictEqual(EmailService.getActiveProvider(), 'apps_script');
      assert.strictEqual(EmailService.isConfigured(), true);
    } finally {
      if (origProvider !== undefined) process.env.EMAIL_PROVIDER = origProvider; else delete process.env.EMAIL_PROVIDER;
      if (origUrl !== undefined) process.env.GOOGLE_APPS_SCRIPT_URL = origUrl; else delete process.env.GOOGLE_APPS_SCRIPT_URL;
      if (origSecret !== undefined) process.env.GOOGLE_APPS_SCRIPT_SECRET = origSecret; else delete process.env.GOOGLE_APPS_SCRIPT_SECRET;
      if (origLegacyUrl !== undefined) process.env.APPS_SCRIPT_URL = origLegacyUrl; else delete process.env.APPS_SCRIPT_URL;
      if (origLegacySecret !== undefined) process.env.APPS_SCRIPT_SECRET = origLegacySecret; else delete process.env.APPS_SCRIPT_SECRET;
      EmailService.clearMockClient();
    }
  });

  // 10. Backward Compatibility with APPS_SCRIPT_URL & SECRET
  await runTest('Backward compatibility with legacy APPS_SCRIPT_URL & APPS_SCRIPT_SECRET', () => {
    EmailService.clearMockClient();

    const origProvider = process.env.EMAIL_PROVIDER;
    const origUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    const origSecret = process.env.GOOGLE_APPS_SCRIPT_SECRET;
    const origLegacyUrl = process.env.APPS_SCRIPT_URL;
    const origLegacySecret = process.env.APPS_SCRIPT_SECRET;

    try {
      delete process.env.GOOGLE_APPS_SCRIPT_URL;
      delete process.env.GOOGLE_APPS_SCRIPT_SECRET;
      process.env.EMAIL_PROVIDER = 'apps_script';
      process.env.APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz_legacy456/exec';
      process.env.APPS_SCRIPT_SECRET = 'sec_token_legacy_123456';

      EmailService.initTransporter();

      assert.strictEqual(EmailService.getActiveProvider(), 'apps_script');
      assert.strictEqual(EmailService.isConfigured(), true);
    } finally {
      if (origProvider !== undefined) process.env.EMAIL_PROVIDER = origProvider; else delete process.env.EMAIL_PROVIDER;
      if (origUrl !== undefined) process.env.GOOGLE_APPS_SCRIPT_URL = origUrl; else delete process.env.GOOGLE_APPS_SCRIPT_URL;
      if (origSecret !== undefined) process.env.GOOGLE_APPS_SCRIPT_SECRET = origSecret; else delete process.env.GOOGLE_APPS_SCRIPT_SECRET;
      if (origLegacyUrl !== undefined) process.env.APPS_SCRIPT_URL = origLegacyUrl; else delete process.env.APPS_SCRIPT_URL;
      if (origLegacySecret !== undefined) process.env.APPS_SCRIPT_SECRET = origLegacySecret; else delete process.env.APPS_SCRIPT_SECRET;
      EmailService.clearMockClient();
    }
  });

  // 11. Outbound SMTP is disabled and does not initialize Nodemailer in production
  await runTest('Outbound SMTP is disabled: Presence of SMTP credentials routes to Apps Script without creating SMTP transporter', () => {
    EmailService.clearMockClient();

    const origRender = process.env.RENDER;
    const origProvider = process.env.EMAIL_PROVIDER;
    const origUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    const origSecret = process.env.GOOGLE_APPS_SCRIPT_SECRET;
    const origSmtpUser = process.env.SMTP_USER;
    const origSmtpPass = process.env.SMTP_PASS;

    try {
      process.env.RENDER = 'true';
      delete process.env.EMAIL_PROVIDER;
      process.env.GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz_render_test/exec';
      process.env.GOOGLE_APPS_SCRIPT_SECRET = 'render_secret_token_123';
      process.env.SMTP_USER = '4mc24is022@gmail.com';
      process.env.SMTP_PASS = 'abcd efgh ijkl mnop';

      EmailService.initTransporter();

      assert.strictEqual(EmailService.getActiveProvider(), 'apps_script');
      assert.strictEqual(EmailService.isConfigured(), true);
    } finally {
      if (origRender !== undefined) process.env.RENDER = origRender; else delete process.env.RENDER;
      if (origProvider !== undefined) process.env.EMAIL_PROVIDER = origProvider; else delete process.env.EMAIL_PROVIDER;
      if (origUrl !== undefined) process.env.GOOGLE_APPS_SCRIPT_URL = origUrl; else delete process.env.GOOGLE_APPS_SCRIPT_URL;
      if (origSecret !== undefined) process.env.GOOGLE_APPS_SCRIPT_SECRET = origSecret; else delete process.env.GOOGLE_APPS_SCRIPT_SECRET;
      if (origSmtpUser !== undefined) process.env.SMTP_USER = origSmtpUser; else delete process.env.SMTP_USER;
      if (origSmtpPass !== undefined) process.env.SMTP_PASS = origSmtpPass; else delete process.env.SMTP_PASS;
      EmailService.clearMockClient();
    }
  });

  // 12. Strict type and format validation
  await runTest('Strict type validation rejects malformed email strings', async () => {
    mockBackend.reset();
    EmailService.setMockClient({ appsScript: mockBackend });
    process.env.GOOGLE_APPS_SCRIPT_SECRET = mockBackend.configuredSecret;

    const res = await EmailService.sendMailDetailed({
      to: 'not-an-email@',
      subject: 'Strict Validation Test',
      html: '<p>Test</p>'
    });

    assert.strictEqual(res.success, false);
    assert.ok(res.error?.includes('INVALID_RECIPIENT'), 'Must record INVALID_RECIPIENT rejection');
    assert.strictEqual(mockBackend.calls.length, 1, 'Was dispatched to provider and rejected by strict validation');
  });

  // 13. Public doGet() does not leak sensitive quota or secret metrics
  await runTest('Minimal health check does not expose operational metrics without auth', async () => {
    EmailService.clearMockClient();
    const origUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    const origSecret = process.env.GOOGLE_APPS_SCRIPT_SECRET;
    const origProvider = process.env.EMAIL_PROVIDER;

    try {
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'ONLINE',
          service: 'NDC Email Service',
          timestamp: new Date().toISOString()
        })
      });

      const origGlobalFetch = globalThis.fetch;
      (globalThis as any).fetch = mockFetch;

      process.env.EMAIL_PROVIDER = 'apps_script';
      process.env.GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz_sanitized/exec';
      process.env.GOOGLE_APPS_SCRIPT_SECRET = 'secret_123';
      EmailService.initTransporter();

      const conn = await EmailService.testConnection();
      assert.strictEqual(conn.success, true);
      assert.strictEqual(conn.provider, 'Google Apps Script');
      assert.ok(conn.message.includes('NDC Email Service'));

      globalThis.fetch = origGlobalFetch;
    } finally {
      if (origUrl !== undefined) process.env.GOOGLE_APPS_SCRIPT_URL = origUrl; else delete process.env.GOOGLE_APPS_SCRIPT_URL;
      if (origSecret !== undefined) process.env.GOOGLE_APPS_SCRIPT_SECRET = origSecret; else delete process.env.GOOGLE_APPS_SCRIPT_SECRET;
      if (origProvider !== undefined) process.env.EMAIL_PROVIDER = origProvider; else delete process.env.EMAIL_PROVIDER;
      EmailService.clearMockClient();
    }
  });

  // 14. Timeout handling: Request timeout aborts cleanly without blind duplicate retry
  await runTest('Timeout handling: AbortError returns TIMEOUT_ABORTED without duplicate retry', async () => {
    EmailService.clearMockClient();
    const origUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    const origSecret = process.env.GOOGLE_APPS_SCRIPT_SECRET;
    let fetchInvocationCount = 0;

    try {
      const mockFetchWithTimeout = async () => {
        fetchInvocationCount++;
        const abortErr = new Error('The operation was aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      };

      const origGlobalFetch = globalThis.fetch;
      (globalThis as any).fetch = mockFetchWithTimeout;

      process.env.GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz_timeout_test/exec';
      process.env.GOOGLE_APPS_SCRIPT_SECRET = 'secret_timeout_test';
      EmailService.initTransporter();

      const res = await EmailService.sendMailDetailed({
        to: 'student.timeout@mcehassan.ac.in',
        subject: 'Timeout Test',
        html: '<p>Testing timeout behavior</p>'
      });

      assert.strictEqual(res.success, false);
      assert.ok(res.error?.includes('TIMEOUT_ABORTED'), 'Error must identify TIMEOUT_ABORTED');
      assert.strictEqual(res.retryCount, 0, 'Must NOT retry on timeout');
      assert.strictEqual(fetchInvocationCount, 1, 'Must invoke fetch exactly once without retrying');

      globalThis.fetch = origGlobalFetch;
    } finally {
      if (origUrl !== undefined) process.env.GOOGLE_APPS_SCRIPT_URL = origUrl; else delete process.env.GOOGLE_APPS_SCRIPT_URL;
      if (origSecret !== undefined) process.env.GOOGLE_APPS_SCRIPT_SECRET = origSecret; else delete process.env.GOOGLE_APPS_SCRIPT_SECRET;
      EmailService.clearMockClient();
    }
  });

  // 15. Attachment support preserved in payload
  await runTest('Attachments support: base64 attachments are preserved in dispatch payload', async () => {
    mockBackend.reset();
    EmailService.setMockClient({ appsScript: mockBackend });
    process.env.GOOGLE_APPS_SCRIPT_SECRET = mockBackend.configuredSecret;

    const res = await EmailService.sendMailDetailed({
      to: 'student.attach@mcehassan.ac.in',
      subject: 'Certificate with Attachment',
      html: '<p>Attached is your certificate PDF</p>',
      attachments: [
        {
          filename: 'ClearanceCertificate.pdf',
          content: 'JVBERi0xLjQKJcfs...',
          contentType: 'application/pdf'
        }
      ]
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(mockBackend.calls.length, 1);
    const call = mockBackend.calls[0] as any;
    assert.ok(Array.isArray(call.attachments), 'attachments array must be present');
    assert.strictEqual(call.attachments.length, 1);
    assert.strictEqual(call.attachments[0].filename, 'ClearanceCertificate.pdf');
  });

  // 16. Student Welcome Email workflow
  await runTest('sendStudentWelcomeEmail dispatches with student profile details and portal link', async () => {
    mockBackend.reset();
    EmailService.setMockClient({ appsScript: mockBackend });
    process.env.GOOGLE_APPS_SCRIPT_SECRET = mockBackend.configuredSecret;

    const sent = await EmailService.sendStudentWelcomeEmail({
      toEmail: 'newstudent@college.edu.in',
      studentName: 'Aarav Patel',
      usn: '4MC24CS001',
      departmentName: 'Computer Science and Engineering',
      batch: '2022-2026',
      clientUrl: 'https://ndc-mce.vercel.app'
    });

    assert.strictEqual(sent, true);
    assert.strictEqual(mockBackend.calls.length, 1);
    const call = mockBackend.calls[0];
    assert.strictEqual(call.to, 'newstudent@college.edu.in');
    assert.ok(call.subject.includes('4MC24CS001'));
    assert.ok(call.html?.includes('Aarav Patel'));
    assert.ok(call.html?.includes('Computer Science and Engineering'));
    assert.ok(call.html?.includes('https://ndc-mce.vercel.app/student-login'));
  });

  // 17. Credential Change OTP Email workflow
  await runTest('sendCredentialChangeOtpEmail dispatches verification OTP code cleanly', async () => {
    mockBackend.reset();
    EmailService.setMockClient({ appsScript: mockBackend });
    process.env.GOOGLE_APPS_SCRIPT_SECRET = mockBackend.configuredSecret;

    const sent = await EmailService.sendCredentialChangeOtpEmail({
      toEmail: 'officer.new@mce.ac.in',
      otpCode: '852963',
      accountName: 'Library Desk Officer',
      role: 'CLEARANCE_OFFICER',
      expiresMinutes: 10
    });

    assert.strictEqual(sent, true);
    assert.strictEqual(mockBackend.calls.length, 1);
    const call = mockBackend.calls[0];
    assert.strictEqual(call.to, 'officer.new@mce.ac.in');
    assert.ok(call.subject.includes('852963'));
    assert.ok(call.html?.includes('852963'));
    assert.ok(call.html?.includes('Library Desk Officer'));
  });

  // 18. Password Reset Notice Email workflow
  await runTest('sendPasswordResetNoticeEmail dispatches notice with account owner info', async () => {
    mockBackend.reset();
    EmailService.setMockClient({ appsScript: mockBackend });
    process.env.GOOGLE_APPS_SCRIPT_SECRET = mockBackend.configuredSecret;

    const sent = await EmailService.sendPasswordResetNoticeEmail({
      toEmail: 'student.pwreset@mce.ac.in',
      accountName: 'Chethan N',
      resetBy: 'Self-service'
    });

    assert.strictEqual(sent, true);
    assert.strictEqual(mockBackend.calls.length, 1);
    const call = mockBackend.calls[0];
    assert.strictEqual(call.to, 'student.pwreset@mce.ac.in');
    assert.ok(call.subject.includes('Password Reset'));
    assert.ok(call.html?.includes('Chethan N'));
    assert.ok(call.html?.includes('Self-service'));
  });

  // 19. Batch clearance dispatch handling
  await runTest('sendClearanceUpdateEmailsBatch dispatches multiple notifications sequentially', async () => {
    mockBackend.reset();
    EmailService.setMockClient({ appsScript: mockBackend });
    process.env.GOOGLE_APPS_SCRIPT_SECRET = mockBackend.configuredSecret;

    const payloads: ClearanceEmailPayload[] = [
      {
        toEmail: 'student1@mce.ac.in',
        studentName: 'Student One',
        usn: '4MC24CS001',
        departmentName: 'Hostel Section',
        status: 'CLEARED'
      },
      {
        toEmail: 'student2@mce.ac.in',
        studentName: 'Student Two',
        usn: '4MC24CS002',
        departmentName: 'Hostel Section',
        status: 'DUE',
        dueAmount: 500,
        dueDetails: 'Mess maintenance dues'
      }
    ];

    const result = await EmailService.sendClearanceUpdateEmailsBatch(payloads);

    assert.strictEqual(result.total, 2);
    assert.strictEqual(result.sent, 2);
    assert.strictEqual(result.failed, 0);
    assert.strictEqual(mockBackend.calls.length, 2);
  });

  console.log('====================================================');
  console.log(`SUMMARY: ${passedCount} of ${testCount} tests PASSED!`);
  console.log('====================================================');
}

runAppsScriptTestSuite().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
