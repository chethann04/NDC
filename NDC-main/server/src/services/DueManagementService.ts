import prisma from '../config/prisma';
import { DepartmentClearanceStatus, NdcRequestStatus } from '../constants/statuses';
import { UserRole } from '../constants/roles';
import { AuditService } from './AuditService';
import { NdcWorkflowService } from './NdcWorkflowService';
import { LaboratoryAggregationService } from './LaboratoryAggregationService';
import { invalidateStudentStatusCache, invalidateOfficerStatsCache } from '../controllers/NdcController';
import { NotificationQueueService, NotificationJobData } from './NotificationQueueService';

export interface RecordDueParams {
  clearanceId: string;
  amount: number;
  reason: string;
  officerUserId: string;
  source: 'LOGBOOK_OCR' | 'AI_ASSISTANT' | 'MANUAL_OFFICER';
  sourceEntryId?: string;
  idempotencyKey?: string;
  conflictStrategy?: 'ACCUMULATE' | 'ERROR_ON_EXISTING';
  reqObj?: any;
}

export interface DueApplicationResult {
  success: boolean;
  clearanceId: string;
  studentId: string;
  usn: string;
  studentName: string;
  departmentId: string;
  departmentCode: string;
  departmentName: string;
  isLab: boolean;
  labId?: string | null;
  labName?: string | null;
  previousDueAmount: number;
  addedDueAmount: number;
  newDueAmount: number;
  dueDetails: string;
  wasAccumulated: boolean;
  status: DepartmentClearanceStatus | string;
  overallNdcStatus: NdcRequestStatus | string;
  reviewedAt: Date;
  idempotencyKey?: string;
  notification?: NotificationJobData | null;
}

export class DueManagementService {
  /**
   * Revalidates officer permissions for managing clearances for a specific department/lab.
   * Super Admins & Admins have institutional authority.
   * Department Officers must be explicitly mapped or belong to the clearance department.
   * HODs can only manage their academic department.
   */
  public static async verifyOfficerDepartmentAuthorization(
    officerUserId: string,
    clearance: { departmentId: string; department?: { code?: string }; labId?: string | null; studentId?: string }
  ): Promise<{ authorized: boolean; reason?: string }> {
    const user = await prisma.user.findUnique({
      where: { id: officerUserId },
      include: {
        department: true
      }
    });

    if (!user || !user.isActive) {
      return { authorized: false, reason: 'Officer account not found or inactive.' };
    }

    if (user.role === UserRole.SUPER_ADMIN || user.role === UserRole.ADMIN) {
      return { authorized: true };
    }

    if (user.role === UserRole.DEPARTMENT_OFFICER) {
      const officer = await prisma.clearanceOfficer.findUnique({
        where: { userId: officerUserId },
        include: {
          departmentMappings: {
            include: { department: true }
          }
        }
      });

      let authorizedDeptIds: string[] = [];
      if (officer && officer.departmentMappings.length > 0) {
        authorizedDeptIds = officer.departmentMappings.map((m) => m.departmentId);
      } else if (user.departmentId) {
        authorizedDeptIds = [user.departmentId];
      }

      if (!authorizedDeptIds.includes(clearance.departmentId)) {
        return {
          authorized: false,
          reason: `Officer is not authorized for department ${clearance.department?.code || clearance.departmentId}.`
        };
      }

      // Department Lab verification: student must belong to this department
      if (clearance.labId && clearance.studentId) {
        const student = await prisma.student.findUnique({
          where: { id: clearance.studentId },
          select: { departmentId: true }
        });
        if (student && !authorizedDeptIds.includes(student.departmentId)) {
          return {
            authorized: false,
            reason: 'Officer cannot manage Department Lab clearances for students outside their department.'
          };
        }
      }

      return { authorized: true };
    }

    if (user.role === UserRole.HOD) {
      if (user.departmentId !== clearance.departmentId) {
        return {
          authorized: false,
          reason: 'HOD can only review clearances for their respective academic department.'
        };
      }
      return { authorized: true };
    }

    return { authorized: false, reason: `Role [${user.role}] cannot record departmental dues.` };
  }

