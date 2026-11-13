import { z } from 'zod';
import { PrismaClient, UserRole, AgentToolType, DepartmentClearanceStatus } from '@prisma/client';
import crypto from 'crypto';
import { TokenSecurityService } from './TokenSecurityService';
import { DueManagementService } from '../DueManagementService';
import { ContextResolutionService } from './ContextResolutionService';
import { DepartmentValidationService } from './DepartmentValidationService';

const prisma = new PrismaClient();

// -------------------------------------------------------------
// STRICT SCHEMAS (ZOD .strict())
// -------------------------------------------------------------
export const VtuUsnSchema = z.string()
  .trim()
  .regex(/^4MC\d{2}[A-Z]{2}\d{3}$/i, 'Invalid VTU USN format (example: 4MC24IS022)')
  .transform(v => v.toUpperCase());

export const PositiveAmountSchema = z.number()
  .positive('Amount must be greater than zero')
  .max(100_000, 'Amount exceeds ₹1,00,000 safety threshold');

export const ReasonSchema = z.string()
  .trim()
  .min(3, 'Reason must be at least 3 characters')
  .max(500, 'Reason exceeds 500 character limit');

export const LookupStudentSchema = z.object({
  usn: VtuUsnSchema
}).strict();

export const SearchStudentByNameSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100)
}).strict();

export const GetDepartmentStatsSchema = z.object({
  departmentCode: z.string().trim().min(2).max(10).optional()
}).strict();

export const GetClearanceDetailSchema = z.object({
  clearanceId: z.string().uuid('Invalid clearance ID format')
}).strict();

export const GetDepartmentDuesSchema = z.object({
  limit: z.number().int().min(1).max(20).default(10).optional()
}).strict();

export const StageMarkDueSchema = z.object({
  usn: VtuUsnSchema,
  amount: PositiveAmountSchema,
  reason: ReasonSchema
}).strict();

export const StageClearDueSchema = z.object({
  usn: VtuUsnSchema,
  reason: ReasonSchema.optional()
}).strict();

export const StageHoldSchema = z.object({
  usn: VtuUsnSchema,
  reason: ReasonSchema
}).strict();

// -------------------------------------------------------------
// IMMUTABLE SERVER SECURITY CONTEXT
// -------------------------------------------------------------
export interface ServerSecurityContext {
  readonly taskId?: string;
  readonly stepId?: string;
  readonly userId: string;
  readonly userRole: UserRole;
  readonly departmentId: string;
  readonly departmentCode: string;
  readonly fencingToken?: number;
  readonly ipAddress?: string;
}

export interface ToolExecutionOutput {
  sanitizedResult: Record<string, any>;
  operationalSummary: string;
  waitingConfirmation?: boolean;
  confirmationTokenId?: string;
  rawToken?: string;
}

