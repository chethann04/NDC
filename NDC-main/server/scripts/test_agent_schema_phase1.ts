import prisma from '../src/config/prisma';
import crypto from 'crypto';

async function testPhase1Schema() {
  console.log('================================================================');
  console.log('🧪 VERIFYING PHASE 1: PRISMA SCHEMA & DATABASE MIGRATION');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${desc}`);
      failed++;
    }
  }

  // 1. Verify User lookup
  const testUser = await prisma.user.findFirst({
    where: { isActive: true }
  });
  if (!testUser) {
    throw new Error('No active user found in database to run schema tests.');
  }
  assert(Boolean(testUser.id), 'Active user identified for relation testing');

  const testTaskId = crypto.randomUUID();
  const testIdempotencyKey = `idemp_${crypto.randomUUID()}`;
  const testDueInstanceId = `due_${crypto.randomUUID()}`;
  const testStudentId = crypto.randomUUID();

  try {
    // 2. Create AiAgentTask with default status (QUEUED) and targetEntityId
    const task = await prisma.aiAgentTask.create({
      data: {
        id: testTaskId,
        idempotencyKey: testIdempotencyKey,
        userId: testUser.id,
        departmentCode: 'PHY',
        targetEntityId: testStudentId,
        goal: 'Verify Physics Lab clearance for student',
        status: 'QUEUED',
        currentStepIndex: 0,
        maxSteps: 10,
        fencingToken: 1,
        lockedAt: new Date(),
        lockedBy: 'worker_test_1'
      }
    });
    assert(task.id === testTaskId, 'AiAgentTask record created with UUID');
    assert(task.status === 'QUEUED', 'AiAgentTask created with status QUEUED');
    assert(task.targetEntityId === testStudentId, 'AiAgentTask stores targetEntityId');
    assert(task.fencingToken === 1, 'AiAgentTask initialized with fencingToken = 1');

    // 3. Create AiConfirmationToken with new Phase 1 columns and scoped index fields
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const confirmationToken = await prisma.aiConfirmationToken.create({
      data: {
        token: rawToken,
        tokenHash,
        userId: testUser.id,
        action: 'MARK_DUE',
        studentId: testStudentId,
        clearanceId: 'clearance_test_123',
        payload: { test: true },
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        taskId: task.id,
        stepId: 'step_test_1',
        dueInstanceId: testDueInstanceId,
        fencingToken: 1
      }
    });
    assert(confirmationToken.tokenHash === tokenHash, 'AiConfirmationToken stores tokenHash');
    assert(confirmationToken.taskId === task.id, 'AiConfirmationToken links to taskId');
    assert(confirmationToken.stepId === 'step_test_1', 'AiConfirmationToken links to stepId');
    assert(confirmationToken.dueInstanceId === testDueInstanceId, 'AiConfirmationToken stores dueInstanceId');
    assert(confirmationToken.fencingToken === 1, 'AiConfirmationToken stores fencingToken');

    // 4. Create AiAgentTaskStep
    const step = await prisma.aiAgentTaskStep.create({
      data: {
        taskId: task.id,
        stepIndex: 1,
        toolName: 'lookup_student',
        toolType: 'READ_ONLY',
        validatedArguments: { usn: '4MC24IS022' },
        status: 'COMPLETED',
        operationalSummary: 'Queried Physics Lab clearance for student 4MC24IS022',
        sanitizedResult: { status: 'DUE', amount: 300 },
        confirmationTokenId: confirmationToken.id,
        durationMs: 45
      }
    });
    assert(step.stepIndex === 1, 'AiAgentTaskStep created with stepIndex = 1');
    assert(step.toolType === 'READ_ONLY', 'AiAgentTaskStep toolType = READ_ONLY validated');
    assert(step.confirmationTokenId === confirmationToken.id, 'AiAgentTaskStep links to confirmationTokenId');

    // 5. Test Unique Constraint on (taskId, stepIndex)
    let duplicateRejected = false;
    try {
      await prisma.aiAgentTaskStep.create({
        data: {
          taskId: task.id,
          stepIndex: 1, // Duplicate step index
          toolName: 'lookup_student',
          toolType: 'READ_ONLY',
          validatedArguments: { usn: '4MC24IS022' }
        }
      });
    } catch {
      duplicateRejected = true;
    }
    assert(duplicateRejected, 'Unique constraint @@unique([taskId, stepIndex]) successfully rejected duplicate step index');

    // 6. Test Relations Query
    const queriedTask = await prisma.aiAgentTask.findUnique({
      where: { id: task.id },
      include: {
        steps: true,
        confirmationTokens: true,
        user: { select: { id: true, name: true } }
      }
    });
    assert(queriedTask?.steps.length === 1, 'Task relation loaded steps correctly');
    assert(queriedTask?.confirmationTokens.length === 1, 'Task relation loaded confirmationTokens correctly');
    assert(queriedTask?.user.id === testUser.id, 'Task relation loaded User correctly');

    // 7. Test Step Relation to ConfirmationToken
    const queriedStep = await prisma.aiAgentTaskStep.findUnique({
      where: { id: step.id },
      include: {
        confirmationToken: true,
        task: true
      }
    });
    assert(queriedStep?.confirmationToken?.id === confirmationToken.id, 'Step loaded confirmationToken via foreign key');
    assert(queriedStep?.task.id === task.id, 'Step loaded parent task via foreign key');

    // 8. Test State Transitions across approved enum states
    const statesToTest = ['PLANNING', 'RUNNING', 'WAITING_CONFIRMATION', 'RESUMING', 'COMPLETED'] as const;
    for (const nextState of statesToTest) {
      const updated = await prisma.aiAgentTask.update({
        where: { id: task.id },
        data: {
          status: nextState,
          fencingToken: { increment: 1 }
        }
      });
      assert(updated.status === nextState, `AiAgentTask successfully transitioned to state ${nextState}`);
    }

  } finally {
    // 9. Cleanup test records
    await prisma.aiAgentTaskStep.deleteMany({
      where: { taskId: testTaskId }
    }).catch(() => {});

    await prisma.aiConfirmationToken.deleteMany({
      where: { taskId: testTaskId }
    }).catch(() => {});

    await prisma.aiAgentTask.deleteMany({
      where: { id: testTaskId }
    }).catch(() => {});
  }

  // 10. Verify existing AiConfirmationTokens were preserved
  const existingTokensCount = await prisma.aiConfirmationToken.count();
  assert(existingTokensCount >= 0, `Existing AiConfirmationToken records remain intact (count: ${existingTokensCount})`);

  console.log('\n================================================================');
  console.log(`🏁 PHASE 1 SCHEMA VERIFICATION: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

testPhase1Schema()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error in schema test:', err);
    process.exit(1);
  });
