import prisma from '../src/config/prisma';

async function verifyLiveSchema() {
  console.log('================================================================');
  console.log('🔍 VERIFYING LIVE DATABASE SCHEMA AGAINST schema.prisma');
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

  // 1. Verify Enum AgentTaskStatus values
  const taskStatusEnum: any[] = await prisma.$queryRawUnsafe(`
    SELECT e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'AgentTaskStatus'
    ORDER BY e.enumsortorder;
  `);
  const actualTaskStatuses = taskStatusEnum.map(e => e.enumlabel);
  const expectedTaskStatuses = [
    'QUEUED',
    'PLANNING',
    'RUNNING',
    'WAITING_CONFIRMATION',
    'RESUMING',
    'COMPLETED',
    'FAILED',
    'CANCELLED'
  ];
  assert(
    JSON.stringify(actualTaskStatuses) === JSON.stringify(expectedTaskStatuses),
    `AgentTaskStatus enum matches exact 8 approved states: [${actualTaskStatuses.join(', ')}]`
  );

  // 2. Verify Enum AgentStepStatus values
  const stepStatusEnum: any[] = await prisma.$queryRawUnsafe(`
    SELECT e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'AgentStepStatus'
    ORDER BY e.enumsortorder;
  `);
  const actualStepStatuses = stepStatusEnum.map(e => e.enumlabel);
  const expectedStepStatuses = [
    'PENDING',
    'EXECUTING',
    'COMPLETED',
    'FAILED',
    'SKIPPED',
    'WAITING_CONFIRMATION'
  ];
  assert(
    JSON.stringify(actualStepStatuses) === JSON.stringify(expectedStepStatuses),
    `AgentStepStatus enum matches exact approved states: [${actualStepStatuses.join(', ')}]`
  );

  // 3. Verify Enum AgentToolType values
  const toolTypeEnum: any[] = await prisma.$queryRawUnsafe(`
    SELECT e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'AgentToolType'
    ORDER BY e.enumsortorder;
  `);
  const actualToolTypes = toolTypeEnum.map(e => e.enumlabel);
  const expectedToolTypes = ['READ_ONLY', 'STAGED_MUTATION'];
  assert(
    JSON.stringify(actualToolTypes) === JSON.stringify(expectedToolTypes),
    `AgentToolType enum matches exact approved values: [${actualToolTypes.join(', ')}]`
  );

  // 4. Verify columns of ai_agent_tasks
  const taskCols: any[] = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'ai_agent_tasks'
    ORDER BY ordinal_position;
  `);
  const taskColMap = new Map(taskCols.map(c => [c.column_name, c]));
  assert(taskColMap.has('id'), 'ai_agent_tasks has column id');
  assert(taskColMap.has('idempotencyKey'), 'ai_agent_tasks has column idempotencyKey');
  assert(taskColMap.has('userId'), 'ai_agent_tasks has column userId');
  assert(taskColMap.has('departmentCode'), 'ai_agent_tasks has column departmentCode');
  assert(taskColMap.has('targetEntityId'), 'ai_agent_tasks has column targetEntityId');
  assert(taskColMap.has('goal'), 'ai_agent_tasks has column goal');
  assert(taskColMap.has('status'), 'ai_agent_tasks has column status');
  assert(String(taskColMap.get('status')?.column_default).includes('QUEUED'), 'ai_agent_tasks status default is QUEUED');
  assert(taskColMap.has('currentStepIndex'), 'ai_agent_tasks has column currentStepIndex');
  assert(taskColMap.has('maxSteps'), 'ai_agent_tasks has column maxSteps');
  assert(taskColMap.has('fencingToken'), 'ai_agent_tasks has column fencingToken');
  assert(taskColMap.has('lockedAt'), 'ai_agent_tasks has column lockedAt');
  assert(taskColMap.has('lockedBy'), 'ai_agent_tasks has column lockedBy');
  assert(taskColMap.has('leaseExpiresAt'), 'ai_agent_tasks has column leaseExpiresAt');
  assert(taskColMap.has('summary'), 'ai_agent_tasks has column summary');
  assert(taskColMap.has('error'), 'ai_agent_tasks has column error');

  // 5. Verify columns of ai_agent_task_steps
  const stepCols: any[] = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'ai_agent_task_steps'
    ORDER BY ordinal_position;
  `);
  const stepColMap = new Map(stepCols.map(c => [c.column_name, c]));
  assert(stepColMap.has('id'), 'ai_agent_task_steps has column id');
  assert(stepColMap.has('taskId'), 'ai_agent_task_steps has column taskId');
  assert(stepColMap.has('stepIndex'), 'ai_agent_task_steps has column stepIndex');
  assert(stepColMap.has('toolName'), 'ai_agent_task_steps has column toolName');
  assert(stepColMap.has('toolType'), 'ai_agent_task_steps has column toolType');
  assert(stepColMap.has('validatedArguments'), 'ai_agent_task_steps has column validatedArguments (jsonb)');
  assert(stepColMap.has('status'), 'ai_agent_task_steps has column status');
  assert(stepColMap.has('operationalSummary'), 'ai_agent_task_steps has column operationalSummary');
  assert(stepColMap.has('sanitizedResult'), 'ai_agent_task_steps has column sanitizedResult');
  assert(stepColMap.has('confirmationTokenId'), 'ai_agent_task_steps has column confirmationTokenId');
  assert(stepColMap.has('errorCode'), 'ai_agent_task_steps has column errorCode');
  assert(stepColMap.has('errorMessage'), 'ai_agent_task_steps has column errorMessage');
  assert(stepColMap.has('durationMs'), 'ai_agent_task_steps has column durationMs');

  // 6. Verify columns of ai_confirmation_tokens
  const tokenCols: any[] = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'ai_confirmation_tokens'
    ORDER BY ordinal_position;
  `);
  const tokenColMap = new Map(tokenCols.map(c => [c.column_name, c]));
  assert(tokenColMap.has('tokenHash'), 'ai_confirmation_tokens has column tokenHash');
  assert(tokenColMap.has('taskId'), 'ai_confirmation_tokens has column taskId');
  assert(tokenColMap.has('stepId'), 'ai_confirmation_tokens has column stepId');
  assert(tokenColMap.has('dueInstanceId'), 'ai_confirmation_tokens has column dueInstanceId');
  assert(tokenColMap.has('fencingToken'), 'ai_confirmation_tokens has column fencingToken');

  // 7. Verify indexes on ai_agent_tasks
  const taskIndexes: any[] = await prisma.$queryRawUnsafe(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'ai_agent_tasks';
  `);
  const taskIndexNames = taskIndexes.map(i => i.indexname);
  assert(taskIndexNames.includes('ai_agent_tasks_idempotencyKey_key'), 'ai_agent_tasks has unique index on idempotencyKey');
  assert(taskIndexNames.includes('ai_agent_tasks_userId_status_idx'), 'ai_agent_tasks has index on (userId, status)');
  assert(taskIndexNames.includes('ai_agent_tasks_status_leaseExpiresAt_idx'), 'ai_agent_tasks has index on (status, leaseExpiresAt)');
  assert(taskIndexNames.includes('ai_agent_tasks_departmentCode_createdAt_idx'), 'ai_agent_tasks has index on (departmentCode, createdAt)');
  assert(taskIndexNames.includes('ai_agent_tasks_targetEntityId_idx'), 'ai_agent_tasks has index on (targetEntityId)');

  // 8. Verify indexes on ai_agent_task_steps
  const stepIndexes: any[] = await prisma.$queryRawUnsafe(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'ai_agent_task_steps';
  `);
  const stepIndexNames = stepIndexes.map(i => i.indexname);
  assert(stepIndexNames.includes('ai_agent_task_steps_taskId_stepIndex_key'), 'ai_agent_task_steps has unique index on (taskId, stepIndex)');
  assert(stepIndexNames.includes('ai_agent_task_steps_taskId_status_idx'), 'ai_agent_task_steps has index on (taskId, status)');
  assert(stepIndexNames.includes('ai_agent_task_steps_confirmationTokenId_idx'), 'ai_agent_task_steps has index on (confirmationTokenId)');

  // 9. Verify indexes on ai_confirmation_tokens
  const tokenIndexes: any[] = await prisma.$queryRawUnsafe(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'ai_confirmation_tokens';
  `);
  const tokenIndexNames = tokenIndexes.map(i => i.indexname);
  assert(tokenIndexNames.includes('ai_confirmation_tokens_tokenHash_idx'), 'ai_confirmation_tokens has index on (tokenHash)');
  assert(tokenIndexNames.includes('ai_confirmation_tokens_userId_clearanceId_consumed_idx'), 'ai_confirmation_tokens has composite index on (userId, clearanceId, consumed)');
  assert(tokenIndexNames.includes('ai_confirmation_tokens_taskId_idx'), 'ai_confirmation_tokens has index on (taskId)');
  assert(tokenIndexNames.includes('ai_confirmation_tokens_stepId_idx'), 'ai_confirmation_tokens has index on (stepId)');
  assert(tokenIndexNames.includes('ai_confirmation_tokens_dueInstanceId_idx'), 'ai_confirmation_tokens has index on (dueInstanceId)');
  assert(tokenIndexNames.includes('ai_confirmation_tokens_clearanceId_dueInstanceId_idx'), 'ai_confirmation_tokens has index on (clearanceId, dueInstanceId)');

  // 10. Verify Foreign Key constraints
  const fkeys: any[] = await prisma.$queryRawUnsafe(`
    SELECT conname, confrelid::regclass::text as referenced_table
    FROM pg_constraint
    WHERE contype = 'f'
      AND conrelid IN (
        'ai_agent_tasks'::regclass,
        'ai_agent_task_steps'::regclass,
        'ai_confirmation_tokens'::regclass
      );
  `);
  const fkeyMap = new Map(fkeys.map(f => [f.conname, f.referenced_table]));
  assert(fkeyMap.get('ai_agent_tasks_userId_fkey') === 'users', 'ai_agent_tasks_userId_fkey references users');
  assert(fkeyMap.get('ai_agent_task_steps_taskId_fkey') === 'ai_agent_tasks', 'ai_agent_task_steps_taskId_fkey references ai_agent_tasks');
  assert(fkeyMap.get('ai_agent_task_steps_confirmationTokenId_fkey') === 'ai_confirmation_tokens', 'ai_agent_task_steps_confirmationTokenId_fkey references ai_confirmation_tokens');
  assert(fkeyMap.get('ai_confirmation_tokens_taskId_fkey') === 'ai_agent_tasks', 'ai_confirmation_tokens_taskId_fkey references ai_agent_tasks');

  console.log('\n================================================================');
  console.log(`🏁 LIVE SCHEMA EQUIVALENCE: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

verifyLiveSchema()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error in schema verification:', err);
    process.exit(1);
  });