// -------------------------------------------------------------
// AGENT TOOL REGISTRY & IMPLEMENTATION
// -------------------------------------------------------------
export class AgentToolRegistry {
  /**
   * 1. READ_ONLY: lookup_student
   */
  public static async lookupStudent(
    args: z.infer<typeof LookupStudentSchema>,
    ctx: ServerSecurityContext
  ): Promise<ToolExecutionOutput> {
    const validated = LookupStudentSchema.parse(args);

    const student = await prisma.student.findUnique({
      where: { usn: validated.usn },
      include: {
        department: true,
        ndcRequests: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            clearances: {
              where: ctx.userRole === UserRole.ADMIN || ctx.userRole === UserRole.SUPER_ADMIN
                ? undefined
                : { departmentId: ctx.departmentId }
            }
          }
        }
      }
    });

    if (!student) {
      return {
        sanitizedResult: { found: false, usn: validated.usn },
        operationalSummary: `Lookup student ${validated.usn}: No record found.`
      };
    }

    const latestRequest = student.ndcRequests[0] || null;
    const clearance = latestRequest?.clearances?.[0] || null;

    return {
      sanitizedResult: {
        found: true,
        studentId: student.id,
        usn: student.usn,
        fullName: student.fullName,
        department: student.department?.name,
        overallStatus: latestRequest?.status || 'NOT_REQUESTED',
        clearance: clearance ? {
          id: clearance.id,
          status: clearance.status,
          dueAmount: Number(clearance.dueAmount || 0),
          dueDetails: clearance.dueDetails
        } : null
      },
      operationalSummary: `Lookup student ${student.usn} (${student.fullName}): Status ${latestRequest?.status || 'N/A'}. Clearance due ₹${clearance?.dueAmount || 0}.`
    };
  }

  /**
   * 2. READ_ONLY: search_student_by_name
   */
  public static async searchStudentByName(
    args: z.infer<typeof SearchStudentByNameSchema>,
    ctx: ServerSecurityContext
  ): Promise<ToolExecutionOutput> {
    const validated = SearchStudentByNameSchema.parse(args);

    const students = await prisma.student.findMany({
      where: {
        fullName: { contains: validated.name, mode: 'insensitive' }
      },
      take: 5,
      include: { department: true }
    });

    return {
      sanitizedResult: {
        query: validated.name,
        count: students.length,
        results: students.map(s => ({
          studentId: s.id,
          usn: s.usn,
          fullName: s.fullName,
          department: s.department?.name
        }))
      },
      operationalSummary: `Searched students for "${validated.name}". Found ${students.length} matching records.`
    };
  }

  /**
   * 3. READ_ONLY: get_department_stats
   */
  public static async getDepartmentStats(
    args: z.infer<typeof GetDepartmentStatsSchema>,
    ctx: ServerSecurityContext
  ): Promise<ToolExecutionOutput> {
    const validated = GetDepartmentStatsSchema.parse(args);

    const deptCode = (ctx.userRole === UserRole.ADMIN || ctx.userRole === UserRole.SUPER_ADMIN)
      ? (validated.departmentCode || ctx.departmentCode)
      : ctx.departmentCode;

    const stats = await ContextResolutionService.getContextStats({
      departmentCode: deptCode,
      departmentId: ctx.departmentId,
      departmentName: deptCode
    } as any);

    return {
      sanitizedResult: stats,
      operationalSummary: `Retrieved department stats for ${deptCode}: ${stats.pendingClearances} pending clearances, ₹${stats.totalDues} total dues.`
    };
  }

  /**
   * 4. READ_ONLY: get_department_dues
   */
  public static async getDepartmentDues(
    args: z.infer<typeof GetDepartmentDuesSchema>,
    ctx: ServerSecurityContext
  ): Promise<ToolExecutionOutput> {
    const validated = GetDepartmentDuesSchema.parse(args);
    const limit = Math.min(validated.limit || 10, 20);

    const clearances = await prisma.ndcClearance.findMany({
      where: {
        departmentId: ctx.departmentId,
        status: DepartmentClearanceStatus.DUE
      },
      take: limit,
      orderBy: { dueAmount: 'desc' },
      include: {
        ndcRequest: {
          include: { student: true }
        }
      }
    });

    const items = clearances.map(c => ({
      clearanceId: c.id,
      usn: c.ndcRequest?.student?.usn,
      studentName: c.ndcRequest?.student?.fullName,
      dueAmount: Number(c.dueAmount || 0),
      dueDetails: c.dueDetails
    }));

    return {
      sanitizedResult: {
        departmentCode: ctx.departmentCode,
        count: items.length,
        dues: items
      },
      operationalSummary: `Retrieved top ${items.length} outstanding dues for department ${ctx.departmentCode}.`
    };
  }

  /**
   * 5. READ_ONLY: get_clearance_detail
   */
  public static async getClearanceDetail(
    args: z.infer<typeof GetClearanceDetailSchema>,
    ctx: ServerSecurityContext
  ): Promise<ToolExecutionOutput> {
    const validated = GetClearanceDetailSchema.parse(args);

    const clearance = await prisma.ndcClearance.findUnique({
      where: { id: validated.clearanceId },
      include: {
        department: true,
        ndcRequest: {
          include: { student: true }
        }
      }
    });

    if (!clearance) {
      throw new Error(`Clearance record ${validated.clearanceId} not found.`);
    }

    // Server-side RBAC validation
    if (ctx.userRole !== UserRole.ADMIN && ctx.userRole !== UserRole.SUPER_ADMIN) {
      DueManagementService.verifyOfficerDepartmentAuthorization(ctx.userId, clearance);
    }

    return {
      sanitizedResult: {
        clearanceId: clearance.id,
        status: clearance.status,
        dueAmount: Number(clearance.dueAmount || 0),
        dueDetails: clearance.dueDetails,
        studentUsn: clearance.ndcRequest?.student?.usn,
        studentName: clearance.ndcRequest?.student?.fullName,
        departmentName: clearance.department?.name,
        updatedAt: clearance.updatedAt.toISOString()
      },
      operationalSummary: `Clearance details for ${clearance.ndcRequest?.student?.usn}: status ${clearance.status}, amount ₹${clearance.dueAmount || 0}.`
    };
  }

  /**
   * 6. STAGED_MUTATION: stage_mark_due
   */
  public static async stageMarkDue(
    args: z.infer<typeof StageMarkDueSchema>,
    ctx: ServerSecurityContext
  ): Promise<ToolExecutionOutput> {
    const validated = StageMarkDueSchema.parse(args);

    // Look up student and clearance
    const student = await prisma.student.findUnique({
      where: { usn: validated.usn },
      include: {
        department: true,
        ndcRequests: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            clearances: {
              where: { departmentId: ctx.departmentId }
            }
          }
        }
      }
    });

    if (!student) {
      throw new Error(`Student with USN ${validated.usn} not found.`);
    }

    const latestRequest = student.ndcRequests[0];
    const clearance = latestRequest?.clearances?.[0];

    if (!clearance) {
      throw new Error(`No active clearance found for ${student.fullName} (${validated.usn}) in ${ctx.departmentCode}.`);
    }

    // Verify authorization
    if (ctx.userRole !== UserRole.ADMIN && ctx.userRole !== UserRole.SUPER_ADMIN) {
      const authCheck = await DueManagementService.verifyOfficerDepartmentAuthorization(ctx.userId, clearance);
      if (!authCheck.authorized) {
        throw new Error(`Unauthorized: ${authCheck.reason || 'You do not have permission to modify clearances for this department.'}`);
      }
    }

    // Step idempotency check: if token already generated for this task step
    if (ctx.taskId && ctx.stepId) {
      const existingToken = await prisma.aiConfirmationToken.findFirst({
        where: {
          taskId: ctx.taskId,
          stepId: ctx.stepId,
          consumed: false
        }
      });

      if (existingToken) {
        return {
          waitingConfirmation: true,
          confirmationTokenId: existingToken.id,
          sanitizedResult: {
            action: 'MARK_DUE',
            studentUsn: student.usn,
            studentName: student.fullName,
            amount: validated.amount,
            reason: validated.reason,
            stagedTokenId: existingToken.id
          },
          operationalSummary: `Action already staged: Outstanding due ₹${validated.amount} for "${validated.reason}" on ${student.usn}.`
        };
      }
    }

    // Scoped Invalidation: invalidate previous pending tokens on this specific clearance
    await prisma.aiConfirmationToken.updateMany({
      where: {
        userId: ctx.userId,
        clearanceId: clearance.id,
        consumed: false
      },
      data: {
        consumed: true,
        consumedAt: new Date(),
        payload: {
          lifecycleStatus: 'SUPERSEDED',
          cancellationReason: 'Superseded by new staged due action'
        }
      }
    });

    const { rawToken, tokenHash } = TokenSecurityService.generateToken();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const dueInstanceId = `due_${clearance.id}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const createdToken = await prisma.aiConfirmationToken.create({
      data: {
        token: rawToken,
        tokenHash,
        userId: ctx.userId,
        action: 'MARK_DUE',
        studentId: student.id,
        clearanceId: clearance.id,
        taskId: ctx.taskId,
        stepId: ctx.stepId,
        dueInstanceId,
        fencingToken: ctx.fencingToken,
        expiresAt,
        payload: {
          dueInstanceId,
          studentName: student.fullName,
          usn: student.usn,
          amount: validated.amount,
          reason: validated.reason,
          departmentId: ctx.departmentId,
          departmentCode: ctx.departmentCode,
          lifecycleStatus: 'STAGED'
        }
      }
    });

    return {
      waitingConfirmation: true,
      confirmationTokenId: createdToken.id,
      rawToken,
      sanitizedResult: {
        action: 'MARK_DUE',
        studentUsn: student.usn,
        studentName: student.fullName,
        amount: validated.amount,
        reason: validated.reason,
        stagedTokenId: createdToken.id,
        dueInstanceId
      },
      operationalSummary: `Staged MARK_DUE: ₹${validated.amount} for "${validated.reason}" on ${student.usn}. Awaiting officer confirmation.`
    };
  }

  /**
   * 7. STAGED_MUTATION: stage_clear_due
   */
  public static async stageClearDue(
    args: z.infer<typeof StageClearDueSchema>,
    ctx: ServerSecurityContext
  ): Promise<ToolExecutionOutput> {
    const validated = StageClearDueSchema.parse(args);

    const student = await prisma.student.findUnique({
      where: { usn: validated.usn },
      include: {
        department: true,
        ndcRequests: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            clearances: {
              where: { departmentId: ctx.departmentId }
            }
          }
        }
      }
    });

    if (!student) {
      throw new Error(`Student with USN ${validated.usn} not found.`);
    }

    const latestRequest = student.ndcRequests[0];
    const clearance = latestRequest?.clearances?.[0];

    if (!clearance) {
      throw new Error(`No active clearance found for ${student.fullName} (${validated.usn}) in ${ctx.departmentCode}.`);
    }

    // Verify authorization
    if (ctx.userRole !== UserRole.ADMIN && ctx.userRole !== UserRole.SUPER_ADMIN) {
      const authCheck = await DueManagementService.verifyOfficerDepartmentAuthorization(ctx.userId, clearance);
      if (!authCheck.authorized) {
        throw new Error(`Unauthorized: ${authCheck.reason || 'You do not have permission to modify clearances for this department.'}`);
      }
    }

    // Check if already cleared with 0 dues
    if (clearance.status === DepartmentClearanceStatus.CLEARED && Number(clearance.dueAmount || 0) === 0) {
      return {
        waitingConfirmation: false,
        sanitizedResult: {
          alreadyCleared: true,
          studentUsn: student.usn,
          status: 'CLEARED'
        },
        operationalSummary: `Student ${student.usn} is already CLEARED with ₹0 dues in ${ctx.departmentCode}. No action required.`
      };
    }

    // Step idempotency check
    if (ctx.taskId && ctx.stepId) {
      const existingToken = await prisma.aiConfirmationToken.findFirst({
        where: {
          taskId: ctx.taskId,
          stepId: ctx.stepId,
          consumed: false
        }
      });

      if (existingToken) {
        return {
          waitingConfirmation: true,
          confirmationTokenId: existingToken.id,
          sanitizedResult: {
            action: 'CLEAR_DUE',
            studentUsn: student.usn,
            studentName: student.fullName,
            stagedTokenId: existingToken.id
          },
          operationalSummary: `Action already staged: Clear dues for ${student.usn}.`
        };
      }
    }

    // Scoped Invalidation: invalidate previous pending tokens on this specific clearance
    await prisma.aiConfirmationToken.updateMany({
      where: {
        userId: ctx.userId,
        clearanceId: clearance.id,
        consumed: false
      },
      data: {
        consumed: true,
        consumedAt: new Date(),
        payload: {
          lifecycleStatus: 'SUPERSEDED',
          cancellationReason: 'Superseded by new staged clear action'
        }
      }
    });

    const { rawToken, tokenHash } = TokenSecurityService.generateToken();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const targetDueInstanceId = `due_${clearance.id}_${clearance.updatedAt.getTime()}`;

    const createdToken = await prisma.aiConfirmationToken.create({
      data: {
        token: rawToken,
        tokenHash,
        userId: ctx.userId,
        action: 'CLEAR_DUE',
        studentId: student.id,
        clearanceId: clearance.id,
        taskId: ctx.taskId,
        stepId: ctx.stepId,
        dueInstanceId: targetDueInstanceId,
        fencingToken: ctx.fencingToken,
        expiresAt,
        payload: {
          dueInstanceId: targetDueInstanceId,
          studentName: student.fullName,
          usn: student.usn,
          amount: 0,
          reason: validated.reason || 'Clearance verified and approved as No Due',
          departmentId: ctx.departmentId,
          departmentCode: ctx.departmentCode,
          lifecycleStatus: 'STAGED'
        }
      }
    });

    return {
      waitingConfirmation: true,
      confirmationTokenId: createdToken.id,
      rawToken,
      sanitizedResult: {
        action: 'CLEAR_DUE',
        studentUsn: student.usn,
        studentName: student.fullName,
        stagedTokenId: createdToken.id,
        dueInstanceId: targetDueInstanceId
      },
      operationalSummary: `Staged CLEAR_DUE for ${student.usn}. Awaiting officer confirmation.`
    };
  }

  /**
   * 8. STAGED_MUTATION: stage_hold
   */
  public static async stageHold(
    args: z.infer<typeof StageHoldSchema>,
    ctx: ServerSecurityContext
  ): Promise<ToolExecutionOutput> {
    const validated = StageHoldSchema.parse(args);

    const student = await prisma.student.findUnique({
      where: { usn: validated.usn },
      include: {
        department: true,
        ndcRequests: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            clearances: {
              where: { departmentId: ctx.departmentId }
            }
          }
        }
      }
    });

    if (!student) {
      throw new Error(`Student with USN ${validated.usn} not found.`);
    }

    const latestRequest = student.ndcRequests[0];
    const clearance = latestRequest?.clearances?.[0];

    if (!clearance) {
      throw new Error(`No active clearance found for ${student.fullName} (${validated.usn}) in ${ctx.departmentCode}.`);
    }

    // Verify authorization
    if (ctx.userRole !== UserRole.ADMIN && ctx.userRole !== UserRole.SUPER_ADMIN) {
      const authCheck = await DueManagementService.verifyOfficerDepartmentAuthorization(ctx.userId, clearance);
      if (!authCheck.authorized) {
        throw new Error(`Unauthorized: ${authCheck.reason || 'You do not have permission to modify clearances for this department.'}`);
      }
    }

    // Scoped Invalidation
    await prisma.aiConfirmationToken.updateMany({
      where: {
        userId: ctx.userId,
        clearanceId: clearance.id,
        consumed: false
      },
      data: {
        consumed: true,
        consumedAt: new Date(),
        payload: {
          lifecycleStatus: 'SUPERSEDED',
          cancellationReason: 'Superseded by new staged hold action'
        }
      }
    });

    const { rawToken, tokenHash } = TokenSecurityService.generateToken();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const createdToken = await prisma.aiConfirmationToken.create({
      data: {
        token: rawToken,
        tokenHash,
        userId: ctx.userId,
        action: 'HOLD',
        studentId: student.id,
        clearanceId: clearance.id,
        taskId: ctx.taskId,
        stepId: ctx.stepId,
        fencingToken: ctx.fencingToken,
        expiresAt,
        payload: {
          studentName: student.fullName,
          usn: student.usn,
          amount: 0,
          reason: validated.reason,
          departmentId: ctx.departmentId,
          departmentCode: ctx.departmentCode,
          lifecycleStatus: 'STAGED'
        }
      }
    });

    return {
      waitingConfirmation: true,
      confirmationTokenId: createdToken.id,
      rawToken,
      sanitizedResult: {
        action: 'HOLD',
        studentUsn: student.usn,
        studentName: student.fullName,
        reason: validated.reason,
        stagedTokenId: createdToken.id
      },
      operationalSummary: `Staged HOLD: "${validated.reason}" on ${student.usn}. Awaiting officer confirmation.`
    };
  }
}
