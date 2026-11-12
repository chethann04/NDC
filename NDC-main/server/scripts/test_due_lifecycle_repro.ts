import prisma from '../src/config/prisma';
import { AiAssistantService } from '../src/services/AiAssistantService';
import { DepartmentClearanceStatus } from '../src/constants/statuses';
import { UserRole } from '../src/constants/roles';

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

async function runDueLifecycleSuite() {
  console.log('================================================================');
  console.log('🧪 COMPREHENSIVE DUE LIFECYCLE & RECURRING DUE TEST SUITE');
  console.log('================================================================\n');

  try {
    const phyDept = await prisma.clearanceDepartment.findFirst({ where: { code: 'PHY' } });
    if (!phyDept) throw new Error('PHY department not found');

    const officer = await prisma.user.findFirst({
      where: {
        role: { in: [UserRole.DEPARTMENT_OFFICER, UserRole.ADMIN, UserRole.SUPER_ADMIN] },
        OR: [{ departmentId: phyDept.id }, { role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] } }]
      }
    });
    if (!officer) throw new Error('Officer not found');

    const officerContext = {
      id: officer.id,
      role: officer.role,
      name: officer.name,
      departmentId: phyDept.id
    };

    const student = await prisma.student.findFirst({
      where: { usn: '4MC24IS022' },
      include: { ndcClearances: { where: { departmentId: phyDept.id } } }
    });
    if (!student) throw new Error('Student 4MC24IS022 not found');

    let clearance = student.ndcClearances[0];
    if (!clearance) throw new Error('Clearance not found');

    // Reset initial state to PENDING, 0 dues
    await prisma.ndcClearance.update({
      where: { id: clearance.id },
      data: { status: DepartmentClearanceStatus.PENDING as any, dueAmount: 0, dueDetails: '', remarks: 'Initial test reset' }
    });

    const conversationMessages: Array<{ role: 'user' | 'model'; content: string }> = [];

    // ─────────────────────────────────────────────────────────────
    // TEST 1: Initial Due Addition (Lifecycle 1)
    // ─────────────────────────────────────────────────────────────
    console.log('▶ TEST 1: Add due of ₹300 for broken prism to 4MC24IS022');
    conversationMessages.push({ role: 'user', content: 'Add due of 300 for broken prism to 4MC24IS022' });

    const step1Stage = await AiAssistantService.processMessage({
      user: officerContext,
      messages: conversationMessages,
      departmentCode: 'PHY'
    });

    assert(Boolean(step1Stage.actionRequired), 'Step 1 staged confirmation action');
    assert(step1Stage.actionRequired?.action === 'MARK_DUE', 'Step 1 action is MARK_DUE');
    assert(step1Stage.actionRequired?.amount === 300, 'Step 1 amount is ₹300');

    // Live DB must remain PENDING with 0 dues before confirmation
    const dbPre1 = await prisma.ndcClearance.findUnique({ where: { id: clearance.id } });
    assert(dbPre1?.status === DepartmentClearanceStatus.PENDING, 'Zero mutations before confirmation');
    assert(Number(dbPre1?.dueAmount) === 0, 'Due amount remains 0 before confirmation');

    const token1 = step1Stage.actionRequired!.token;
    conversationMessages.push({ role: 'model', content: step1Stage.reply });

    // Confirm step 1
    const confirm1 = await AiAssistantService.confirmAndExecute(token1, officer.id);
    assert(confirm1.success === true, 'Step 1 confirmAndExecute succeeded');
    assert(confirm1.status === DepartmentClearanceStatus.DUE, 'Live status updated to DUE');
    assert(Number(confirm1.dueAmount) === 300, 'Live due amount updated to ₹300');

    const tokenRecord1 = await prisma.aiConfirmationToken.findUnique({ where: { token: token1 } });
    const payload1 = tokenRecord1?.payload as any;
    const dueInstanceId1 = payload1?.dueInstanceId;
    assert(Boolean(dueInstanceId1), `Assigned unique dueInstanceId 1: ${dueInstanceId1}`);

    conversationMessages.push({ role: 'model', content: confirm1.completionReply });

    // ─────────────────────────────────────────────────────────────
    // TEST 2: Clear that due successfully (Lifecycle 1 Completed)
    // ─────────────────────────────────────────────────────────────
    console.log('\n▶ TEST 2: Clear that due successfully');
    conversationMessages.push({ role: 'user', content: 'Clear due for 4MC24IS022' });

    const step2Stage = await AiAssistantService.processMessage({
      user: officerContext,
      messages: conversationMessages,
      departmentCode: 'PHY'
    });

    assert(Boolean(step2Stage.actionRequired), 'Step 2 staged clear confirmation action');
    assert(step2Stage.actionRequired?.action === 'CLEAR_DUE', 'Step 2 action is CLEAR_DUE');

    const token2 = step2Stage.actionRequired!.token;
    conversationMessages.push({ role: 'model', content: step2Stage.reply });

    // Confirm step 2
    const confirm2 = await AiAssistantService.confirmAndExecute(token2, officer.id);
    assert(confirm2.success === true, 'Step 2 confirmAndExecute succeeded');
    assert(confirm2.status === DepartmentClearanceStatus.CLEARED, 'Live status transitioned to CLEARED');
    assert(Number(confirm2.dueAmount) === 0, 'Live due amount reset to ₹0');

    conversationMessages.push({ role: 'model', content: confirm2.completionReply });

    // ─────────────────────────────────────────────────────────────
    // TEST 3: Add the EXACT SAME due again (Lifecycle 2 Creation)
    // ─────────────────────────────────────────────────────────────
    console.log('\n▶ TEST 3: Add the exact same due again (₹300 for broken prism)');
    conversationMessages.push({ role: 'user', content: 'Add due of 300 for broken prism to 4MC24IS022' });

    const step3Stage = await AiAssistantService.processMessage({
      user: officerContext,
      messages: conversationMessages,
      departmentCode: 'PHY'
    });

    assert(Boolean(step3Stage.actionRequired), 'Step 3 staged action for new due instance');
    assert(step3Stage.actionRequired?.action === 'MARK_DUE', 'Step 3 action is MARK_DUE');
    assert(step3Stage.actionRequired?.amount === 300, 'Step 3 amount is ₹300');
    assert(
      !step3Stage.reply.includes('Clearance Already Completed'),
      'Step 3 does NOT falsely claim clearance already completed'
    );

    const token3 = step3Stage.actionRequired!.token;
    assert(token3 !== token1, 'Step 3 generates fresh distinct confirmation token');
    conversationMessages.push({ role: 'model', content: step3Stage.reply });

    // Confirm step 3
    const confirm3 = await AiAssistantService.confirmAndExecute(token3, officer.id);
    assert(confirm3.success === true, 'Step 3 confirmAndExecute succeeded');
    assert(confirm3.status === DepartmentClearanceStatus.DUE, 'Live status updated to DUE for second due');
    assert(Number(confirm3.dueAmount) === 300, 'Live due amount updated to ₹300 for second due');

    const tokenRecord3 = await prisma.aiConfirmationToken.findUnique({ where: { token: token3 } });
    const payload3 = tokenRecord3?.payload as any;
    const dueInstanceId2 = payload3?.dueInstanceId;
    assert(Boolean(dueInstanceId2), `Assigned unique dueInstanceId 2: ${dueInstanceId2}`);
    assert(dueInstanceId2 !== dueInstanceId1, 'Second due instance has distinct lifecycle identity from first due');

    conversationMessages.push({ role: 'model', content: confirm3.completionReply });

    // ─────────────────────────────────────────────────────────────
    // TEST 4: Clear the newly added due (Lifecycle 2 Completed)
    // ─────────────────────────────────────────────────────────────
    console.log('\n▶ TEST 4: Clear the newly added second due');
    conversationMessages.push({ role: 'user', content: 'Clear due for 4MC24IS022' });

    const step4Stage = await AiAssistantService.processMessage({
      user: officerContext,
      messages: conversationMessages,
      departmentCode: 'PHY'
    });

    assert(Boolean(step4Stage.actionRequired), 'Step 4 successfully staged clear action for newly added due');
    assert(step4Stage.actionRequired?.action === 'CLEAR_DUE', 'Step 4 action is CLEAR_DUE');
    assert(
      !step4Stage.reply.includes('Clearance Already Completed'),
      'Step 4 does NOT falsely block clear on active due'
    );

    const token4 = step4Stage.actionRequired!.token;
    assert(token4 !== token2, 'Step 4 generates fresh distinct confirmation token');
    conversationMessages.push({ role: 'model', content: step4Stage.reply });

    // Confirm step 4
    const confirm4 = await AiAssistantService.confirmAndExecute(token4, officer.id);
    assert(confirm4.success === true, 'Step 4 confirmAndExecute succeeded');
    assert(confirm4.status === DepartmentClearanceStatus.CLEARED, 'Live status transitioned to CLEARED');
    assert(Number(confirm4.dueAmount) === 0, 'Live due amount reset to ₹0');

    conversationMessages.push({ role: 'model', content: confirm4.completionReply });

    // ─────────────────────────────────────────────────────────────
    // TEST 5: Replay Protection & Already Completed Handling
    // ─────────────────────────────────────────────────────────────
    console.log('\n▶ TEST 5: Replay protection and already completed handling');

    // 5A: Replay consumed token from Step 4
    let replayThrew = false;
    try {
      await AiAssistantService.confirmAndExecute(token4, officer.id);
    } catch (err: any) {
      replayThrew = true;
      assert(
        err.message.includes('already been confirmed and executed') || err.message.includes('already confirmed'),
        'Replay attempt rejected with already confirmed error'
      );
    }
    assert(replayThrew, 'Replaying consumed token was blocked');

    // 5B: Clearing already cleared clearance in conversation
    conversationMessages.push({ role: 'user', content: 'Clear due for 4MC24IS022' });
    const step5Stage = await AiAssistantService.processMessage({
      user: officerContext,
      messages: conversationMessages,
      departmentCode: 'PHY'
    });

    assert(step5Stage.actionRequired === null, 'No action staged when student already has 0 dues');
    assert(
      step5Stage.reply.includes('Clearance Already Completed') ||
      step5Stage.reply.includes('already verified and marked as CLEARED') ||
      step5Stage.reply.includes('already has No Due'),
      'Correctly informs officer that clearance is already completed'
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 6: Duplicate Active Due Detection
    // ─────────────────────────────────────────────────────────────
    console.log('\n▶ TEST 6: Duplicate active due detection (preventing duplicate write of exact active due)');
    // Put clearance back in DUE state with ₹300 for broken prism
    await prisma.ndcClearance.update({
      where: { id: clearance.id },
      data: { status: DepartmentClearanceStatus.DUE as any, dueAmount: 300, dueDetails: 'broken prism' }
    });

    const dupStageRes = await AiAssistantService.processMessage({
      user: officerContext,
      messages: [{ role: 'user', content: 'Add due of 300 for broken prism to 4MC24IS022' }],
      departmentCode: 'PHY'
    });

    assert(dupStageRes.actionRequired === null, 'Duplicate active due blocked from staging');
    assert(
      dupStageRes.reply.includes('Duplicate due detected') || dupStageRes.reply.includes('already recorded'),
      'Provides explicit duplicate due detection explanation'
    );

    // ─────────────────────────────────────────────────────────────
    // TEARDOWN
    // ─────────────────────────────────────────────────────────────
    await prisma.ndcClearance.update({
      where: { id: clearance.id },
      data: { status: DepartmentClearanceStatus.PENDING as any, dueAmount: 0, dueDetails: '', remarks: 'Clean teardown' }
    });

  } catch (err: any) {
    console.error('\n❌ UNEXPECTED ERROR IN TEST SUITE:', err);
    failed++;
  } finally {
    await prisma.$disconnect();
  }

  console.log('\n================================================================');
  console.log(`🏁 DUE LIFECYCLE RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runDueLifecycleSuite();
