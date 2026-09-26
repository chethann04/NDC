import crypto from 'crypto';
import prisma from '../config/prisma';
import { DepartmentClearanceStatus, NdcRequestStatus } from '../constants/statuses';
import { CertificateService } from './CertificateService';
import { AuditService } from './AuditService';
import { LaboratoryAggregationService } from './LaboratoryAggregationService';
import { withId } from '../utils/formatters';
import { departmentCache } from '../utils/departmentCache';
import emailService from './EmailService';

export class NdcWorkflowService {
  /**
   * Ultra-fast atomic initialization for a newly created student.
   * Completely avoids redundant queries: creates request and bulk clearances in 1 round-trip.
   */
  public static async initializeNewStudentNdc(
    studentId: string,
    studentDepartmentId: string,
    clientOrTx: any = prisma,
    remarks?: string
  ): Promise<any> {
    const allDepts = await departmentCache.getAllActiveDepartments();
    const targetDepts = allDepts.filter(
      (d) => d.requiresClearance && !d.isAcademicBranch
    );

    const currentYear = new Date().getFullYear();
    const count = await clientOrTx.ndcRequest.count();
    let requestNumber = `NDC-${currentYear}-${String(count + 1).padStart(6, '0')}`;

    // Guarantee unique requestNumber without race collisions
    let attempts = 0;
    while (attempts < 10) {
      const exists = await clientOrTx.ndcRequest.findUnique({
        where: { requestNumber },
        select: { id: true }
      });
      if (!exists) break;
      attempts++;
      const rand = Math.floor(1000 + Math.random() * 9000);
      requestNumber = `NDC-${currentYear}-${String(count + attempts).padStart(4, '0')}-${rand}`;
    }
    const requestId = crypto.randomUUID();

    const ndcRequest = await clientOrTx.ndcRequest.create({
      data: {
        id: requestId,
        requestNumber,
        studentId,
        status: NdcRequestStatus.IN_PROGRESS as any,
        submittedAt: new Date(),
        remarks: remarks || undefined
      }
    });

    const clearanceData: any[] = targetDepts.map((dept) => ({
      id: crypto.randomUUID(),
      ndcRequestId: requestId,
      studentId,
      departmentId: dept.id,
      labId: null,
      status: DepartmentClearanceStatus.PENDING as any
    }));

    // Dynamically include departmental laboratory configured for the student's department (only 1 lab per department)
    if (studentDepartmentId) {
      const deptLabs = await clientOrTx.departmentLab.findMany({
        where: { departmentId: studentDepartmentId, isActive: true },
        take: 1,
        orderBy: { displayOrder: 'asc' }
      });
      for (const lab of deptLabs) {
        clearanceData.push({
          id: crypto.randomUUID(),
          ndcRequestId: requestId,
          studentId,
          departmentId: studentDepartmentId,
          labId: lab.id,
          status: DepartmentClearanceStatus.PENDING as any
        });
      }
    }

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

    // If request does not exist, initialize it cleanly
    if (!ndcRequest) {
      return this.initializeNewStudentNdc(student.id, student.departmentId);
    }

    // Identify all required clearance departments from memory cache
    const allDepts = await departmentCache.getAllActiveDepartments();
    const targetDepts = allDepts.filter(
      (d) => d.requiresClearance && !d.isAcademicBranch
    );
    const targetDeptIds = new Set(targetDepts.map((d) => d.id));

    // Ensure no academic desk clearance exists (faculty reviews Department Lab only)
    await prisma.ndcClearance.deleteMany({
      where: {
        ndcRequestId: ndcRequest.id,
        labId: null,
        department: { isAcademicBranch: true }
      }
    });

    // Fetch existing clearances for this request
    const existingClearances = await prisma.ndcClearance.findMany({
      where: { ndcRequestId: ndcRequest.id },
      select: {
        id: true,
        departmentId: true,
        labId: true,
        status: true,
        reviewedById: true,
        remarks: true,
        department: { select: { code: true } }
      }
    });
    const existingDeptDesks = new Set(
      existingClearances.filter((c) => !c.labId).map((c) => c.departmentId)
    );
    const existingLabIds = new Set(
      existingClearances.filter((c) => c.labId).map((c) => c.labId)
    );

    // Only restore clearances that were automatically marked NOT_APPLICABLE due to being Optional/Exempt by Administration,
    // and have NOT been reviewed by an officer (Hostel section NOT_APPLICABLE is an authorized review outcome for day scholars and must never be reverted)
    const toRestore = existingClearances.filter(
      (c) =>
        !c.labId &&
        targetDeptIds.has(c.departmentId) &&
        c.status === DepartmentClearanceStatus.NOT_APPLICABLE &&
        !c.reviewedById &&
        c.department?.code !== 'HST' &&
        c.remarks === 'Department marked as Optional/Exempt by Administration'
    );
    if (toRestore.length > 0) {
      await prisma.ndcClearance.updateMany({
        where: { id: { in: toRestore.map((c) => c.id) } },
        data: {
          status: DepartmentClearanceStatus.PENDING as any,
          remarks: 'Restored to required clearance'
        }
      });
    }

    // Only exempt clearances that have not been reviewed by an officer
    const toExempt = existingClearances.filter(
      (c) =>
        !c.labId &&
        !targetDeptIds.has(c.departmentId) &&
        !c.reviewedById &&
        (c.status === DepartmentClearanceStatus.PENDING || c.status === DepartmentClearanceStatus.ON_HOLD)
    );
    if (toExempt.length > 0) {
      await prisma.ndcClearance.updateMany({
        where: { id: { in: toExempt.map((c) => c.id) } },
        data: {
          status: DepartmentClearanceStatus.NOT_APPLICABLE as any,
          remarks: 'Department marked as Optional/Exempt by Administration'
        }
      });
    }

    const newClearances: any[] = targetDepts
      .filter((dept) => !existingDeptDesks.has(dept.id))
      .map((dept) => ({
        id: crypto.randomUUID(),
        ndcRequestId: ndcRequest.id,
        studentId: student.id,
        departmentId: dept.id,
        labId: null,
        status: DepartmentClearanceStatus.PENDING as any
      }));

    // Check for missing departmental lab (at most 1 lab per department)
    if (student.departmentId) {
      const deptLabs = await prisma.departmentLab.findMany({
        where: { departmentId: student.departmentId, isActive: true },
        take: 1,
        orderBy: { displayOrder: 'asc' }
      });
      for (const lab of deptLabs) {
        if (!existingLabIds.has(lab.id)) {
          newClearances.push({
            id: crypto.randomUUID(),
            ndcRequestId: ndcRequest.id,
            studentId: student.id,
            departmentId: student.departmentId,
            labId: lab.id,
            status: DepartmentClearanceStatus.PENDING as any
          });
        }
      }
    }

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
      const randSuffix = Math.floor(1000 + Math.random() * 9000);
      const requestNumber = `NDC-${currentYear}-${String(seq).padStart(6, '0')}-${randSuffix}`;
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

    // 5. Clean up any legacy branch desk clearances (labId: null for academic branches)
    const requestIds = Array.from(requestMap.values()).map((r) => r.id);
    await prisma.ndcClearance.deleteMany({
      where: {
        ndcRequestId: { in: requestIds },
        labId: null,
        department: { isAcademicBranch: true }
      }
    });

    // Fetch existing clearances for all these requests in 1 query
    const existingClearances = await prisma.ndcClearance.findMany({
      where: { ndcRequestId: { in: requestIds } }
    });
    const existingClearanceSet = new Set(
      existingClearances.map((c) => `${c.ndcRequestId}_${c.departmentId}_${c.labId || 'desk'}`)
    );

    // Fetch all active department labs for these branches
    const allDeptLabs = await prisma.departmentLab.findMany({
      where: { departmentId: { in: deptIds }, isActive: true },
      orderBy: { displayOrder: 'asc' }
    });
    const labsByDeptId = new Map<string, any[]>();
    allDeptLabs.forEach((l) => {
      const arr = labsByDeptId.get(l.departmentId) || [];
      arr.push(l);
      labsByDeptId.set(l.departmentId, arr);
    });

    // Auto-provision branch department lab if missing
    for (const dId of deptIds) {
      if (!labsByDeptId.has(dId) || (labsByDeptId.get(dId) || []).length === 0) {
        const branchDept = branchDeptMap.get(dId);
        if (branchDept && branchDept.isAcademicBranch) {
          try {
            const newLab = await prisma.departmentLab.upsert({
              where: { departmentId: dId },
              update: { isActive: true },
              create: {
                departmentId: dId,
                code: `${branchDept.code.toUpperCase()}-LAB`,
                name: `${branchDept.name} Lab`,
                isActive: true,
                displayOrder: 1
              }
            });
            labsByDeptId.set(dId, [newLab]);
          } catch {
            const fetched = await prisma.departmentLab.findFirst({ where: { departmentId: dId } });
            if (fetched) labsByDeptId.set(dId, [fetched]);
          }
        }
      }
    }

    const newClearances: any[] = [];
    for (const s of students) {
      const req = requestMap.get(s.id);
      if (!req) continue;

      const deptsForStudent = [...generalDepartments];

      for (const dept of deptsForStudent) {
        const key = `${req.id}_${dept.id}_desk`;
        if (!existingClearanceSet.has(key)) {
          newClearances.push({
            id: crypto.randomUUID(),
            ndcRequestId: req.id,
            studentId: s.id,
            departmentId: dept.id,
            labId: null,
            status: DepartmentClearanceStatus.PENDING as any
          });
          existingClearanceSet.add(key);
        }
      }

      // Add department lab for student's branch (at most 1 lab)
      const branchLabs = (labsByDeptId.get(s.departmentId) || []).slice(0, 1);
      for (const lab of branchLabs) {
        const key = `${req.id}_${s.departmentId}_${lab.id}`;
        if (!existingClearanceSet.has(key)) {
          newClearances.push({
            id: crypto.randomUUID(),
            ndcRequestId: req.id,
            studentId: s.id,
            departmentId: s.departmentId,
            labId: lab.id,
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
   * System-wide sync: checks all active students in the database and ensures every student
   * has an active NDC Request and clearances across all required departments.
   */
  public static async ensureAllStudentsClearances(reqObj?: any): Promise<number> {
    const allStudents = await prisma.student.findMany({
      where: { isActive: true },
      select: { id: true }
    });
    if (allStudents.length === 0) return 0;

    const studentIds = allStudents.map((s) => s.id);
    const BATCH_SIZE = 500;
    for (let i = 0; i < studentIds.length; i += BATCH_SIZE) {
      const slice = studentIds.slice(i, i + BATCH_SIZE);
      await this.ensureStudentNdcRequestsBulk(slice, reqObj);
    }
    return studentIds.length;
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
      where: { id: clearanceId },
      include: { department: true }
    });

    if (!clearance) {
      throw new Error('Clearance task not found.');
    }

    if (status === DepartmentClearanceStatus.NOT_APPLICABLE) {
      const isHostel = clearance.department?.code === 'HST' ||
                       clearance.department?.name?.toLowerCase().includes('hostel');
      if (!isHostel) {
        throw new Error('NOT_APPLICABLE status is strictly restricted to the Hostel clearance section.');
      }
    }

    // Validation rules & defaults
    const finalDueDetails = status === DepartmentClearanceStatus.DUE
      ? (dueDetails && dueDetails.trim() !== '' ? dueDetails.trim() : 'Pending Dues')
      : '';

    const finalRemarks = status === DepartmentClearanceStatus.NOT_APPLICABLE
      ? (remarks && remarks.trim() !== '' ? remarks.trim() : 'Not applicable (Hostel clearance not required / Day scholar)')
      : (remarks || '');

    const oldStatus = clearance.status;
    const updated = await prisma.ndcClearance.update({
      where: { id: clearanceId },
      data: {
        status: status as any,
        remarks: finalRemarks,
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

    // Asynchronously dispatch notification email to student's registered email address
    (async () => {
      try {
        const fullClearance = await prisma.ndcClearance.findUnique({
          where: { id: clearanceId },
          include: {
            department: true,
            lab: true,
            reviewedBy: { select: { id: true, name: true } },
            ndcRequest: {
              include: {
                student: {
                  include: {
                    user: { select: { email: true } }
                  }
                },
                clearances: {
                  where: {
                    department: {
                      isActive: true,
                      requiresClearance: true
                    }
                  }
                }
              }
            }
          }
        });

        const student = fullClearance?.ndcRequest?.student;
        const targetEmail = student?.user?.email || student?.email;

        if (targetEmail && student) {
          const reqClearances = fullClearance.ndcRequest?.clearances || [];
          const clearedCount = reqClearances.filter(
            (c: any) => c.status === DepartmentClearanceStatus.CLEARED || c.status === DepartmentClearanceStatus.NOT_APPLICABLE
          ).length;
          const totalCount = reqClearances.length;

          const sectionName = fullClearance.lab?.name
            ? (fullClearance.department?.name ? `${fullClearance.department.name} - ${fullClearance.lab.name}` : fullClearance.lab.name)
            : fullClearance.department?.name || 'Department Clearance Section';

          await emailService.sendClearanceUpdateEmail({
            toEmail: targetEmail,
            studentName: student.fullName,
            usn: student.usn,
            departmentName: sectionName,
            departmentCode: fullClearance.department?.code,
            status: status,
            dueAmount: status === DepartmentClearanceStatus.DUE ? (dueAmount || 0) : 0,
            dueDetails: status === DepartmentClearanceStatus.DUE ? finalDueDetails : undefined,
            remarks: finalRemarks,
            officerName: fullClearance.reviewedBy?.name,
            clearedCount,
            totalCount
          });
        }
      } catch (emailErr) {
        console.warn('[NdcWorkflowService]: Failed to dispatch clearance update email:', emailErr);
      }
    })().catch(() => {});

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
      },
      include: {
        department: true,
        lab: true
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

    // Verify aggregate laboratory status using centralized rule
    const labSummary = LaboratoryAggregationService.getLaboratoryClearanceSummary(clearances);
    if (labSummary.overallLaboratoryStatus === 'DUE') {
      hasDue = true;
      allClearedOrNa = false;
    }

    let newStatus: NdcRequestStatus = NdcRequestStatus.IN_PROGRESS;

    if (hasDue) {
      newStatus = NdcRequestStatus.BLOCKED;
    } else if (allClearedOrNa && clearances.length > 0 && labSummary.overallLaboratoryStatus === 'NO DUE') {
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
          completedAt: newStatus === NdcRequestStatus.APPROVED ? new Date() : null,
          certificateId: newStatus === NdcRequestStatus.APPROVED ? request.certificateId : null
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

    // Asynchronously dispatch notification email to student's registered email address
    (async () => {
      try {
        const fullClearance = await prisma.ndcClearance.findUnique({
          where: { id: clearanceId },
          include: {
            department: true,
            lab: true,
            ndcRequest: {
              include: {
                student: {
                  include: {
                    user: { select: { email: true } }
                  }
                },
                clearances: {
                  where: {
                    department: {
                      isActive: true,
                      requiresClearance: true
                    }
                  }
                }
              }
            }
          }
        });

        const student = fullClearance?.ndcRequest?.student;
        const targetEmail = student?.user?.email || student?.email;

        if (targetEmail && student) {
          const reqClearances = fullClearance.ndcRequest?.clearances || [];
          const clearedCount = reqClearances.filter(
            (c: any) => c.status === DepartmentClearanceStatus.CLEARED || c.status === DepartmentClearanceStatus.NOT_APPLICABLE
          ).length;

          const sectionName = fullClearance.lab?.name
            ? (fullClearance.department?.name ? `${fullClearance.department.name} - ${fullClearance.lab.name}` : fullClearance.lab.name)
            : fullClearance.department?.name || 'Department Clearance Section';

          await emailService.sendClearanceUpdateEmail({
            toEmail: targetEmail,
            studentName: student.fullName,
            usn: student.usn,
            departmentName: sectionName,
            departmentCode: fullClearance.department?.code,
            status: newStatus,
            remarks: `Admin Override: ${overrideReason || 'Administrative update'}`,
            officerName: 'System Administrator',
            clearedCount,
            totalCount: reqClearances.length
          });
        }
      } catch (emailErr) {
        console.warn('[NdcWorkflowService]: Admin override email dispatch warning:', emailErr);
      }
    })().catch(() => {});

    return withId(updated);
  }

  /**
   * Synchronize departmental clearance requirement when an admin toggles
   * "Mandatory Clearance Required" (requiresClearance) or active status in Administration Block.
   * Ensures that all active students, pending queues, and workflow states immediately reflect the change.
   */
  public static async syncDepartmentClearanceRequirement(
    departmentId: string,
    isRequiredAndActive: boolean,
    reqObj?: any
  ): Promise<void> {
    departmentCache.invalidate();

    const dept = await prisma.clearanceDepartment.findUnique({
      where: { id: departmentId }
    });
    if (!dept) return;

    if (!isRequiredAndActive) {
      // 1. Department is no longer required or has been deactivated.
      // Update any pending/on-hold clearances for this department to NOT_APPLICABLE
      const affectedClearances = await prisma.ndcClearance.findMany({
        where: {
          departmentId,
          labId: null,
          status: { in: [DepartmentClearanceStatus.PENDING, DepartmentClearanceStatus.ON_HOLD] },
          ndcRequest: {
            status: { in: [NdcRequestStatus.IN_PROGRESS, NdcRequestStatus.PENDING, NdcRequestStatus.BLOCKED] }
          }
        },
        select: { id: true, ndcRequestId: true }
      });

      if (affectedClearances.length > 0) {
        await prisma.ndcClearance.updateMany({
          where: {
            id: { in: affectedClearances.map((c) => c.id) }
          },
          data: {
            status: DepartmentClearanceStatus.NOT_APPLICABLE as any,
            remarks: 'Department marked as Optional/Exempt by Administration'
          }
        });
      }

      // Re-evaluate affected active requests so that student status and auto-approval update immediately
      const requestsToReevaluate = Array.from(new Set(affectedClearances.map((c) => c.ndcRequestId)));
      for (const reqId of requestsToReevaluate) {
        await this.checkAndUpdateNdcStatus(reqId, undefined, reqObj);
      }
    } else {
      // 2. Department is now mandatory & active.
      // Find all active NDC requests that don't have a completed certificate yet
      const activeRequests = await prisma.ndcRequest.findMany({
        where: {
          status: { in: [NdcRequestStatus.IN_PROGRESS, NdcRequestStatus.PENDING, NdcRequestStatus.BLOCKED, NdcRequestStatus.APPROVED] }
        },
        include: {
          student: true,
          clearances: {
            where: { departmentId, labId: null }
          }
        }
      });

      const requestsToReevaluate: string[] = [];

      for (const reqItem of activeRequests) {
        // Only apply if non-academic or student's own academic department
        const applies = !dept.isAcademicBranch || dept.id === reqItem.student.departmentId;
        if (!applies) continue;

        if (reqItem.clearances.length === 0) {
          // Create new pending clearance
          await prisma.ndcClearance.create({
            data: {
              id: crypto.randomUUID(),
              ndcRequestId: reqItem.id,
              studentId: reqItem.studentId,
              departmentId: dept.id,
              labId: null,
              status: DepartmentClearanceStatus.PENDING as any
            }
          });
          requestsToReevaluate.push(reqItem.id);
        } else {
          // If clearance exists and was marked NOT_APPLICABLE by admin exemption, revert to PENDING
          const naClearances = reqItem.clearances.filter(
            (c) =>
              c.status === DepartmentClearanceStatus.NOT_APPLICABLE &&
              !c.reviewedById &&
              dept.code !== 'HST' &&
              c.remarks === 'Department marked as Optional/Exempt by Administration'
          );
          if (naClearances.length > 0) {
            await prisma.ndcClearance.updateMany({
              where: {
                id: { in: naClearances.map((c) => c.id) }
              },
              data: {
                status: DepartmentClearanceStatus.PENDING as any,
                remarks: 'Department restored to Mandatory by Administration'
              }
            });
            requestsToReevaluate.push(reqItem.id);
          }
        }
      }

      for (const reqId of requestsToReevaluate) {
        await this.checkAndUpdateNdcStatus(reqId, undefined, reqObj);
      }
    }

    departmentCache.invalidate();
  }
}
