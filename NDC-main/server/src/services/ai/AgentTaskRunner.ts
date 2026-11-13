import { PrismaClient, AgentTaskStatus, AgentStepStatus, AgentToolType, UserRole } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

export class FencingViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FencingViolationError';
  }
}

export class TaskLeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskLeaseError';
  }
}

export interface CreateTaskParams {
  goal: string;
  userId: string;
  departmentCode: string;
  targetEntityId?: string;
  idempotencyKey?: string;
  maxSteps?: number;
}

export interface ExecuteStepParams {
  taskId: string;
  stepIndex: number;
  toolName: string;
  toolType: AgentToolType;
  validatedArguments: Record<string, any>;
  workerId: string;
  fencingToken: number;
  executor: () => Promise<{
    sanitizedResult: Record<string, any>;
    operationalSummary: string;
    confirmationTokenId?: string;
    waitingConfirmation?: boolean;
  }>;
}

export class AgentTaskRunner {
  private static readonly LEASE_DURATION_MS = 30_000; // 30 seconds
  private static readonly HEARTBEAT_INTERVAL_MS = 10_000; // 10 seconds

  /**
   * Create a new agent task with idempotency protection.
   */
  public static async createTask(params: CreateTaskParams) {
    const {
      goal,
      userId,
      departmentCode,
      targetEntityId,
      idempotencyKey = `task_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      maxSteps = 10
    } = params;

    // Check if task with idempotencyKey already exists
    const existing = await prisma.aiAgentTask.findUnique({
      where: { idempotencyKey },
      include: { steps: { orderBy: { stepIndex: 'asc' } } }
    });

    if (existing) {
      return existing;
    }

    return await prisma.aiAgentTask.create({
      data: {
        idempotencyKey,
        userId,
        departmentCode,
        targetEntityId,
        goal,
        status: AgentTaskStatus.QUEUED,
        currentStepIndex: 0,
        maxSteps,
        fencingToken: 1
      },
      include: { steps: true }
    });
  }

  /**
   * Atomically acquires lease for a task.
   * Increments fencing token on every takeover.
   */
  public static async acquireTaskLease(taskId: string, workerId: string): Promise<{ fencingToken: number }> {
    const now = new Date();
    const leaseExpires = new Date(now.getTime() + this.LEASE_DURATION_MS);

    // Atomic CAS lease acquisition:
    // Either unassigned (lockedBy null), lease expired, or already owned by same worker
    const updateResult = await prisma.aiAgentTask.updateMany({
      where: {
        id: taskId,
        status: { in: [AgentTaskStatus.QUEUED, AgentTaskStatus.PLANNING, AgentTaskStatus.RUNNING, AgentTaskStatus.RESUMING] },
        OR: [
          { lockedBy: null },
          { leaseExpiresAt: { lt: now } },
          { lockedBy: workerId }
        ]
      },
      data: {
        lockedBy: workerId,
        lockedAt: now,
        leaseExpiresAt: leaseExpires,
        fencingToken: { increment: 1 },
        status: AgentTaskStatus.RUNNING
      }
    });

    if (updateResult.count === 0) {
      throw new TaskLeaseError(`Task ${taskId} is currently locked by another active worker or in non-runnable state.`);
    }

    const task = await prisma.aiAgentTask.findUnique({
      where: { id: taskId },
      select: { fencingToken: true, status: true }
    });

    if (!task) {
      throw new TaskLeaseError(`Task ${taskId} not found after lease acquisition.`);
    }

    return { fencingToken: task.fencingToken };
  }

  /**
   * Heartbeat to renew an existing lease.
   */
  public static async renewLease(taskId: string, workerId: string, expectedFencingToken: number): Promise<void> {
    const now = new Date();
    const leaseExpires = new Date(now.getTime() + this.LEASE_DURATION_MS);

    const result = await prisma.aiAgentTask.updateMany({
      where: {
        id: taskId,
        lockedBy: workerId,
        fencingToken: expectedFencingToken
      },
      data: {
        leaseExpiresAt: leaseExpires,
        lockedAt: now
      }
    });

    if (result.count === 0) {
      throw new FencingViolationError(`Lease renewal failed for task ${taskId}: lease was lost or fencing token changed.`);
    }
  }

  /**
   * Validate that the worker still holds the authoritative lease.
   */
  public static async validateFence(taskId: string, expectedFencingToken: number): Promise<void> {
    const task = await prisma.aiAgentTask.findUnique({
      where: { id: taskId },
      select: { fencingToken: true, lockedBy: true }
    });

    if (!task || task.fencingToken !== expectedFencingToken) {
      throw new FencingViolationError(
        `Fencing violation: expected token ${expectedFencingToken}, found ${task?.fencingToken}. Another worker has acquired this task.`
      );
    }
  }

  /**
   * Execute an individual step under strict lease, fencing and state boundaries.
   */
  public static async executeStep(params: ExecuteStepParams) {
    const {
      taskId,
      stepIndex,
      toolName,
      toolType,
      validatedArguments,
      workerId,
      fencingToken,
      executor
    } = params;

    // 1. Verify fence before starting
    await this.validateFence(taskId, fencingToken);

    // 2. Check if step already completed or waiting confirmation
    let step = await prisma.aiAgentTaskStep.findUnique({
      where: { taskId_stepIndex: { taskId, stepIndex } }
    });

    if (step && (step.status === AgentStepStatus.COMPLETED || step.status === AgentStepStatus.WAITING_CONFIRMATION)) {
      return { step, repeated: true };
    }

    // 3. Upsert step record to EXECUTING
    const startTime = Date.now();
    step = await prisma.aiAgentTaskStep.upsert({
      where: { taskId_stepIndex: { taskId, stepIndex } },
      create: {
        taskId,
        stepIndex,
        toolName,
        toolType,
        validatedArguments,
        status: AgentStepStatus.EXECUTING,
        startedAt: new Date()
      },
      update: {
        toolName,
        toolType,
        validatedArguments,
        status: AgentStepStatus.EXECUTING,
        startedAt: new Date()
      }
    });

    // Update task currentStepIndex
    await prisma.aiAgentTask.update({
      where: { id: taskId },
      data: { currentStepIndex: stepIndex }
    });

    try {
      // 4. Execute step logic
      const result = await executor();
      const durationMs = Date.now() - startTime;

      // 5. Verify fence again before writing completion
      await this.validateFence(taskId, fencingToken);

      if (result.waitingConfirmation) {
        step = await prisma.aiAgentTaskStep.update({
          where: { id: step.id },
          data: {
            status: AgentStepStatus.WAITING_CONFIRMATION,
            confirmationTokenId: result.confirmationTokenId,
            operationalSummary: result.operationalSummary,
            sanitizedResult: result.sanitizedResult,
            durationMs
          }
        });

        await prisma.aiAgentTask.update({
          where: { id: taskId },
          data: { status: AgentTaskStatus.WAITING_CONFIRMATION }
        });
      } else {
        step = await prisma.aiAgentTaskStep.update({
          where: { id: step.id },
          data: {
            status: AgentStepStatus.COMPLETED,
            operationalSummary: result.operationalSummary,
            sanitizedResult: result.sanitizedResult,
            completedAt: new Date(),
            durationMs
          }
        });
      }

      return { step, repeated: false };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;

      // Log failure on step
      await prisma.aiAgentTaskStep.update({
        where: { id: step.id },
        data: {
          status: AgentStepStatus.FAILED,
          errorCode: error.name || 'STEP_EXECUTION_ERROR',
          errorMessage: error.message || 'Execution failed',
          durationMs
        }
      });

      await prisma.aiAgentTask.update({
        where: { id: taskId },
        data: {
          status: AgentTaskStatus.FAILED,
          error: error.message || 'Step execution failed'
        }
      });

      throw error;
    }
  }

  /**
   * Release lease when task is waiting for confirmation or completed.
   */
  public static async releaseLease(taskId: string, workerId?: string) {
    const whereClause: any = { id: taskId };
    if (workerId) {
      whereClause.lockedBy = workerId;
    }

    await prisma.aiAgentTask.updateMany({
      where: whereClause,
      data: {
        lockedBy: null,
        lockedAt: null,
        leaseExpiresAt: null
      }
    });
  }

  /**
   * Complete task successfully with an operational summary.
   */
  public static async completeTask(taskId: string, summary: string, fencingToken: number) {
    await this.validateFence(taskId, fencingToken);

    return await prisma.aiAgentTask.update({
      where: { id: taskId },
      data: {
        status: AgentTaskStatus.COMPLETED,
        summary,
        lockedBy: null,
        lockedAt: null,
        leaseExpiresAt: null
      }
    });
  }

  /**
   * Crash Recovery Sweep:
   * Finds tasks whose leases have expired while in PLANNING or RUNNING status.
   * Inspects confirmation token state as a durable operation receipt.
   */
  public static async recoverInterruptedTasks(): Promise<{ recoveredCount: number; resetStepsCount: number }> {
    const now = new Date();
    const staleTasks = await prisma.aiAgentTask.findMany({
      where: {
        status: { in: [AgentTaskStatus.PLANNING, AgentTaskStatus.RUNNING] },
        leaseExpiresAt: { lt: now }
      },
      include: {
        steps: { orderBy: { stepIndex: 'asc' } }
      }
    });

    let recoveredCount = 0;
    let resetStepsCount = 0;

    for (const task of staleTasks) {
      for (const step of task.steps) {
        if (step.status === AgentStepStatus.COMPLETED || step.status === AgentStepStatus.SKIPPED) {
          continue; // Already safe
        }

        if (step.status === AgentStepStatus.EXECUTING) {
          if (step.toolType === AgentToolType.STAGED_MUTATION && step.confirmationTokenId) {
            const token = await prisma.aiConfirmationToken.findUnique({
              where: { id: step.confirmationTokenId }
            });

            const payload = (token?.payload as any) || {};
            if (token?.consumed && payload.lifecycleStatus === 'EXECUTED') {
              // Mutation succeeded before crash! Mark step completed.
              await prisma.aiAgentTaskStep.update({
                where: { id: step.id },
                data: {
                  status: AgentStepStatus.COMPLETED,
                  completedAt: new Date(),
                  operationalSummary: 'Recovered: mutation was successfully executed before server interruption.'
                }
              });
              continue;
            }

            // Mutation was not executed
            await prisma.aiAgentTaskStep.update({
              where: { id: step.id },
              data: {
                status: AgentStepStatus.PENDING,
                startedAt: null
              }
            });
            resetStepsCount++;
          } else {
            // READ_ONLY step interrupted
            await prisma.aiAgentTaskStep.update({
              where: { id: step.id },
              data: {
                status: AgentStepStatus.PENDING,
                startedAt: null
              }
            });
            resetStepsCount++;
          }
        }
      }

      // Unlock task and return to runnable/resumable state
      await prisma.aiAgentTask.update({
        where: { id: task.id },
        data: {
          lockedAt: null,
          lockedBy: null,
          leaseExpiresAt: null,
          status: AgentTaskStatus.QUEUED
        }
      });

      recoveredCount++;
    }

    return { recoveredCount, resetStepsCount };
  }
}

