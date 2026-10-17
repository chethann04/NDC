import { emailService } from '../src/services/EmailService';
import { NotificationQueueService } from '../src/services/NotificationQueueService';
import { DueManagementService } from '../src/services/DueManagementService';
import prisma from '../src/config/prisma';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}${detail ? ` -> ${detail}` : ''}`);
    failed++;
  }
}

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('   NDC NOTIFICATION PIPELINE HARDENING TEST SUITE             ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Disable test synthetic address skipping for explicit mock tests so mock client receives dispatches
  const originalSkip = process.env.SKIP_NOTIFICATIONS;
  process.env.SKIP_NOTIFICATIONS = 'false';

  try {
    // ─────────────────────────────────────────────────────────────
    // TEST 1: Successful Delivery to Google Apps Script (ACCEPTED)
    // ─────────────────────────────────────────────────────────────
    console.log('Test 1: Successful delivery via Google Apps Script mock');
    NotificationQueueService.resetForTesting();

    let appsScriptCalls = 0;
    emailService.setMockClient({
      appsScript: {
        send: async (payload: any) => {
          appsScriptCalls++;
          return {
            success: true,
            messageId: `gas_msg_${Date.now()}_abc123`,
            remainingQuota: 95
          };
        }
      }
    });

    const job1 = await NotificationQueueService.enqueueClearanceNotification({
      idempotencyKey: 'test_notif_success_1',
      clearanceId: 'clearance_test_1',
      studentId: 'student_test_1',
      usn: '4MC21CS001',
      studentName: 'Alice Smith',
      toEmail: 'alice.smith@university.ac.in',
      departmentName: 'Physics Laboratory',
      departmentCode: 'PHY',
      status: 'CLEARED',
      remarks: 'All physics lab apparatus cleared with no dues',
      source: 'AI_ASSISTANT'
    });

    assert(job1.deliveryStatus === 'QUEUED', 'Job initially created in QUEUED state');
    assert(job1.idempotencyKey === 'test_notif_success_1', 'Idempotency key preserved');

    // Flush queue to process worker synchronously
    await NotificationQueueService.flushQueue();

    const verifiedJob1 = await NotificationQueueService.getJobByIdempotencyKey('test_notif_success_1');
    assert(verifiedJob1?.deliveryStatus === 'ACCEPTED', 'Job transitions to ACCEPTED');
    assert(Boolean(verifiedJob1?.messageId && verifiedJob1.messageId.startsWith('gas_msg_')), 'Valid messageId recorded');
    assert(verifiedJob1?.remainingQuota === 95, 'Apps Script remainingQuota recorded');
    assert(appsScriptCalls === 1, 'Apps Script send called exactly once');

    // ─────────────────────────────────────────────────────────────
    // TEST 2: Deterministic Failure Handling (FAILED)
    // ─────────────────────────────────────────────────────────────
    console.log('\nTest 2: Deterministic provider error handling (FAILED)');
    NotificationQueueService.resetForTesting();

    emailService.setMockClient({
      appsScript: {
        send: async () => {
          return {
            success: false,
            error: 'UNAUTHORIZED: Invalid or missing authentication secret',
            remainingQuota: 90
          };
        }
      }
    });

    const job2 = await NotificationQueueService.enqueueClearanceNotification({
      idempotencyKey: 'test_notif_fail_2',
      clearanceId: 'clearance_test_2',
      studentId: 'student_test_2',
      usn: '4MC21CS002',
      studentName: 'Bob Jones',
      toEmail: 'bob.jones@university.ac.in',
      departmentName: 'Physics Laboratory',
      departmentCode: 'PHY',
      status: 'DUE',
      dueAmount: 250,
      dueDetails: 'Optical grating damaged',
      source: 'LOGBOOK_OCR'
    });

    await NotificationQueueService.flushQueue();

    const verifiedJob2 = await NotificationQueueService.getJobByIdempotencyKey('test_notif_fail_2');
    assert(verifiedJob2?.deliveryStatus === 'FAILED', 'Deterministic error transitions job to FAILED');
    assert(Boolean(verifiedJob2?.lastError && verifiedJob2.lastError.includes('UNAUTHORIZED')), 'Detailed error message captured');
    assert(verifiedJob2?.attempts === 1, 'Only 1 attempt made for deterministic error');

    // ─────────────────────────────────────────────────────────────
    // TEST 3: HTTP Timeout / Uncertainty Handling (UNCERTAIN & No Blind Retry)
    // ─────────────────────────────────────────────────────────────
    console.log('\nTest 3: HTTP Timeout handling (UNCERTAIN & No Blind Retry)');
    NotificationQueueService.resetForTesting();

    let timeoutCalls = 0;
    emailService.setMockClient({
      appsScript: {
        send: async () => {
          timeoutCalls++;
          const timeoutErr: any = new Error('The operation was aborted due to timeout.');
          timeoutErr.name = 'AbortError';
          throw timeoutErr;
        }
      }
    });

    const job3 = await NotificationQueueService.enqueueClearanceNotification({
      idempotencyKey: 'test_notif_timeout_3',
      clearanceId: 'clearance_test_3',
      studentId: 'student_test_3',
      usn: '4MC21CS003',
      studentName: 'Charlie Brown',
      toEmail: 'charlie.brown@university.ac.in',
      departmentName: 'Physics Laboratory',
      departmentCode: 'PHY',
      status: 'DUE',
      dueAmount: 500,
      dueDetails: 'Spectrometer prism chipped',
      source: 'AI_ASSISTANT'
    });

    await NotificationQueueService.flushQueue();

    const verifiedJob3 = await NotificationQueueService.getJobByIdempotencyKey('test_notif_timeout_3');
    assert(verifiedJob3?.deliveryStatus === 'UNCERTAIN', 'HTTP timeout correctly marked as UNCERTAIN');
    assert(
      Boolean(verifiedJob3?.lastError && verifiedJob3.lastError.includes('TIMEOUT_ABORTED')),
      'Timeout error reason preserved'
    );
    assert(verifiedJob3?.attempts === 1, 'Crucial check: Blind automatic retry was NOT attempted');
    assert(timeoutCalls === 1, 'Provider was called only once');

    // ─────────────────────────────────────────────────────────────
    // TEST 4: Duplicate Submission Suppression (Idempotency)
    // ─────────────────────────────────────────────────────────────
    console.log('\nTest 4: Duplicate submission suppression using durable idempotency key');
    let duplicateDispatchCalls = 0;
    emailService.setMockClient({
      appsScript: {
        send: async () => {
          duplicateDispatchCalls++;
          return {
            success: true,
            messageId: 'gas_dedup_success_1',
            remainingQuota: 80
          };
        }
      }
    });

    // Enqueue initial notification
    await NotificationQueueService.enqueueClearanceNotification({
      idempotencyKey: 'idempotent_key_dup_4',
      clearanceId: 'clearance_test_4',
      studentId: 'student_test_4',
      usn: '4MC21CS004',
      studentName: 'Dana Scully',
      toEmail: 'dana.scully@university.ac.in',
      departmentName: 'Physics Laboratory',
      status: 'CLEARED',
      source: 'AI_ASSISTANT'
    });

    await NotificationQueueService.flushQueue();
    assert(duplicateDispatchCalls === 1, 'Initial notification dispatched');

    // Attempt second submission with EXACT same idempotencyKey
    const duplicateAttempt = await NotificationQueueService.enqueueClearanceNotification({
      idempotencyKey: 'idempotent_key_dup_4',
      clearanceId: 'clearance_test_4',
      studentId: 'student_test_4',
      usn: '4MC21CS004',
      studentName: 'Dana Scully',
      toEmail: 'dana.scully@university.ac.in',
      departmentName: 'Physics Laboratory',
      status: 'CLEARED',
      source: 'AI_ASSISTANT'
    });

    assert(duplicateAttempt.deduplicated === true, 'Repeated submission marked as deduplicated');
    assert(duplicateAttempt.deliveryStatus === 'ACCEPTED', 'Returns existing ACCEPTED delivery status');
    assert(duplicateDispatchCalls === 1, 'No additional network dispatch made (duplicate prevented)');

    // ─────────────────────────────────────────────────────────────
    // TEST 5: Invalid Recipient Handling (Pre-flight Validation)
    // ─────────────────────────────────────────────────────────────
    console.log('\nTest 5: Invalid recipient address rejection');
    let invalidRecipientNetworkCalls = 0;
    emailService.setMockClient({
      appsScript: {
        send: async () => {
          invalidRecipientNetworkCalls++;
          return { success: true };
        }
      }
    });

    const job5 = await NotificationQueueService.enqueueClearanceNotification({
      idempotencyKey: 'test_notif_invalid_email_5',
      clearanceId: 'clearance_test_5',
      studentId: 'student_test_5',
      usn: '4MC21CS005',
      studentName: 'Invalid Student',
      toEmail: 'not-an-email',
      departmentName: 'Physics Laboratory',
      status: 'DUE',
      dueAmount: 100,
      dueDetails: 'Test',
      source: 'LOGBOOK_OCR'
    });

    assert(job5.deliveryStatus === 'FAILED', 'Invalid email immediately rejected with FAILED status');
    assert(
      Boolean(job5.lastError && job5.lastError.includes('INVALID_RECIPIENT_ADDRESS')),
      'Error indicates invalid recipient address'
    );
    assert(invalidRecipientNetworkCalls === 0, 'No network call attempted for invalid recipient');

    // ─────────────────────────────────────────────────────────────
    // TEST 6: Google Apps Script Quota Exhaustion (QUOTA_EXCEEDED)
    // ─────────────────────────────────────────────────────────────
    console.log('\nTest 6: Apps Script quota exhaustion handling');
    NotificationQueueService.resetForTesting();
    NotificationQueueService.setRemainingQuotaForTesting(0); // Quota exhausted

    let quotaDispatchCalls = 0;
    emailService.setMockClient({
      appsScript: {
        send: async () => {
          quotaDispatchCalls++;
          return {
            success: false,
            error: 'QUOTA_EXCEEDED: Google daily email limit reached',
            remainingQuota: 0
          };
        }
      }
    });

    const job6 = await NotificationQueueService.enqueueClearanceNotification({
      idempotencyKey: 'test_notif_quota_6',
      clearanceId: 'clearance_test_6',
      studentId: 'student_test_6',
      usn: '4MC21CS006',
      studentName: 'Frank Castle',
      toEmail: 'frank.castle@university.ac.in',
      departmentName: 'Physics Laboratory',
      status: 'DUE',
      dueAmount: 150,
      dueDetails: 'Vernier caliper damaged',
      source: 'AI_ASSISTANT'
    });

    await NotificationQueueService.flushQueue();

    const verifiedJob6 = await NotificationQueueService.getJobByIdempotencyKey('test_notif_quota_6');
    assert(verifiedJob6?.deliveryStatus === 'FAILED', 'Quota exhausted job marked FAILED');
    assert(
      Boolean(verifiedJob6?.lastError && verifiedJob6.lastError.includes('QUOTA_EXCEEDED')),
      'Error reason indicates QUOTA_EXCEEDED'
    );
    assert(quotaDispatchCalls === 0, 'Did not dispatch to network when quota was already 0');

    // ─────────────────────────────────────────────────────────────
    // TEST 7: Decoupled Outbox - DB Mutation Survives Notification Failure
    // ─────────────────────────────────────────────────────────────
    console.log('\nTest 7: Decoupled Outbox - Database mutation independence');
    NotificationQueueService.resetForTesting();

    // Verify mock clearance in DB if available, or simulate DueManagementService logic
    emailService.setMockClient({
      appsScript: {
        send: async () => {
          throw new Error('Apps Script 503 Service Unavailable');
        }
      }
    });

    const clearance = await prisma.ndcClearance.findFirst({
      where: { labId: { not: null } },
      include: { department: true, lab: true, student: true }
    });

    if (clearance) {
      const officer = await prisma.user.findFirst({
        where: { role: 'SUPER_ADMIN' }
      });

      if (officer) {
        const uniqueReason = `Apparatus verification test #${Date.now()}`;
        const recordDueResult = await DueManagementService.recordClearanceDue({
          clearanceId: clearance.id,
          amount: 50,
          reason: uniqueReason,
          officerUserId: officer.id,
          source: 'AI_ASSISTANT',
          conflictStrategy: 'ACCUMULATE'
        });

        assert(recordDueResult.success === true, 'Database due mutation succeeded');
        assert(recordDueResult.newDueAmount >= 50, 'New due amount persisted in database');
        assert(recordDueResult.notification !== undefined, 'Notification object returned in response');

        // Flush worker where email dispatch throws 503
        await NotificationQueueService.flushQueue();

        // Verify the database record STILL has the due! Email failure did NOT roll back the DB mutation!
        const verifiedDbClearance = await prisma.ndcClearance.findUnique({
          where: { id: clearance.id }
        });

        assert(
          verifiedDbClearance?.status === 'DUE',
          'Database record status remained DUE despite email notification failure'
        );
        assert(
          Boolean(verifiedDbClearance?.dueDetails && verifiedDbClearance.dueDetails.includes(uniqueReason)),
          'Due reason was durably preserved in PostgreSQL'
        );
      } else {
        console.log('  ⚠ Skipped live DB mutation sub-test: No super admin user found.');
      }
    } else {
      console.log('  ⚠ Skipped live DB mutation sub-test: No lab clearance found in DB.');
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`TEST SUMMARY: ${passed} Passed, ${failed} Failed`);
    console.log('═══════════════════════════════════════════════════════════════');

    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    process.env.SKIP_NOTIFICATIONS = originalSkip;
    emailService.clearMockClient();
  }
}

runTests().catch((err) => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
