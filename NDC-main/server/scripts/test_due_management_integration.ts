import prisma from '../src/config/prisma';
import { DepartmentClearanceStatus, NdcRequestStatus } from '../src/constants/statuses';
import { UserRole } from '../src/constants/roles';
import { DueManagementService } from '../src/services/DueManagementService';
import { LogbookScannerService } from '../src/services/LogbookScannerService';
import { LaboratoryAggregationService } from '../src/services/LaboratoryAggregationService';
import { AuditService } from '../src/services/AuditService';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, details?: any) {
  if (condition) {
    console.log(`[PASS] ${testName}`);
    passed++;
  } else {
    console.error(`[FAIL] ${testName}`, details !== undefined ? details : '');
    failed++;
  }
}

async function runDueManagementIntegrationTests() {
  console.log('================================================================');
  console.log('STARTING DUE MANAGEMENT & LOGBOOK INTEGRATION VERIFICATION SUITE');
  console.log('================================================================\n');

  // Find a student with clearances for testing
  const student = await prisma.student.findFirst({
    where: { isActive: true },
    include: {
      ndcClearances: {
        include: {
          department: true,
          lab: true,
          ndcRequest: true
        }
      },
      department: true
    }
  });

  if (!student) {
    throw new Error('No active student found in database for integration test.');
  }

  console.log(`Test student identified: ${student.fullName} (${student.usn}) with ${student.ndcClearances.length} clearances.`);

  // Find or identify an admin / super admin user for authorization tests
  const adminUser = await prisma.user.findFirst({
    where: { role: { in: [UserRole.SUPER_ADMIN, UserRole.ADMIN] }, isActive: true }
  });

  if (!adminUser) {
    throw new Error('No active admin user found for integration tests.');
  }

  // Find a department officer user
  const deptOfficer = await prisma.user.findFirst({
    where: { role: UserRole.DEPARTMENT_OFFICER, isActive: true },
    include: {
      department: true
    }
  });

  const clearanceOfficer = deptOfficer
    ? await prisma.clearanceOfficer.findUnique({
        where: { userId: deptOfficer.id },
        include: { departmentMappings: true }
      })
    : null;

  // Identify Physics, Chemistry and Academic Lab clearances for this student
  const phyClearance = student.ndcClearances.find((c) => c.department?.code === 'PHY');
  const chemClearance = student.ndcClearances.find((c) => c.department?.code === 'CHEM');
  const deptLabClearance = student.ndcClearances.find((c) => c.labId !== null);
  const generalClearance = student.ndcClearances.find((c) => c.department?.code !== 'PHY' && c.department?.code !== 'CHEM');

  const targetClearance = phyClearance || generalClearance || student.ndcClearances[0];
  if (!targetClearance) {
    throw new Error('Student has no clearances available to test.');
  }

  // Save baseline clearance state for clean teardown
  const baselineState = {
    id: targetClearance.id,
    status: targetClearance.status,
    dueAmount: targetClearance.dueAmount,
    dueDetails: targetClearance.dueDetails,
    remarks: targetClearance.remarks,
    reviewedById: targetClearance.reviewedById,
    reviewedAt: targetClearance.reviewedAt,
    ndcRequestId: targetClearance.ndcRequestId
  };

  const baselineNdcRequest = await prisma.ndcRequest.findUnique({
    where: { id: targetClearance.ndcRequestId }
  });

  try {
    // -------------------------------------------------------------
    // TEST 1: Pre-flight validation - Invalid / Non-existent clearance & student
    // -------------------------------------------------------------
    console.log('\n--- TEST 1: Pre-flight Rejection on Invalid Clearance / Student ---');
    let rejectedNonExistent = false;
    try {
      await DueManagementService.recordClearanceDue({
        clearanceId: 'non-existent-clearance-id-99999',
        amount: 250,
        reason: 'Broken Spectrometer',
        officerUserId: adminUser.id,
        source: 'MANUAL_OFFICER'
      });
    } catch (err: any) {
      rejectedNonExistent = err.message.includes('not found in database');
    }
    assert(rejectedNonExistent, 'Rejects non-existent clearance ID');

    let rejectedZeroAmount = false;
    try {
      await DueManagementService.recordClearanceDue({
        clearanceId: targetClearance.id,
        amount: 0,
        reason: 'Valid Reason',
        officerUserId: adminUser.id,
        source: 'MANUAL_OFFICER'
      });
    } catch (err: any) {
      rejectedZeroAmount = err.message.includes('Invalid due amount');
    }
    assert(rejectedZeroAmount, 'Rejects non-positive due amount (amount = 0)');

    let rejectedNegativeAmount = false;
    try {
      await DueManagementService.recordClearanceDue({
        clearanceId: targetClearance.id,
        amount: -50,
        reason: 'Valid Reason',
        officerUserId: adminUser.id,
        source: 'MANUAL_OFFICER'
      });
    } catch (err: any) {
      rejectedNegativeAmount = err.message.includes('Invalid due amount');
    }
    assert(rejectedNegativeAmount, 'Rejects negative due amount (amount = -50)');

    let rejectedEmptyReason = false;
    try {
      await DueManagementService.recordClearanceDue({
        clearanceId: targetClearance.id,
        amount: 100,
        reason: '   ',
        officerUserId: adminUser.id,
        source: 'MANUAL_OFFICER'
      });
    } catch (err: any) {
      rejectedEmptyReason = err.message.includes('reason is required');
    }
    assert(rejectedEmptyReason, 'Rejects blank/whitespace due reason');

    // -------------------------------------------------------------
    // TEST 2: Authorization Revalidation - Unauthorized Officer
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: Officer Department Authorization Revalidation ---');
    if (deptOfficer) {
      const authorizedDeptIds = clearanceOfficer?.departmentMappings?.map((m: any) => m.departmentId) || [];
      if (deptOfficer.departmentId) authorizedDeptIds.push(deptOfficer.departmentId);

      // Find a clearance that this officer is NOT authorized for
      const unauthorizedClearance = student.ndcClearances.find(
        (c) => !authorizedDeptIds.includes(c.departmentId)
      );

      if (unauthorizedClearance) {
        let authRejected = false;
        try {
          await DueManagementService.recordClearanceDue({
            clearanceId: unauthorizedClearance.id,
            amount: 150,
            reason: 'Unauthorized attempt',
            officerUserId: deptOfficer.id,
            source: 'LOGBOOK_OCR'
          });
        } catch (err: any) {
          authRejected = err.message.includes('Unauthorized department clearance operation');
        }
        assert(authRejected, 'Blocks officer from recording dues in an unauthorized department');
      } else {
        console.log('[SKIP] No clearance found outside officer authorized departments');
      }
    }

    // -------------------------------------------------------------
    // TEST 3: Successful Persistence & Verified State Return
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: Successful Due Persistence & Verified Record Return ---');
    // Ensure clean starting state for targetClearance
    await prisma.ndcClearance.update({
      where: { id: targetClearance.id },
      data: {
        status: DepartmentClearanceStatus.CLEARED,
        dueAmount: 0,
        dueDetails: null
      }
    });

    const testAmount1 = 350.50;
    const testReason1 = 'Damaged Vernier Caliper in Physics Lab';
    const dueResult1 = await DueManagementService.recordClearanceDue({
      clearanceId: targetClearance.id,
      amount: testAmount1,
      reason: testReason1,
      officerUserId: adminUser.id,
      source: 'LOGBOOK_OCR',
      idempotencyKey: 'test_key_001',
      conflictStrategy: 'ACCUMULATE'
    });

    assert(dueResult1.success === true, 'Result reports success: true');
    assert(dueResult1.status === DepartmentClearanceStatus.DUE, 'Status transitioned to DUE');
    assert(dueResult1.newDueAmount === testAmount1, `Persisted dueAmount matches exact amount (${testAmount1})`);
    assert(dueResult1.dueDetails === testReason1, 'Persisted dueDetails matches exact reason');
    assert(dueResult1.wasAccumulated === false, 'wasAccumulated is false on initial due');
    assert(dueResult1.usn === student.usn, 'Returned USN matches student USN');

    // Verify in database directly
    const directDbCheck = await prisma.ndcClearance.findUnique({
      where: { id: targetClearance.id }
    });
    assert(directDbCheck?.status === DepartmentClearanceStatus.DUE, 'Direct DB check confirms status: DUE');
    assert(directDbCheck?.dueAmount === testAmount1, `Direct DB check confirms dueAmount: ₹${testAmount1}`);

    // Verify Audit Log was recorded
    const auditEntry = await prisma.auditLog.findFirst({
      where: {
        entityId: targetClearance.id,
        action: 'CLEARANCE_DUE_RECORDED'
      },
      orderBy: { timestamp: 'desc' }
    });
    assert(Boolean(auditEntry), 'Audit log entry written via AuditService for CLEARANCE_DUE_RECORDED');

    // -------------------------------------------------------------
    // TEST 4: Multiple Outstanding Dues & Accumulation (Never Overwrite Silently)
    // -------------------------------------------------------------
    console.log('\n--- TEST 4: Multiple Outstanding Dues & Accumulation ---');
    // Test 4A: With ERROR_ON_EXISTING conflict strategy
    let conflictBlocked = false;
    try {
      await DueManagementService.recordClearanceDue({
        clearanceId: targetClearance.id,
        amount: 200,
        reason: 'Lost Lens',
        officerUserId: adminUser.id,
        source: 'LOGBOOK_OCR',
        conflictStrategy: 'ERROR_ON_EXISTING'
      });
    } catch (err: any) {
      conflictBlocked = err.message.includes('Conflicting existing due of');
    }
    assert(conflictBlocked, 'conflictStrategy: ERROR_ON_EXISTING safely prevents overwrite with error');

    // Test 4B: With ACCUMULATE conflict strategy (Non-destructive aggregation)
    const testAmount2 = 150;
    const testReason2 = 'Late apparatus return penalty';
    const dueResult2 = await DueManagementService.recordClearanceDue({
      clearanceId: targetClearance.id,
      amount: testAmount2,
      reason: testReason2,
      officerUserId: adminUser.id,
      source: 'LOGBOOK_OCR',
      idempotencyKey: 'test_key_002',
      conflictStrategy: 'ACCUMULATE'
    });

    const expectedTotal = Number((testAmount1 + testAmount2).toFixed(2));
    assert(dueResult2.success === true, 'Accumulated due application succeeded');
    assert(dueResult2.wasAccumulated === true, 'wasAccumulated is true on existing due');
    assert(dueResult2.newDueAmount === expectedTotal, `Due amount accumulated non-destructively: ₹${expectedTotal}`);
    assert(
      dueResult2.dueDetails.includes(testReason1) && dueResult2.dueDetails.includes(testReason2),
      'Itemized dueDetails preserves prior reason and appends new due reason'
    );

    // -------------------------------------------------------------
    // TEST 5: Durable Idempotency & Duplicate Submission Prevention
    // -------------------------------------------------------------
    console.log('\n--- TEST 5: Durable Idempotency & Duplicate Submission Prevention ---');
    // Create a temporary ScanJob and ScanJobEntry
    const testScanJob = await prisma.scanJob.create({
      data: {
        lecturerUserId: adminUser.id,
        departmentId: targetClearance.departmentId,
        originalFilename: 'test_logbook_idempotency.jpg',
        fileSize: 12345,
        mimeType: 'image/jpeg',
        totalEntries: 2,
        approvedEntries: 0,
        rejectedEntries: 0,
        appliedEntries: 0,
        failedEntries: 0,
        status: 'REVIEWING'
      }
    });

    const entry1 = await prisma.scanJobEntry.create({
      data: {
        scanJobId: testScanJob.id,
        entryIndex: 1,
        extractedUsn: student.usn,
        correctedUsn: student.usn,
        extractedName: student.fullName,
        matchedStudentId: student.id,
        matchedStudentName: student.fullName,
        extractedAmount: 100,
        extractedReason: 'Test Due 1',
        clearanceId: targetClearance.id,
        status: 'APPROVED'
      }
    });

    const entry2 = await prisma.scanJobEntry.create({
      data: {
        scanJobId: testScanJob.id,
        entryIndex: 2,
        extractedUsn: student.usn,
        correctedUsn: student.usn,
        extractedName: student.fullName,
        matchedStudentId: student.id,
        matchedStudentName: student.fullName,
        extractedAmount: 50,
        extractedReason: 'Test Due 2',
        clearanceId: targetClearance.id,
        status: 'APPROVED'
      }
    });

    // Run applyApprovedEntries first time
    console.log('Running first pass of applyApprovedEntries...');
    const firstPass = await LogbookScannerService.applyApprovedEntries(
      testScanJob.id,
      [entry1.id, entry2.id],
      adminUser.id
    );
    assert(firstPass.appliedCount === 2, `First pass applied 2 entries (got ${firstPass.appliedCount})`);
    assert(firstPass.skippedCount === 0, 'First pass skipped 0 entries');

    const clearanceAfterFirstPass = await prisma.ndcClearance.findUnique({
      where: { id: targetClearance.id }
    });
    const amountAfterFirst = clearanceAfterFirstPass?.dueAmount;

    // Run applyApprovedEntries second time with same entries (idempotency check)
    console.log('Running second pass (duplicate submission) of applyApprovedEntries...');
    const secondPass = await LogbookScannerService.applyApprovedEntries(
      testScanJob.id,
      [entry1.id, entry2.id],
      adminUser.id
    );
    assert(secondPass.appliedCount === 0, 'Second pass applied 0 new entries');
    assert(secondPass.skippedCount === 2, `Second pass skipped 2 already-applied entries (got ${secondPass.skippedCount})`);

    const clearanceAfterSecondPass = await prisma.ndcClearance.findUnique({
      where: { id: targetClearance.id }
    });
    assert(
      clearanceAfterSecondPass?.dueAmount === amountAfterFirst,
      'Clearance dueAmount unchanged on duplicate apply submission'
    );

    // -------------------------------------------------------------
    // TEST 6: Job Recovery & Partial Failure Handling
    // -------------------------------------------------------------
    console.log('\n--- TEST 6: Job Recovery & Interruption Handling ---');
    // Add a 3rd entry to testScanJob that has an invalid clearanceId (will fail)
    const entry3 = await prisma.scanJobEntry.create({
      data: {
        scanJobId: testScanJob.id,
        entryIndex: 3,
        extractedUsn: 'INVALID_USN_999',
        extractedName: 'Unknown Student',
        extractedAmount: 75,
        extractedReason: 'Invalid student due',
        clearanceId: null, // missing clearance
        status: 'APPROVED'
      }
    });

    const recoveryPass1 = await LogbookScannerService.applyApprovedEntries(
      testScanJob.id,
      [entry1.id, entry2.id, entry3.id],
      adminUser.id
    );
    assert(recoveryPass1.failedCount === 1, 'Failed entry handled cleanly without throwing error');
    assert(recoveryPass1.skippedCount === 2, 'Previously applied entries remain safely skipped');

    // Now simulate officer correcting the failed entry in review UI
    await prisma.scanJobEntry.update({
      where: { id: entry3.id },
      data: {
        correctedUsn: student.usn,
        matchedStudentId: student.id,
        matchedStudentName: student.fullName,
        clearanceId: targetClearance.id,
        status: 'APPROVED',
        errorMessage: null
      }
    });

    // Run recovery pass
    const recoveryPass2 = await LogbookScannerService.applyApprovedEntries(
      testScanJob.id,
      [entry1.id, entry2.id, entry3.id],
      adminUser.id
    );
    assert(recoveryPass2.appliedCount === 1, 'Recovered entry was successfully applied');
    assert(recoveryPass2.skippedCount === 2, 'Existing entries remained safely skipped');

    // -------------------------------------------------------------
    // TEST 7: Lab Hierarchy Isolation & Dynamic Aggregation
    // -------------------------------------------------------------
    console.log('\n--- TEST 7: Laboratory Isolation & Aggregate Clearance Behavior ---');
    if (phyClearance && chemClearance) {
      console.log(`Testing with Physics (${phyClearance.id}) and Chemistry (${chemClearance.id})`);

      // Reset both to CLEARED
      await prisma.ndcClearance.update({
        where: { id: phyClearance.id },
        data: { status: DepartmentClearanceStatus.CLEARED, dueAmount: 0, dueDetails: null }
      });
      await prisma.ndcClearance.update({
        where: { id: chemClearance.id },
        data: { status: DepartmentClearanceStatus.CLEARED, dueAmount: 0, dueDetails: null }
      });
      if (deptLabClearance) {
        await prisma.ndcClearance.update({
          where: { id: deptLabClearance.id },
          data: { status: DepartmentClearanceStatus.CLEARED, dueAmount: 0, dueDetails: null }
        });
      }

      // Record a due ONLY on Physics Lab
      const phyDue = await DueManagementService.recordClearanceDue({
        clearanceId: phyClearance.id,
        amount: 500,
        reason: 'Broken Spectrometer in Optics Darkroom',
        officerUserId: adminUser.id,
        source: 'LOGBOOK_OCR'
      });

      // Verify Physics Lab is DUE
      assert(phyDue.status === DepartmentClearanceStatus.DUE, 'Physics Lab clearance status is DUE');
      assert(phyDue.newDueAmount === 500, 'Physics Lab dueAmount is 500');

      // Verify Chemistry Lab is UNCHANGED
      const verifyChem = await prisma.ndcClearance.findUnique({
        where: { id: chemClearance.id }
      });
      assert(verifyChem?.status === DepartmentClearanceStatus.CLEARED, 'Chemistry Lab remains CLEARED (unaffected by Physics due)');
      assert(verifyChem?.dueAmount === 0, 'Chemistry Lab dueAmount remains 0');

      // Verify Department Lab is UNCHANGED (if exists)
      if (deptLabClearance) {
        const verifyDeptLab = await prisma.ndcClearance.findUnique({
          where: { id: deptLabClearance.id }
        });
        assert(verifyDeptLab?.status === DepartmentClearanceStatus.CLEARED, 'Department Lab remains CLEARED (unaffected by Physics due)');
      }

      // Check dynamic Laboratory aggregation
      const studentClearances = await prisma.ndcClearance.findMany({
        where: { studentId: student.id },
        include: { department: true, lab: true }
      });

      const labSummary = LaboratoryAggregationService.getLaboratoryClearanceSummary(studentClearances as any);
      assert(labSummary.status === DepartmentClearanceStatus.DUE, 'Aggregated Laboratory status is DUE');
      assert(labSummary.totalDueAmount === 500, 'Aggregated Laboratory dueAmount reflects Physics due (₹500)');
      assert(
        labSummary.dueLabs.some((l) => l.code === 'PHY'),
        'Aggregated dueLabs lists Physics Lab'
      );
      assert(
        !labSummary.dueLabs.some((l) => l.code === 'CHEM'),
        'Aggregated dueLabs does NOT list Chemistry Lab'
      );
    } else {
      console.log('[SKIP] Student does not have both PHY and CHEM clearances to test isolation');
    }

    // -------------------------------------------------------------
    // Clean up temporary test data & Restore baseline
    // -------------------------------------------------------------
    console.log('\n--- Cleaning up temporary test artifacts ---');
    await prisma.scanJobEntry.deleteMany({
      where: { scanJobId: testScanJob.id }
    });
    await prisma.scanJob.delete({
      where: { id: testScanJob.id }
    });

    // Restore baseline clearance state
    await prisma.ndcClearance.update({
      where: { id: baselineState.id },
      data: {
        status: baselineState.status,
        dueAmount: baselineState.dueAmount,
        dueDetails: baselineState.dueDetails,
        remarks: baselineState.remarks,
        reviewedById: baselineState.reviewedById,
        reviewedAt: baselineState.reviewedAt
      }
    });

    if (baselineNdcRequest) {
      await prisma.ndcRequest.update({
        where: { id: baselineNdcRequest.id },
        data: { status: baselineNdcRequest.status }
      });
    }

    console.log('Baseline state restored successfully.');
  } catch (testErr) {
    console.error('Unexpected error during test execution:', testErr);
    // Attempt baseline restoration in catch as well
    try {
      await prisma.ndcClearance.update({
        where: { id: baselineState.id },
        data: {
          status: baselineState.status,
          dueAmount: baselineState.dueAmount,
          dueDetails: baselineState.dueDetails
        }
      });
    } catch (_) {}
    throw testErr;
  }

  console.log('\n================================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runDueManagementIntegrationTests()
  .catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
