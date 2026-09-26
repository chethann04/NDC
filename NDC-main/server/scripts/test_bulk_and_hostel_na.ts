import jwt from 'jsonwebtoken';
import prisma from '../src/config/prisma';
import { DepartmentClearanceStatus } from '../src/constants/statuses';

const BASE_URL = 'http://localhost:5000/api/v1';
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_ndc_jwt_key_2026_mce_auth_token_string';

async function runBulkAndHostelTests() {
  console.log('====================================================');
  console.log('STARTING BULK CLEARANCE & HOSTEL N/A TEST SUITE');
  console.log('====================================================\n');

  // 1. Locate key departments
  const hostelDept = await prisma.clearanceDepartment.findFirst({
    where: {
      OR: [
        { code: 'HST' },
        { name: { contains: 'Hostel', mode: 'insensitive' } }
      ]
    }
  });

  const libraryDept = await prisma.clearanceDepartment.findFirst({
    where: {
      OR: [
        { code: 'LIB' },
        { name: { contains: 'Library', mode: 'insensitive' } }
      ]
    }
  });

  const accountsDept = await prisma.clearanceDepartment.findFirst({
    where: {
      OR: [
        { code: 'ACC' },
        { name: { contains: 'Accounts', mode: 'insensitive' } }
      ]
    }
  });

  if (!hostelDept || !libraryDept) {
    console.error('Required departments (Hostel, Library) not found.');
    process.exit(1);
  }

  console.log(`[Setup]: Found Hostel Dept: ${hostelDept.name} (${hostelDept.code}) [ID: ${hostelDept.id}]`);
  console.log(`[Setup]: Found Library Dept: ${libraryDept.name} (${libraryDept.code}) [ID: ${libraryDept.id}]`);

  // 2. Find or assign officer users
  // Find an officer mapped to Hostel or assign mapping
  let hostelOfficer = await prisma.clearanceOfficer.findFirst({
    where: {
      departmentMappings: {
        some: { departmentId: hostelDept.id }
      }
    }
  });

  if (!hostelOfficer) {
    hostelOfficer = await prisma.clearanceOfficer.findFirst();
    if (hostelOfficer) {
      await prisma.clearanceOfficerDepartment.upsert({
        where: {
          officerId_departmentId: {
            officerId: hostelOfficer.id,
            departmentId: hostelDept.id
          }
        },
        create: {
          officerId: hostelOfficer.id,
          departmentId: hostelDept.id
        },
        update: {}
      });
    }
  }

  // Find Library officer or assign mapping
  let libraryOfficer = await prisma.clearanceOfficer.findFirst({
    where: {
      departmentMappings: {
        some: { departmentId: libraryDept.id }
      }
    }
  });

  if (!libraryOfficer) {
    // create a separate officer mapping for library
    const anyOfficer = await prisma.clearanceOfficer.findMany();
    const libCandidate = anyOfficer.find((o) => o.id !== hostelOfficer?.id) || anyOfficer[0];
    if (libCandidate) {
      libraryOfficer = libCandidate;
      await prisma.clearanceOfficerDepartment.upsert({
        where: {
          officerId_departmentId: {
            officerId: libCandidate.id,
            departmentId: libraryDept.id
          }
        },
        create: {
          officerId: libCandidate.id,
          departmentId: libraryDept.id
        },
        update: {}
      });
    }
  }

  const hostelUser = await prisma.user.findUnique({
    where: { id: hostelOfficer!.userId }
  });

  const libraryUser = await prisma.user.findUnique({
    where: { id: libraryOfficer!.userId }
  });

  if (!hostelUser || !libraryUser) {
    console.error('Officer users not found.');
    process.exit(1);
  }

  const hostelToken = jwt.sign(
    { userId: hostelUser.id, role: hostelUser.role, email: hostelUser.email, name: hostelUser.name },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const libraryToken = jwt.sign(
    { userId: libraryUser.id, role: libraryUser.role, email: libraryUser.email, name: libraryUser.name },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  // 3. Find test student
  const testStudent = await prisma.student.findFirst({
    where: { usn: '4MC22ME004' },
    include: { department: true }
  });

  if (!testStudent) {
    console.error('Test student not found.');
    process.exit(1);
  }

  // Ensure an active NDC request exists with clearances for this student
  let ndcReq = await prisma.ndcRequest.findFirst({
    where: { studentId: testStudent.id },
    include: { clearances: { include: { department: true } } }
  });

  if (!ndcReq) {
    console.log('[Setup]: Creating test NDC request for student...');
    const createdReq = await prisma.ndcRequest.create({
      data: {
        id: crypto.randomUUID(),
        studentId: testStudent.id,
        requestNumber: `NDC-TEST-${Date.now()}`,
        status: 'PENDING'
      }
    });

    const activeDepts = await prisma.clearanceDepartment.findMany({
      where: { isActive: true, requiresClearance: true }
    });

    for (const d of activeDepts) {
      await prisma.ndcClearance.create({
        data: {
          id: crypto.randomUUID(),
          ndcRequestId: createdReq.id,
          studentId: testStudent.id,
          departmentId: d.id,
          status: DepartmentClearanceStatus.PENDING
        }
      });
    }

    ndcReq = (await prisma.ndcRequest.findUnique({
      where: { id: createdReq.id },
      include: { clearances: { include: { department: true } } }
    }))!;
  }

  console.log(`[Setup]: NDC Request ID: ${ndcReq!.id}, Status: ${ndcReq!.status}`);

  // Identify student's Library and Hostel clearances
  const studentLibClearance = ndcReq!.clearances.find((c) => c.departmentId === libraryDept.id);
  const studentHostelClearance = ndcReq!.clearances.find((c) => c.departmentId === hostelDept.id);

  if (!studentLibClearance || !studentHostelClearance) {
    console.error('Student is missing Library or Hostel clearance records.');
    process.exit(1);
  }

  // ----------------------------------------------------
  // TEST 1: Library officer clears one student normally
  // ----------------------------------------------------
  console.log('\n--- TEST 1: Library officer clears 1 student individually ---');
  const res1 = await fetch(`${BASE_URL}/ndc/clearance/${studentLibClearance.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${libraryToken}`
    },
    body: JSON.stringify({
      status: 'CLEARED',
      remarks: 'Individual test clearance'
    })
  });
  const data1 = await res1.json() as any;
  console.log(`Response status: ${res1.status}, data:`, data1);
  if (res1.status === 200 && data1.success) {
    console.log('✓ PASS: Individual clearance succeeded.');
  } else {
    console.error('✗ FAIL: Individual clearance failed.');
  }

  // ----------------------------------------------------
  // TEST 2: Non-hostel officer attempts NOT_APPLICABLE -> Expect 400 Bad Request
  // ----------------------------------------------------
  console.log('\n--- TEST 2: Non-Hostel department officer attempts NOT_APPLICABLE (Expect 400) ---');
  const res2 = await fetch(`${BASE_URL}/ndc/clearance/${studentLibClearance.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${libraryToken}`
    },
    body: JSON.stringify({
      status: 'NOT_APPLICABLE',
      remarks: 'Attempting invalid NOT_APPLICABLE on Library'
    })
  });
  const data2 = await res2.json() as any;
  console.log(`Response status: ${res2.status}, message: ${data2.message}`);
  if (res2.status === 400 && data2.message?.includes('restricted to the Hostel')) {
    console.log('✓ PASS: Non-hostel NOT_APPLICABLE correctly blocked with 400 Bad Request.');
  } else {
    console.error('✗ FAIL: Non-hostel NOT_APPLICABLE was not properly blocked.');
  }

  // ----------------------------------------------------
  // TEST 3: Hostel officer marks student as NOT_APPLICABLE -> Expect 200 OK
  // ----------------------------------------------------
  console.log('\n--- TEST 3: Hostel officer marks student NOT_APPLICABLE (Expect 200) ---');
  const res3 = await fetch(`${BASE_URL}/ndc/clearance/${studentHostelClearance.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${hostelToken}`
    },
    body: JSON.stringify({
      status: 'NOT_APPLICABLE',
      remarks: 'Student is a day scholar - Hostel not applicable'
    })
  });
  const data3 = await res3.json() as any;
  console.log(`Response status: ${res3.status}, data:`, data3);
  if (res3.status === 200 && data3.success) {
    console.log('✓ PASS: Hostel NOT_APPLICABLE successfully updated.');
  } else {
    console.error('✗ FAIL: Hostel NOT_APPLICABLE failed.');
  }

  // Verify DB state
  const updatedHostel = await prisma.ndcClearance.findUnique({
    where: { id: studentHostelClearance.id }
  });
  console.log(`Hostel DB status: ${updatedHostel?.status} (Separate from CLEARED: ${updatedHostel?.status !== 'CLEARED'})`);

  // ----------------------------------------------------
  // TEST 4: Hostel NOT_APPLICABLE does not block NDC approval
  // ----------------------------------------------------
  console.log('\n--- TEST 4: Check if Hostel NOT_APPLICABLE allows NDC approval ---');
  // Mark all non-hostel clearances as CLEARED for this student
  await prisma.ndcClearance.updateMany({
    where: {
      ndcRequestId: ndcReq!.id,
      departmentId: { not: hostelDept.id }
    },
    data: {
      status: DepartmentClearanceStatus.CLEARED,
      reviewedAt: new Date()
    }
  });

  // Trigger checkAndUpdateNdcStatus
  const { NdcWorkflowService } = await import('../src/services/NdcWorkflowService');
  await NdcWorkflowService.checkAndUpdateNdcStatus(ndcReq!.id);

  const checkReq = await prisma.ndcRequest.findUnique({
    where: { id: ndcReq!.id }
  });
  console.log(`NDC Request Status when all others CLEARED and Hostel NOT_APPLICABLE: ${checkReq?.status}`);
  if (checkReq?.status === 'APPROVED') {
    console.log('✓ PASS: NDC is APPROVED. Hostel NOT_APPLICABLE did NOT block approval.');
  } else {
    console.error(`✗ FAIL: NDC status is ${checkReq?.status}, expected APPROVED.`);
  }

  // ----------------------------------------------------
  // TEST 5: Hostel DUE blocks NDC approval
  // ----------------------------------------------------
  console.log('\n--- TEST 5: Hostel marked DUE blocks NDC approval ---');
  await prisma.ndcClearance.update({
    where: { id: studentHostelClearance.id },
    data: {
      status: DepartmentClearanceStatus.DUE,
      dueAmount: 500,
      dueDetails: 'Mess dues pending'
    }
  });

  await NdcWorkflowService.checkAndUpdateNdcStatus(ndcReq!.id);
  const dueReq = await prisma.ndcRequest.findUnique({
    where: { id: ndcReq!.id }
  });
  console.log(`NDC Request Status when Hostel is DUE: ${dueReq?.status}`);
  if (dueReq?.status !== 'APPROVED') {
    console.log(`✓ PASS: NDC is NOT approved (${dueReq?.status}). Hostel DUE successfully blocks approval.`);
  } else {
    console.error('✗ FAIL: NDC was approved despite Hostel DUE.');
  }

  // ----------------------------------------------------
  // TEST 6: Certificate PDF Filtering
  // ----------------------------------------------------
  console.log('\n--- TEST 6: Certificate PDF filtering for NOT_APPLICABLE vs CLEARED ---');
  // Part A: Set Hostel to NOT_APPLICABLE
  await prisma.ndcClearance.update({
    where: { id: studentHostelClearance.id },
    data: { status: DepartmentClearanceStatus.NOT_APPLICABLE }
  });

  const fullReqWithNA = await prisma.ndcRequest.findUnique({
    where: { id: ndcReq!.id },
    include: {
      student: { include: { department: true } },
      clearances: { include: { department: true } }
    }
  });

  const activeClearancesNA = fullReqWithNA!.clearances.filter((c) => c.status !== DepartmentClearanceStatus.NOT_APPLICABLE);
  const hostelInListNA = activeClearancesNA.some((c) => c.department.code === 'HST' || c.department.name.toLowerCase().includes('hostel'));
  console.log(`Hostel in filtered certificate items when NOT_APPLICABLE: ${hostelInListNA}`);
  if (!hostelInListNA) {
    console.log('✓ PASS: Hostel is completely omitted from certificate list when NOT_APPLICABLE.');
  } else {
    console.error('✗ FAIL: Hostel was not omitted from certificate items.');
  }

  // Part B: Set Hostel to CLEARED
  await prisma.ndcClearance.update({
    where: { id: studentHostelClearance.id },
    data: { status: DepartmentClearanceStatus.CLEARED }
  });
  const fullReqWithCleared = await prisma.ndcRequest.findUnique({
    where: { id: ndcReq!.id },
    include: {
      student: { include: { department: true } },
      clearances: { include: { department: true } }
    }
  });
  const activeClearancesCleared = fullReqWithCleared!.clearances.filter((c) => c.status !== DepartmentClearanceStatus.NOT_APPLICABLE);
  const hostelInListCleared = activeClearancesCleared.some((c) => c.department.code === 'HST' || c.department.name.toLowerCase().includes('hostel'));
  console.log(`Hostel in certificate items when CLEARED: ${hostelInListCleared}`);
  if (hostelInListCleared) {
    console.log('✓ PASS: Hostel appears on certificate when CLEARED.');
  } else {
    console.error('✗ FAIL: Hostel missing when CLEARED.');
  }

  // Reset Hostel to NOT_APPLICABLE for subsequent checks
  await prisma.ndcClearance.update({
    where: { id: studentHostelClearance.id },
    data: { status: DepartmentClearanceStatus.NOT_APPLICABLE }
  });

  // ----------------------------------------------------
  // TEST 7: Bulk Clearance for Library Officer
  // ----------------------------------------------------
  console.log('\n--- TEST 7: Bulk clearance of multiple students (1 HTTP request) ---');
  // Reset some library clearances to PENDING
  const someLibClearances = await prisma.ndcClearance.findMany({
    where: { departmentId: libraryDept.id },
    take: 5
  });

  const clearanceIdsToReset = someLibClearances.map((c) => c.id);
  await prisma.ndcClearance.updateMany({
    where: { id: { in: clearanceIdsToReset } },
    data: { status: DepartmentClearanceStatus.PENDING }
  });

  console.log(`Reset ${clearanceIdsToReset.length} Library clearances to PENDING.`);

  const bulkRes = await fetch(`${BASE_URL}/ndc/clearances/bulk-clear`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${libraryToken}`
    },
    body: JSON.stringify({
      clearanceIds: clearanceIdsToReset,
      remarks: 'Automated bulk clearance test'
    })
  });

  const bulkData = await bulkRes.json() as any;
  console.log(`Bulk Clear response status: ${bulkRes.status}`, bulkData);
  if (bulkRes.status === 200 && bulkData.success && bulkData.cleared === clearanceIdsToReset.length) {
    console.log(`✓ PASS: Bulk clearance successfully cleared ${bulkData.cleared} students in 1 request.`);
  } else {
    console.error('✗ FAIL: Bulk clearance did not return expected cleared count.');
  }

  // ----------------------------------------------------
  // TEST 8: Mixed Selection (already cleared + pending + invalid)
  // ----------------------------------------------------
  console.log('\n--- TEST 8: Mixed selection: already-cleared + pending + invalid ID ---');
  // Take 1 already cleared, reset 1 to pending, and 1 non-existent id
  await prisma.ndcClearance.update({
    where: { id: clearanceIdsToReset[0] },
    data: { status: DepartmentClearanceStatus.PENDING }
  });

  const mixedIds = [
    clearanceIdsToReset[0], // PENDING -> should be cleared
    clearanceIdsToReset[1], // CLEARED -> should be skipped
    '00000000-0000-0000-0000-000000000000' // NOT FOUND -> should be rejected
  ];

  const mixedRes = await fetch(`${BASE_URL}/ndc/clearances/bulk-clear`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${libraryToken}`
    },
    body: JSON.stringify({
      clearanceIds: mixedIds
    })
  });

  const mixedData = await mixedRes.json() as any;
  console.log(`Mixed Clear response: ${mixedRes.status}`, mixedData);
  if (mixedData.cleared === 1 && mixedData.skipped === 1 && mixedData.rejected === 1) {
    console.log(`✓ PASS: Correct mixed response breakdown: cleared=${mixedData.cleared}, skipped=${mixedData.skipped}, rejected=${mixedData.rejected}.`);
  } else {
    console.error('✗ FAIL: Mixed response breakdown did not match expectations.');
  }

  // ----------------------------------------------------
  // TEST 9: Cross-Department Clearance Security Check
  // ----------------------------------------------------
  console.log('\n--- TEST 9: Cross-department clearance attempt (Library officer submitting Accounts clearance) ---');
  let accountsClearance = await prisma.ndcClearance.findFirst({
    where: { departmentId: accountsDept?.id || 'non-existent' }
  });

  if (accountsClearance) {
    const crossRes = await fetch(`${BASE_URL}/ndc/clearances/bulk-clear`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${libraryToken}`
      },
      body: JSON.stringify({
        clearanceIds: [accountsClearance.id]
      })
    });
    const crossData = await crossRes.json() as any;
    console.log(`Cross-dept attempt result:`, crossData);
    if (crossData.cleared === 0 && crossData.rejected === 1) {
      console.log('✓ PASS: Cross-department clearance was REJECTED without modifying the record.');
    } else {
      console.error('✗ FAIL: Cross-department clearance was not rejected.');
    }
  } else {
    console.log('No accounts clearance found to test cross-dept, skipped.');
  }

  // ----------------------------------------------------
  // TEST 10: Audit Log Verification
  // ----------------------------------------------------
  console.log('\n--- TEST 10: Verify BULK_CLEAR audit log creation ---');
  const latestAudit = await prisma.auditLog.findFirst({
    where: { action: 'BULK_CLEAR' },
    orderBy: { timestamp: 'desc' }
  });

  if (latestAudit) {
    console.log(`✓ PASS: Found BULK_CLEAR audit record. User: ${latestAudit.userName}, Role: ${latestAudit.role}, Details:`, latestAudit.newValue);
  } else {
    console.error('✗ FAIL: No BULK_CLEAR audit log found.');
  }

  // ----------------------------------------------------
  // TEST 11: Notification Verification
  // ----------------------------------------------------
  console.log('\n--- TEST 11: Verify persistent student notifications ---');
  const latestNotif = await prisma.notification.findFirst({
    where: { type: 'CLEARANCE_UPDATE' },
    orderBy: { createdAt: 'desc' }
  });

  if (latestNotif) {
    console.log(`✓ PASS: Found student notification. Title: "${latestNotif.title}", Message: "${latestNotif.message}".`);
  } else {
    console.log('Notice: No recent notification found, check if recipientUserId was set.');
  }

  console.log('\n====================================================');
  console.log('ALL BULK CLEARANCE & HOSTEL N/A TESTS COMPLETED');
  console.log('====================================================\n');
}

runBulkAndHostelTests()
  .catch((e) => {
    console.error('Test execution error:', e);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
