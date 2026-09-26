import { Response } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../config/prisma';
import { AuthRequest } from '../middleware/auth';
import { UserRole } from '../constants/roles';
import { CertificateStatus } from '../constants/statuses';
import { PdfService } from '../services/PdfService';
import { withId, withIds } from '../utils/formatters';

export class TeachingDepartmentController {
  /**
   * Helper to resolve the user's academic department ID.
   */
  private static async getEffectiveAcademicDepartmentId(req: AuthRequest): Promise<string | null> {
    if (req.query.departmentId) {
      if (req.user.role === UserRole.SUPER_ADMIN || req.user.role === UserRole.ADMIN) {
        return String(req.query.departmentId);
      }
      if (req.user.departmentId === String(req.query.departmentId)) {
        return String(req.query.departmentId);
      }
    }

    if (req.user.role === UserRole.HOD || req.user.role === UserRole.DEPARTMENT_OFFICER) {
      if (!req.user.departmentId) {
        throw new Error('No academic department assigned to your user account.');
      }
      return req.user.departmentId;
    }

    // Super Admin / Admin fallback: query departmentId or first academic department
    if (req.user.departmentId) {
      return req.user.departmentId;
    }

    const firstAcademicDept = await prisma.clearanceDepartment.findFirst({
      where: { isAcademicBranch: true, isActive: true },
      orderBy: { displayOrder: 'asc' }
    });
    return firstAcademicDept ? firstAcademicDept.id : null;
  }

