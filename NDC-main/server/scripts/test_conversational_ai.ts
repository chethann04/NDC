import prisma from '../src/config/prisma';
import { DepartmentClearanceStatus } from '../src/constants/statuses';
import { UserRole } from '../src/constants/roles';
import { AiAssistantService } from '../src/services/AiAssistantService';

async function runConversationalAiTests() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  NDC CONVERSATIONAL AI & MANDATORY SAFEGUARDS TEST SUITE       ║');
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
    console.log('--- SETUP: Resolving Departments, Officers, and Student 4MC24IS022 ---');

    const phyDept = await prisma.clearanceDepartment.findFirst({
      where: { code: 'PHY' }
    });
    assert(Boolean(phyDept), 'Physics Department (PHY) exists in database');

    const cheDept = await prisma.clearanceDepartment.findFirst({
      where: { code: 'CHEM' }
    });
    assert(Boolean(cheDept), 'Chemistry Department (CHEM) exists in database');

    // Resolve an authorized Physics Officer
    let phyOfficer = await prisma.user.findFirst({
      where: {
        role: { in: [UserRole.DEPARTMENT_OFFICER, UserRole.ADMIN, UserRole.SUPER_ADMIN] },
        OR: [
          { departmentId: phyDept!.id },
          { role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] } }
        ]
      }
    });
    assert(Boolean(phyOfficer), `Authorized Physics officer resolved: ${phyOfficer?.name} (${phyOfficer?.role})`);

    const phyOfficerContext = {
      id: phyOfficer!.id,
      role: phyOfficer!.role,
      name: phyOfficer!.name,
      departmentId: phyDept!.id
    };

    // Create or resolve a Chemistry-only Officer to test unauthorized department boundaries
    let cheOfficer = await prisma.user.findFirst({
      where: {
        role: UserRole.DEPARTMENT_OFFICER,
        departmentId: cheDept!.id
      }
    });
    if (!cheOfficer && cheDept) {
      cheOfficer = await prisma.user.create({
        data: {
          name: 'Chemistry Test Officer',
          email: 'che.officer.test@nie.ac.in',
          passwordHash: 'dummy_hash',
          role: UserRole.DEPARTMENT_OFFICER,
          departmentId: cheDept.id
        }
      });
    }
    assert(Boolean(cheOfficer), `Chemistry-only officer resolved for authorization test: ${cheOfficer?.name}`);

    // Resolve student 4MC24IS022
    let testStudent = await prisma.student.findFirst({
      where: { usn: { equals: '4MC24IS022', mode: 'insensitive' } },
      include: {
        ndcClearances: {
          where: { departmentId: phyDept!.id }
        }
      }
    });
    assert(Boolean(testStudent), `Target student 4MC24IS022 resolved: ${testStudent?.fullName} (${testStudent?.usn})`);

    let phyClearance = testStudent?.ndcClearances.find((c) => c.departmentId === phyDept?.id);
    assert(Boolean(phyClearance), `Target student Physics clearance record active (ID: ${phyClearance?.id})`);

    // Reset student clearance to clean PENDING state before tests
    await prisma.ndcClearance.update({
      where: { id: phyClearance!.id },
      data: { status: DepartmentClearanceStatus.PENDING as any, dueAmount: 0, dueDetails: '', remarks: '' }
    });

    // ─────────────────────────────────────────────────────────────
    // TEST 1: Everyday Natural Phrasings for Adding a Due
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 1: Everyday Natural Phrasings for Adding a Due ---');

    // Phrasing A: "Please put a fine of ₹300 on USN 4MC24IS022 for breaking a thermometer."
    const resA = await AiAssistantService.processMessage({
      user: phyOfficerContext,
      messages: [
        { role: 'user', content: 'Please put a fine of ₹300 on USN 4MC24IS022 for breaking a thermometer.' }
      ],
      departmentCode: 'PHY'
    });

    assert(Boolean(resA.actionRequired), 'Phrasing A staged an action required token');
    assert(resA.actionRequired?.action === 'MARK_DUE', 'Phrasing A mapped to MARK_DUE');
    assert(resA.actionRequired?.amount === 300, 'Phrasing A extracted amount 300');
    assert(resA.actionRequired?.usn === '4MC24IS022', 'Phrasing A extracted USN 4MC24IS022');
    assert(Boolean(resA.actionRequired?.consequences), 'Phrasing A generated clear consequences description');

    // Verify ZERO database mutation occurred before confirmation
    const checkDbBeforeConfirm = await prisma.ndcClearance.findUnique({
      where: { id: phyClearance!.id }
    });
    assert(checkDbBeforeConfirm?.dueAmount === 0, 'Zero database mutation occurred before confirmation (dueAmount remains 0)');
    assert(checkDbBeforeConfirm?.status === DepartmentClearanceStatus.PENDING, 'Clearance status remains unchanged prior to confirmation');

    // ─────────────────────────────────────────────────────────────
    // TEST 2: Conversational Multi-Turn Follow-Ups & Action Edits
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 2: Conversational Multi-Turn Follow-Ups & Action Edits ---');

    // Follow-up 1: "Change it to ₹450."
    const resEditAmount = await AiAssistantService.processMessage({
      user: phyOfficerContext,
      messages: [
        { role: 'user', content: 'Please put a fine of ₹300 on USN 4MC24IS022 for breaking a thermometer.' },
        { role: 'model', content: resA.reply },
        { role: 'user', content: 'Change it to ₹450.' }
      ],
      departmentCode: 'PHY'
    });

    assert(Boolean(resEditAmount.actionRequired), 'Follow-up "Change it to ₹450." staged a fresh confirmation token');
    assert(resEditAmount.actionRequired?.amount === 450, 'Follow-up successfully changed amount to 450');
    assert(resEditAmount.actionRequired?.token !== resA.actionRequired?.token, 'Old confirmation token was invalidated and replaced with a fresh token');

    // Verify the previous token is now invalidated in DB
    const oldTokenDb = await prisma.aiConfirmationToken.findUnique({
      where: { token: resA.actionRequired!.token }
    });
    assert(oldTokenDb?.consumed === true, 'Previous token marked consumed/superseded upon action edit');

    // Follow-up 2: "The reason is a broken lens, not a thermometer."
    const resEditReason = await AiAssistantService.processMessage({
      user: phyOfficerContext,
      messages: [
        { role: 'user', content: 'Please put a fine of ₹300 on USN 4MC24IS022 for breaking a thermometer.' },
        { role: 'model', content: resA.reply },
        { role: 'user', content: 'Change it to ₹450.' },
        { role: 'model', content: resEditAmount.reply },
        { role: 'user', content: 'The reason is a broken lens, not a thermometer.' }
      ],
      departmentCode: 'PHY'
    });

    assert(Boolean(resEditReason.actionRequired), 'Follow-up reason edit staged a fresh confirmation token');
    assert(resEditReason.actionRequired?.amount === 450, 'Amount 450 was preserved through reason edit');
    assert(resEditReason.actionRequired?.reason?.toLowerCase().includes('lens') === true, 'Reason successfully updated to broken lens');

    // ─────────────────────────────────────────────────────────────
    // TEST 3: Conversational Cancellation Before Execution
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 3: Conversational Cancellation Before Execution ---');

    // Follow-up 3: "Cancel that."
    const resCancel = await AiAssistantService.processMessage({
      user: phyOfficerContext,
      messages: [
        { role: 'user', content: 'Please put a fine of ₹300 on USN 4MC24IS022 for breaking a thermometer.' },
        { role: 'model', content: resA.reply },
        { role: 'user', content: 'Cancel that.' }
      ],
      departmentCode: 'PHY'
    });

    assert(!resCancel.actionRequired, 'Cancellation returned no pending confirmation action');
    assert(resCancel.reply.toLowerCase().includes('cancel') || resCancel.reply.toLowerCase().includes('discarded'), 'Cancellation confirmed verbally to user');

    // Also test explicit API cancelAction endpoint
    const stagedForCancel = await AiAssistantService.processMessage({
      user: phyOfficerContext,
      messages: [
        { role: 'user', content: 'Charge 4MC24IS022 ₹200 for missing observation sheet.' }
      ],
      departmentCode: 'PHY'
    });
    assert(Boolean(stagedForCancel.actionRequired), 'Staged action for API cancellation test');

    const apiCancelRes = await AiAssistantService.cancelAction(stagedForCancel.actionRequired!.token, phyOfficer!.id);
    assert(apiCancelRes.success === true, 'api.cancelAssistantAction succeeded');

    const tokenAfterApiCancel = await prisma.aiConfirmationToken.findUnique({
      where: { token: stagedForCancel.actionRequired!.token }
    });
    assert(tokenAfterApiCancel?.consumed === true, 'Token invalidated in database upon API cancellation');

    // ─────────────────────────────────────────────────────────────
    // TEST 4: Missing or Ambiguous USNs and Amounts
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 4: Missing or Ambiguous USNs and Amounts ---');

    // Missing both USN and Amount: "Charge for a broken thermometer."
    const resMissingBoth = await AiAssistantService.processMessage({
      user: phyOfficerContext,
      messages: [
        { role: 'user', content: 'Charge for a broken thermometer.' }
      ],
      departmentCode: 'PHY'
    });
    assert(!resMissingBoth.actionRequired, 'No confirmation token staged when USN and amount are missing');
    assert(resMissingBoth.reply.toLowerCase().includes('usn') || resMissingBoth.reply.toLowerCase().includes('student'), 'Assistant asked clarification for student/USN');

    // Missing USN only: "Charge 300 rupees for a broken thermometer."
    const resMissingUsn = await AiAssistantService.processMessage({
      user: phyOfficerContext,
      messages: [
        { role: 'user', content: 'Charge 300 rupees for a broken thermometer.' }
      ],
      departmentCode: 'PHY'
    });
    assert(!resMissingUsn.actionRequired, 'No confirmation token staged when USN is missing');
    assert(resMissingUsn.reply.toLowerCase().includes('usn') || resMissingUsn.reply.toLowerCase().includes('student'), 'Assistant asked clarification for student USN');

    // Missing Amount only: "Charge 4MC24IS022 for breaking apparatus."
    const resMissingAmount = await AiAssistantService.processMessage({
      user: phyOfficerContext,
      messages: [
        { role: 'user', content: 'Charge 4MC24IS022 for breaking apparatus.' }
      ],
      departmentCode: 'PHY'
    });
    assert(!resMissingAmount.actionRequired, 'No confirmation token staged when amount is missing');
    assert(resMissingAmount.reply.toLowerCase().includes('amount') || resMissingAmount.reply.toLowerCase().includes('rupee'), 'Assistant asked clarification for amount');

    // Context resolution: turn 1 mentions student, turn 2 mentions charge
    const resContextFollowup = await AiAssistantService.processMessage({
      user: phyOfficerContext,
      messages: [
        { role: 'user', content: 'Check details for 4MC24IS022.' },
        { role: 'model', content: 'Here are the details for student 4MC24IS022...' },
        { role: 'user', content: 'That student broke a thermometer. Charge him 300 rupees.' }
      ],
      departmentCode: 'PHY'
    });
    assert(Boolean(resContextFollowup.actionRequired), 'Pronoun context "That student broke a thermometer. Charge him 300 rupees" successfully resolved USN 4MC24IS022');
    assert(resContextFollowup.actionRequired?.usn === '4MC24IS022', 'Resolved USN is 4MC24IS022 from previous turn context');
    assert(resContextFollowup.actionRequired?.amount === 300, 'Resolved amount is 300');

    // ─────────────────────────────────────────────────────────────
    // TEST 5: Initial "Please do it" cannot skip confirmation
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 5: Initial "Please do it" cannot skip confirmation ---');

    const resSkipAttempt = await AiAssistantService.processMessage({
      user: phyOfficerContext,
      messages: [
        { role: 'user', content: 'Charge 4MC24IS022 300 rupees for broken thermometer and please confirm it right now.' }
      ],
      departmentCode: 'PHY'
    });
    assert(Boolean(resSkipAttempt.actionRequired), 'Action staged with confirmation token despite user prompt saying "please confirm it right now"');

    // Also send "please do it" in text chat
    const resChatConfirmAttempt = await AiAssistantService.processMessage({
      user: phyOfficerContext,
      messages: [
        { role: 'user', content: 'Charge 4MC24IS022 300 rupees for broken thermometer.' },
        { role: 'model', content: resSkipAttempt.reply },
        { role: 'user', content: 'Please do it' }
      ],
      departmentCode: 'PHY'
    });
    assert(resChatConfirmAttempt.reply.toLowerCase().includes('click') || resChatConfirmAttempt.reply.toLowerCase().includes('card') || resChatConfirmAttempt.reply.toLowerCase().includes('confirm'), 'Assistant directed user to click confirmation button and did not execute via plain text');

    // ─────────────────────────────────────────────────────────────
    // TEST 6: Execution via Confirmation Token & Concurrency/Replay Protection
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 6: Execution via Confirmation Token & Concurrency/Replay Protection ---');

    // Stage clean action
    const stagedValid = await AiAssistantService.processMessage({
      user: phyOfficerContext,
      messages: [
        { role: 'user', content: 'Put a fine of ₹300 on USN 4MC24IS022 for broken thermometer.' }
      ],
      departmentCode: 'PHY'
    });

    const validToken = stagedValid.actionRequired!.token;

    // Concurrent double confirmation execution
    const [execResult1, execResult2] = await Promise.allSettled([
      AiAssistantService.confirmAndExecute(validToken, phyOfficer!.id),
      AiAssistantService.confirmAndExecute(validToken, phyOfficer!.id)
    ]);

    const successes = [execResult1, execResult2].filter((r) => r.status === 'fulfilled');
    const rejections = [execResult1, execResult2].filter((r) => r.status === 'rejected');

    assert(successes.length === 1, 'Exactly one concurrent confirmation execution succeeded (atomic concurrency protection)');
    assert(rejections.length === 1, 'Concurrent second confirmation was rejected');

    // Sequential replay attempt with same consumed token
    let replayError: any = null;
    try {
      await AiAssistantService.confirmAndExecute(validToken, phyOfficer!.id);
    } catch (err: any) {
      replayError = err;
    }
    assert(Boolean(replayError), 'Sequential replay of consumed token was rejected with error: ' + replayError?.message);

    // Verify committed database result
    const updatedClearance = await prisma.ndcClearance.findUnique({
      where: { id: phyClearance!.id }
    });
    assert(Number(updatedClearance?.dueAmount) === 300, `Committed database due amount verified: ₹${updatedClearance?.dueAmount}`);
    assert(updatedClearance?.status === DepartmentClearanceStatus.DUE, `Committed database status verified: ${updatedClearance?.status}`);

    // Verify Audit Log
    const auditRecord = await prisma.auditLog.findFirst({
      where: {
        action: { in: ['AI_ASSISTANT_MARK_DUE', 'AI_ASSISTANT_CLEAR_DUE', 'RECORD_DUE'] },
        userId: phyOfficer!.id
      },
      orderBy: { timestamp: 'desc' }
    });
    assert(Boolean(auditRecord), 'Audit record for AI_ASSISTANT_MARK_DUE / RECORD_DUE created in database');

    // ─────────────────────────────────────────────────────────────
    // TEST 7: Attempting to Alter Staged Parameters Fails
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 7: Attempting to Alter Staged Parameters Fails ---');

    const stagedForTampering = await AiAssistantService.processMessage({
      user: phyOfficerContext,
      messages: [
        { role: 'user', content: 'Mark ₹250 due on 4MC24IS022 for wire snap.' }
      ],
      departmentCode: 'PHY'
    });

    let tamperError: any = null;
    try {
      await AiAssistantService.confirmAndExecute(
        stagedForTampering.actionRequired!.token,
        phyOfficer!.id,
        null,
        { action: 'MARK_DUE', usn: '4MC24IS022', amount: 9999 } // Tampered amount
      );
    } catch (err: any) {
      tamperError = err;
    }
    assert(Boolean(tamperError), 'Tampered confirmation parameters rejected: ' + tamperError?.message);

    // ─────────────────────────────────────────────────────────────
    // TEST 8: Token Expiration Protection
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 8: Token Expiration Protection ---');

    const stagedForExpiry = await AiAssistantService.processMessage({
      user: phyOfficerContext,
      messages: [
        { role: 'user', content: 'Mark ₹150 due on 4MC24IS022 for pendulum wire.' }
      ],
      departmentCode: 'PHY'
    });

    // Manually backdate expiry in DB
    await prisma.aiConfirmationToken.update({
      where: { token: stagedForExpiry.actionRequired!.token },
      data: { expiresAt: new Date(Date.now() - 60000) } // Expired 1 minute ago
    });

    let expiryError: any = null;
    try {
      await AiAssistantService.confirmAndExecute(stagedForExpiry.actionRequired!.token, phyOfficer!.id);
    } catch (err: any) {
      expiryError = err;
    }
    assert(Boolean(expiryError), 'Expired confirmation token rejected: ' + expiryError?.message);

    // ─────────────────────────────────────────────────────────────
    // TEST 9: Unauthorized Department Boundaries
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 9: Unauthorized Department Boundaries ---');

    // Chemistry officer attempting to mutate Physics Lab clearance
    let unauthorizedError: any = null;
    try {
      // Stage action under Physics lab
      const phyStaged = await AiAssistantService.processMessage({
        user: phyOfficerContext,
        messages: [{ role: 'user', content: 'Mark ₹100 due on 4MC24IS022.' }],
        departmentCode: 'PHY'
      });

      // Attempt execution as Chemistry officer
      await AiAssistantService.confirmAndExecute(phyStaged.actionRequired!.token, cheOfficer!.id);
    } catch (err: any) {
      unauthorizedError = err;
    }
    assert(Boolean(unauthorizedError), 'Cross-department unauthorized execution prevented: ' + unauthorizedError?.message);

    // ─────────────────────────────────────────────────────────────
    // TEST 10: Natural Phrasings for Clearing Dues & Read-Only Queries
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 10: Natural Phrasings for Clearing Dues & Read-Only Queries ---');

    // Natural clearing: "He returned the apparatus, so remove that charge."
    const resClearDue = await AiAssistantService.processMessage({
      user: phyOfficerContext,
      messages: [
        { role: 'user', content: 'Details for 4MC24IS022' },
        { role: 'model', content: 'Student 4MC24IS022 has an outstanding due of ₹300.' },
        { role: 'user', content: 'He returned the apparatus, so remove that charge.' }
      ],
      departmentCode: 'PHY'
    });
    assert(Boolean(resClearDue.actionRequired), 'Natural phrasing "He returned the apparatus, so remove that charge" staged confirmation');
    assert(resClearDue.actionRequired?.action === 'CLEAR_DUE', 'Action mapped to CLEAR_DUE');
    assert(resClearDue.actionRequired?.usn === '4MC24IS022', 'USN resolved as 4MC24IS022');

    // Confirm and execute the clearance
    const clearResult = await AiAssistantService.confirmAndExecute(resClearDue.actionRequired!.token, phyOfficer!.id);
    assert(clearResult.success === true, 'Clearance confirmed and executed successfully');

    const clearanceAfterRemoval = await prisma.ndcClearance.findUnique({
      where: { id: phyClearance!.id }
    });
    assert(Number(clearanceAfterRemoval?.dueAmount) === 0, 'Database due amount reset to 0');
    assert(clearanceAfterRemoval?.status === DepartmentClearanceStatus.CLEARED, 'Clearance status set to CLEARED');

    // Read-only query: "Who hasn't cleared their Physics Lab dues?"
    const resWhoPending = await AiAssistantService.processMessage({
      user: phyOfficerContext,
      messages: [
        { role: 'user', content: "Who hasn't cleared their Physics Lab dues?" }
      ],
      departmentCode: 'PHY'
    });
    assert(!resWhoPending.actionRequired, 'Read-only query staged zero mutation confirmation tokens');
    assert(resWhoPending.reply.length > 20, 'Read-only query returned substantive report');

    // Read-only query: "Check whether 4MC24IS022 has any pending dues."
    const resCheckPending = await AiAssistantService.processMessage({
      user: phyOfficerContext,
      messages: [
        { role: 'user', content: 'Check whether 4MC24IS022 has any pending dues.' }
      ],
      departmentCode: 'PHY'
    });
    assert(!resCheckPending.actionRequired, 'Read-only query for specific student staged zero confirmation tokens');
    assert(resCheckPending.reply.toLowerCase().includes('4mc24is022'), 'Read-only query provided status for 4MC24IS022');

    // Natural completion: "Mark this student's Physics Lab clearance as complete."
    const resMarkComplete = await AiAssistantService.processMessage({
      user: phyOfficerContext,
      messages: [
        { role: 'user', content: 'Look up 4MC24IS022' },
        { role: 'model', content: 'Student 4MC24IS022 status...' },
        { role: 'user', content: "Mark this student's Physics Lab clearance as complete." }
      ],
      departmentCode: 'PHY'
    });
    assert(Boolean(resMarkComplete.actionRequired), 'Natural phrasing "Mark this student\'s Physics Lab clearance as complete" staged confirmation');
    assert(resMarkComplete.actionRequired?.action === 'CLEAR_DUE', 'Action mapped to CLEAR_DUE');

    // Clean up test clearance record to PENDING
    await prisma.ndcClearance.update({
      where: { id: phyClearance!.id },
      data: { status: DepartmentClearanceStatus.PENDING as any, dueAmount: 0, dueDetails: '', remarks: '' }
    });

  } catch (error: any) {
    console.error('FATAL TEST SUITE ERROR:', error);
    failed++;
  } finally {
    console.log('\n════════════════════════════════════════════════════════════════');
    console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
    console.log('════════════════════════════════════════════════════════════════\n');
    await prisma.$disconnect();
    if (failed > 0) {
      process.exit(1);
    }
  }
}

runConversationalAiTests();
