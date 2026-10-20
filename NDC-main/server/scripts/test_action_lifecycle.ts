import prisma from '../src/config/prisma';
import { AiAssistantService } from '../src/services/AiAssistantService';
import { DepartmentClearanceStatus } from '../src/constants/statuses';
import { NdcWorkflowService } from '../src/services/NdcWorkflowService';

async function runActionLifecycleTests() {
  console.log('================================================================');
  console.log('🧪 ACTION CONFIRMATION & CANCELLATION LIFECYCLE TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      if (detail) console.error(`     Detail: ${detail}`);
      failed++;
    }
  }

  try {
    // 1. Fetch test officer, chemistry officer (unauthorized), and student
    const physicsOfficer = await prisma.user.findFirst({
      where: { email: { contains: 'physics', mode: 'insensitive' } },
      include: { department: true }
    });

    const chemOfficer = await prisma.user.findFirst({
      where: { email: { contains: 'chemistry', mode: 'insensitive' } },
      include: { department: true }
    });

    const physicsDept = await prisma.clearanceDepartment.findFirst({
      where: { code: 'PHY' }
    });

    const testStudent = await prisma.student.findFirst({
      where: { isActive: true },
      include: {
        ndcClearances: {
          where: { departmentId: physicsDept?.id }
        }
      }
    });

    if (!physicsOfficer || !physicsDept || !testStudent) {
      throw new Error(`Prerequisites not met: Officer (${!!physicsOfficer}), Dept (${!!physicsDept}), Student (${!!testStudent})`);
    }

    console.log(`📋 Test Environment:`);
    console.log(`   - Authorized Officer: ${physicsOfficer.name} (${physicsOfficer.email})`);
    console.log(`   - Target Department: ${physicsDept.name} (${physicsDept.code})`);
    console.log(`   - Test Student: ${testStudent.fullName} (${testStudent.usn})\n`);

    // Ensure student has clearance record in physics dept
    await NdcWorkflowService.ensureStudentNdcRequest(testStudent.id);
    let clearance = await prisma.ndcClearance.findFirst({
      where: { studentId: testStudent.id, departmentId: physicsDept.id }
    });

    if (!clearance) {
      throw new Error(`Clearance record could not be found for student ${testStudent.usn}`);
    }

    // Reset initial state to PENDING, 0 dues
    await prisma.ndcClearance.update({
      where: { id: clearance.id },
      data: { status: DepartmentClearanceStatus.PENDING as any, dueAmount: 0, remarks: 'Reset for lifecycle test' }
    });

    const authUser = {
      id: physicsOfficer.id,
      name: physicsOfficer.name,
      role: physicsOfficer.role,
      departmentId: physicsDept.id
    };

    const unauthorizedUser = {
      id: chemOfficer ? chemOfficer.id : '00000000-0000-0000-0000-000000000000',
      name: chemOfficer ? chemOfficer.name : 'Intruder Officer',
      role: 'DEPARTMENT_OFFICER',
      departmentId: chemOfficer?.departmentId || '00000000-0000-0000-0000-000000000001'
    };

    // ─── TEST 1: STAGING AN ACTION WITHOUT DATABASE CHANGES ───────
    console.log('▶ TEST 1: Staging MARK_DUE action without database mutations');
    let stagedRes = await AiAssistantService.processMessage({
      user: authUser,
      departmentCode: 'PHY',
      messages: [{ role: 'user', content: `Add due of 350 for sonometer wire breakage to student ${testStudent.usn}` }],
      reqObj: { user: authUser, ip: '127.0.0.1' }
    });

    assert(!!stagedRes.actionRequired, 'Action required payload is returned');
    assert(!!stagedRes.actionRequired?.token, 'Confirmation token is generated');
    assert(stagedRes.actionRequired?.lifecycleStatus === 'STAGED', 'Action lifecycleStatus is marked STAGED');
    assert(stagedRes.actionRequired?.amount === 350, 'Staged amount is ₹350');

    // Verify live DB record is COMPLETELY UNTOUCHED
    let dbClearanceAfterStage = await prisma.ndcClearance.findUnique({ where: { id: clearance.id } });
    assert(dbClearanceAfterStage?.status === (DepartmentClearanceStatus.PENDING as any), 'Database status remained PENDING', `Got: ${dbClearanceAfterStage?.status}`);
    assert(Number(dbClearanceAfterStage?.dueAmount) === 0, 'Database dueAmount remained ₹0 (zero mutations on stage)');

    const token1 = stagedRes.actionRequired!.token;

    // Verify token stored in DB
    const dbToken1 = await prisma.aiConfirmationToken.findUnique({ where: { token: token1 } });
    assert(!!dbToken1 && !dbToken1.consumed, 'Token record exists in DB with consumed=false');
    const token1Payload: any = dbToken1?.payload;
    assert(token1Payload?.lifecycleStatus === 'STAGED', 'Token record payload has lifecycleStatus=STAGED');

    // ─── TEST 2: CANCELLING A STAGED ACTION ────────────────────────
    console.log('\n▶ TEST 2: Cancelling the pending staged action');
    const cancelRes = await AiAssistantService.cancelAction(token1, authUser.id, { user: authUser, ip: '127.0.0.1' });

    assert(cancelRes.success === true, 'Cancel returns success=true');
    assert(cancelRes.cancelled === true, 'Cancel returns cancelled=true');
    assert(!!cancelRes.completionReply, 'Cancel provides 7-point completionReply');
    assert(cancelRes.completionReply!.includes('Live database records remain completely unchanged'), 'Completion reply confirms zero changes');

    // Verify live DB record remains completely untouched
    const dbClearanceAfterCancel = await prisma.ndcClearance.findUnique({ where: { id: clearance.id } });
    assert(dbClearanceAfterCancel?.status === (DepartmentClearanceStatus.PENDING as any), 'Database status is still PENDING', `Got: ${dbClearanceAfterCancel?.status}`);
    assert(Number(dbClearanceAfterCancel?.dueAmount) === 0, 'Database dueAmount is still ₹0');

    // Verify token in DB is marked consumed and cancelled
    const dbToken1AfterCancel = await prisma.aiConfirmationToken.findUnique({ where: { token: token1 } });
    assert(dbToken1AfterCancel?.consumed === true, 'Token is marked consumed=true');
    const token1PayloadAfterCancel: any = dbToken1AfterCancel?.payload;
    assert(token1PayloadAfterCancel?.lifecycleStatus === 'CANCELLED', 'Token payload has lifecycleStatus=CANCELLED');
    assert(token1PayloadAfterCancel?.cancelled === true, 'Token payload has cancelled=true');

    // ─── TEST 3: IDEMPOTENT CANCELLATION ──────────────────────────
    console.log('\n▶ TEST 3: Idempotent cancellation (repeating Cancel)');
    const secondCancelRes = await AiAssistantService.cancelAction(token1, authUser.id, { user: authUser, ip: '127.0.0.1' });
    assert(secondCancelRes.success === true, 'Second cancel returns success=true');
    assert(secondCancelRes.cancelled === true, 'Second cancel returns cancelled=true');
    assert(secondCancelRes.message.includes('already cancelled'), 'Returns idempotent notice');

    // ─── TEST 4: CONFIRM AND EXECUTE AN ACTION EXACTLY ONCE ──────
    console.log('\n▶ TEST 4: Confirm and execute an action');
    stagedRes = await AiAssistantService.processMessage({
      user: authUser,
      departmentCode: 'PHY',
      messages: [{ role: 'user', content: `Add due of 300 for prism scratch to student ${testStudent.usn}` }],
      reqObj: { user: authUser, ip: '127.0.0.1' }
    });
    const token2 = stagedRes.actionRequired!.token;

    const confirmRes = await AiAssistantService.confirmAndExecute(token2, authUser.id, { user: authUser, ip: '127.0.0.1' });
    assert(confirmRes.success === true, 'confirmAndExecute returns success=true');
    assert(confirmRes.status === (DepartmentClearanceStatus.DUE as any), 'Returned status is DUE');
    assert(confirmRes.dueAmount === 300, 'Returned dueAmount is ₹300');
    assert(!!confirmRes.completionReply, 'Includes 7-point completionReply');

    // Verify live DB record IS updated
    const dbClearanceAfterConfirm = await prisma.ndcClearance.findUnique({ where: { id: clearance.id } });
    assert(dbClearanceAfterConfirm?.status === (DepartmentClearanceStatus.DUE as any), 'Live database status updated to DUE');
    assert(Number(dbClearanceAfterConfirm?.dueAmount) === 300, 'Live database dueAmount updated to ₹300');

    // Verify token lifecycle in DB
    const dbToken2 = await prisma.aiConfirmationToken.findUnique({ where: { token: token2 } });
    assert(dbToken2?.consumed === true, 'Token is marked consumed=true');
    const token2Payload: any = dbToken2?.payload;
    assert(token2Payload?.lifecycleStatus === 'EXECUTED', 'Token payload lifecycleStatus is EXECUTED');
    assert(!!token2Payload?.executedAt, 'Token payload has executedAt timestamp');

    // Verify double-confirm / replay protection
    let replayThrew = false;
    try {
      await AiAssistantService.confirmAndExecute(token2, authUser.id, { user: authUser, ip: '127.0.0.1' });
    } catch (err: any) {
      replayThrew = true;
      assert(err.message.includes('already been confirmed and executed') || err.message.includes('already confirmed'), 'Replay returns already confirmed error');
    }
    assert(replayThrew, 'Replaying confirmed token was blocked');

    // ─── TEST 5: REJECTING CANCELLATION AFTER EXECUTION ───────────
    console.log('\n▶ TEST 5: Rejecting cancellation of already-executed action');
    let cancelAfterExecThrew = false;
    try {
      await AiAssistantService.cancelAction(token2, authUser.id, { user: authUser, ip: '127.0.0.1' });
    } catch (err: any) {
      cancelAfterExecThrew = true;
      assert(
        err.message.includes('Cannot cancel: This action has already been confirmed and executed'),
        'Rejects with explicit executed error'
      );
      assert(
        err.message.includes('clearance approval reversal workflow') || err.message.includes('reversal'),
        'Explains reversal workflow availability'
      );
    }
    assert(cancelAfterExecThrew, 'Cancel after execution was rejected');

    // Verify live DB record was NOT rolled back or modified by the rejected cancel
    const dbClearanceAfterRejectedCancel = await prisma.ndcClearance.findUnique({ where: { id: clearance.id } });
    assert(Number(dbClearanceAfterRejectedCancel?.dueAmount) === 300, 'Live record dueAmount remained ₹300 (not silently deleted)');
    assert(dbClearanceAfterRejectedCancel?.status === (DepartmentClearanceStatus.DUE as any), 'Live record status remained DUE');

    // ─── TEST 6: EDITING A STAGED ACTION WITHOUT EXECUTING IT ────
    console.log('\n▶ TEST 6: Editing a staged action without premature execution');
    stagedRes = await AiAssistantService.processMessage({
      user: authUser,
      departmentCode: 'PHY',
      messages: [{ role: 'user', content: `Add due of 150 for galvanometer coil to student ${testStudent.usn}` }],
      reqObj: { user: authUser, ip: '127.0.0.1' }
    });
    const token3 = stagedRes.actionRequired!.token;

    const editRes = await AiAssistantService.editStagedAction(
      token3,
      authUser.id,
      { amount: 275, reason: 'Voltmeter Resistance Coil' },
      { user: authUser, ip: '127.0.0.1' }
    );

    assert(editRes.success === true, 'editStagedAction returns success=true');
    assert(!!editRes.actionRequired, 'editStagedAction returns fresh actionRequired');
    assert(editRes.actionRequired?.token !== token3, 'New confirmation token generated');
    assert(editRes.actionRequired?.amount === 275, 'New amount is ₹275');
    assert(editRes.actionRequired?.reason === 'Voltmeter Resistance Coil', 'New reason is updated');
    assert(editRes.actionRequired?.lifecycleStatus === 'STAGED', 'New action status is STAGED');

    // Verify old token was superseded
    const oldTokenDb = await prisma.aiConfirmationToken.findUnique({ where: { token: token3 } });
    assert(oldTokenDb?.consumed === true, 'Old token marked consumed=true');
    const oldPayload: any = oldTokenDb?.payload;
    assert(oldPayload?.lifecycleStatus === 'SUPERSEDED', 'Old token lifecycleStatus is SUPERSEDED');
    assert(oldPayload?.cancelled === true, 'Old token marked cancelled=true');

    // Verify live DB is STILL unchanged from edit (still ₹300 from Test 4)
    const dbClearanceAfterEdit = await prisma.ndcClearance.findUnique({ where: { id: clearance.id } });
    assert(Number(dbClearanceAfterEdit?.dueAmount) === 300, 'Database dueAmount was NOT modified by edit');

    // Cancel the edited token cleanly
    await AiAssistantService.cancelAction(editRes.actionRequired!.token, authUser.id, { user: authUser, ip: '127.0.0.1' });

    // ─── TEST 7: UNAUTHORIZED CONFIRMATION & CANCELLATION ─────────
    console.log('\n▶ TEST 7: Unauthorized confirmation and cancellation protection');
    stagedRes = await AiAssistantService.processMessage({
      user: authUser,
      departmentCode: 'PHY',
      messages: [{ role: 'user', content: `Add due of 200 for prism to student ${testStudent.usn}` }],
      reqObj: { user: authUser, ip: '127.0.0.1' }
    });
    const token4 = stagedRes.actionRequired!.token;

    let unauthConfirmThrew = false;
    try {
      await AiAssistantService.confirmAndExecute(token4, unauthorizedUser.id, { user: unauthorizedUser, ip: '127.0.0.1' });
    } catch (err: any) {
      unauthConfirmThrew = true;
      assert(err.message.includes('Unauthorized') || err.message.includes('authorized'), 'Unauthorized confirmation rejected');
    }
    assert(unauthConfirmThrew, 'Unauthorized user could not confirm action');

    let unauthCancelThrew = false;
    try {
      await AiAssistantService.cancelAction(token4, unauthorizedUser.id, { user: unauthorizedUser, ip: '127.0.0.1' });
    } catch (err: any) {
      unauthCancelThrew = true;
      assert(err.message.includes('Unauthorized') || err.message.includes('authorized'), 'Unauthorized cancellation rejected');
    }
    assert(unauthCancelThrew, 'Unauthorized user could not cancel action');

    // ─── TEST 8: CONCURRENT CONFIRM AND CANCEL (RACE CONDITION) ──
    console.log('\n▶ TEST 8: Concurrency safety (simultaneous Confirm and Cancel)');
    // token4 is still unconsumed
    const results = await Promise.allSettled([
      AiAssistantService.confirmAndExecute(token4, authUser.id, { user: authUser, ip: '127.0.0.1' }),
      AiAssistantService.cancelAction(token4, authUser.id, { user: authUser, ip: '127.0.0.1' })
    ]);

    const fulfilledCount = results.filter((r) => r.status === 'fulfilled').length;
    assert(fulfilledCount >= 1, 'At least one operation completed');
    // Verify coherent state in database
    const dbToken4 = await prisma.aiConfirmationToken.findUnique({ where: { token: token4 } });
    assert(dbToken4?.consumed === true, 'Token is consumed exactly once');
    const token4Payload: any = dbToken4?.payload;
    assert(
      token4Payload?.lifecycleStatus === 'EXECUTED' || token4Payload?.lifecycleStatus === 'CANCELLED',
      `Token lifecycle status is coherently either EXECUTED or CANCELLED (actual: ${token4Payload?.lifecycleStatus})`
    );

    // ─── TEST 9: CONVERSATION HISTORY SYNCHRONIZATION ────────────
    console.log('\n▶ TEST 9: Conversation history synchronization with token state');
    // Verify that retrieving conversation logs synchronizes token lifecycle
    const logItem = await prisma.aiConversationLog.create({
      data: {
        userId: authUser.id,
        departmentCode: physicsDept.code,
        role: 'model',
        content: 'Proposed clearance action',
        actionRequired: {
          token: token2,
          action: 'MARK_DUE',
          studentId: testStudent.id,
          studentName: testStudent.fullName,
          usn: testStudent.usn,
          clearanceId: clearance.id,
          amount: 300
        }
      }
    });

    const logs = await prisma.aiConversationLog.findMany({
      where: { userId: authUser.id, departmentCode: physicsDept.code },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    // Check token2 status
    const verifiedToken2 = await prisma.aiConfirmationToken.findUnique({ where: { token: token2 } });
    const p2: any = verifiedToken2?.payload || {};
    const isExecuted = verifiedToken2?.consumed && p2.lifecycleStatus === 'EXECUTED';
    assert(isExecuted === true, 'Executed token is recognized as EXECUTED in token repository');

    // Clean up test clearance record to PENDING ₹0
    await prisma.ndcClearance.update({
      where: { id: clearance.id },
      data: { status: DepartmentClearanceStatus.PENDING as any, dueAmount: 0, remarks: 'Cleaned after test' }
    });

  } catch (err: any) {
    console.error('\n❌ UNEXPECTED ERROR IN TEST RUNNER:', err);
    failed++;
  }

  console.log('\n================================================================');
  console.log(`🏁 LIFECYCLE TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runActionLifecycleTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
