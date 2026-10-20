import prisma from '../src/config/prisma';
import { AiAssistantService } from '../src/services/AiAssistantService';
import { DepartmentValidationService } from '../src/services/ai/DepartmentValidationService';
import { DueManagementService } from '../src/services/DueManagementService';
import { DepartmentClearanceStatus } from '../src/constants/statuses';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    results.push({ name: testName, passed: true, details });
    console.log(`  ✅ PASS: ${testName}`);
  } else {
    results.push({ name: testName, passed: false, error: details || 'Assertion failed' });
    console.error(`  ❌ FAIL: ${testName} - ${details || 'Assertion failed'}`);
  }
}

async function runRegressionTests() {
  console.log('================================================================');
  console.log('🧪 RUNNING DUE VALIDATION & STUDENT IDENTITY WORKFLOW REGRESSION');
  console.log('================================================================\n');

  // 1. Setup Test Actors
  const studentUsn = '4MC24IS022';
  const student = await prisma.student.findUnique({
    where: { usn: studentUsn },
    include: { department: true, ndcClearances: { include: { department: true } } }
  });

  if (!student) {
    throw new Error(`Student ${studentUsn} not found for tests.`);
  }

  const libOfficer = await prisma.user.findUnique({
    where: { email: 'library@mce.ac.in' },
    include: { department: true }
  });
  if (!libOfficer) throw new Error('library@mce.ac.in user not found');

  const phyOfficer = await prisma.user.findUnique({
    where: { email: 'physics.lab@mce.ac.in' },
    include: { department: true }
  });
  if (!phyOfficer) throw new Error('physics.lab@mce.ac.in user not found');

  const libDept = await prisma.clearanceDepartment.findFirst({ where: { code: 'LIB' } });
  if (!libDept) throw new Error('LIB department not found');

  const phyDept = await prisma.clearanceDepartment.findFirst({ where: { code: 'PHY' } });
  if (!phyDept) throw new Error('PHY department not found');

  // Reset student clearance state in LIB for clean testing
  const initialLibClearance = await prisma.ndcClearance.findFirst({
    where: { studentId: student.id, departmentId: libDept.id }
  });
  if (initialLibClearance) {
    await prisma.ndcClearance.update({
      where: { id: initialLibClearance.id },
      data: {
        status: DepartmentClearanceStatus.PENDING as any,
        dueAmount: 0,
        dueDetails: null,
        remarks: 'Test reset'
      }
    });
  }

  console.log('--- TEST GROUP 1: Student Identity & Department Separation ---');
  {
    // Test 1.1: Academic Department is separate from Clearance Desk
    const validation = await DepartmentValidationService.validateDueAction({
      studentUsn,
      targetDepartmentIdOrCode: libDept.id,
      amount: 400,
      reason: 'Overdue technical volume penalty',
      officerUserId: libOfficer.id,
      action: 'MARK_DUE'
    });

    assert(
      validation.studentAcademicDepartment === 'Information Science & Engineering',
      'Student Academic Department correctly resolved to Information Science & Engineering',
      `Got: ${validation.studentAcademicDepartment}`
    );

    assert(
      validation.targetClearanceDesk === 'Central Library' || validation.targetClearanceDesk.includes('Library'),
      'Target Clearance Desk correctly resolved to Central Library',
      `Got: ${validation.targetClearanceDesk}`
    );

    assert(
      validation.studentAcademicDepartment !== validation.targetClearanceDesk,
      'Student Academic Department and Target Clearance Desk are distinct entities and not conflated',
      `${validation.studentAcademicDepartment} vs ${validation.targetClearanceDesk}`
    );
  }

  console.log('\n--- TEST GROUP 2: Charge Type & Department Scope Enforcement ---');
  {
    // Test 2.1: Central Library rejecting Apparatus / Lab Equipment Damage
    const libApparatusCheck = DepartmentValidationService.validateChargeType('LIB', 'Apparatus / Lab Equipment Damage');
    assert(
      libApparatusCheck.allowed === false,
      'Central Library rejects Apparatus / Lab Equipment Damage charge type',
      libApparatusCheck.reasonDetail
    );

    assert(
      libApparatusCheck.detectedCategory === 'LABORATORY_APPARATUS',
      'Correctly detected laboratory apparatus category as unauthorized in Library'
    );

    // Test 2.2: Central Library accepting overdue book / lost book fine
    const libBookCheck = DepartmentValidationService.validateChargeType('LIB', 'Lost 3rd semester textbook replacement');
    assert(
      libBookCheck.allowed === true,
      'Central Library accepts valid textbook replacement charge type',
      libBookCheck.reasonDetail
    );

    // Test 2.3: Physics Lab rejecting library book fines
    const phyLibraryCheck = DepartmentValidationService.validateChargeType('PHY', 'Overdue library book return fee');
    assert(
      phyLibraryCheck.allowed === false,
      'Physics Lab rejects Library Book charge type',
      phyLibraryCheck.reasonDetail
    );

    // Test 2.4: Physics Lab accepting apparatus damage
    const phyApparatusCheck = DepartmentValidationService.validateChargeType('PHY', 'Broken spectrometer optical prism');
    assert(
      phyApparatusCheck.allowed === true,
      'Physics Lab accepts spectrometer optical prism apparatus damage',
      phyApparatusCheck.reasonDetail
    );
  }

  console.log('\n--- TEST GROUP 3: Pre-Flight Validation Blocking Unauthorized Due Requests ---');
  {
    // Test 3.1: Assistant rejects apparatus due staging in Central Library
    const libAssistantResponse = await AiAssistantService.processMessage({
      user: {
        id: libOfficer.id,
        role: libOfficer.role,
        name: libOfficer.name,
        departmentId: libDept.id
      },
      messages: [
        {
          role: 'user',
          content: 'Add due of ₹400 for 4MC24IS022 for Apparatus / Lab Equipment Damage'
        }
      ],
      departmentCode: 'LIB'
    });

    assert(
      libAssistantResponse.actionRequired === null,
      'AI Assistant blocks staging when charge type is unauthorized for Central Library',
      'actionRequired is null'
    );

    assert(
      libAssistantResponse.reply.includes('Validation Failed') || libAssistantResponse.reply.includes('not authorized'),
      'AI Assistant response provides explicit explanation of unauthorized charge type',
      libAssistantResponse.reply.substring(0, 150)
    );

    // Verify zero database changes occurred in clearance record
    const clearanceAfterBlocked = await prisma.ndcClearance.findFirst({
      where: { studentId: student.id, departmentId: libDept.id }
    });
    assert(
      Number(clearanceAfterBlocked?.dueAmount) === 0,
      'Clearance due amount remains ₹0 after blocked validation attempt',
      `Found: ₹${clearanceAfterBlocked?.dueAmount}`
    );
  }

  console.log('\n--- TEST GROUP 4: Cross-Department Officer Authorization ---');
  {
    // Test 4.1: Physics Officer attempting to operate in Central Library without permission
    const unauthorizedValidation = await DepartmentValidationService.validateDueAction({
      studentUsn,
      targetDepartmentIdOrCode: libDept.id,
      amount: 400,
      reason: 'Overdue textbook fine',
      officerUserId: phyOfficer.id, // Physics officer!
      action: 'MARK_DUE'
    });

    assert(
      unauthorizedValidation.isValid === false,
      'Pre-flight validation blocks cross-department mutation by unauthorized officer',
      unauthorizedValidation.blockingReason
    );

    const officerCheck = unauthorizedValidation.checks.find(c => c.key === 'officer_authorization');
    assert(
      officerCheck?.passed === false,
      'Officer authorization check marked as failed for cross-department officer'
    );
  }

  console.log('\n--- TEST GROUP 5: Valid Staging, Zero Mutation, Confirmation & Execution ---');
  {
    // Test 5.1: Valid staging for Central Library with authorized book charge
    const validLibResponse = await AiAssistantService.processMessage({
      user: {
        id: libOfficer.id,
        role: libOfficer.role,
        name: libOfficer.name,
        departmentId: libDept.id
      },
      messages: [
        {
          role: 'user',
          content: 'Add due of ₹400 for 4MC24IS022 for Overdue technical reference book'
        }
      ],
      departmentCode: 'LIB'
    });

    assert(
      validLibResponse.actionRequired !== null,
      'Valid library due successfully staged and returned confirmation token',
      `Token: ${validLibResponse.actionRequired?.token?.substring(0, 8)}...`
    );

    assert(
      validLibResponse.actionRequired?.studentAcademicDepartment === 'Information Science & Engineering',
      'Staged actionRequired includes distinct studentAcademicDepartment',
      validLibResponse.actionRequired?.studentAcademicDepartment
    );

    assert(
      Boolean(validLibResponse.actionRequired?.targetClearanceDesk?.includes('Library')),
      'Staged actionRequired includes distinct targetClearanceDesk',
      validLibResponse.actionRequired?.targetClearanceDesk
    );

    assert(
      Array.isArray(validLibResponse.actionRequired?.validationResults) &&
      validLibResponse.actionRequired.validationResults.length > 0,
      'Staged actionRequired contains explicit pre-flight validation checklist',
      `Count: ${validLibResponse.actionRequired?.validationResults?.length}`
    );

    // Verify zero database mutation on staging
    const clearanceDuringStaging = await prisma.ndcClearance.findFirst({
      where: { studentId: student.id, departmentId: libDept.id }
    });
    assert(
      Number(clearanceDuringStaging?.dueAmount) === 0 && clearanceDuringStaging?.status === 'PENDING',
      'Staging does NOT mutate live database: clearance status remains PENDING and due remains ₹0',
      `Status: ${clearanceDuringStaging?.status}, Due: ₹${clearanceDuringStaging?.dueAmount}`
    );

    // Test 5.2: Duplicate Due Prevention
    // Try staging identical due while previous one is staged
    const duplicateValidation = await DepartmentValidationService.validateDueAction({
      studentUsn,
      targetDepartmentIdOrCode: libDept.id,
      amount: 400,
      reason: 'Overdue technical reference book',
      officerUserId: libOfficer.id,
      action: 'MARK_DUE'
    });

    assert(
      duplicateValidation.isValid === false,
      'Duplicate due detection identifies equivalent pending proposal and blocks duplicate',
      duplicateValidation.blockingReason
    );

    // Test 5.3: Confirm and Execute
    const token = validLibResponse.actionRequired?.token;
    if (token) {
      const confirmResult = await AiAssistantService.confirmAndExecute(
        token,
        libOfficer.id,
        { action: 'MARK_DUE', usn: studentUsn, amount: 400 }
      );

      assert(
        confirmResult.success === true,
        'Confirm & Save successfully executes and verifies in database',
        confirmResult.message
      );

      assert(
        confirmResult.completionReply.includes('Information Science & Engineering') &&
        confirmResult.completionReply.includes('Central Library'),
        'Completion response explicitly separates student academic department and clearance desk'
      );

      console.log('    [DEBUG completionReply]:\n', confirmResult.completionReply);
      assert(
        confirmResult.completionReply.includes('400') && confirmResult.completionReply.includes('Actual Amount Recorded'),
        'Completion response accurately reports recorded amount',
        confirmResult.completionReply
      );

      // Verify database write
      const updatedClearance = await prisma.ndcClearance.findFirst({
        where: { studentId: student.id, departmentId: libDept.id }
      });
      assert(
        updatedClearance?.status === 'DUE' && Number(updatedClearance?.dueAmount) === 400,
        'Clearance record in database successfully updated to DUE with ₹400',
        `Status: ${updatedClearance?.status}, Amount: ₹${updatedClearance?.dueAmount}`
      );

      // Test 5.4: Double-Click / Replay Protection
      let replayBlocked = false;
      try {
        await AiAssistantService.confirmAndExecute(token, libOfficer.id);
      } catch (replayErr: any) {
        replayBlocked = true;
        assert(
          replayErr.message.includes('already been confirmed and executed'),
          'Double-click / retry correctly blocked with ALREADY_CONSUMED protection',
          replayErr.message
        );
      }
      assert(replayBlocked, 'Replaying consumed token was prevented');
    }
  }

  console.log('\n--- TEST GROUP 6: Cancellation Workflow ---');
  {
    // Test 6.1: Stage an action to clear due, then cancel it
    const stagedToClear = await AiAssistantService.processMessage({
      user: {
        id: libOfficer.id,
        role: libOfficer.role,
        name: libOfficer.name,
        departmentId: libDept.id
      },
      messages: [
        {
          role: 'user',
          content: 'Clear 4MC24IS022 clearance as No Due'
        }
      ],
      departmentCode: 'LIB'
    });

    const clearToken = stagedToClear.actionRequired?.token;
    assert(clearToken !== undefined, 'Clearance approval action successfully staged for cancellation testing');

    if (clearToken) {
      const cancelResult = await AiAssistantService.cancelAction(clearToken, libOfficer.id);
      assert(
        cancelResult.cancelled === true,
        'Cancel action safely discards pending staged action',
        cancelResult.message
      );

      assert(
        cancelResult.completionReply.includes('Live clearance records in Central Library verified completely unchanged'),
        'Cancellation response verifies live records remained unchanged'
      );

      // Verify live clearance is still DUE (₹400) from previous test, unaffected by cancelled approval
      const clearanceAfterCancel = await prisma.ndcClearance.findFirst({
        where: { studentId: student.id, departmentId: libDept.id }
      });
      assert(
        clearanceAfterCancel?.status === 'DUE' && Number(clearanceAfterCancel?.dueAmount) === 400,
        'Live database clearance record remained untouched after cancellation',
        `Status: ${clearanceAfterCancel?.status}, Due: ₹${clearanceAfterCancel?.dueAmount}`
      );
    }
  }

  // Clean up: approve clearance back to CLEARED with 0 dues
  await prisma.ndcClearance.updateMany({
    where: { studentId: student.id, departmentId: libDept.id },
    data: { status: DepartmentClearanceStatus.CLEARED as any, dueAmount: 0, dueDetails: null, remarks: 'Test finished reset' }
  });

  console.log('\n================================================================');
  console.log(`📊 SUMMARY: ${results.filter(r => r.passed).length}/${results.length} TESTS PASSED`);
  console.log('================================================================\n');

  if (results.some(r => !r.passed)) {
    console.error('❌ SOME TESTS FAILED:');
    results.filter(r => !r.passed).forEach(r => console.error(`  - ${r.name}: ${r.error}`));
    process.exit(1);
  } else {
    console.log('🎉 ALL REGRESSION TESTS PASSED CLEANLY WITH ZERO ERRORS!');
  }
}

runRegressionTests()
  .catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
