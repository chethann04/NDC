import prisma from '../src/config/prisma';
import { AiAssistantService } from '../src/services/AiAssistantService';
import { WorkflowStateMachine, WorkflowState } from '../src/services/ai/WorkflowStateMachine';
import { DepartmentClearanceStatus } from '../src/constants/statuses';
import { NdcWorkflowService } from '../src/services/NdcWorkflowService';

async function runStatisticsInquiryRegressionTests() {
  console.log('================================================================');
  console.log('🤖 STARTING STATISTICS INQUIRY & MUTATION REGRESSION SUITE');
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

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  let physicsOfficerUser: any = null;

  try {
    // 0. Locate test actors
    const physicsDept = await prisma.clearanceDepartment.findFirst({
      where: { code: 'PHY' }
    });
    if (!physicsDept) throw new Error('Physics department (PHY) not found');

    const physicsOfficer = await prisma.user.findFirst({
      where: {
        role: 'DEPARTMENT_OFFICER',
        OR: [
          { departmentId: physicsDept.id },
          { email: { contains: 'physics', mode: 'insensitive' } },
          { loginId: 'PHY001' }
        ]
      }
    });
    if (!physicsOfficer) throw new Error('Physics officer not found');
    physicsOfficerUser = physicsOfficer;

    const adminUser = await prisma.user.findFirst({
      where: { role: 'ADMIN' }
    });
    if (!adminUser) throw new Error('Admin user not found');

    // Ensure 4MC24IS022 or active student exists
    let testStudent = await prisma.student.findUnique({
      where: { usn: '4MC24IS022' }
    });
    if (!testStudent) {
      testStudent = await prisma.student.findFirst({
        where: { isActive: true }
      });
    }
    if (!testStudent) throw new Error('No active student found for test');

    await NdcWorkflowService.ensureStudentNdcRequest(testStudent.id);
    let clearance = await prisma.ndcClearance.findFirst({
      where: { studentId: testStudent.id, departmentId: physicsDept.id }
    });
    if (!clearance) {
      const ndcReq = await prisma.ndcRequest.findFirst({ where: { studentId: testStudent.id } });
      if (ndcReq) {
        clearance = await prisma.ndcClearance.create({
          data: {
            ndcRequestId: ndcReq.id,
            studentId: testStudent.id,
            departmentId: physicsDept.id,
            status: DepartmentClearanceStatus.PENDING as any,
            dueAmount: 0
          }
        });
      }
    }

    // Clean up any stale tokens for test officer before suite runs
    await prisma.aiConfirmationToken.deleteMany({
      where: { userId: physicsOfficer.id }
    });

    const officerContext = {
      user: {
        id: physicsOfficer.id,
        name: physicsOfficer.name,
        role: physicsOfficer.role,
        departmentId: physicsDept.id
      },
      departmentCode: physicsDept.code
    };

    const adminContext = {
      user: {
        id: adminUser.id,
        name: adminUser.name,
        role: adminUser.role
      },
      departmentCode: 'ADM'
    };

    console.log(`📋 Test Environment:`);
    console.log(`   - Officer: ${physicsOfficer.name} (${physicsOfficer.email}) [Dept: ${physicsDept.name}]`);
    console.log(`   - Admin: ${adminUser.name} (${adminUser.email})`);
    console.log(`   - Test Student: ${testStudent.fullName} (${testStudent.usn})\n`);

    // ─────────────────────────────────────────────────────────────
    // TEST 1: "how many students due is cleared?" -> statistics inquiry
    // ─────────────────────────────────────────────────────────────
    console.log('▶ TEST 1: "how many students due is cleared?" -> statistics inquiry');
    {
      const q = 'how many students due is cleared?';
      const isStat = WorkflowStateMachine.isStatisticalInquiry(q);
      const hasClear = WorkflowStateMachine.hasClearDueSignal(q);
      const stateResult = WorkflowStateMachine.analyzeHistory([{ role: 'user', content: q }]);

      assert(isStat === true, 'isStatisticalInquiry returns true for "how many students due is cleared?"');
      assert(hasClear === false, 'hasClearDueSignal returns false (not intercepted as CLEAR_DUE)');
      assert(stateResult.intent === 'DEPARTMENT_REPORT', 'StateMachine routes intent to DEPARTMENT_REPORT');

      await sleep(800);
      const res = await AiAssistantService.processMessage({
        ...officerContext,
        messages: [{ role: 'user', content: q }]
      });

      assert(!res.actionRequired, 'No operational mutation actionRequired returned');
      assert(!res.reply.toLowerCase().includes("please provide the student's usn"), 'Does NOT ask for a student USN');
      assert(
        res.reply.includes('Cleared (No Due)') ||
          (res.reply.includes('No Due') && res.reply.toLowerCase().includes('cleared')),
        'Response contains cleared statistics'
      );
      console.log(`   Sample response snippet:\n   ${res.reply.split('\n')[0]}`);
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 2: "how many students are cleared?" -> statistics inquiry
    // ─────────────────────────────────────────────────────────────
    console.log('\n▶ TEST 2: "how many students are cleared?" -> statistics inquiry');
    {
      const q = 'how many students are cleared?';
      const isStat = WorkflowStateMachine.isStatisticalInquiry(q);
      const hasClear = WorkflowStateMachine.hasClearDueSignal(q);

      assert(isStat === true, 'isStatisticalInquiry returns true for "how many students are cleared?"');
      assert(hasClear === false, 'hasClearDueSignal returns false');

      await sleep(800);
      const res = await AiAssistantService.processMessage({
        ...officerContext,
        messages: [{ role: 'user', content: q }]
      });

      assert(!res.actionRequired, 'No operational mutation actionRequired returned');
      assert(!res.reply.toLowerCase().includes("please provide the student's usn"), 'Does NOT ask for a student USN');
      assert(res.reply.includes('Cleared (No Due)'), 'Response contains cleared metric summary');
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 3: "how many students have pending dues?" -> statistics inquiry
    // ─────────────────────────────────────────────────────────────
    console.log('\n▶ TEST 3: "how many students have pending dues?" -> statistics inquiry');
    {
      const q = 'how many students have pending dues?';
      const isStat = WorkflowStateMachine.isStatisticalInquiry(q);
      const hasAdd = WorkflowStateMachine.hasAddDueSignal(q);
      const hasClear = WorkflowStateMachine.hasClearDueSignal(q);

      assert(isStat === true, 'isStatisticalInquiry returns true for "how many students have pending dues?"');
      assert(hasAdd === false, 'hasAddDueSignal returns false (not intercepted as ADD_DUE)');
      assert(hasClear === false, 'hasClearDueSignal returns false');

      await sleep(800);
      const res = await AiAssistantService.processMessage({
        ...officerContext,
        messages: [{ role: 'user', content: q }]
      });

      assert(!res.actionRequired, 'No mutation triggered');
      assert(!res.reply.toLowerCase().includes("please provide the student's usn"), 'Does NOT ask for a student USN');
      assert(res.reply.includes('Flagged With Dues') || res.reply.includes('Pending'), 'Response contains pending dues statistics');
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 4: "what is the total number of students?" -> statistics inquiry
    // ─────────────────────────────────────────────────────────────
    console.log('\n▶ TEST 4: "what is the total number of students?" -> statistics inquiry');
    {
      const q = 'what is the total number of students?';
      const isStat = WorkflowStateMachine.isStatisticalInquiry(q);

      assert(isStat === true, 'isStatisticalInquiry returns true for "what is the total number of students?"');

      await sleep(800);
      const res = await AiAssistantService.processMessage({
        ...officerContext,
        messages: [{ role: 'user', content: q }]
      });

      assert(!res.actionRequired, 'No mutation triggered');
      assert(!res.reply.toLowerCase().includes("please provide the student's usn"), 'Does NOT ask for a student USN');
      assert(res.reply.includes('registered students for clearance'), 'Response returns total student count');
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 5: "show clearance statistics" -> report inquiry
    // ─────────────────────────────────────────────────────────────
    console.log('\n▶ TEST 5: "show clearance statistics" -> report inquiry');
    {
      const q = 'show clearance statistics';
      const isStat = WorkflowStateMachine.isStatisticalInquiry(q);
      const stateResult = WorkflowStateMachine.analyzeHistory([{ role: 'user', content: q }]);

      assert(isStat === true, 'isStatisticalInquiry returns true for "show clearance statistics"');
      assert(stateResult.intent === 'DEPARTMENT_REPORT', 'StateMachine routes to DEPARTMENT_REPORT');

      await sleep(800);
      const res = await AiAssistantService.processMessage({
        ...officerContext,
        messages: [{ role: 'user', content: q }]
      });

      assert(!res.actionRequired, 'No mutation triggered');
      assert(res.reply.includes('| Metric | Count | Share |') && res.reply.includes('Clearance Report'), 'Returns full Markdown report table');
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 6: "clear due for <USN>" -> mutation protected
    // ─────────────────────────────────────────────────────────────
    console.log(`\n▶ TEST 6: "clear due for ${testStudent.usn}" -> mutation protected`);
    {
      const q = `clear due for ${testStudent.usn}`;
      const isStat = WorkflowStateMachine.isStatisticalInquiry(q);
      const hasClear = WorkflowStateMachine.hasClearDueSignal(q);
      const stateResult = WorkflowStateMachine.analyzeHistory([{ role: 'user', content: q }]);

      assert(isStat === false, 'isStatisticalInquiry returns false when USN is present');
      assert(hasClear === true, 'hasClearDueSignal returns true');
      assert(stateResult.intent === 'CLEAR_DUE', 'StateMachine routes intent to CLEAR_DUE');
      assert(stateResult.usn === testStudent.usn, 'USN is correctly extracted');

      const res = await AiAssistantService.processMessage({
        ...officerContext,
        messages: [{ role: 'user', content: q }]
      });

      assert(res.actionRequired !== null && res.actionRequired !== undefined, 'Operational mutation staged (actionRequired present)');
      assert(res.actionRequired?.action === 'CLEAR_DUE', 'actionRequired action is CLEAR_DUE');
      assert(res.actionRequired?.usn === testStudent.usn, 'actionRequired usn matches target student');
      assert(typeof res.actionRequired?.token === 'string' && res.actionRequired.token.length > 0, 'Security confirmation token generated');
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 7: "approve clearance for <USN>" -> mutation protected
    // ─────────────────────────────────────────────────────────────
    console.log(`\n▶ TEST 7: "approve clearance for ${testStudent.usn}" -> mutation protected`);
    {
      const q = `approve clearance for ${testStudent.usn}`;
      const isStat = WorkflowStateMachine.isStatisticalInquiry(q);
      const hasClear = WorkflowStateMachine.hasClearDueSignal(q);
      const stateResult = WorkflowStateMachine.analyzeHistory([{ role: 'user', content: q }]);

      assert(isStat === false, 'isStatisticalInquiry returns false when USN is present');
      assert(hasClear === true, 'hasClearDueSignal returns true');
      assert(stateResult.intent === 'CLEAR_DUE', 'StateMachine routes intent to CLEAR_DUE');

      const res = await AiAssistantService.processMessage({
        ...officerContext,
        messages: [{ role: 'user', content: q }]
      });

      assert(res.actionRequired !== null && res.actionRequired !== undefined, 'Operational mutation staged');
      assert(res.actionRequired?.action === 'CLEAR_DUE', 'actionRequired action is CLEAR_DUE');
      assert(res.actionRequired?.usn === testStudent.usn, 'actionRequired usn matches');
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 8: "Clear due" followed by USN -> multi-turn pending mutation continues
    // ─────────────────────────────────────────────────────────────
    console.log('\n▶ TEST 8: Multi-turn "Clear due" followed by USN');
    {
      // Clean up previous tokens before testing multi-turn initialization
      await prisma.aiConfirmationToken.deleteMany({
        where: { userId: physicsOfficer.id }
      });

      // Turn 1
      const turn1State = WorkflowStateMachine.analyzeHistory([{ role: 'user', content: 'Clear due' }]);
      assert(turn1State.state === WorkflowState.REQUIRED_INFORMATION_MISSING, 'Turn 1: state is REQUIRED_INFORMATION_MISSING');
      assert(turn1State.intent === 'CLEAR_DUE', 'Turn 1: intent is CLEAR_DUE');

      const turn1Res = await AiAssistantService.processMessage({
        ...officerContext,
        messages: [{ role: 'user', content: 'Clear due' }]
      });
      assert(!turn1Res.actionRequired, 'Turn 1: No mutation executed yet');
      assert(turn1Res.reply.toLowerCase().includes('usn'), 'Turn 1: Prompts user to supply USN');

      // Turn 2
      const history = [
        { role: 'user' as const, content: 'Clear due' },
        { role: 'model' as const, content: turn1Res.reply },
        { role: 'user' as const, content: testStudent.usn }
      ];

      const turn2State = WorkflowStateMachine.analyzeHistory(history);
      assert(turn2State.intent === 'CLEAR_DUE', 'Turn 2: Recovers CLEAR_DUE intent');
      assert(turn2State.usn === testStudent.usn, 'Turn 2: Recovers target USN');
      assert(turn2State.isContinuation === true, 'Turn 2: Marks isContinuation as true');

      const turn2Res = await AiAssistantService.processMessage({
        ...officerContext,
        messages: history
      });

      assert(turn2Res.actionRequired !== null && turn2Res.actionRequired !== undefined, 'Turn 2: Completes flow and stages CLEAR_DUE mutation');
      assert(turn2Res.actionRequired?.action === 'CLEAR_DUE', 'Turn 2: action is CLEAR_DUE');
      assert(turn2Res.actionRequired?.usn === testStudent.usn, 'Turn 2: action USN matches');

      // Cleanup
      await prisma.aiConfirmationToken.deleteMany({
        where: { userId: physicsOfficer.id }
      });
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 9: Statistics query from admin -> institution-scoped results
    // ─────────────────────────────────────────────────────────────
    console.log('\n▶ TEST 9: Statistics query from admin -> institution-scoped results');
    {
      const q = 'how many students due is cleared?';
      await sleep(800);
      const res = await AiAssistantService.processMessage({
        ...adminContext,
        messages: [{ role: 'user', content: q }]
      });

      assert(!res.actionRequired, 'Admin query: No mutation triggered');
      assert(res.reply.startsWith('Across the institution'), 'Admin query is scoped with "Across the institution"');
      assert(res.reply.includes('Cleared (No Due)'), 'Admin query returns clearance stats');
      console.log(`   Admin snippet:\n   ${res.reply.split('\n')[0]}`);
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 10: Statistics query from department officer -> department-scoped results
    // ─────────────────────────────────────────────────────────────
    console.log('\n▶ TEST 10: Statistics query from department officer -> department-scoped results');
    {
      const q = 'how many students due is cleared?';
      await sleep(800);
      const res = await AiAssistantService.processMessage({
        ...officerContext,
        messages: [{ role: 'user', content: q }]
      });

      assert(!res.actionRequired, 'Officer query: No mutation triggered');
      assert(res.reply.startsWith(`In **${physicsDept.name}**`), `Officer query is scoped to department ("In **${physicsDept.name}**")`);
      assert(!res.reply.startsWith('Across the institution'), 'Officer query is NOT institution-wide');
      console.log(`   Officer snippet:\n   ${res.reply.split('\n')[0]}`);
    }

  } catch (err: any) {
    console.error('Fatal error during test suite execution:', err);
    failed++;
  } finally {
    if (physicsOfficerUser) {
      await prisma.aiConfirmationToken.deleteMany({
        where: { userId: physicsOfficerUser.id }
      });
    }
    await prisma.$disconnect();
  }

  console.log('\n================================================================');
  console.log(`TEST RESULTS: ${passed} passed, ${failed} failed`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runStatisticsInquiryRegressionTests();
