import prisma from '../src/config/prisma';
import { DepartmentClearanceStatus } from '../src/constants/statuses';
import { UserRole } from '../src/constants/roles';
import { GeminiService } from '../src/services/GeminiService';
import { AiAssistantService } from '../src/services/AiAssistantService';
import { LogbookScannerService } from '../src/services/LogbookScannerService';

async function runTestSuite() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  NDC AI ASSISTANT & AI LOGBOOK SCANNER REGRESSION SUITE        ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, details?: any) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}`, details || '');
      failed++;
    }
  }

  try {
    // ─────────────────────────────────────────────────────────────
    // SETUP & PREREQUISITES
    // ─────────────────────────────────────────────────────────────
    console.log('--- SETUP: Resolving Physics Department, Officer, and Student 4MC24IS022 ---');

    const phyDept = await prisma.clearanceDepartment.findFirst({
      where: { code: 'PHY' }
    });
    assert(Boolean(phyDept), 'Physics Department (PHY) found in database', phyDept);

    // Resolve an authorized Physics Officer or Admin
    let officerUser = await prisma.user.findFirst({
      where: {
        role: { in: [UserRole.DEPARTMENT_OFFICER, UserRole.ADMIN, UserRole.SUPER_ADMIN] },
        OR: [
          { departmentId: phyDept!.id },
          { role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] } }
        ]
      }
    });

    if (!officerUser) {
      officerUser = await prisma.user.findFirst({
        where: { role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] } }
      });
    }
    assert(Boolean(officerUser), `Authorized officer user found: ${officerUser?.name} (${officerUser?.role})`);

    // Ensure student 4MC24IS022 exists with active Physics clearance
    let testStudent = await prisma.student.findFirst({
      where: { usn: { equals: '4MC24IS022', mode: 'insensitive' } },
      include: {
        ndcClearances: {
          where: { departmentId: phyDept!.id }
        }
      }
    });

    assert(Boolean(testStudent), `Student 4MC24IS022 found: ${testStudent?.fullName} (${testStudent?.usn})`);

    let phyClearance = testStudent?.ndcClearances.find((c) => c.departmentId === phyDept?.id);
    if (!phyClearance && testStudent && phyDept) {
      const ndcReq = await prisma.ndcRequest.findFirst({
        where: { studentId: testStudent.id }
      });
      if (ndcReq) {
        phyClearance = await prisma.ndcClearance.create({
          data: {
            ndcRequestId: ndcReq.id,
            studentId: testStudent.id,
            departmentId: phyDept.id,
            status: DepartmentClearanceStatus.PENDING as any,
            dueAmount: 0
          }
        });
      }
    }
    assert(Boolean(phyClearance), `Student 4MC24IS022 Physics Lab clearance active (ID: ${phyClearance?.id})`);

    // ─────────────────────────────────────────────────────────────
    // TEST 1: ACCEPTANCE TEST 1 — "Add ₹300 due for breaking a thermometer for USN 4MC24IS022."
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 1: Acceptance Test 1 (Add ₹300 due for breaking a thermometer for USN 4MC24IS022) ---');

    // Reset clearance to clean state before test
    await prisma.ndcClearance.update({
      where: { id: phyClearance!.id },
      data: { status: DepartmentClearanceStatus.PENDING as any, dueAmount: 0, dueDetails: '', remarks: '' }
    });

    const addDueResponse = await AiAssistantService.processMessage({
      user: {
        id: officerUser!.id,
        role: officerUser!.role,
        name: officerUser!.name,
        departmentId: phyDept!.id
      },
      messages: [
        { role: 'user', content: 'Add ₹300 due for breaking a thermometer for USN 4MC24IS022.' }
      ],
      departmentCode: 'PHY'
    });

    assert(Boolean(addDueResponse.actionRequired), 'Assistant generated confirmation card (actionRequired)');
    const stagedAdd = addDueResponse.actionRequired!;
    assert(stagedAdd.action === 'MARK_DUE', `Operation correctly identified as MARK_DUE (was: ${stagedAdd.action})`);
    assert(stagedAdd.usn === '4MC24IS022', `Student USN extracted: ${stagedAdd.usn}`);
    assert(stagedAdd.amount === 300, `Amount extracted correctly as ₹300 (was: ₹${stagedAdd.amount})`);
    assert(
      Boolean(stagedAdd.reason?.toLowerCase().includes('thermometer')),
      `Reason extracted contains "thermometer" (was: "${stagedAdd.reason}")`
    );
    assert(
      stagedAdd.labName === 'Physics Lab',
      `Target Laboratory identified as "Physics Lab" (was: "${stagedAdd.labName}")`
    );
    assert(Boolean(stagedAdd.token), `Secure confirmation token issued: ${stagedAdd.token?.slice(0, 16)}...`);

    // VERIFY DB UNMUTATED BEFORE CONFIRMATION
    const dbBeforeConfirm = await prisma.ndcClearance.findUnique({
      where: { id: phyClearance!.id }
    });
    assert(
      dbBeforeConfirm?.status !== DepartmentClearanceStatus.DUE && dbBeforeConfirm?.dueAmount === 0,
      'UNCONFIRMED SAFETY: Database record was NOT mutated prior to explicit confirmation'
    );

    // CONFIRM AND EXECUTE
    console.log('\n--- Executing Confirmation for Staged Due ---');
    const confirmAddResult = await AiAssistantService.confirmAndExecute(stagedAdd.token, officerUser!.id);
    assert(confirmAddResult.success === true, 'Confirmation execution reported success');

    // VERIFY DB MUTATED AFTER CONFIRMATION
    const dbAfterConfirm = await prisma.ndcClearance.findUnique({
      where: { id: phyClearance!.id }
    });
    assert(
      dbAfterConfirm?.status === DepartmentClearanceStatus.DUE && Number(dbAfterConfirm?.dueAmount) === 300,
      `LIVE DATABASE VERIFIED: Record updated in PostgreSQL: Status = DUE, Amount = ₹${dbAfterConfirm?.dueAmount}`
    );

    // Verify audit log
    const addAudit = await prisma.auditLog.findFirst({
      where: { entityId: phyClearance!.id, action: { contains: 'AI_ASSISTANT_MARK_DUE' } },
      orderBy: { timestamp: 'desc' }
    });
    assert(Boolean(addAudit), `Audit log verified: ${addAudit?.action}`);

    // ─────────────────────────────────────────────────────────────
    // TEST 2: REPLAY PROTECTION (Duplicate Submission Prevention)
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 2: Replay Protection (Duplicate Submission) ---');
    let duplicateRejected = false;
    try {
      await AiAssistantService.confirmAndExecute(stagedAdd.token, officerUser!.id);
    } catch (err: any) {
      duplicateRejected = true;
      assert(err.message.includes('already been confirmed'), `Duplicate execution safely blocked: "${err.message}"`);
    }
    assert(duplicateRejected, 'Replay of consumed confirmation token was rejected');

    // ─────────────────────────────────────────────────────────────
    // TEST 3: ACCEPTANCE TEST 2 — "Clear 4MC24IS022's Physics Lab clearance as No Due."
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 3: Acceptance Test 2 (Clear 4MC24IS022 Physics Lab clearance as No Due) ---');

    const clearResponse = await AiAssistantService.processMessage({
      user: {
        id: officerUser!.id,
        role: officerUser!.role,
        name: officerUser!.name,
        departmentId: phyDept!.id
      },
      messages: [
        { role: 'user', content: "Clear 4MC24IS022's Physics Lab clearance as No Due." }
      ],
      departmentCode: 'PHY'
    });

    assert(Boolean(clearResponse.actionRequired), 'Assistant generated confirmation card for clearing clearance');
    const stagedClear = clearResponse.actionRequired!;
    assert(stagedClear.action === 'CLEAR_DUE', `Operation recognized as CLEAR_DUE (was: ${stagedClear.action})`);
    assert(stagedClear.usn === '4MC24IS022', `USN verified: ${stagedClear.usn}`);
    assert(stagedClear.amount === 0, `Due amount set to ₹0`);
    assert(
      clearResponse.reply.includes('300') || clearResponse.reply.includes('outstanding due'),
      'Assistant noted the existing ₹300 due will be cleared/waived'
    );

    // Confirm clearing
    const confirmClearResult = await AiAssistantService.confirmAndExecute(stagedClear.token, officerUser!.id);
    assert(confirmClearResult.success === true, 'Clearance confirmation execution reported success');

    const dbAfterClear = await prisma.ndcClearance.findUnique({
      where: { id: phyClearance!.id }
    });
    assert(
      dbAfterClear?.status === DepartmentClearanceStatus.CLEARED && Number(dbAfterClear?.dueAmount) === 0,
      `LIVE DATABASE VERIFIED: Record updated in PostgreSQL: Status = CLEARED, Amount = ₹${dbAfterClear?.dueAmount}`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 4: CONTRADICTORY REQUEST DETECTION
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 4: Contradictory Request Detection ---');
    const contradictoryResponse = await AiAssistantService.processMessage({
      user: {
        id: officerUser!.id,
        role: officerUser!.role,
        name: officerUser!.name,
        departmentId: phyDept!.id
      },
      messages: [
        { role: 'user', content: 'Clear 4MC24IS022 as No Due and add ₹300 due for broken prism' }
      ],
      departmentCode: 'PHY'
    });

    assert(
      contradictoryResponse.actionRequired === null,
      'Contradictory request staged NO action token'
    );
    assert(
      contradictoryResponse.reply.includes('Contradictory Operations Requested') ||
      contradictoryResponse.reply.includes('conflict'),
      'Assistant asked for clarification regarding conflicting operations'
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 5: STUDENT LOOKUP & STATUS QUERY
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 5: Student Lookup & Status Query ---');
    const lookupResponse = await AiAssistantService.processMessage({
      user: {
        id: officerUser!.id,
        role: officerUser!.role,
        name: officerUser!.name,
        departmentId: phyDept!.id
      },
      messages: [
        { role: 'user', content: 'Lookup student 4MC24IS022' }
      ],
      departmentCode: 'PHY'
    });

    assert(lookupResponse.actionRequired === null, 'Lookup query staged no mutation action');
    assert(
      lookupResponse.reply.includes('4MC24IS022') && lookupResponse.reply.includes('Student Clearance Record'),
      'Assistant returned formatted Markdown clearance record for student'
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 6: VIEW PENDING DUES
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 6: View Pending Dues ---');
    const duesResponse = await AiAssistantService.processMessage({
      user: {
        id: officerUser!.id,
        role: officerUser!.role,
        name: officerUser!.name,
        departmentId: phyDept!.id
      },
      messages: [
        { role: 'user', content: 'Show pending dues in Physics Lab' }
      ],
      departmentCode: 'PHY'
    });

    assert(duesResponse.actionRequired === null, 'View dues query staged no mutation action');
    assert(
      duesResponse.reply.includes('Outstanding Dues') || duesResponse.reply.includes('No Outstanding Dues'),
      'Assistant returned structured dues report'
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 7: LIST DEPARTMENT RECORDS / SUMMARY
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 7: List Department Records / Summary ---');
    const summaryResponse = await AiAssistantService.processMessage({
      user: {
        id: officerUser!.id,
        role: officerUser!.role,
        name: officerUser!.name,
        departmentId: phyDept!.id
      },
      messages: [
        { role: 'user', content: 'Show Physics Lab clearance summary' }
      ],
      departmentCode: 'PHY'
    });

    assert(summaryResponse.actionRequired === null, 'Summary query staged no mutation action');
    assert(
      (summaryResponse.reply.includes('Clearance Report') || summaryResponse.reply.includes('Clearance Desk Overview')) &&
      (summaryResponse.reply.includes('Total Students') || summaryResponse.reply.includes('Total Student Records')),
      'Assistant returned structured department statistics'
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 8: INVALID USN HANDLING
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 8: Invalid USN Handling ---');
    const invalidUsnResponse = await AiAssistantService.processMessage({
      user: {
        id: officerUser!.id,
        role: officerUser!.role,
        name: officerUser!.name,
        departmentId: phyDept!.id
      },
      messages: [
        { role: 'user', content: 'Add ₹300 due for breaking a thermometer for USN 4MC99XX999.' }
      ],
      departmentCode: 'PHY'
    });

    assert(invalidUsnResponse.actionRequired === null, 'Invalid USN produced NO action token');
    assert(
      invalidUsnResponse.reply.includes('Student Not Found'),
      'Assistant returned useful "Student Not Found" error instead of generic greeting'
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 9: UNAUTHORIZED USER ACTION
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 9: Unauthorized User Action ---');
    // Find a department that is NOT Physics (e.g. Chemistry or Mech)
    const otherDept = await prisma.clearanceDepartment.findFirst({
      where: { code: { not: 'PHY' }, isActive: true }
    });

    const unauthorizedOfficer = {
      id: 'mock-unauthorized-user-id',
      role: UserRole.DEPARTMENT_OFFICER,
      name: 'Dr. Other Officer',
      departmentId: otherDept?.id || 'other-dept-id'
    };

    const unauthResponse = await AiAssistantService.processMessage({
      user: unauthorizedOfficer,
      messages: [
        { role: 'user', content: 'Add ₹300 due for breaking a thermometer for USN 4MC24IS022.' }
      ],
      departmentCode: 'PHY'
    });

    assert(unauthResponse.actionRequired === null, 'Unauthorized officer produced NO action token');
    assert(
      unauthResponse.reply.includes('Unauthorized Action'),
      'Assistant returned clear "Unauthorized Action" error message'
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 9B: REGRESSION — NATURAL LANGUAGE PHRASING VARIANTS
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 9B: Natural Language Variants (Record Fine / Mark Cleared / Read Details / Report) ---');

    // Variant 1: "Record fine 200 for 4MC24IS022 missing prism"
    const variantFineResponse = await AiAssistantService.processMessage({
      user: { id: officerUser!.id, role: officerUser!.role, name: officerUser!.name, departmentId: phyDept!.id },
      messages: [{ role: 'user', content: 'Record fine 200 for 4MC24IS022 missing prism.' }],
      departmentCode: 'PHY'
    });
    assert(variantFineResponse.actionRequired !== null, 'Variant fine generated confirmation card');
    assert(variantFineResponse.actionRequired?.action === 'MARK_DUE', 'Variant fine identified as MARK_DUE');
    assert(variantFineResponse.actionRequired?.amount === 200, 'Variant fine extracted ₹200');
    assert(
      Boolean(variantFineResponse.actionRequired?.reason?.toLowerCase().includes('missing prism')),
      `Variant fine extracted reason containing "missing prism" (got: "${variantFineResponse.actionRequired?.reason}")`
    );

    // Variant 2: "Mark student 4MC24IS022 as cleared in Physics Lab"
    const variantClearResponse = await AiAssistantService.processMessage({
      user: { id: officerUser!.id, role: officerUser!.role, name: officerUser!.name, departmentId: phyDept!.id },
      messages: [{ role: 'user', content: 'Mark student 4MC24IS022 as cleared in Physics Lab.' }],
      departmentCode: 'PHY'
    });
    assert(variantClearResponse.actionRequired !== null, 'Variant clear generated confirmation card');
    assert(variantClearResponse.actionRequired?.action === 'CLEAR_DUE', 'Variant clear identified as CLEAR_DUE');

    // Variant 3: "Read physics lab clearance details for 4MC24IS022"
    const variantReadResponse = await AiAssistantService.processMessage({
      user: { id: officerUser!.id, role: officerUser!.role, name: officerUser!.name, departmentId: phyDept!.id },
      messages: [{ role: 'user', content: 'Read physics lab clearance details for 4MC24IS022.' }],
      departmentCode: 'PHY'
    });
    assert(variantReadResponse.actionRequired === null, 'Read clearance details produced NO mutation token');
    assert(
      variantReadResponse.reply.includes('Student Clearance Record') || variantReadResponse.reply.includes('4MC24IS022'),
      'Assistant returned formatted clearance details for 4MC24IS022'
    );

    // Variant 4: "Generate authorized report for Physics department"
    const variantReportResponse = await AiAssistantService.processMessage({
      user: { id: officerUser!.id, role: officerUser!.role, name: officerUser!.name, departmentId: phyDept!.id },
      messages: [{ role: 'user', content: 'Generate authorized report for Physics department.' }],
      departmentCode: 'PHY'
    });
    assert(variantReportResponse.actionRequired === null, 'Department report produced NO mutation token');
    assert(
      variantReportResponse.reply.includes('Authorized Clearance Report') || variantReportResponse.reply.includes('Total Students'),
      'Assistant returned authorized department report'
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 9C: REGRESSION — MISSING AMOUNT CLARIFICATION
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 9C: Missing Amount Clarification Handling ---');
    const missingAmountResponse = await AiAssistantService.processMessage({
      user: { id: officerUser!.id, role: officerUser!.role, name: officerUser!.name, departmentId: phyDept!.id },
      messages: [{ role: 'user', content: 'Add a due for breaking a thermometer for USN 4MC24IS022.' }],
      departmentCode: 'PHY'
    });
    assert(missingAmountResponse.actionRequired === null, 'Missing amount produced NO mutation token');
    assert(
      missingAmountResponse.reply.includes('Due Amount') || missingAmountResponse.reply.includes('specify'),
      'Assistant asked clarification question for missing due amount'
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 9D: REGRESSION — FORGED CONFIRMATION PREVENTION
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 9D: Forged Confirmation Token Prevention ---');
    // Stage an action for officerUser
    const stageForForged = await AiAssistantService.processMessage({
      user: { id: officerUser!.id, role: officerUser!.role, name: officerUser!.name, departmentId: phyDept!.id },
      messages: [{ role: 'user', content: 'Add ₹150 due for missing lens for USN 4MC24IS022.' }],
      departmentCode: 'PHY'
    });
    assert(stageForForged.actionRequired !== null, 'Staged token for forged test');

    let forgedBlocked = false;
    try {
      // Attempt to execute token with forged/different officer account
      await AiAssistantService.confirmAndExecute(stageForForged.actionRequired!.token, 'attacker-user-id-9999');
    } catch (err: any) {
      forgedBlocked = err.message.includes('different officer account');
    }
    assert(forgedBlocked, 'Safely blocked confirmation execution by unauthorized/forged user account');

    // ─────────────────────────────────────────────────────────────
    // TEST 10: LOGBOOK SCANNER VERIFICATION
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 10: AI Logbook Scanner Upload, Correction & Apply ---');
    const sampleBuffer = Buffer.from('MOCK_SCANNED_REGISTER_BINARY_DATA');
    const scanJob = await LogbookScannerService.processUpload({
      lecturerUserId: officerUser!.id,
      departmentId: phyDept!.id,
      originalFilename: 'Physics_Lab_Logbook_March_2026.png',
      mimeType: 'image/png',
      fileBuffer: sampleBuffer
    });

    assert(Boolean(scanJob.id), `Scan job created with ID: ${scanJob.id}`);
    assert(scanJob.totalEntries > 0, `Entries extracted: ${scanJob.totalEntries}`);

    const firstEntry = scanJob.entries[0];
    const updatedEntry = await LogbookScannerService.updateEntry({
      entryId: firstEntry.id,
      correctedUsn: '4MC24IS022',
      correctedAmount: 450,
      correctedReason: 'Laser Optics Kit Component Damaged',
      lecturerUserId: officerUser!.id
    });

    assert(
      updatedEntry.status === 'MATCHED' && updatedEntry.matchedStudentId === testStudent!.id,
      `Entry reconciled to real student 4MC24IS022 with status MATCHED`
    );

    const applyResult = await LogbookScannerService.applyApprovedEntries(
      scanJob.id,
      [firstEntry.id],
      officerUser!.id
    );

    assert(applyResult.appliedCount === 1, `Applied count: ${applyResult.appliedCount}`);
    const clearanceAfterScan = await prisma.ndcClearance.findUnique({
      where: { id: phyClearance!.id }
    });
    assert(
      clearanceAfterScan?.status === DepartmentClearanceStatus.DUE && Number(clearanceAfterScan?.dueAmount) === 450,
      `Logbook entry applied to database: Status = DUE, Amount = ₹${clearanceAfterScan?.dueAmount}`
    );

    // Restore clean state
    await prisma.ndcClearance.update({
      where: { id: phyClearance!.id },
      data: { status: DepartmentClearanceStatus.CLEARED as any, dueAmount: 0, remarks: 'Verified by test suite' }
    });

    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log(`║  ALL TESTS COMPLETED: ${passed} PASSED, ${failed} FAILED                     ║`);
    console.log('╚════════════════════════════════════════════════════════════════╝');

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err: any) {
    console.error('\n[FATAL ERROR IN TEST SUITE]:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runTestSuite();
