import prisma from '../src/config/prisma';
import { AiAssistantService } from '../src/services/AiAssistantService';
import { WorkflowStateMachine, WorkflowState } from '../src/services/ai/WorkflowStateMachine';
import { DepartmentClearanceStatus } from '../src/constants/statuses';
import { NdcWorkflowService } from '../src/services/NdcWorkflowService';

async function runRegressionTests() {
  console.log('================================================================');
  console.log('🤖 STARTING MULTI-TURN AI WORKFLOW REGRESSION TEST SUITE');
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
    // 1. Fetch test officer and student
    const physicsOfficer = await prisma.user.findFirst({
      where: { email: { contains: 'physics', mode: 'insensitive' } },
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

    console.log(`📋 Test Environment Initialized:`);
    console.log(`   - Officer: ${physicsOfficer.name} (${physicsOfficer.email})`);
    console.log(`   - Department: ${physicsDept.name} (${physicsDept.code})`);
    console.log(`   - Student: ${testStudent.fullName} (${testStudent.usn})\n`);

    // Ensure student has clearance record in physics dept
    await NdcWorkflowService.ensureStudentNdcRequest(testStudent.id);
    let clearance = await prisma.ndcClearance.findFirst({
      where: { studentId: testStudent.id, departmentId: physicsDept.id }
    });

    if (!clearance) {
      throw new Error(`Clearance record could not be initialized for student ${testStudent.usn} in ${physicsDept.name}`);
    }

    const testUser = {
      id: physicsOfficer.id,
      name: physicsOfficer.name,
      role: physicsOfficer.role,
      departmentId: physicsDept.id
    };

    // ─── TEST 1: WORKFLOW STATE MACHINE TURN-BY-TURN ANALYSIS ─────
    console.log('▶ TEST 1: Multi-turn State Machine intent recovery');
    {
      const history1 = [
        { role: 'user', content: 'Clear dues for student clearance please' },
        { role: 'model', content: '### ⚠️ Missing Required Information\n\nPlease specify the student\'s USN (e.g. `4MC24IS022`) to clear clearance.' },
        { role: 'user', content: testStudent.usn }
      ];

      const turnState = WorkflowStateMachine.analyzeHistory(history1);
      assert(turnState.intent === 'CLEAR_DUE', 'Turn 2 recovers CLEAR_DUE intent from prior turn context');
      assert(turnState.usn === testStudent.usn, 'Turn 2 recovers target USN from latest message');
      assert(turnState.isContinuation === true, 'Turn 2 marks isContinuation as true');
      assert(turnState.state === WorkflowState.RECORD_RETRIEVED, 'Turn 2 transitions to RECORD_RETRIEVED state');
    }

    // ─── TEST 2: END-TO-END PROCESS MESSAGE WITH MULTI-TURN ───────
    console.log('\n▶ TEST 2: End-to-end multi-turn clearance request execution');
    {
      // Reset clearance to PENDING with 0 dues
      await prisma.ndcClearance.update({
        where: { id: clearance.id },
        data: {
          status: DepartmentClearanceStatus.PENDING as any,
          dueAmount: 0,
          dueDetails: null,
          remarks: 'Pending verification'
        }
      });

      // Clear any prior confirmation tokens
      await prisma.aiConfirmationToken.deleteMany({
        where: { clearanceId: clearance.id }
      });

      // Turn 1: User asks without USN
      const responseTurn1 = await AiAssistantService.processMessage({
        user: testUser,
        departmentCode: 'PHY',
        messages: [{ role: 'user', content: 'Clear student clearance as No Due' }],
        reqObj: { user: testUser, ip: '127.0.0.1' }
      });

      assert(responseTurn1.actionRequired === null, 'Turn 1 does not generate confirmation token');
      assert(responseTurn1.reply.includes('Missing Required Information') || responseTurn1.reply.includes('Student USN'), 'Turn 1 asks for student USN');

      // Turn 2: User supplies USN
      const responseTurn2 = await AiAssistantService.processMessage({
        user: testUser,
        departmentCode: 'PHY',
        messages: [
          { role: 'user', content: 'Clear student clearance as No Due' },
          { role: 'model', content: responseTurn1.reply },
          { role: 'user', content: testStudent.usn }
        ],
        reqObj: { user: testUser, ip: '127.0.0.1' }
      });

      assert(responseTurn2.actionRequired !== null, 'Turn 2 stages action with confirmation token (does NOT stop at record lookup)');
      assert(responseTurn2.actionRequired?.action === 'CLEAR_DUE', 'Turn 2 staged action is CLEAR_DUE');
      assert(responseTurn2.actionRequired?.usn === testStudent.usn, 'Turn 2 staged action has correct USN');
      assert(responseTurn2.reply.includes('1. **Understood**'), 'Turn 2 response includes Point 1 (Understood)');
      assert(responseTurn2.reply.includes('2. **Record Found**'), 'Turn 2 response includes Point 2 (Record Found)');
      assert(responseTurn2.reply.includes('3. **Validation Established**'), 'Turn 2 response includes Point 3 (Validation Established)');
      assert(responseTurn2.reply.includes('4. **Proposed Action**'), 'Turn 2 response includes Point 4 (Proposed Action)');
      assert(responseTurn2.reply.includes('5. **Expected Outcome**'), 'Turn 2 response includes Point 5 (Expected Outcome)');
      assert(responseTurn2.reply.includes('6. **Pending Confirmation**'), 'Turn 2 response includes Point 6 (Pending Confirmation)');
      assert(responseTurn2.reply.includes('7. **Next Step**'), 'Turn 2 response includes Point 7 (Next Step)');

      // Verify the generated token is in DB
      const token = responseTurn2.actionRequired!.token;
      const dbToken = await prisma.aiConfirmationToken.findUnique({
        where: { token }
      });
      assert(!!dbToken && dbToken.consumed === false, 'HMAC confirmation token stored safely in DB with consumed=false');

      // ─── TEST 3: CONFIRMATION & EXECUTION LIFECYCLE ─────────────
      console.log('\n▶ TEST 3: Confirm and execute staged clearance approval');
      const execResult = await AiAssistantService.confirmAndExecute(
        token,
        physicsOfficer.id,
        { user: physicsOfficer, ip: '127.0.0.1' }
      );

      assert(execResult.success === true, 'Execution result is success=true');
      assert(execResult.status === DepartmentClearanceStatus.CLEARED, 'Execution result returns CLEARED status');
      assert(!!execResult.completionReply, 'Execution result includes 7-point completionReply');
      assert(execResult.completionReply.includes('Action Executed and Verified in Live Records'), 'Completion reply confirms live record update');

      // Verify live DB record
      const refreshedClearance = await prisma.ndcClearance.findUnique({
        where: { id: clearance.id }
      });
      assert(refreshedClearance?.status === (DepartmentClearanceStatus.CLEARED as any), 'Live database clearance status updated to CLEARED');
      assert(Number(refreshedClearance?.dueAmount) === 0, 'Live database clearance dueAmount is ₹0');

      // ─── TEST 4: REPLAY PROTECTION ──────────────────────────────
      console.log('\n▶ TEST 4: Token replay attack protection');
      let replayFailed = false;
      try {
        await AiAssistantService.confirmAndExecute(
          token,
          physicsOfficer.id,
          { user: physicsOfficer, ip: '127.0.0.1' }
        );
      } catch (err: any) {
        replayFailed = true;
        assert(err.message.includes('already been confirmed') || err.message.includes('not available'), 'Replay rejected with proper safety error');
      }
      assert(replayFailed, 'Second execution of same token prevented');
    }

    // ─── TEST 5: ALREADY COMPLETED RECOGNITION ────────────────────
    console.log('\n▶ TEST 5: ALREADY_COMPLETED handling');
    {
      // Student is now CLEARED with 0 dues
      const alreadyClearedResponse = await AiAssistantService.processMessage({
        user: testUser,
        departmentCode: 'PHY',
        messages: [{ role: 'user', content: `Clear clearance for student ${testStudent.usn}` }],
        reqObj: { user: testUser, ip: '127.0.0.1' }
      });

      assert(alreadyClearedResponse.actionRequired === null, 'No new confirmation token generated for already cleared student');
      assert(alreadyClearedResponse.reply.includes('Clearance Already Completed'), 'Response clearly identifies ALREADY_COMPLETED status');
      assert(alreadyClearedResponse.reply.includes('Outstanding Dues: **₹0**'), 'Response notes ₹0 dues');
      assert(alreadyClearedResponse.reply.includes('Next Steps'), 'Response provides useful next steps');
    }

    // ─── TEST 6: STUDENT LOOKUP + AFFIRMATIVE FOLLOW-UP ──────────
    console.log('\n▶ TEST 6: Student lookup followed by "clear it" affirmative command');
    {
      // Reset clearance to DUE with ₹250
      await prisma.ndcClearance.update({
        where: { id: clearance.id },
        data: {
          status: DepartmentClearanceStatus.DUE as any,
          dueAmount: 250,
          dueDetails: 'Apparatus damage',
          remarks: 'Broken beaker'
        }
      });

      // Turn 1: Lookup student
      const lookupResponse = await AiAssistantService.processMessage({
        user: testUser,
        departmentCode: 'PHY',
        messages: [{ role: 'user', content: `Lookup student ${testStudent.usn}` }],
        reqObj: { user: testUser, ip: '127.0.0.1' }
      });

      assert(lookupResponse.reply.includes('Student Clearance Record'), 'Lookup returns student clearance record');
      assert(lookupResponse.reply.includes('Outstanding Due'), 'Lookup notes active due');
      assert(lookupResponse.reply.includes('Next Step'), 'Lookup specifies actionable next step');

      // Turn 2: User says "clear it"
      const clearItResponse = await AiAssistantService.processMessage({
        user: testUser,
        departmentCode: 'PHY',
        messages: [
          { role: 'user', content: `Lookup student ${testStudent.usn}` },
          { role: 'model', content: lookupResponse.reply },
          { role: 'user', content: 'clear it' }
        ],
        reqObj: { user: testUser, ip: '127.0.0.1' }
      });

      assert(clearItResponse.actionRequired !== null, 'Affirmative "clear it" stages clearance approval action');
      assert(clearItResponse.actionRequired?.action === 'CLEAR_DUE', 'Action is CLEAR_DUE');
      assert(clearItResponse.actionRequired?.usn === testStudent.usn, 'Target USN correctly carried over from prior turn');

      // Clean up token
      if (clearItResponse.actionRequired?.token) {
        await AiAssistantService.cancelAction(
          clearItResponse.actionRequired.token,
          physicsOfficer.id,
          { user: physicsOfficer, ip: '127.0.0.1' }
        );
      }
    }

    // ─── TEST 7: DISTINGUISHING ZERO RECORDED DUES FROM VERIFIED CLEARANCE
    console.log('\n▶ TEST 7: Zero recorded dues distinction vs pending clearance');
    {
      // Set to PENDING with 0 dues
      await prisma.ndcClearance.update({
        where: { id: clearance.id },
        data: {
          status: DepartmentClearanceStatus.PENDING as any,
          dueAmount: 0,
          dueDetails: null,
          remarks: null
        }
      });

      const zeroDuesLookup = await AiAssistantService.processMessage({
        user: testUser,
        departmentCode: 'PHY',
        messages: [{ role: 'user', content: `Check status for ${testStudent.usn}` }],
        reqObj: { user: testUser, ip: '127.0.0.1' }
      });

      assert(zeroDuesLookup.reply.includes('PENDING'), 'Status accurately reported as PENDING');
      assert(zeroDuesLookup.reply.includes('distinguishes zero recorded dues from verified approval') || zeroDuesLookup.reply.includes('0 recorded dues'), 'Explains that 0 dues does not automatically mean certified clearance');
      assert(zeroDuesLookup.reply.includes('clear it'), 'Prompts officer with how to approve clearance');
    }

    // ─── TEST 8: CANCELLATION LIFECYCLE ───────────────────────────
    console.log('\n▶ TEST 8: Explicit cancellation lifecycle');
    {
      const stagedResponse = await AiAssistantService.processMessage({
        user: testUser,
        departmentCode: 'PHY',
        messages: [{ role: 'user', content: `Add ₹400 due for broken lens for ${testStudent.usn}` }],
        reqObj: { user: testUser, ip: '127.0.0.1' }
      });

      assert(stagedResponse.actionRequired !== null, 'MARK_DUE staged successfully');
      const token = stagedResponse.actionRequired!.token;

      // Cancel it
      const cancelResult = await AiAssistantService.cancelAction(
        token,
        physicsOfficer.id,
        { user: physicsOfficer, ip: '127.0.0.1' }
      );

      assert(cancelResult.cancelled === true, 'Cancel result confirms cancelled=true');
      assert(!!cancelResult.completionReply, 'Cancel result provides 7-point cancellation completionReply');

      const dbToken = await prisma.aiConfirmationToken.findUnique({ where: { token } });
      assert(dbToken?.consumed === true && (dbToken.payload as any)?.cancelled === true, 'Token consumed and marked cancelled in database');
    }

    console.log('\n================================================================');
    console.log(`🎉 ALL TESTS COMPLETED: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err: any) {
    console.error('Fatal test error:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runRegressionTests();
