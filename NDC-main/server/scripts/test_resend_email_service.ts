import assert from 'assert';
import EmailService, { SendMailResult } from '../src/services/EmailService';
import { getProductionClientUrl, getProductionLoginUrl, getProductionDashboardUrl, getProductionCertificateUrl } from '../src/utils/urlHelper';

interface MockSendCall {
  from?: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
}

// Custom mock Resend client implementation
class MockResendClient {
  public sendCalls: MockSendCall[] = [];
  public shouldFailWithRateLimit = false;
  public rateLimitFailCount = 0;
  public shouldFailWithAuthError = false;
  public shouldFailWithGenericError = false;

  public emails = {
    send: async (payload: MockSendCall) => {
      this.sendCalls.push(payload);

      if (this.shouldFailWithAuthError) {
        return {
          data: null,
          error: {
            name: 'validation_error',
            message: 'API key is invalid',
            statusCode: 401
          }
        };
      }

      if (this.shouldFailWithRateLimit && this.rateLimitFailCount > 0) {
        this.rateLimitFailCount--;
        return {
          data: null,
          error: {
            name: 'rate_limit_exceeded',
            message: 'Rate limit exceeded: 2 requests per second',
            statusCode: 429
          }
        };
      }

      if (this.shouldFailWithGenericError) {
        return {
          data: null,
          error: {
            name: 'application_error',
            message: 'Domain not verified in Resend',
            statusCode: 403
          }
        };
      }

      // Successful acceptance
      return {
        data: {
          id: `re_msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
        },
        error: null
      };
    }
  };

  public apiKeys = {
    list: async () => {
      if (this.shouldFailWithAuthError) {
        throw new Error('Unauthorized');
      }
      return { data: [{ id: 'key_123' }] };
    }
  };

  public reset() {
    this.sendCalls = [];
    this.shouldFailWithRateLimit = false;
    this.rateLimitFailCount = 0;
    this.shouldFailWithAuthError = false;
    this.shouldFailWithGenericError = false;
  }
}

async function runTestSuite() {
  console.log('====================================================');
  console.log('   RESEND EMAIL SERVICE COMPREHENSIVE TEST SUITE    ');
  console.log('====================================================');

  const mockClient = new MockResendClient();
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

  // 1. URL Helper & Route Validation Tests
  await runTest('URL Helper generates valid production URLs and prevents localhost leaks', () => {
    const origUrl = process.env.CLIENT_URL;
    process.env.CLIENT_URL = 'https://ndc-portal.vercel.app';

    const loginUrl = getProductionLoginUrl();
    const dashUrl = getProductionDashboardUrl();
    const certUrl = getProductionCertificateUrl('CERT-2026-001');

    assert.strictEqual(loginUrl, 'https://ndc-portal.vercel.app/student-login');
    assert.strictEqual(dashUrl, 'https://ndc-portal.vercel.app/student/dashboard');
    assert.strictEqual(certUrl, 'https://ndc-portal.vercel.app/verify?certId=CERT-2026-001');

    // Test trailing slash normalization
    process.env.CLIENT_URL = 'https://ndc-portal.vercel.app/';
    assert.strictEqual(getProductionLoginUrl(), 'https://ndc-portal.vercel.app/student-login');

    if (origUrl) process.env.CLIENT_URL = origUrl;
  });

  // 2. Synthetic & Test Email Filtering Test
  await runTest('Synthetic test email domains (.invalid, @loadtest.invalid, example.com) are skipped without API calls', async () => {
    mockClient.reset();
    EmailService.setMockClient(mockClient);

    const syntheticEmails = [
      'student123@loadtest.invalid',
      'user@synthetic.invalid',
      'test@example.com',
      'dev@test.invalid',
      'perf@benchmark.test'
    ];

    for (const email of syntheticEmails) {
      const res: SendMailResult = await EmailService.sendMailDetailed({
        to: email,
        subject: 'Welcome',
        html: '<p>Test</p>'
      });

      assert.strictEqual(res.success, true, `Should return success for synthetic ${email}`);
      assert.strictEqual(res.skipped, true, `Should mark as skipped for ${email}`);
      assert.ok(res.messageId?.startsWith('mock-skipped-synthetic-'), 'Should have synthetic messageId');
    }

    // Zero API calls must have been made to Resend
    assert.strictEqual(mockClient.sendCalls.length, 0, 'No Resend API calls should be made for synthetic emails');
  });

  // 3. Successful Resend API acceptance
  await runTest('Successful Resend API email dispatch via HTTPS API', async () => {
    mockClient.reset();
    EmailService.setMockClient(mockClient);

    const res = await EmailService.sendMailDetailed({
      to: 'student.real@college.edu.in',
      subject: 'Test Subject',
      html: '<h1>Hello World</h1>'
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.skipped, false);
    assert.ok(res.messageId?.startsWith('re_msg_'), 'MessageId should start with re_msg_');
    assert.strictEqual(mockClient.sendCalls.length, 1);
    const sent = mockClient.sendCalls[0];
    assert.deepStrictEqual(sent.to, ['student.real@college.edu.in']);
    assert.strictEqual(sent.subject, 'Test Subject');
    assert.strictEqual(sent.html, '<h1>Hello World</h1>');
  });

  // 4. Rate-limit (429) backoff and retry handling
  await runTest('Rate-limit (429) backoff and retry handling succeeds after retry', async () => {
    mockClient.reset();
    mockClient.shouldFailWithRateLimit = true;
    mockClient.rateLimitFailCount = 1; // Will fail 1 time, then succeed on retry
    EmailService.setMockClient(mockClient);

    const startTime = Date.now();
    const res = await EmailService.sendMailDetailed({
      to: 'student.retry@college.edu.in',
      subject: 'Retry Test',
      html: '<p>Testing Backoff</p>'
    });
    const duration = Date.now() - startTime;

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.retryCount, 1);
    assert.ok(duration >= 600, `Duration should reflect backoff wait (was ${duration}ms)`);
    assert.strictEqual(mockClient.sendCalls.length, 2, 'Should have called mock Resend twice (initial + retry)');
  });

  // 5. Provider rejection / Auth error handling
  await runTest('Provider rejection (401 invalid API key) is reported cleanly without throwing', async () => {
    mockClient.reset();
    mockClient.shouldFailWithAuthError = true;
    EmailService.setMockClient(mockClient);

    const res = await EmailService.sendMailDetailed({
      to: 'student.auth@college.edu.in',
      subject: 'Auth Test',
      html: '<p>Auth Error</p>'
    });

    assert.strictEqual(res.success, false);
    assert.ok(res.error?.includes('API key is invalid'));
  });

  // 6. Welcome Email Template & Link Inspection
  await runTest('Welcome email generates correct production link and preserves student template', async () => {
    mockClient.reset();
    EmailService.setMockClient(mockClient);

    const origUrl = process.env.CLIENT_URL;
    process.env.CLIENT_URL = 'https://ndc.mcehassan.ac.in';

    const sent = await EmailService.sendStudentWelcomeEmail({
      toEmail: 'chethan@college.edu.in',
      studentName: 'Chethan N',
      usn: '4MC24IS022',
      departmentName: 'Department of Information Science',
      batch: '2024-2025'
    });

    assert.strictEqual(sent, true);
    assert.strictEqual(mockClient.sendCalls.length, 1);
    const call = mockClient.sendCalls[0];
    assert.deepStrictEqual(call.to, ['chethan@college.edu.in']);
    assert.ok(call.subject.includes('4MC24IS022'));
    assert.ok(call.html?.includes('https://ndc.mcehassan.ac.in/student-login'), 'Must include production login link');
    assert.ok(call.html?.includes('4MC24IS022'), 'Must include USN');

    if (origUrl) process.env.CLIENT_URL = origUrl;
  });

  // 7. Clearance Update Email Template & Link Inspection
  await runTest('Clearance update email generates correct status and dashboard link', async () => {
    mockClient.reset();
    EmailService.setMockClient(mockClient);

    const origUrl = process.env.CLIENT_URL;
    process.env.CLIENT_URL = 'https://ndc.mcehassan.ac.in';

    const sent = await EmailService.sendClearanceUpdateEmail({
      toEmail: 'chethan@college.edu.in',
      studentName: 'Chethan N',
      usn: '4MC24IS022',
      departmentName: 'Department of Information Science',
      status: 'APPROVED',
      remarks: 'All lab dues cleared.',
      officerName: 'HOD - Dr. Ramesh'
    });

    assert.strictEqual(sent, true);
    assert.strictEqual(mockClient.sendCalls.length, 1);
    const call = mockClient.sendCalls[0];
    assert.ok(call.subject.includes('Cleared (No Due)'));
    assert.ok(call.html?.includes('Department of Information Science'));
    assert.ok(call.html?.includes('All lab dues cleared.'));
    assert.ok(call.html?.includes('https://ndc.mcehassan.ac.in/student-login'), 'Must link to student portal');

    if (origUrl) process.env.CLIENT_URL = origUrl;
  });

  // 8. Clearance Batch Throttling Test
  await runTest('Clearance updates batch sends with rate-limiting throttling', async () => {
    mockClient.reset();
    EmailService.setMockClient(mockClient);

    const updates = [
      {
        toEmail: 'student1@college.edu.in',
        studentName: 'Student One',
        usn: '4MC24IS001',
        departmentName: 'Library',
        status: 'CLEARED'
      },
      {
        toEmail: 'student2@college.edu.in',
        studentName: 'Student Two',
        usn: '4MC24IS002',
        departmentName: 'Library',
        status: 'CLEARED'
      }
    ];

    const startTime = Date.now();
    const batchResult = await EmailService.sendClearanceUpdateEmailsBatch(updates);
    const elapsed = Date.now() - startTime;

    assert.strictEqual(batchResult.total, 2);
    assert.strictEqual(batchResult.sent, 2);
    assert.strictEqual(batchResult.failed, 0);
    assert.strictEqual(mockClient.sendCalls.length, 2);
    assert.ok(elapsed >= 500, `Batch throttle delay should be at least 500ms between calls (was ${elapsed}ms)`);
  });

  // 9. Certificate Issued Email Template & Link Inspection
  await runTest('Certificate issued email links to /verify with certId', async () => {
    mockClient.reset();
    EmailService.setMockClient(mockClient);

    const origUrl = process.env.CLIENT_URL;
    process.env.CLIENT_URL = 'https://ndc.mcehassan.ac.in';

    const sent = await EmailService.sendCertificateIssuedEmail({
      toEmail: 'chethan@college.edu.in',
      studentName: 'Chethan N',
      usn: '4MC24IS022',
      certificateNumber: 'MCE-NDC-2026-9999',
      issuedAt: new Date()
    });

    assert.strictEqual(sent, true);
    assert.strictEqual(mockClient.sendCalls.length, 1);
    const call = mockClient.sendCalls[0];
    assert.ok(call.subject.includes('No Due Certificate'));
    assert.ok(call.html?.includes('MCE-NDC-2026-9999'));
    assert.ok(call.html?.includes('https://ndc.mcehassan.ac.in/verify?certId=MCE-NDC-2026-9999'), 'Must link to /verify route');

    if (origUrl) process.env.CLIENT_URL = origUrl;
  });

  // 10. OTP Email Verification
  await runTest('Credential Change OTP email contains 6-digit OTP code', async () => {
    mockClient.reset();
    EmailService.setMockClient(mockClient);

    const sent = await EmailService.sendCredentialChangeOtpEmail({
      toEmail: 'faculty@college.edu.in',
      accountName: 'Faculty User',
      otpCode: '789123',
      role: 'FACULTY',
      expiresMinutes: 10
    });

    assert.strictEqual(sent, true);
    assert.strictEqual(mockClient.sendCalls.length, 1);
    const call = mockClient.sendCalls[0];
    assert.ok(call.subject.includes('Verification Code'));
    assert.ok(call.subject.includes('789123'));
    assert.ok(call.html?.includes('Security Verification'));
    assert.ok(call.html?.includes('789123'));
    assert.ok(call.html?.includes('10 minutes'));
  });

  // 11. Configuration check returns accurate diagnostic info
  await runTest('isConfigured() and testConnection() report status accurately', async () => {
    EmailService.clearMockClient();

    const origKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = 're_placeholder_replace_with_your_key';
    assert.strictEqual(EmailService.isConfigured(), false);

    process.env.RESEND_API_KEY = '';
    assert.strictEqual(EmailService.isConfigured(), false);

    // With mock client attached
    EmailService.setMockClient(mockClient);
    assert.strictEqual(EmailService.isConfigured(), true);

    const conn = await EmailService.testConnection();
    assert.strictEqual(conn.success, true);
    assert.strictEqual(conn.mode, 'mock');

    if (origKey) process.env.RESEND_API_KEY = origKey;
    EmailService.clearMockClient();
  });

  console.log('====================================================');
  console.log(`SUMMARY: ${passedCount} of ${testCount} tests PASSED!`);
  console.log('====================================================');
}

runTestSuite().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
