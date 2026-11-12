-- =========================================================================
-- NDC AGENTIC AI BRAIN: DURABLE TASK EXECUTION STATE MACHINE MIGRATION
-- =========================================================================
-- Non-destructive, additive schema extension.
-- Adds durable task and step tracking tables and enhances confirmation tokens
-- with fencing tokens, hash storage, and task-step bindings.
-- =========================================================================

-- 1. Create Enums safely
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AgentTaskStatus') THEN
        CREATE TYPE "AgentTaskStatus" AS ENUM ('QUEUED', 'PLANNING', 'RUNNING', 'WAITING_CONFIRMATION', 'RESUMING', 'COMPLETED', 'FAILED', 'CANCELLED');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AgentStepStatus') THEN
        CREATE TYPE "AgentStepStatus" AS ENUM ('PENDING', 'EXECUTING', 'COMPLETED', 'FAILED', 'SKIPPED', 'WAITING_CONFIRMATION');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AgentToolType') THEN
        CREATE TYPE "AgentToolType" AS ENUM ('READ_ONLY', 'STAGED_MUTATION');
    END IF;
END $$;

-- 2. Add columns to ai_confirmation_tokens
ALTER TABLE "ai_confirmation_tokens" 
ADD COLUMN IF NOT EXISTS "tokenHash" TEXT,
ADD COLUMN IF NOT EXISTS "taskId" TEXT,
ADD COLUMN IF NOT EXISTS "stepId" TEXT,
ADD COLUMN IF NOT EXISTS "dueInstanceId" TEXT,
ADD COLUMN IF NOT EXISTS "fencingToken" INTEGER;

-- 3. Create ai_agent_tasks table
CREATE TABLE IF NOT EXISTS "ai_agent_tasks" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "departmentCode" TEXT NOT NULL,
    "targetEntityId" TEXT,
    "goal" TEXT NOT NULL,
    "status" "AgentTaskStatus" NOT NULL DEFAULT 'QUEUED',
    "currentStepIndex" INTEGER NOT NULL DEFAULT 0,
    "maxSteps" INTEGER NOT NULL DEFAULT 10,
    "fencingToken" INTEGER NOT NULL DEFAULT 1,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "summary" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_agent_tasks_pkey" PRIMARY KEY ("id")
);

-- 4. Create ai_agent_task_steps table
CREATE TABLE IF NOT EXISTS "ai_agent_task_steps" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "toolName" TEXT NOT NULL,
    "toolType" "AgentToolType" NOT NULL,
    "validatedArguments" JSONB NOT NULL,
    "status" "AgentStepStatus" NOT NULL DEFAULT 'PENDING',
    "operationalSummary" TEXT,
    "sanitizedResult" JSONB,
    "confirmationTokenId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_agent_task_steps_pkey" PRIMARY KEY ("id")
);

-- 5. Create Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "ai_agent_tasks_idempotencyKey_key" ON "ai_agent_tasks"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "ai_agent_tasks_userId_status_idx" ON "ai_agent_tasks"("userId", "status");
CREATE INDEX IF NOT EXISTS "ai_agent_tasks_status_leaseExpiresAt_idx" ON "ai_agent_tasks"("status", "leaseExpiresAt");
CREATE INDEX IF NOT EXISTS "ai_agent_tasks_departmentCode_createdAt_idx" ON "ai_agent_tasks"("departmentCode", "createdAt");
CREATE INDEX IF NOT EXISTS "ai_agent_tasks_targetEntityId_idx" ON "ai_agent_tasks"("targetEntityId");

CREATE UNIQUE INDEX IF NOT EXISTS "ai_agent_task_steps_taskId_stepIndex_key" ON "ai_agent_task_steps"("taskId", "stepIndex");
CREATE INDEX IF NOT EXISTS "ai_agent_task_steps_taskId_status_idx" ON "ai_agent_task_steps"("taskId", "status");
CREATE INDEX IF NOT EXISTS "ai_agent_task_steps_confirmationTokenId_idx" ON "ai_agent_task_steps"("confirmationTokenId");

CREATE INDEX IF NOT EXISTS "ai_confirmation_tokens_tokenHash_idx" ON "ai_confirmation_tokens"("tokenHash");
CREATE INDEX IF NOT EXISTS "ai_confirmation_tokens_userId_clearanceId_consumed_idx" ON "ai_confirmation_tokens"("userId", "clearanceId", "consumed");
CREATE INDEX IF NOT EXISTS "ai_confirmation_tokens_taskId_idx" ON "ai_confirmation_tokens"("taskId");
CREATE INDEX IF NOT EXISTS "ai_confirmation_tokens_stepId_idx" ON "ai_confirmation_tokens"("stepId");
CREATE INDEX IF NOT EXISTS "ai_confirmation_tokens_dueInstanceId_idx" ON "ai_confirmation_tokens"("dueInstanceId");
CREATE INDEX IF NOT EXISTS "ai_confirmation_tokens_clearanceId_dueInstanceId_idx" ON "ai_confirmation_tokens"("clearanceId", "dueInstanceId");

-- 6. Add Foreign Keys safely
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_agent_tasks_userId_fkey') THEN
        ALTER TABLE "ai_agent_tasks" ADD CONSTRAINT "ai_agent_tasks_userId_fkey" 
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_agent_task_steps_taskId_fkey') THEN
        ALTER TABLE "ai_agent_task_steps" ADD CONSTRAINT "ai_agent_task_steps_taskId_fkey" 
        FOREIGN KEY ("taskId") REFERENCES "ai_agent_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_agent_task_steps_confirmationTokenId_fkey') THEN
        ALTER TABLE "ai_agent_task_steps" ADD CONSTRAINT "ai_agent_task_steps_confirmationTokenId_fkey" 
        FOREIGN KEY ("confirmationTokenId") REFERENCES "ai_confirmation_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_confirmation_tokens_taskId_fkey') THEN
        ALTER TABLE "ai_confirmation_tokens" ADD CONSTRAINT "ai_confirmation_tokens_taskId_fkey" 
        FOREIGN KEY ("taskId") REFERENCES "ai_agent_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
