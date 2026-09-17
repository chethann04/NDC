import { Response } from 'express';
import prisma from '../config/prisma';
import { NdcWorkflowService } from '../services/NdcWorkflowService';
import { ReportController } from './ReportController';
import { PdfService } from '../services/PdfService';
import { AuthRequest } from '../middleware/auth';
import { UserRole } from '../constants/roles';
import { withId, withIds } from '../utils/formatters';

export class NdcController {
  /**
   * Student applies for a No Due Certificate (Deprecated / Blocked).
   */
  public static async applyForNdc(req: AuthRequest, res: Response): Promise<void> {
    res.status(400).json({
      success: false,
      message: 'The NDC system is institution-driven. No manual NDC application is required. Clearance tasks are automatically initialized by the institution.'
    });
  }

  /**
   * Get student's active or recent NDC request and clearance breakdown.
   */
  public static async getStudentNdcStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      let studentId = req.params.studentId || req.user?.associatedStudentId;
      if (!studentId) {
        res.status(200).json({
          success: true,
          hasActiveRequest: false,
          student: null,
          clearances: [],
          progress: { total: 0, cleared: 0, percentage: 0 },
          message: 'No student profile associated with this user account.'
        });
        return;
      }

      // Backend RBAC Scoping for Student reading student NDC status
      if (req.user) {
        if (req.user.role === UserRole.STUDENT && req.user.associatedStudentId) {
          if (String(studentId) !== String(req.user.associatedStudentId)) {
            res.status(403).json({ success: false, message: 'Forbidden: You can only view your own clearance status.' });
            return;
          }
        }
      }

      let student = await prisma.student.findUnique({
        where: { id: studentId },
        include: { department: true }
      });

      if (!student) {
        res.status(200).json({
          success: true,
          hasActiveRequest: false,
          student: null,
          clearances: [],
          progress: { total: 0, cleared: 0, percentage: 0 },
          message: 'Student profile not found.'
        });
        return;
      }

      // Auto-ensure NDC request and clearances exist for institution-driven workflow
      let ndcRequest = await NdcWorkflowService.ensureStudentNdcRequest(student.id, req);

      if (!ndcRequest) {
        ndcRequest = await prisma.ndcRequest.findFirst({
          where: { studentId: student.id },
          orderBy: { createdAt: 'desc' }
        });
      }

      if (!ndcRequest) {
        res.status(200).json({
          success: true,
          hasActiveRequest: false,
          student: withId(student),
          clearances: [],
          progress: { total: 0, cleared: 0, percentage: 0 },
          message: 'No NDC request found for this student.'
        });
        return;
      }

      const reqId = ndcRequest.id || ndcRequest._id;
      const rawClearances = await prisma.ndcClearance.findMany({
        where: { ndcRequestId: reqId },
        include: {
          department: true,
          reviewedBy: {
            select: { id: true, name: true, email: true, role: true }
          }
        },
        orderBy: { createdAt: 'asc' }
      });

      const clearances = rawClearances.filter((c) => c.department != null);

      const totalDepartments = clearances.length;
      const clearedCount = clearances.filter(
        (c) => c.status === 'CLEARED' || c.status === 'NOT_APPLICABLE'
      ).length;

      // Auto-heal / Auto-generate certificate if all departments are cleared
      if (totalDepartments > 0 && clearedCount === totalDepartments) {
        try {
          if (ndcRequest.status !== 'APPROVED') {
            await prisma.ndcRequest.update({
              where: { id: reqId },
              data: {
                status: 'APPROVED' as any,
                completedAt: new Date()
              }
            });
          }
          let cert = await prisma.ndcCertificate.findFirst({
            where: { ndcRequestId: reqId, status: 'VALID' as any }
          });
          if (!cert) {
            const { CertificateService } = await import('../services/CertificateService');
            cert = await CertificateService.generateCertificate(reqId, req.user?.id || req.user?._id, req);
          }
          if (cert && (!ndcRequest.certificateId || ndcRequest.certificateId !== cert.id)) {
            await prisma.ndcRequest.update({
              where: { id: reqId },
              data: { certificateId: cert.id }
            });
          }
        } catch (certErr) {
          console.error('[AutoCertGen Error]:', certErr);
        }
      }

      const refreshedRequest = await prisma.ndcRequest.findUnique({
        where: { id: reqId },
        include: { certificate: true }
      });

