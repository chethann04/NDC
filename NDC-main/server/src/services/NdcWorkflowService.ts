import crypto from 'crypto';
import prisma from '../config/prisma';
import { DepartmentClearanceStatus, NdcRequestStatus } from '../constants/statuses';
import { CertificateService } from './CertificateService';
import { AuditService } from './AuditService';
import { withId } from '../utils/formatters';
import { departmentCache } from '../utils/departmentCache';

export class NdcWorkflowService {
  /**
   * Ultra-fast atomic initialization for a newly created student.
   * Completely avoids redundant queries: creates request and bulk clearances in 1 round-trip.
   */
  public static async initializeNewStudentNdc(
    studentId: string,
    studentDepartmentId: string,
    clientOrTx: any = prisma
  ): Promise<any> {
    const allDepts = await departmentCache.getAllActiveDepartments();
    const targetDepts = allDepts.filter(
      (d) => d.requiresClearance && (!d.isAcademicBranch || d.id === studentDepartmentId)
    );

    const currentYear = new Date().getFullYear();
    const latestReq = await clientOrTx.ndcRequest.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { requestNumber: true }
    });

    let seq = 0;
    if (latestReq && latestReq.requestNumber) {
      const match = latestReq.requestNumber.match(/\d+$/);
      if (match) seq = parseInt(match[0], 10);
    }
    if (seq === 0) {
      seq = await clientOrTx.ndcRequest.count();
    }
    const requestNumber = `NDC-${currentYear}-${String(seq + 1).padStart(6, '0')}`;
    const requestId = crypto.randomUUID();

    const ndcRequest = await clientOrTx.ndcRequest.create({
      data: {
        id: requestId,
        requestNumber,
        studentId,
        status: NdcRequestStatus.IN_PROGRESS as any,
        submittedAt: new Date()
      }
    });

    const clearanceData = targetDepts.map((dept) => ({
      id: crypto.randomUUID(),
      ndcRequestId: requestId,
      studentId,
      departmentId: dept.id,
      status: DepartmentClearanceStatus.PENDING as any
    }));

    if (clearanceData.length > 0) {
      await clientOrTx.ndcClearance.createMany({
        data: clearanceData,
        skipDuplicates: true
      });
    }

    return withId(ndcRequest);
  }

  /**
   * Ensure an NDC Request and all departmental clearance records exist for a student.
   * Institutional-Driven Workflow: Automatically called on student creation, import, or status check.
   */
  public static async ensureStudentNdcRequest(studentId: string, reqObj?: any): Promise<any> {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        ndcRequests: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          include: { clearances: true }
        }
      }
    });

    if (!student || !student.isActive) {
      return null;
    }

    let ndcRequest: any = student.ndcRequests && student.ndcRequests[0];

    // Fast-path: If request already exists and clearances are initialized (at least 6 general desks), return immediately in 1 query!
    if (ndcRequest && ndcRequest.clearances && ndcRequest.clearances.length >= 6) {
      return withId(ndcRequest);
    }

    if (!ndcRequest) {
      return this.initializeNewStudentNdc(student.id, student.departmentId);
    }

    // Identify all required clearance departments from memory cache
    const allDepts = await departmentCache.getAllActiveDepartments();
    const targetDepts = allDepts.filter(
      (d) => d.requiresClearance && (!d.isAcademicBranch || d.id === student.departmentId)
    );

    // Ensure clearance task exists for each required department
    const existingClearances = await prisma.ndcClearance.findMany({
      where: { ndcRequestId: ndcRequest.id },
      select: { departmentId: true }
    });
    const existingDeptIds = new Set(existingClearances.map((c) => c.departmentId));

    const newClearances = targetDepts
      .filter((dept) => !existingDeptIds.has(dept.id))
      .map((dept) => ({
        id: crypto.randomUUID(),
        ndcRequestId: ndcRequest.id,
        studentId: student.id,
        departmentId: dept.id,
        status: DepartmentClearanceStatus.PENDING as any
      }));

    if (newClearances.length > 0) {
      await prisma.ndcClearance.createMany({
        data: newClearances,
        skipDuplicates: true
      });
    }

    return withId(ndcRequest);
  }

  /**
   * High performance bulk batch processing for student NDC Requests & Clearances.
   */
  public static async ensureStudentNdcRequestsBulk(studentIds: string[], reqObj?: any): Promise<void> {
    if (!studentIds || studentIds.length === 0) return;

    // 1. Fetch active students & their departmentIds in 1 query
    const students = await prisma.student.findMany({
      where: { id: { in: studentIds }, isActive: true }
    });
    if (!students.length) return;

    // 2. Fetch all active general clearance departments ONCE
    const generalDepartments = await prisma.clearanceDepartment.findMany({
      where: { isActive: true, requiresClearance: true, isAcademicBranch: false },
      orderBy: { displayOrder: 'asc' }
    });

    // 3. Fetch academic branch departments for these students in 1 query
    const deptIds = Array.from(new Set(students.map((s) => s.departmentId).filter(Boolean)));
    const branchDepts = await prisma.clearanceDepartment.findMany({
      where: { id: { in: deptIds }, isActive: true, requiresClearance: true }
    });
    const branchDeptMap = new Map(branchDepts.map((d) => [d.id, d]));

    // 4. Fetch existing NDC requests for these students in 1 query
    const existingRequests = await prisma.ndcRequest.findMany({
      where: { studentId: { in: students.map((s) => s.id) } }
    });
    const requestMap = new Map(existingRequests.map((r) => [r.studentId, r]));

    // Create missing requests
    const currentYear = new Date().getFullYear();
    const latestReq = await prisma.ndcRequest.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { requestNumber: true }
    });

    let seq = 0;
    if (latestReq && latestReq.requestNumber) {
      const match = latestReq.requestNumber.match(/\d+$/);
      if (match) seq = parseInt(match[0], 10);
    }
    if (seq === 0) {
      seq = await prisma.ndcRequest.count();
    }

    const newRequestsData: any[] = [];
    const studentsNeedingRequest = students.filter((s) => !requestMap.has(s.id));

    for (const s of studentsNeedingRequest) {
      seq++;
      const requestNumber = `NDC-${currentYear}-${String(seq).padStart(6, '0')}`;
      newRequestsData.push({
        id: crypto.randomUUID(),
        requestNumber,
        studentId: s.id,
        status: NdcRequestStatus.IN_PROGRESS as any,
        submittedAt: new Date()
      });
    }

    if (newRequestsData.length > 0) {
      await prisma.ndcRequest.createMany({
        data: newRequestsData,
        skipDuplicates: true
      });

      // Re-fetch all requests for these students to get generated IDs
      const allRequests = await prisma.ndcRequest.findMany({
        where: { studentId: { in: students.map((s) => s.id) } }
      });
      allRequests.forEach((r) => requestMap.set(r.studentId, r));
    }

    // 5. Fetch existing clearances for all these requests in 1 query
    const requestIds = Array.from(requestMap.values()).map((r) => r.id);
    const existingClearances = await prisma.ndcClearance.findMany({
      where: { ndcRequestId: { in: requestIds } }
    });
    const existingClearanceSet = new Set(existingClearances.map((c) => `${c.ndcRequestId}_${c.departmentId}`));

    const newClearances: any[] = [];
    for (const s of students) {
      const req = requestMap.get(s.id);
      if (!req) continue;

      const deptsForStudent = [...generalDepartments];
      const branch = branchDeptMap.get(s.departmentId);
      if (branch && !deptsForStudent.some((d) => d.id === branch.id)) {
        deptsForStudent.push(branch);
      }

      for (const dept of deptsForStudent) {
        const key = `${req.id}_${dept.id}`;
        if (!existingClearanceSet.has(key)) {
          newClearances.push({
            id: crypto.randomUUID(),
            ndcRequestId: req.id,
            studentId: s.id,
            departmentId: dept.id,
            status: DepartmentClearanceStatus.PENDING as any
          });
          existingClearanceSet.add(key);
        }
      }
    }

    if (newClearances.length > 0) {
      await prisma.ndcClearance.createMany({
        data: newClearances,
        skipDuplicates: true
      });
    }
  }

  /**
   * Create an NDC Request for an eligible student.
   */
  public static async createNdcRequest(studentId: string, reqObj?: any): Promise<any> {
    return this.ensureStudentNdcRequest(studentId, reqObj);
  }

  /**
   * Process a departmental clearance update (Clear, Mark Due, Hold, Not Applicable).
   * After updating, automatically recalculates overall NDC status.
   */
  public static async processClearanceChange(
    clearanceId: string,
    status: DepartmentClearanceStatus,
    officerUserId: string,
    remarks?: string,
    dueAmount?: number,
    dueDetails?: string,
    reqObj?: any
  ): Promise<any> {
    const clearance = await prisma.ndcClearance.findUnique({
      where: { id: clearanceId }
    });

    if (!clearance) {
      throw new Error('Clearance task not found.');
    }

    // Validation rules & defaults
    const finalDueDetails = status === DepartmentClearanceStatus.DUE
      ? (dueDetails && dueDetails.trim() !== '' ? dueDetails.trim() : 'Pending Dues')
      : '';

    const oldStatus = clearance.status;
    const updated = await prisma.ndcClearance.update({
      where: { id: clearanceId },
      data: {
        status: status as any,
        remarks: remarks || '',
        dueAmount: status === DepartmentClearanceStatus.DUE ? (dueAmount || 0) : 0,
        dueDetails: finalDueDetails,
        reviewedById: officerUserId,
        reviewedAt: new Date()
      }
    });

    await AuditService.log(
      reqObj || null,
      `CLEARANCE_${status}`,
      'NdcClearance',
      `Updated departmental clearance status from [${oldStatus}] to [${status}]. Remarks: ${remarks || 'N/A'}`,
      clearance.id,
      { status: oldStatus },
      { status, remarks, dueAmount, dueDetails }
    );

    // Recalculate NDC overall status
    await this.checkAndUpdateNdcStatus(clearance.ndcRequestId, officerUserId, reqObj);

    return withId(updated);
  }

  /**
   * Evaluate all clearances for an NDC request and update request status.
   * Rules:
   * - If all required clearances are CLEARED or NOT_APPLICABLE -> NDC = APPROVED & Auto Generate Certificate
   * - If any clearance is DUE -> NDC = BLOCKED
   * - Otherwise (PENDING or ON_HOLD) -> NDC = IN_PROGRESS
   */
  public static async checkAndUpdateNdcStatus(
    ndcRequestId: string,
    updatedByUserId?: string,
    reqObj?: any
  ): Promise<NdcRequestStatus> {
    const request = await prisma.ndcRequest.findUnique({
      where: { id: ndcRequestId }
    });

    if (!request) {
      throw new Error('NDC Request not found.');
    }

    const clearances = await prisma.ndcClearance.findMany({
      where: {
        ndcRequestId: request.id,
        department: {
          isActive: true,
          requiresClearance: true
        }
      }
    });

    let hasDue = false;
    let hasPendingOrHold = false;
    let allClearedOrNa = true;

    for (const c of clearances) {
      if (c.status === DepartmentClearanceStatus.DUE) {
        hasDue = true;
        allClearedOrNa = false;
      } else if (c.status === DepartmentClearanceStatus.PENDING || c.status === DepartmentClearanceStatus.ON_HOLD) {
        hasPendingOrHold = true;
        allClearedOrNa = false;
      }
    }

    let newStatus: NdcRequestStatus = NdcRequestStatus.IN_PROGRESS;

    if (hasDue) {
      newStatus = NdcRequestStatus.BLOCKED;
    } else if (allClearedOrNa && clearances.length > 0) {
      newStatus = NdcRequestStatus.APPROVED;
    } else if (hasPendingOrHold) {
      newStatus = NdcRequestStatus.IN_PROGRESS;
    }

    if (request.status !== (newStatus as any)) {
      const oldStatus = request.status;
      await prisma.ndcRequest.update({
        where: { id: request.id },
        data: {
          status: newStatus as any,
          completedAt: newStatus === NdcRequestStatus.APPROVED ? new Date() : null
        }
      });

      await AuditService.log(
        reqObj || null,
        'NDC_STATUS_CHANGED',
        'NdcRequest',
        `NDC Request [${request.requestNumber}] status updated to [${newStatus}].`,
        request.id,
        { status: oldStatus },
        { status: newStatus }
      );

      // If not approved (due or hold), automatically revoke any existing certificate
      if (newStatus !== NdcRequestStatus.APPROVED) {
        const existingCert = await prisma.ndcCertificate.findFirst({
          where: { ndcRequestId: request.id, isReplaced: false }
        });
        if (existingCert && existingCert.status !== ('REVOKED' as any)) {
          await prisma.ndcCertificate.update({
            where: { id: existingCert.id },
            data: {
              status: 'REVOKED' as any,
              revocationReason: hasDue ? 'Department marked student with outstanding dues.' : 'Department clearance put on hold.',
              revokedAt: new Date()
            }
          });
          await prisma.ndcRequest.update({
            where: { id: request.id },
            data: { certificateId: existingCert.id }
          });
        }
      }

      // If approved, trigger Certificate Generation automatically
      if (newStatus === NdcRequestStatus.APPROVED) {
        await CertificateService.generateCertificate(request.id, updatedByUserId, reqObj);
      }
    }

    return newStatus;
  }

  /**
   * Super Admin Override function for a clearance record.
   */
  public static async adminOverrideClearance(
    clearanceId: string,
    newStatus: DepartmentClearanceStatus,
    overrideReason: string,
    adminUserId: string,
    reqObj?: any
  ): Promise<any> {
    if (!overrideReason || overrideReason.trim() === '') {
      throw new Error('Override reason is strictly required for Super Admin overrides.');
    }

    const clearance = await prisma.ndcClearance.findUnique({
      where: { id: clearanceId }
    });

    if (!clearance) {
      throw new Error('Clearance record not found.');
    }

    const oldStatus = clearance.status;
    const updated = await prisma.ndcClearance.update({
      where: { id: clearanceId },
      data: {
        status: newStatus as any,
        remarks: `[ADMIN OVERRIDE]: ${overrideReason}`,
        reviewedById: adminUserId,
        reviewedAt: new Date()
      }
    });

    await AuditService.log(
      reqObj || null,
      'ADMIN_OVERRIDE',
      'NdcClearance',
      `Super Admin overridden clearance status from [${oldStatus}] to [${newStatus}]. Reason: ${overrideReason}`,
      clearance.id,
      { status: oldStatus },
      { status: newStatus, overrideReason }
    );

    // Recalculate NDC overall status
    await this.checkAndUpdateNdcStatus(clearance.ndcRequestId, adminUserId, reqObj);

    return withId(updated);
  }
}