  /**
   * Shared institutional due-management method.
   * Atomically records a due on an existing clearance record with:
   * 1. Immediate pre-flight revalidation of authentication, permissions, student identity, amount, reason, and state.
   * 2. Multiple dues handling: NEVER silently overwrites existing dues. Accumulates amount and preserves itemized due details.
   * 3. Database transaction for atomic consistency.
   * 4. Audit logging via AuditService.
   * 5. Overall NDC status recalculation.
   * 6. Cache invalidation.
   * 7. Returns verified persisted record state.
   */
  public static async recordClearanceDue(params: RecordDueParams): Promise<DueApplicationResult> {
    const {
      clearanceId,
      amount,
      reason,
      officerUserId,
      source,
      sourceEntryId,
      idempotencyKey,
      conflictStrategy = 'ACCUMULATE',
      reqObj
    } = params;

    // 1. Fetch clearance with student and department
    const clearance = await prisma.ndcClearance.findUnique({
      where: { id: clearanceId },
      include: {
        department: true,
        lab: true,
        student: true
      }
    });

    if (!clearance) {
      throw new Error(`Clearance record [${clearanceId}] not found in database.`);
    }

    if (!clearance.student || !clearance.student.isActive) {
      throw new Error(`Student associated with clearance [${clearanceId}] is invalid or inactive.`);
    }

    // 2. Pre-flight authorization revalidation
    const authCheck = await this.verifyOfficerDepartmentAuthorization(officerUserId, clearance);
    if (!authCheck.authorized) {
      throw new Error(`Unauthorized department clearance operation: ${authCheck.reason}`);
    }

    // 3. Validate amount and reason
    const numAmount = Number(amount);
    if (typeof numAmount !== 'number' || isNaN(numAmount) || numAmount <= 0) {
      throw new Error(`Invalid due amount: ₹${amount}. Amount must be a positive number greater than zero.`);
    }

    const cleanReason = (reason || '').trim();
    if (!cleanReason) {
      throw new Error('Due reason is required and cannot be empty.');
    }

    // 4. Multiple outstanding dues handling: Never overwrite silently!
    const oldStatus = clearance.status;
    const oldDueAmount = Number(clearance.dueAmount) || 0;
    const oldDueDetails = (clearance.dueDetails || '').trim();
    const hasExistingDue = oldStatus === DepartmentClearanceStatus.DUE && oldDueAmount > 0;

    if (hasExistingDue && conflictStrategy === 'ERROR_ON_EXISTING') {
      throw new Error(
        `Conflicting existing due of ₹${oldDueAmount} ("${oldDueDetails}") already exists on this clearance.`
      );
    }

    let newDueAmount = numAmount;
    let newDueDetails = cleanReason;
    let wasAccumulated = false;

    if (hasExistingDue) {
      newDueAmount = Number((oldDueAmount + numAmount).toFixed(2));
      wasAccumulated = true;
      newDueDetails = `${oldDueDetails} + ${cleanReason} (₹${numAmount})`;
    }

    const sectionName = clearance.lab?.name
      ? `${clearance.department.name} - ${clearance.lab.name}`
      : clearance.department.name;

    const remarks = `Due of ₹${numAmount} recorded via ${source}: ${cleanReason}${
      wasAccumulated ? ` [Total accumulated: ₹${newDueAmount}]` : ''
    }`;

    // 5. Execute in database transaction
    const updatedClearance = await prisma.$transaction(async (tx) => {
      const updated = await tx.ndcClearance.update({
        where: { id: clearanceId },
        data: {
          status: DepartmentClearanceStatus.DUE as any,
          dueAmount: newDueAmount,
          dueDetails: newDueDetails,
          remarks,
          reviewedById: officerUserId,
          reviewedAt: new Date()
        },
        include: {
          department: true,
          lab: true,
          student: true,
          ndcRequest: true
        }
      });

      // Write audit log
      await AuditService.log(
        reqObj || null,
        'CLEARANCE_DUE_RECORDED',
        'NdcClearance',
        remarks,
        clearanceId,
        { status: oldStatus, dueAmount: oldDueAmount, dueDetails: oldDueDetails },
        { status: DepartmentClearanceStatus.DUE, dueAmount: newDueAmount, dueDetails: newDueDetails, source, sourceEntryId, idempotencyKey }
      );

      return updated;
    }, {
      maxWait: 10000,
      timeout: 15000
    });

    // 6. Recalculate NDC overall status (outside the sub-transaction for deadlock avoidance)
    await NdcWorkflowService.checkAndUpdateNdcStatus(clearance.ndcRequestId, officerUserId, reqObj);

    // 7. Invalidate caches
    invalidateStudentStatusCache(clearance.studentId);
    invalidateOfficerStatsCache();

    // 8. Re-fetch and verify persisted record state
    const verified = await prisma.ndcClearance.findUnique({
      where: { id: clearanceId },
      include: {
        department: true,
        lab: true,
        student: {
          include: {
            user: { select: { email: true } }
          }
        },
        reviewedBy: { select: { id: true, name: true, email: true } },
        ndcRequest: {
          include: {
            student: {
              include: {
                user: { select: { email: true } }
              }
            },
            clearances: {
              where: {
                department: { isActive: true }
              }
            }
          }
        }
      }
    });

    if (!verified) {
      throw new Error(`Failed to verify persisted clearance record ${clearanceId}.`);
    }

    // 9. Queue notification ONLY after database mutation and verification succeed
    let notificationResult: any = null;
    try {
      const student = verified.student || (verified.ndcRequest as any)?.student;
      const targetEmail = student?.email || student?.user?.email || '';
      const reqClearances = (verified.ndcRequest as any)?.clearances || [];
      const clearedCount = reqClearances.filter(
        (c: any) => c.status === DepartmentClearanceStatus.CLEARED || c.status === DepartmentClearanceStatus.NOT_APPLICABLE
      ).length;

      const notifIdempotencyKey = idempotencyKey
        ? `notif_${idempotencyKey}`
        : `notif_${source.toLowerCase()}_${clearanceId}_due_${Date.now()}`;

      notificationResult = await NotificationQueueService.enqueueClearanceNotification({
        idempotencyKey: notifIdempotencyKey,
        clearanceId: verified.id,
        studentId: verified.studentId,
        usn: verified.student.usn,
        studentName: verified.student.fullName,
        toEmail: targetEmail,
        departmentName: sectionName,
        departmentCode: verified.department.code,
        status: DepartmentClearanceStatus.DUE,
        dueAmount: verified.dueAmount,
        dueDetails: verified.dueDetails || '',
        remarks,
        officerName: (verified as any).reviewedBy?.name || reqObj?.user?.name || reqObj?.user?.email || 'Clearance Officer',
        clearedCount,
        totalCount: reqClearances.length,
        source,
        reqObj
      });
    } catch (notifErr: any) {
      console.warn('[DueManagementService]: Notification queuing notice (non-fatal):', notifErr.message);
    }

    return {
      success: true,
      clearanceId: verified.id,
      studentId: verified.studentId,
      usn: verified.student.usn,
      studentName: verified.student.fullName,
      departmentId: verified.departmentId,
      departmentCode: verified.department.code,
      departmentName: verified.department.name,
      isLab: Boolean(verified.labId || LaboratoryAggregationService.isLaboratoryClearance(verified)),
      labId: verified.labId,
      labName: verified.lab?.name || null,
      previousDueAmount: oldDueAmount,
      addedDueAmount: numAmount,
      newDueAmount: verified.dueAmount,
      dueDetails: verified.dueDetails || '',
      wasAccumulated,
      status: verified.status,
      overallNdcStatus: verified.ndcRequest.status,
      reviewedAt: verified.reviewedAt || new Date(),
      idempotencyKey,
      notification: notificationResult
    };
  }
}