      res.status(200).json({
        success: true,
        hasActiveRequest: true,
        student: withId(student),
        ndcRequest: withId(refreshedRequest || ndcRequest),
        clearances: withIds(clearances.map((c) => ({
          ...c,
          departmentId: withId(c.department),
          reviewedBy: withId(c.reviewedBy)
        }))),
        progress: {
          total: totalDepartments,
          cleared: clearedCount,
          percentage: totalDepartments > 0 ? Math.round((clearedCount / totalDepartments) * 100) : 0
        }
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Get all NDC requests (Admin / Overview / HOD).
   */
  public static async getAllNdcRequests(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { status, search, page = '1', limit = '50' } = req.query;
      const where: any = {};

      if (status) {
        const s = String(status).trim();
        if (s === 'ACTIVE') {
          where.status = { in: ['PENDING', 'IN_PROGRESS', 'BLOCKED'] };
        } else if (s.includes(',')) {
          where.status = { in: s.split(',').map((item: string) => item.trim()) };
        } else {
          where.status = s;
        }
      }

      // HOD Scope: Only students of HOD's academic department
      const baseScope: any = {};
      if (req.user.role === UserRole.HOD && req.user.departmentId) {
        where.student = { departmentId: req.user.departmentId };
        baseScope.student = { departmentId: req.user.departmentId };
      }

      if (search) {
        const searchStr = String(search).trim();
        where.OR = [
          { requestNumber: { contains: searchStr, mode: 'insensitive' } },
          { student: { usn: { contains: searchStr, mode: 'insensitive' } } },
          { student: { fullName: { contains: searchStr, mode: 'insensitive' } } }
        ];
      }

      const pageNum = Math.max(1, parseInt(String(page || '1'), 10));
      const limitNum = Math.min(1000, Math.max(1, parseInt(String(limit || '50'), 10)));
      const skip = (pageNum - 1) * limitNum;

      const [total, requests, totalAll, totalActive, totalApproved] = await Promise.all([
        prisma.ndcRequest.count({ where }),
        prisma.ndcRequest.findMany({
          where,
          include: {
            student: {
              select: {
                id: true,
                studentId: true,
                usn: true,
                fullName: true,
                email: true,
                departmentId: true,
                batch: true,
                department: {
                  select: { id: true, name: true, code: true }
                }
              }
            },
            certificate: {
              select: {
                id: true,
                certificateNumber: true,
                status: true,
                issuedAt: true,
                isSubmitted: true,
                submittedAt: true,
                pdfPath: true
              }
            }
          },
          orderBy: { submittedAt: 'desc' },
          skip,
          take: limitNum
        }),
        prisma.ndcRequest.count({ where: baseScope }),
        prisma.ndcRequest.count({ where: { ...baseScope, status: { in: ['PENDING', 'IN_PROGRESS', 'BLOCKED'] } } }),
        prisma.ndcRequest.count({ where: { ...baseScope, status: 'APPROVED' } })
      ]);

      const formatted = requests.map((r) => ({
        ...r,
        studentId: withId(r.student ? { ...r.student, departmentId: withId(r.student.department) } : null),
        certificateId: withId(r.certificate)
      }));

      res.status(200).json({
        success: true,
        data: withIds(formatted),
        counts: {
          total: totalAll,
          active: totalActive,
          approved: totalApproved
        },
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum)
        }
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Get Single NDC Request with detailed departmental clearances.
   */
  public static async getNdcRequestById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { requestId } = req.params;

      const request = await prisma.ndcRequest.findUnique({
        where: { id: requestId },
        include: {
          student: {
            include: { department: true }
          },
          clearances: {
            where: {
              department: {
                isActive: true,
                requiresClearance: true
              }
            },
            include: {
              department: true,
              reviewedBy: {
                select: { id: true, name: true, email: true, role: true }
              }
            },
            orderBy: { createdAt: 'asc' }
          },
          certificate: true
        }
      });

      if (!request) {
        res.status(404).json({ success: false, message: 'NDC request not found.' });
        return;
      }

      const formattedClearances = request.clearances.map((c) => ({
        ...c,
        departmentId: withId(c.department),
        reviewedBy: withId(c.reviewedBy)
      }));

      const formatted = {
        ...request,
        studentId: withId(request.student ? { ...request.student, departmentId: withId(request.student.department) } : null),
        certificateId: withId(request.certificate),
        clearances: withIds(formattedClearances)
      };

      res.status(200).json({
        success: true,
        data: withId(formatted)
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Get Department Officer Clearance Queue.
   */
  public static async getOfficerClearances(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { status, search, departmentId, page = '1', limit = '50' } = req.query;
      const where: any = {};

      if (status) {
        where.status = status;
      }

      if (req.user.role === UserRole.DEPARTMENT_OFFICER) {
        let assignedDeptIds: string[] = [];
        const officer = await prisma.clearanceOfficer.findUnique({
          where: { userId: req.user.id || req.user._id },
          include: { departmentMappings: true }
        });
        if (officer && officer.departmentMappings.length > 0) {
          assignedDeptIds = officer.departmentMappings.map((m) => m.departmentId);
        } else if (req.user.departmentId) {
          assignedDeptIds = [req.user.departmentId];
        }

        if (departmentId) {
          where.departmentId = String(departmentId);
        } else if (assignedDeptIds.length > 0) {
          where.departmentId = { in: assignedDeptIds };
        }
      } else if (req.user.role === UserRole.HOD && req.user.departmentId) {
        where.departmentId = req.user.departmentId;
      } else if (departmentId) {
        where.departmentId = String(departmentId);
      }

      if (search) {
        const searchStr = String(search).trim();
        where.OR = [
          { student: { fullName: { contains: searchStr, mode: 'insensitive' } } },
          { student: { usn: { contains: searchStr, mode: 'insensitive' } } },
          { ndcRequest: { requestNumber: { contains: searchStr, mode: 'insensitive' } } }
        ];
      }

      const pageNum = Math.max(1, parseInt(String(page || '1'), 10));
      const limitNum = Math.min(500, Math.max(1, parseInt(String(limit || '50'), 10)));
      const skip = (pageNum - 1) * limitNum;

      const [total, clearances] = await Promise.all([
        prisma.ndcClearance.count({ where }),
        prisma.ndcClearance.findMany({
          where,
          include: {
            student: {
              select: {
                id: true,
                studentId: true,
                usn: true,
                fullName: true,
                email: true,
                batch: true,
                academicYear: true,
                department: {
                  select: { id: true, name: true, code: true }
                }
              }
            },
            ndcRequest: {
              select: { id: true, requestNumber: true, status: true, submittedAt: true }
            },
            department: {
              select: { id: true, name: true, code: true }
            },
            reviewedBy: {
              select: { id: true, name: true, email: true, role: true }
            }
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limitNum
        })
      ]);

      const formatted = clearances.map((c) => ({
        ...c,
        studentId: withId(c.student ? { ...c.student, departmentId: withId(c.student.department) } : null),
        ndcRequestId: withId(c.ndcRequest),
        departmentId: withId(c.department),
        reviewedBy: withId(c.reviewedBy)
      }));

      res.status(200).json({
        success: true,
        data: withIds(formatted),
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum)
        }
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Fast Aggregate KPI Stats for Department Officer Queue.
   * Returns counts for PENDING, CLEARED, DUE, ON_HOLD, and TOTAL in ~15ms.
   */
  public static async getOfficerQueueStats(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { departmentId } = req.query;
      const where: any = {};

      if (req.user.role === UserRole.DEPARTMENT_OFFICER) {
        let assignedDeptIds: string[] = [];
        const officer = await prisma.clearanceOfficer.findUnique({
          where: { userId: req.user.id || req.user._id },
          include: { departmentMappings: true }
        });
        if (officer && officer.departmentMappings.length > 0) {
          assignedDeptIds = officer.departmentMappings.map((m) => m.departmentId);
        } else if (req.user.departmentId) {
          assignedDeptIds = [req.user.departmentId];
        }

        if (departmentId) {
          where.departmentId = String(departmentId);
        } else if (assignedDeptIds.length > 0) {
          where.departmentId = { in: assignedDeptIds };
        }
      } else if (req.user.role === UserRole.HOD && req.user.departmentId) {
        where.departmentId = req.user.departmentId;
      } else if (departmentId) {
        where.departmentId = String(departmentId);
      }

      const groups = await prisma.ndcClearance.groupBy({
        by: ['status'],
        where,
        _count: { _all: true }
      });

      const statsMap: Record<string, number> = {
        PENDING: 0,
        CLEARED: 0,
        DUE: 0,
        ON_HOLD: 0,
        NOT_APPLICABLE: 0,
        TOTAL: 0
      };

      let total = 0;
      groups.forEach((g) => {
        statsMap[g.status] = g._count._all;
        total += g._count._all;
      });
      statsMap.TOTAL = total;

      res.status(200).json({ success: true, data: statsMap });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Process Department Clearance (CLEAR, MARK DUE, ON_HOLD, NOT_APPLICABLE).
   * Restricted strictly to designated Clearance Officers.
   * Officers in College Office (ADM) and Admin Block (ADMIN) are prohibited.
   */
  public static async processClearance(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { clearanceId } = req.params;
      const { status, remarks, dueAmount, dueDetails } = req.body;

      // 1. Explicitly disallow Administration Block officers
      if (req.user.role === UserRole.ADMIN) {
        res.status(403).json({
          success: false,
          message: 'Access denied. Administration Block officers are not authorized to review or modify student clearance statuses. Clearance verification is strictly restricted to designated clearance officers.'
        });
        return;
      }

      // 2. For Department Officers: Verify officer belongs to a designated clearance department (not ADM)
      if (req.user.role === UserRole.DEPARTMENT_OFFICER) {
        const userId = req.user.id || req.user._id;
        const officer = await prisma.clearanceOfficer.findUnique({
          where: { userId },
          include: {
            departmentMappings: {
              include: { department: true }
            }
          }
        });

        let userDepts: any[] = [];
        if (officer && officer.departmentMappings.length > 0) {
          userDepts = officer.departmentMappings.map((m) => m.department);
        } else if (req.user.departmentId) {
          const d = await prisma.clearanceDepartment.findUnique({ where: { id: req.user.departmentId } });
          if (d) userDepts = [d];
        }

        // Check if officer belongs to College Office (ADM) or any department where clearance is not required
        const isOnlyAdmOrExempt = userDepts.length > 0 && userDepts.every(
          (d) => d.code === 'ADM' || d.requiresClearance === false
        );

        if (isOnlyAdmOrExempt || userDepts.length === 0) {
          res.status(403).json({
            success: false,
            message: 'Access denied. College Office (ADM) officers are not authorized to review or modify student clearance statuses. Clearance verification is strictly restricted to designated clearance officers.'
          });
          return;
        }

        // Verify that the targeted clearance task matches one of the officer's designated clearance departments
        const targetClearance = await prisma.ndcClearance.findUnique({
          where: { id: clearanceId },
          include: { department: true }
        });

        if (!targetClearance) {
          res.status(404).json({ success: false, message: 'Clearance task not found.' });
          return;
        }

        if (targetClearance.department.code === 'ADM' || targetClearance.department.requiresClearance === false) {
          res.status(403).json({
            success: false,
            message: 'Clearance review is not applicable for College Office (ADM).'
          });
          return;
        }

        const isAuthorizedForDept = userDepts.some((d) => d.id === targetClearance.departmentId);
        if (!isAuthorizedForDept) {
          res.status(403).json({
            success: false,
            message: 'Unauthorized. You are only authorized to review clearances for your designated clearance department.'
          });
          return;
        }
      }

      // 3. For HODs: Verify clearance belongs to their academic department
      if (req.user.role === UserRole.HOD) {
        const targetClearance = await prisma.ndcClearance.findUnique({
          where: { id: clearanceId }
        });

        if (!targetClearance) {
          res.status(404).json({ success: false, message: 'Clearance task not found.' });
          return;
        }

        if (targetClearance.departmentId !== req.user.departmentId) {
          res.status(403).json({
            success: false,
            message: 'Unauthorized. HODs can only review clearances for their respective academic department.'
          });
          return;
        }
      }

      const updatedClearance = await NdcWorkflowService.processClearanceChange(
        clearanceId,
        status,
        req.user.id || req.user._id,
        remarks,
        dueAmount ? parseFloat(dueAmount) : 0,
        dueDetails,
        req
      );

      ReportController.invalidateCache();

      res.status(200).json({
        success: true,
        message: `Department clearance status updated to ${status}.`,
        data: withId(updatedClearance)
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  /**
   * Super Admin Override clearance decision.
   */
  public static async adminOverride(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { clearanceId } = req.params;
      const { newStatus, overrideReason } = req.body;

      const updatedClearance = await NdcWorkflowService.adminOverrideClearance(
        clearanceId,
        newStatus,
        overrideReason,
        req.user.id || req.user._id,
        req
      );

      ReportController.invalidateCache();

      res.status(200).json({
        success: true,
        message: `Clearance overridden successfully to ${newStatus}.`,
        data: withId(updatedClearance)
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  /**
   * One-Click Instant Approval & Certificate Generation for an NDC Request.
   */
  public static async approveAllAndIssueCertificate(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { requestId } = req.params;
      const { reason } = req.body;

      if (req.user.role !== UserRole.SUPER_ADMIN) {
        res.status(403).json({
          success: false,
          message: 'Access denied. Clearance status approval is restricted to designated clearance officers.'
        });
        return;
      }

      const ndcRequest = await prisma.ndcRequest.findUnique({
        where: { id: requestId }
      });
      if (!ndcRequest) {
        res.status(404).json({ success: false, message: 'NDC request not found.' });
        return;
      }

      const userId = req.user.id || req.user._id;

      // Mark all clearance tasks as CLEARED
      await prisma.ndcClearance.updateMany({
        where: {
          ndcRequestId: ndcRequest.id,
          NOT: {
            status: { in: ['CLEARED', 'NOT_APPLICABLE'] as any }
          }
        },
        data: {
          status: 'CLEARED' as any,
          remarks: `[INSTANT APPROVAL]: ${reason || 'Approved by System Administrator'}`,
          reviewedById: userId,
          reviewedAt: new Date()
        }
      });

      await prisma.ndcRequest.update({
        where: { id: ndcRequest.id },
        data: {
          status: 'APPROVED' as any,
          completedAt: new Date()
        }
      });

      const { CertificateService } = await import('../services/CertificateService');
      const certificate = await CertificateService.generateCertificate(ndcRequest.id, userId, req);

      await prisma.ndcRequest.update({
        where: { id: ndcRequest.id },
        data: { certificateId: certificate.id || certificate._id }
      });

      ReportController.invalidateCache();

      res.status(200).json({
        success: true,
        message: `Request [${ndcRequest.requestNumber}] fully approved and Certificate [${certificate.certificateNumber}] generated!`,
        certificate: withId(certificate)
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  /**
   * Export official PDF report of all cleared students for the officer's department.
   */
  public static async exportClearedReportPdf(req: AuthRequest, res: Response): Promise<void> {
    try {
      let deptId = req.query.departmentId as string;
      if (!deptId) {
        if (req.user.departmentId) {
          deptId = req.user.departmentId;
        } else {
          const officer = await prisma.clearanceOfficer.findUnique({
            where: { userId: req.user.id || req.user._id },
            include: { departmentMappings: true }
          });
          if (officer && officer.departmentMappings.length > 0) {
            deptId = officer.departmentMappings[0].departmentId;
          }
        }
      }

      // If user is Cash/Fee officer, default to ACC
      if (!deptId && (req.user.email?.startsWith('cashfee') || req.user.email === 'accounts@mce.ac.in')) {
        const accDept = await prisma.clearanceDepartment.findUnique({ where: { code: 'ACC' } });
        if (accDept) deptId = accDept.id;
      }

      const department = deptId
        ? await prisma.clearanceDepartment.findUnique({ where: { id: deptId } })
        : await prisma.clearanceDepartment.findUnique({ where: { code: 'ACC' } });

      const deptName = department?.name || 'Cash/Fee Section';
      const deptCode = department?.code || 'ACC';

      const clearances = await prisma.ndcClearance.findMany({
        where: {
          departmentId: department?.id,
          status: { in: ['CLEARED', 'NOT_APPLICABLE'] as any }
        },
        include: {
          student: {
            include: { department: true }
          },
          reviewedBy: true
        },
        orderBy: { reviewedAt: 'desc' }
      });

      const officer = await prisma.clearanceOfficer.findUnique({
        where: { userId: req.user.id || req.user._id }
      });

      const studentsData = clearances.map((c, index) => ({
        sNo: index + 1,
        fullName: c.student?.fullName || 'N/A',
        usn: c.student?.usn || 'N/A',
        branch: c.student?.department?.code || 'N/A',
        clearedAt: c.reviewedAt
          ? new Date(c.reviewedAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })
          : 'N/A'
      }));

      const filename = `${deptCode}_Cleared_Students_Report.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      await PdfService.generateClearedReportPdf(
        {
          departmentName: deptName,
          departmentCode: deptCode,
          officerName: req.user.name || 'Clearance Officer',
          officerEmployeeId: officer?.employeeId,
          totalCleared: clearances.length,
          students: studentsData
        },
        res
      );
    } catch (err: any) {
      console.error('[Export Cleared PDF Error]:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: err.message });
      }
    }
  }
}