  /**
   * GET /api/v1/teaching-department/dashboard
   */
  public static async getDashboard(req: AuthRequest, res: Response): Promise<void> {
    try {
      const deptId = await TeachingDepartmentController.getEffectiveAcademicDepartmentId(req);
      if (!deptId) {
        res.status(400).json({ success: false, message: 'Academic department not resolved.' });
        return;
      }

      const department = await prisma.clearanceDepartment.findUnique({
        where: { id: deptId },
        include: {
          labs: {
            where: { isActive: true },
            orderBy: { displayOrder: 'asc' }
          }
        }
      });
      if (!department) {
        res.status(404).json({ success: false, message: 'Academic department record not found.' });
        return;
      }

      let effectiveHodName = department.hodName;
      if (!effectiveHodName) {
        const hodUser = await prisma.user.findFirst({
          where: {
            departmentId: deptId,
            role: UserRole.HOD,
            isActive: true
          },
          select: { name: true, email: true }
        });
        if (hodUser) {
          effectiveHodName = hodUser.name;
        }
      }

      let allAcademicBranches: any[] = [];
      if (req.user.role === UserRole.SUPER_ADMIN || req.user.role === UserRole.ADMIN) {
        allAcademicBranches = await prisma.clearanceDepartment.findMany({
          where: { isAcademicBranch: true, isActive: true },
          select: { id: true, code: true, name: true, hodName: true, hodDesignation: true },
          orderBy: { displayOrder: 'asc' }
        });
      }

      const departmentStudents = await prisma.student.findMany({
        where: { departmentId: deptId },
        select: { id: true, usn: true, batch: true }
      });
      const studentIds = departmentStudents.map((s) => s.id);
      const totalStudents = studentIds.length;

      const batchCounts = await prisma.student.groupBy({
        by: ['batch'],
        where: { departmentId: deptId },
        _count: { id: true }
      });
      const batchBreakdown = batchCounts
        .filter((b) => b.batch)
        .map((b) => ({ batch: b.batch, count: b._count.id }))
        .sort((a, b) => (b.batch || '').localeCompare(a.batch || ''));

      if (totalStudents === 0) {
        res.status(200).json({
          success: true,
          data: {
            department: {
              ...withId(department),
              hodName: effectiveHodName || department.hodName || '',
              hodDesignation: department.hodDesignation || 'Head of the Department'
            },
            statistics: {
              totalStudents: 0,
              approved: 0,
              pending: 0,
              due: 0,
              certificatesAvailable: 0,
              totalDueAmount: 0,
              batchBreakdown: []
            },
            allBranches: allAcademicBranches
          }
        });
        return;
      }

      const requests = await prisma.ndcRequest.findMany({
        where: { studentId: { in: studentIds } }
      });

      let approved = 0;
      let pending = 0;
      let due = 0;

      for (const r of requests) {
        if (r.status === 'APPROVED') {
          approved++;
        } else if (r.status === 'BLOCKED') {
          due++;
        } else {
          pending++;
        }
      }

      const duesAggregate = await prisma.ndcClearance.aggregate({
        where: {
          studentId: { in: studentIds },
          status: 'DUE'
        },
        _sum: {
          dueAmount: true
        }
      });
      const totalDueAmount = duesAggregate._sum.dueAmount || 0;

      const certificatesAvailable = await prisma.ndcCertificate.count({
        where: {
          studentId: { in: studentIds },
          status: CertificateStatus.VALID as any
        }
      });

      res.status(200).json({
        success: true,
        data: {
          department: {
            ...withId(department),
            hodName: effectiveHodName || department.hodName || '',
            hodDesignation: department.hodDesignation || 'Head of the Department'
          },
          statistics: {
            totalStudents,
            approved,
            pending,
            due,
            certificatesAvailable,
            totalDueAmount,
            batchBreakdown
          },
          allBranches: allAcademicBranches
        }
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/v1/teaching-department/students
   */
  public static async getStudents(req: AuthRequest, res: Response): Promise<void> {
    try {
      const deptId = await TeachingDepartmentController.getEffectiveAcademicDepartmentId(req);
      if (!deptId) {
        res.status(400).json({ success: false, message: 'Academic department not resolved.' });
        return;
      }

      const { search, status, batch, dueDepartment, page = '1', limit = '20' } = req.query;
      const studentWhere: any = { departmentId: deptId };

      if (batch) {
        studentWhere.batch = String(batch);
      }

      if (search) {
        const searchStr = String(search).trim();
        studentWhere.OR = [
          { fullName: { contains: searchStr, mode: 'insensitive' } },
          { usn: { contains: searchStr, mode: 'insensitive' } },
          { email: { contains: searchStr, mode: 'insensitive' } }
        ];
      }

      const pageNum = parseInt(String(page), 10);
      const limitNum = parseInt(String(limit), 10);
      const skip = (pageNum - 1) * limitNum;

      const allDeptStudents = await prisma.student.findMany({
        where: studentWhere,
        include: { department: true },
        orderBy: { usn: 'asc' }
      });

      const studentIds = allDeptStudents.map((s) => s.id);

      // Fetch NDC requests & clearance tasks for all department students
      const requests = await prisma.ndcRequest.findMany({
        where: { studentId: { in: studentIds } },
        include: { certificate: true }
      });
      const requestMap = new Map<string, any>(requests.map((r) => [r.studentId, r]));

      const requestIds = requests.map((r) => r.id);
      const clearances = await prisma.ndcClearance.findMany({
        where: {
          ndcRequestId: { in: requestIds },
          department: {
            isActive: true,
            requiresClearance: true
          }
        },
        include: { department: true }
      });

      const clearancesByReqMap = new Map<string, any[]>();
      for (const c of clearances) {
        if (!clearancesByReqMap.has(c.ndcRequestId)) {
          clearancesByReqMap.set(c.ndcRequestId, []);
        }
        clearancesByReqMap.get(c.ndcRequestId)!.push(c);
      }

      // Enrich each student with clearance metrics & due details
      let enrichedStudents = allDeptStudents.map((student: any, index: number) => {
        const reqItem = requestMap.get(student.id);
        const reqClearances = reqItem ? clearancesByReqMap.get(reqItem.id) || [] : [];

        const totalTasks = reqClearances.length;
        const clearedTasks = reqClearances.filter((c) => c.status === 'CLEARED' || c.status === 'NOT_APPLICABLE').length;
        const dueTasks = reqClearances.filter((c) => c.status === 'DUE');

        let ndcStatus = 'PENDING';
        if (reqItem) {
          if (reqItem.status === 'APPROVED') ndcStatus = 'APPROVED';
          else if (dueTasks.length > 0 || reqItem.status === 'BLOCKED') ndcStatus = 'DUE';
          else ndcStatus = 'PENDING';
        }

        const totalDueAmount = dueTasks.reduce((sum, c) => sum + (c.dueAmount || 0), 0);
        const dueDeptNames = Array.from(new Set(dueTasks.map((c) => c.department?.name || 'Department'))).join(', ');
        const primaryDueReason = dueTasks.length > 0 ? dueTasks[0].dueDetails || dueTasks[0].remarks || 'Outstanding Dues' : '';

        const certNo = reqItem?.certificate?.certificateNumber || (ndcStatus === 'APPROVED' ? 'Generated' : '-');

        return {
          slNo: index + 1,
          id: student.id,
          _id: student.id,
          studentId: student.studentId,
          usn: student.usn,
          fullName: student.fullName,
          email: student.email,
          phone: student.phone,
          batch: student.batch,
          academicYear: student.academicYear,
          section: student.section,
          departmentName: student.department?.name || 'Academic Dept',
          ndcStatus,
          progress: {
            cleared: clearedTasks,
            total: totalTasks,
            percentage: totalTasks > 0 ? Math.round((clearedTasks / totalTasks) * 100) : 0
          },
          duesCount: dueTasks.length,
          dueDepartment: dueDeptNames || '-',
          dueReason: '',
          dueAmount: totalDueAmount,
          certificateNumber: certNo,
          certificateId: reqItem?.certificate?.id || reqItem?.certificateId || null,
          requestId: reqItem?.id || null
        };
      });

      // Filter by NDC Status if provided
      if (status) {
        const targetStatus = String(status).toUpperCase();
        if (targetStatus === 'WITH_DUES' || targetStatus === 'DUE') {
          enrichedStudents = enrichedStudents.filter((s) => s.ndcStatus === 'DUE' || s.duesCount > 0);
        } else if (targetStatus === 'CERTIFICATES_AVAILABLE' || targetStatus === 'APPROVED') {
          enrichedStudents = enrichedStudents.filter((s) => s.ndcStatus === 'APPROVED');
        } else if (targetStatus === 'PENDING') {
          enrichedStudents = enrichedStudents.filter((s) => s.ndcStatus === 'PENDING');
        }
      }

      // Filter by Due Department name if provided
      if (dueDepartment) {
        const searchDept = String(dueDepartment).toLowerCase();
        enrichedStudents = enrichedStudents.filter((s) => s.dueDepartment.toLowerCase().includes(searchDept));
      }

      const totalRecords = enrichedStudents.length;
      const paginatedRows = enrichedStudents.slice(skip, skip + limitNum).map((s, idx) => ({
        ...s,
        slNo: skip + idx + 1
      }));

      res.status(200).json({
        success: true,
        data: withIds(paginatedRows),
        pagination: {
          total: totalRecords,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(totalRecords / limitNum)
        }
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/v1/teaching-department/students/:studentId
   */
  public static async getStudentById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { studentId } = req.params;
      const deptId = await TeachingDepartmentController.getEffectiveAcademicDepartmentId(req);

      const student = await prisma.student.findUnique({
        where: { id: studentId },
        include: { department: true }
      });

      if (!student) {
        res.status(404).json({ success: false, message: 'Student record not found.' });
        return;
      }

      // Backend Security Enforcement: Check academic department match
      if (req.user.role === UserRole.HOD && student.departmentId !== deptId) {
        res.status(403).json({ success: false, message: 'Forbidden: You can only access students from your academic department.' });
        return;
      }

      const ndcRequest = await prisma.ndcRequest.findFirst({
        where: { studentId: student.id },
        include: { certificate: true }
      });

      const clearances = ndcRequest
        ? await prisma.ndcClearance.findMany({
          where: { ndcRequestId: ndcRequest.id },
          include: {
            department: true,
            reviewedBy: {
              select: { id: true, name: true, email: true, role: true }
            }
          }
        })
        : [];

      res.status(200).json({
        success: true,
        data: {
          student: withId(student),
          ndcRequest: withId(ndcRequest),
          clearances: withIds(clearances.map((c) => ({
            ...c,
            departmentId: withId(c.department),
            reviewedBy: withId(c.reviewedBy)
          })))
        }
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/v1/teaching-department/students/:studentId/dues
   */
  public static async getStudentDues(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { studentId } = req.params;
      const deptId = await TeachingDepartmentController.getEffectiveAcademicDepartmentId(req);

      const student = await prisma.student.findUnique({ where: { id: studentId } });
      if (!student) {
        res.status(404).json({ success: false, message: 'Student record not found.' });
        return;
      }

      if (req.user.role === UserRole.HOD && student.departmentId !== deptId) {
        res.status(403).json({ success: false, message: 'Forbidden: Access restricted to your academic department.' });
        return;
      }

      const ndcRequest = await prisma.ndcRequest.findFirst({ where: { studentId: student.id } });
      if (!ndcRequest) {
        res.status(200).json({ success: true, student: withId(student), dues: [], totalDueAmount: 0 });
        return;
      }

      const dueClearances = await prisma.ndcClearance.findMany({
        where: {
          ndcRequestId: ndcRequest.id,
          status: 'DUE' as any,
          department: {
            isActive: true,
            requiresClearance: true
          }
        },
        include: {
          department: true,
          reviewedBy: { select: { id: true, name: true, email: true, role: true } }
        }
      });

      const formattedDues = dueClearances.map((c: any) => ({
        id: c.id,
        clearanceId: c.id,
        _id: c.id,
        departmentName: c.department?.name || 'Clearance Department',
        departmentCode: c.department?.code || 'DEPT',
        dueDetails: '',
        remarks: '',
        dueAmount: c.dueAmount || 0,
        reportedBy: c.reviewedBy?.name || 'Department Officer',
        reportedAt: c.reviewedAt || c.updatedAt,
        status: c.status
      }));

      const totalDueAmount = formattedDues.reduce((sum, d) => sum + d.dueAmount, 0);

      res.status(200).json({
        success: true,
        student: {
          fullName: student.fullName,
          usn: student.usn,
          batch: student.batch
        },
        dues: withIds(formattedDues),
        totalDueAmount
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /api/v1/teaching-department/certificates/:certificateId/download
   */
  public static async downloadCertificate(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { certificateId } = req.params;
      const deptId = await TeachingDepartmentController.getEffectiveAcademicDepartmentId(req);

      const certificate = await prisma.ndcCertificate.findUnique({
        where: { id: certificateId },
        include: {
          student: {
            include: { department: true }
          }
        }
      });

      if (!certificate) {
        res.status(404).json({ success: false, message: 'Certificate record not found.' });
        return;
      }

      if (certificate.status === CertificateStatus.REVOKED) {
        res.status(400).json({ success: false, message: 'Cannot download a revoked certificate.' });
        return;
      }

      const student = certificate.student;
      if (!student) {
        res.status(404).json({ success: false, message: 'Associated student record not found.' });
        return;
      }

      // Academic Department Verification
      if (req.user.role === UserRole.HOD && student.departmentId !== deptId) {
        res.status(403).json({
          success: false,
          message: 'Forbidden: You can only download certificates for students in your academic department.'
        });
        return;
      }

      const pdfPathStr = certificate.pdfPath || `uploads/certificates/NDC_${certificate.certificateNumber.replace(/[\/\\:]/g, '_')}.pdf`;
      let fullPath = path.isAbsolute(pdfPathStr)
        ? pdfPathStr
        : path.resolve(process.cwd(), pdfPathStr.replace(/^\//, ''));

      // Always verify clearance tasks & ensure ZERO dues or holds
      const clearanceDocs = await prisma.ndcClearance.findMany({
        where: {
          ndcRequestId: certificate.ndcRequestId,
          department: {
            isActive: true,
            requiresClearance: true
          }
        },
        include: {
          department: true,
          reviewedBy: {
            select: { name: true, role: true }
          }
        },
        orderBy: { createdAt: 'asc' }
      });

      const hasUnresolved = clearanceDocs.some((c: any) =>
        c.status === 'DUE' ||
        c.status === 'ON_HOLD' ||
        c.status === 'PENDING' ||
        (c.dueAmount && c.dueAmount > 0)
      );

      if (hasUnresolved || clearanceDocs.length === 0) {
        res.status(400).json({
          success: false,
          message: 'Cannot download certificate: Student has pending departmental dues, unresolved holds, or incomplete clearance tasks.'
        });
        return;
      }

      const clearanceItems = clearanceDocs.map((c: any) => ({
        departmentName: c.department?.name || 'Department Desk',
        departmentCode: c.department?.code || 'DEPT',
        status: c.status || 'CLEARED',
        approvalTimestamp: c.reviewedAt || c.updatedAt || certificate.issuedAt || new Date(),
        reviewedByName: c.reviewedBy?.name || 'Clearance Officer'
      }));

      await PdfService.generateCertificatePdf(
        {
          certificateNumber: certificate.certificateNumber,
          studentName: student.fullName || certificate.studentName || 'Student Name',
          usn: student.usn || certificate.studentUsn || 'USN',
          departmentName: student.department?.name || certificate.departmentName || 'General',
          batch: student.batch || '2022-2026',
          academicYear: student.academicYear || '2025-2026',
          issuedAt: certificate.issuedAt || new Date(),
          hodName: student.department?.hodName,
          clearances: clearanceItems
        },
        fullPath
      );

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="NDC_${certificate.certificateNumber.replace(/[\/\\:]/g, '_')}.pdf"`);

      const fileStream = fs.createReadStream(fullPath);
      fileStream.pipe(res);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}
