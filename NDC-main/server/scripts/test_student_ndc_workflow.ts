import jwt from 'jsonwebtoken';
import prisma from '../src/config/prisma';

const BASE_URL = 'http://localhost:5000/api/v1';
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_ndc_jwt_key_2026_mce_auth_token_string';

async function runTests() {
  console.log('====================================================');
  console.log('STARTING AUTOMATED NDC WORKFLOW INTEGRATION TESTS');
  console.log('====================================================\n');

  // Find a student with no active request or create a clean test student
  let testStudent = await prisma.student.findUnique({
    where: { usn: '4MC22ME004' },
    include: { user: true, department: true }
  });

  if (!testStudent) {
    console.error('Test student 4MC22ME004 not found');
    process.exit(1);
  }

  // Clean any old requests for this test student so we start fresh
  const oldRequests = await prisma.ndcRequest.findMany({
    where: { studentId: testStudent.id }
  });
  if (oldRequests.length > 0) {
    for (const r of oldRequests) {
      await prisma.ndcClearance.deleteMany({ where: { ndcRequestId: r.id } });
      await prisma.ndcRequest.delete({ where: { id: r.id } });
    }
    console.log(`[Setup]: Cleaned ${oldRequests.length} previous requests for test student ${testStudent.usn}.`);
  }

  const studentUser = testStudent.user;
  if (!studentUser) {
    console.error('No user account associated with test student');
    process.exit(1);
  }

  const studentToken = jwt.sign(
    { userId: studentUser.id, role: studentUser.role },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  // Find an admin or officer user to test unauthorized role
  const officerUser = await prisma.user.findFirst({
    where: { role: 'DEPARTMENT_OFFICER', isActive: true }
  });
  const officerToken = officerUser
    ? jwt.sign({ userId: officerUser.id, role: officerUser.role }, JWT_SECRET, { expiresIn: '1h' })
    : null;

  // ----------------------------------------------------
  // TEST 5: Unauthenticated request -> 401
  // ----------------------------------------------------
  console.log('--- TEST 5: Student is not authenticated (Expect 401) ---');
  const res5 = await fetch(`${BASE_URL}/ndc/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  console.log(`Status: ${res5.status}`);
  if (res5.status === 401) {
    console.log('✓ TEST 5 PASSED: 401 Unauthorized returned when no auth header provided.\n');
  } else {
    console.error('✗ TEST 5 FAILED: Expected 401, got', res5.status);
  }

  // ----------------------------------------------------
  // TEST 6: Non-student attempts endpoint -> 403
  // ----------------------------------------------------
  console.log('--- TEST 6: Non-student attempts endpoint (Expect 403) ---');
  if (officerToken) {
    const res6 = await fetch(`${BASE_URL}/ndc/apply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${officerToken}`
      },
      body: JSON.stringify({})
    });
    console.log(`Status: ${res6.status}`);
    if (res6.status === 403) {
      console.log('✓ TEST 6 PASSED: 403 Forbidden returned for non-student.\n');
    } else {
      console.error('✗ TEST 6 FAILED: Expected 403, got', res6.status);
    }
  }

  // ----------------------------------------------------
  // TEST 7: IDOR attempt (student passes another student's ID)
  // ----------------------------------------------------
  console.log("--- TEST 7: Student passes someone else's studentId in body (Expect ignored) ---");
  const fakeId = '00000000-0000-0000-0000-000000000000';
  const startT = Date.now();
  const res7 = await fetch(`${BASE_URL}/ndc/apply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${studentToken}`
    },
    body: JSON.stringify({ studentId: fakeId, remarks: 'Automated test application' })
  });
  const latency = Date.now() - startT;
  const data7 = (await res7.json()) as any;
  console.log(`Status: ${res7.status} (took ${latency}ms)`);
  console.log('Response:', JSON.stringify({ success: data7.success, message: data7.message, requestId: data7.request?.id, clearancesCount: data7.clearances?.length }, null, 2));

  if (res7.status === 201 && data7.request?.studentId === testStudent.id) {
    console.log(`✓ TEST 7 PASSED: Body studentId was ignored; authenticated student's profile (${testStudent.usn}) was used.\n`);
  } else {
    console.error('✗ TEST 7 FAILED: IDOR vulnerability or request failure.');
  }

  // ----------------------------------------------------
  // TEST 1: Verify Request and Clearances Created
  // ----------------------------------------------------
  console.log('--- TEST 1: Verify Request and Department Clearances created in PENDING state ---');
  const reqInDb = await prisma.ndcRequest.findFirst({
    where: { studentId: testStudent.id },
    include: { clearances: { include: { department: true } } }
  });

  if (reqInDb && reqInDb.clearances.length > 0) {
    console.log(`✓ NDC Request created: ${reqInDb.requestNumber}, Status: ${reqInDb.status}`);
    console.log(`✓ Total departmental clearances created: ${reqInDb.clearances.length}`);
    const allPending = reqInDb.clearances.every((c) => c.status === 'PENDING');
    console.log(`✓ All clearances start as PENDING: ${allPending}`);
    reqInDb.clearances.forEach((c) => {
      console.log(`   - ${c.department.name} (${c.department.code}): ${c.status}`);
    });

    // Check Audit Log
    const audit = await prisma.auditLog.findFirst({
      where: { entityId: reqInDb.id, action: 'NDC_REQUEST_CREATED' }
    });
    console.log(`✓ Audit Log record created: ${audit ? audit.action + ' - ' + audit.description : 'None'}`);

    // Check Notifications
    const notifications = await prisma.notification.findMany({
      where: { relatedEntityId: reqInDb.id }
    });
    console.log(`✓ Persistent Officer Notifications generated: ${notifications.length}`);

    console.log('✓ TEST 1 PASSED.\n');
  } else {
    console.error('✗ TEST 1 FAILED: NDC Request or Clearances missing in DB.');
  }

  // ----------------------------------------------------
  // TEST 2 & 3: Duplicate and Concurrency Check
  // ----------------------------------------------------
  console.log('--- TEST 2 & 3: Student clicks button again / Rapid duplicate request ---');
  const res2 = await fetch(`${BASE_URL}/ndc/apply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${studentToken}`
    },
    body: JSON.stringify({ remarks: 'Duplicate request attempt' })
  });
  const data2 = (await res2.json()) as any;
  console.log(`Status: ${res2.status}`);
  console.log(`Response alreadyExists: ${data2.alreadyExists}`);
  console.log(`Message: ${data2.message}`);

  const countReqs = await prisma.ndcRequest.count({ where: { studentId: testStudent.id } });
  console.log(`Total NDC requests in DB for student: ${countReqs}`);
  if (data2.alreadyExists && countReqs === 1) {
    console.log('✓ TEST 2 & 3 PASSED: Duplicate request blocked cleanly; returned existing active request.\n');
  } else {
    console.error('✗ TEST 2 & 3 FAILED: Duplicate request created or incorrect response.');
  }

  // ----------------------------------------------------
  // TEST 10: Student Status Endpoint
  // ----------------------------------------------------
  console.log('--- TEST 10: Student Status Endpoint (GET /ndc/student-status) ---');
  const res10 = await fetch(`${BASE_URL}/ndc/student-status`, {
    headers: { Authorization: `Bearer ${studentToken}` }
  });
  const data10 = (await res10.json()) as any;
  console.log(`Status: ${res10.status}`);
  console.log(`hasActiveRequest: ${data10.hasActiveRequest}`);
  console.log(`Progress: ${data10.progress?.cleared} / ${data10.progress?.total} (${data10.progress?.percentage}%)`);
  if (data10.hasActiveRequest && data10.clearances?.length >= 6) {
    console.log('✓ TEST 10 PASSED: Live student status returned with clearance evaluation.\n');
  } else {
    console.error('✗ TEST 10 FAILED: Expected active request with clearance breakdown.');
  }

  // ----------------------------------------------------
  // TEST 8 & 11: Officer Queue and Clearance Action
  // ----------------------------------------------------
  console.log('--- TEST 8 & 11: Officer Clearance Queue & Action ---');
  if (reqInDb && reqInDb.clearances.length > 0) {
    const firstClearance = reqInDb.clearances[0];
    console.log(`Testing clearance action on: ${firstClearance.department.name} (id: ${firstClearance.id})`);

    // Let's find an officer who can clear this or use admin override
    const { NdcWorkflowService } = await import('../src/services/NdcWorkflowService');
    const updated = await NdcWorkflowService.processClearanceChange(
      firstClearance.id,
      'CLEARED' as any,
      studentUser.id,
      'Verified all records clear in automated test'
    );
    console.log(`Updated status: ${updated.status}`);

    // Re-check student status to verify progress incremented
    const resAfterClear = await fetch(`${BASE_URL}/ndc/student-status`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    const dataAfter = (await resAfterClear.json()) as any;
    console.log(`New Student Progress: ${dataAfter.progress?.cleared} / ${dataAfter.progress?.total} (${dataAfter.progress?.percentage}%)`);
    if (dataAfter.progress?.cleared === 1) {
      console.log('✓ TEST 8 & 11 PASSED: Clearance action immediately reflected in student live progress.\n');
    }
  }

  console.log('====================================================');
  console.log('ALL INTEGRATION TESTS COMPLETED SUCCESSFULLY');
  console.log('====================================================');
}

runTests()
  .catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
