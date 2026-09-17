import { Response } from 'express';
import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';
import prisma from '../config/prisma';
import { CertificateService } from '../services/CertificateService';
import { PdfService } from '../services/PdfService';
import { AuditService } from '../services/AuditService';
import { CertificateStatus } from '../constants/statuses';
import { AuthRequest } from '../middleware/auth';
import { UserRole } from '../constants/roles';
import { withId, withIds } from '../utils/formatters';

export class CertificateController {
  public static async getAllCertificates(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { search, status, submissionStatus, startDate, endDate, page = '1', limit = '20' } = req.query;
      const where: any = {};

      if (status) where.status = status as any;

      if (submissionStatus === 'SUBMITTED') {
        where.isSubmitted = true;
      } else if (submissionStatus === 'NOT_SUBMITTED') {
        where.isSubmitted = false;
      }

      if (startDate || endDate) {
        const dateFilter: any = {};
        if (startDate) dateFilter.gte = new Date(`${startDate}T00:00:00.000Z`);
        if (endDate) dateFilter.lte = new Date(`${endDate}T23:59:59.999Z`);
        if (submissionStatus === 'SUBMITTED') {
          where.submittedAt = dateFilter;
        } else {
          where.issuedAt = dateFilter;
        }
      }

      // HOD Scope: Only certificates of students belonging to HOD's academic department
      if (req.user.role === UserRole.HOD && req.user.departmentId) {
        where.student = { departmentId: req.user.departmentId };
      }

      if (search) {
        const searchStr = String(search).trim();
        where.OR = [
          { certificateNumber: { contains: searchStr, mode: 'insensitive' } },
          { studentUsn: { contains: searchStr, mode: 'insensitive' } },
          { studentName: { contains: searchStr, mode: 'insensitive' } },
          { student: { usn: { contains: searchStr, mode: 'insensitive' } } },
          { student: { fullName: { contains: searchStr, mode: 'insensitive' } } }
        ];
      }

      const pageNum = Math.max(1, parseInt(String(page || '1'), 10));
      const limitNum = Math.min(500, Math.max(1, parseInt(String(limit || '20'), 10)));
      const skip = (pageNum - 1) * limitNum;

      where.isReplaced = false;

      const [total, certificates, totalCount, submittedCount, notSubmittedCount] = await Promise.all([
        prisma.ndcCertificate.count({ where }),
        prisma.ndcCertificate.findMany({
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
                department: {
                  select: { id: true, name: true, code: true }
                }
              }
            },
            request: {
              select: { id: true, requestNumber: true, status: true, submittedAt: true }
            },
            issuedBy: { select: { id: true, name: true, email: true, role: true } },
            revokedBy: { select: { id: true, name: true, email: true, role: true } },
            submittedBy: { select: { id: true, name: true, email: true, role: true } }
          },
          orderBy: { issuedAt: 'desc' },
          skip,
          take: limitNum
        }),
        prisma.ndcCertificate.count({ where: { isReplaced: false, status: CertificateStatus.VALID } }),
        prisma.ndcCertificate.count({ where: { isReplaced: false, status: CertificateStatus.VALID, isSubmitted: true } }),
        prisma.ndcCertificate.count({ where: { isReplaced: false, status: CertificateStatus.VALID, isSubmitted: false } })
      ]);

      const formatted = certificates.map((c) => ({
        ...c,
        studentId: withId(c.student ? { ...c.student, departmentId: withId(c.student.department) } : null),
        ndcRequestId: withId(c.request),
        issuedBy: withId(c.issuedBy),
        revokedBy: withId(c.revokedBy),
        submittedBy: withId(c.submittedBy)
      }));

      // Guarantee each student request has exactly one certificate row reflecting current validity
      const seenRequests = new Set<string>();
      const deduplicated: typeof formatted = [];
      for (const c of formatted) {
        const key = c.ndcRequestId?.id || c.studentId?.id || c.studentUsn || c.id;
        if (!seenRequests.has(key)) {
          seenRequests.add(key);
          deduplicated.push(c);
        }
      }

      res.status(200).json({
        success: true,
        data: withIds(deduplicated),
        counts: {
          total: totalCount,
          submitted: submittedCount,
          notSubmitted: notSubmittedCount,
          submissionRate: totalCount > 0 ? Math.round((submittedCount / totalCount) * 100) : 0
        },
        pagination: {
          total: deduplicated.length,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.max(1, Math.ceil(deduplicated.length / limitNum))
        }
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  public static async getStudentCertificates(req: AuthRequest, res: Response): Promise<void> {
    try {
      const studentId = req.params.studentId || req.user.associatedStudentId;
      if (!studentId) {
        res.status(400).json({ success: false, message: 'Student ID required.' });
        return;
      }

      // Backend RBAC Check for Student viewing their own certificates
      if (req.user.role === UserRole.STUDENT && req.user.associatedStudentId) {
        if (String(studentId) !== String(req.user.associatedStudentId)) {
          res.status(403).json({ success: false, message: 'Forbidden: You can only view your own certificates.' });
          return;
        }
      }

      // Auto-generate missing certificates for fully cleared requests
      const requests = await prisma.ndcRequest.findMany({
        where: { studentId }
      });

      for (const r of requests) {
        const clearances = await prisma.ndcClearance.findMany({
          where: { ndcRequestId: r.id }
        });
        const allCleared =
          clearances.length > 0 &&
          clearances.every((c) => c.status === 'CLEARED' || c.status === 'NOT_APPLICABLE');
        if (allCleared) {
          const existingCert = await prisma.ndcCertificate.findFirst({
            where: { ndcRequestId: r.id, status: 'VALID' as any }
          });
          if (!existingCert) {
            await CertificateService.generateCertificate(r.id, req.user.id || req.user._id, req);
          }
        }
      }

      const certificates = await prisma.ndcCertificate.findMany({
        where: { studentId },
        include: {
          student: {
            include: { department: true }
          },
          request: true
        },
        orderBy: { issuedAt: 'desc' }
      });

      const formatted = certificates.map((c) => ({
        ...c,
        studentId: withId(c.student ? { ...c.student, departmentId: withId(c.student.department) } : null),
        ndcRequestId: withId(c.request)
      }));

      res.status(200).json({ success: true, data: withIds(formatted) });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  public static async downloadPdf(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const certificate = await prisma.ndcCertificate.findUnique({
        where: { id },
        include: {
          student: {
            include: { department: true }
          }
        }
      });

      if (!certificate) {
        res.status(404).json({ success: false, message: 'Certificate not found.' });
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

      // STRICT BACKEND RBAC VALIDATION
      if (req.user.role === UserRole.STUDENT) {
        const certStudentIdStr = String(student.id);
        const userStudentIdStr = String(req.user.associatedStudentId || '');
        if (userStudentIdStr !== certStudentIdStr) {
          res.status(403).json({ success: false, message: 'Forbidden: You can only download your own certificate.' });
          return;
        }
      } else if (req.user.role === UserRole.HOD) {
        const studentDeptId = String(student.departmentId);
        const userDeptId = String(req.user.departmentId || '');
        if (!userDeptId || studentDeptId !== userDeptId) {
          res.status(403).json({ success: false, message: 'Forbidden: Only the student’s academic department HOD/faculty can download this certificate.' });
          return;
        }
      } else if (req.user.role === UserRole.DEPARTMENT_OFFICER) {
        res.status(403).json({ success: false, message: 'Forbidden: Clearance department officers are not authorized to download final student certificates.' });
        return;
      }

      if (!certificate.pdfPath) {
        res.status(404).json({ success: false, message: 'PDF file path not recorded.' });
        return;
      }

      let fullPath = path.isAbsolute(certificate.pdfPath)
        ? certificate.pdfPath
        : path.resolve(process.cwd(), certificate.pdfPath.replace(/^\//, ''));

      // Always verify clearance tasks for active departments requiring clearance & ensure ZERO dues or holds
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
      fileStream.on('error', () => {
        if (!res.headersSent) {
          res.status(500).json({ success: false, message: 'Error streaming PDF file.' });
        }
      });
      fileStream.pipe(res);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  public static async revokeCertificate(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { revocationReason } = req.body;

      if (!revocationReason || revocationReason.trim() === '') {
        res.status(400).json({ success: false, message: 'Revocation reason is mandatory.' });
        return;
      }

      const revokedCert = await CertificateService.revokeCertificate(id, revocationReason, req.user.id || req.user._id, req);
      res.status(200).json({
        success: true,
        message: `Certificate [${revokedCert.certificateNumber}] has been revoked. Number permanently retired.`,
        data: withId(revokedCert)
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  public static async reissueCertificate(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { ndcRequestId } = req.body;
      const newCert = await CertificateService.reissueCertificate(ndcRequestId, req.user.id || req.user._id, req);
      res.status(200).json({
        success: true,
        message: `New certificate reissued with number [${newCert.certificateNumber}].`,
        data: withId(newCert)
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  /**
   * Admin Option: Force Regenerate Certificate PDF file & refresh metadata.
   */
  public static async regenerateCertificate(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const certificate = await prisma.ndcCertificate.findUnique({
        where: { id },
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

      const student = certificate.student;
      const department = student?.department;

      const pdfPathStr = certificate.pdfPath || `uploads/certificates/NDC_${certificate.certificateNumber.replace(/[\/\\:]/g, '_')}.pdf`;
      let fullPath = path.isAbsolute(pdfPathStr)
        ? pdfPathStr
        : path.resolve(process.cwd(), pdfPathStr.replace(/^\//, ''));

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

      const clearanceItems = clearanceDocs.map((c: any) => ({
        departmentName: c.department?.name || 'Department Desk',
        departmentCode: c.department?.code || 'DEPT',
        status: c.status || 'CLEARED',
        approvalTimestamp: c.reviewedAt || c.updatedAt || certificate.issuedAt || new Date(),
        reviewedByName: c.reviewedBy?.name || 'Clearance Officer'
      }));

      // Force PDF re-rendering using latest template & active clearances
      await PdfService.generateCertificatePdf(
        {
          certificateNumber: certificate.certificateNumber,
          studentName: student?.fullName || certificate.studentName || 'Student Name',
          usn: student?.usn || certificate.studentUsn || 'USN',
          departmentName: department ? department.name : certificate.departmentName || 'General',
          batch: student?.batch || '2022-2026',
          academicYear: student?.academicYear || '2025-2026',
          issuedAt: certificate.issuedAt || new Date(),
          hodName: department?.hodName,
          clearances: clearanceItems
        },
        fullPath
      );

      // Update certificate record
      const updated = await prisma.ndcCertificate.update({
        where: { id: certificate.id },
        data: { updatedAt: new Date() }
      });

      await AuditService.log(
        req,
        'CERTIFICATE_REGENERATED',
        'NdcCertificate',
        `Admin regenerated certificate PDF for student [${certificate.studentUsn}].`
      );

      res.status(200).json({
        success: true,
        message: `Certificate [${certificate.certificateNumber}] regenerated successfully.`,
        data: withId(updated)
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  public static async regenerateByStudentId(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { studentId } = req.params;
      const certificate = await prisma.ndcCertificate.findFirst({
        where: { studentId, status: CertificateStatus.VALID as any }
      });
      if (!certificate) {
        res.status(404).json({ success: false, message: 'No valid certificate found for this student.' });
        return;
      }

      req.params.id = certificate.id;
      return CertificateController.regenerateCertificate(req, res);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Update Certificate Physical Submission Status (SUBMITTED / NOT SUBMITTED).
   * Used by the Administration Block to verify receipt of the student's physical certificate.
   */
  public static async updateSubmissionStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { isSubmitted, remarks, submissionRemarks } = req.body;

      const cert = await prisma.ndcCertificate.findUnique({
        where: { id },
        include: {
          student: {
            select: { id: true, usn: true, fullName: true }
          }
        }
      });

      if (!cert) {
        res.status(404).json({ success: false, message: 'Certificate not found.' });
        return;
      }

      const prevStatus = cert.isSubmitted ? 'SUBMITTED' : 'NOT_SUBMITTED';
      const newStatus = Boolean(isSubmitted) ? 'SUBMITTED' : 'NOT_SUBMITTED';
      const comment = submissionRemarks !== undefined ? submissionRemarks : remarks;
      const updated = await prisma.ndcCertificate.update({
        where: { id },
        data: {
          isSubmitted: Boolean(isSubmitted),
          submittedAt: Boolean(isSubmitted) ? new Date() : null,
          submittedById: Boolean(isSubmitted) ? (req.user?.id || req.user?._id) : null,
          submissionRemarks: comment !== undefined ? String(comment).trim() : cert.submissionRemarks
        },
        include: {
          student: {
            select: {
              id: true,
              usn: true,
              fullName: true,
              department: { select: { id: true, name: true, code: true } }
            }
          },
          request: { select: { id: true, requestNumber: true, status: true } },
          submittedBy: { select: { id: true, name: true, email: true, role: true } }
        }
      });

      await AuditService.log(
        req,
        'CERTIFICATE_SUBMISSION_UPDATED',
        'NdcCertificate',
        `Certificate [${cert.certificateNumber}] for student [${cert.studentUsn || cert.student?.usn}] marked as ${newStatus} by ${req.user.name}.`,
        cert.id,
        { isSubmitted: cert.isSubmitted, submittedAt: cert.submittedAt },
        { isSubmitted: updated.isSubmitted, submittedAt: updated.submittedAt, remarks: updated.submissionRemarks }
      );

      res.status(200).json({
        success: true,
        message: `Certificate submission status updated to ${newStatus}.`,
        data: withId({
          ...updated,
          studentId: withId(updated.student ? { ...updated.student, departmentId: withId(updated.student.department) } : null),
          ndcRequestId: withId(updated.request),
          submittedBy: withId(updated.submittedBy)
        })
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Export Certificate Registry and Submission Status to Excel (.xlsx) or CSV (.csv).
   */
  public static async exportCertificates(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { search, status, submissionStatus, format = 'xlsx' } = req.query;
      const where: any = {};

      if (status) where.status = status as any;
      if (submissionStatus === 'SUBMITTED') {
        where.isSubmitted = true;
      } else if (submissionStatus === 'NOT_SUBMITTED') {
        where.isSubmitted = false;
      }

      if (req.user.role === UserRole.HOD && req.user.departmentId) {
        where.student = { departmentId: req.user.departmentId };
      }

      if (search) {
        const searchStr = String(search).trim();
        where.OR = [
          { certificateNumber: { contains: searchStr, mode: 'insensitive' } },
          { studentUsn: { contains: searchStr, mode: 'insensitive' } },
          { studentName: { contains: searchStr, mode: 'insensitive' } },
          { student: { usn: { contains: searchStr, mode: 'insensitive' } } },
          { student: { fullName: { contains: searchStr, mode: 'insensitive' } } }
        ];
      }

      where.isReplaced = false;

      const certificates = await prisma.ndcCertificate.findMany({
        where,
        include: {
          student: {
            select: {
              usn: true,
              fullName: true,
              batch: true,
              department: { select: { name: true, code: true } }
            }
          },
          submittedBy: { select: { name: true, email: true } },
          issuedBy: { select: { name: true, email: true } }
        },
        orderBy: { issuedAt: 'desc' },
        take: 5000
      });

      // Guarantee each student request has exactly one certificate row in registry export
      const seenExport = new Set<string>();
      const deduplicatedCerts: typeof certificates = [];
      for (const c of certificates) {
        const key = c.ndcRequestId || c.studentUsn || c.studentId || c.id;
        if (!seenExport.has(key)) {
          seenExport.add(key);
          deduplicatedCerts.push(c);
        }
      }

      const exportRows = deduplicatedCerts.map((c, index) => ({
        'Sl No': index + 1,
        'Certificate Number': c.certificateNumber,
        'USN': c.student?.usn || c.studentUsn || '',
        'Student Name': c.student?.fullName || c.studentName || '',
        'Department': c.student?.department?.name || c.departmentName || '',
        'Batch': c.student?.batch || '',
        'Issued Date': c.issuedAt ? new Date(c.issuedAt).toLocaleDateString('en-IN') : '',
        'Certificate Status': c.status,
        'Submission Status': c.isSubmitted ? 'SUBMITTED' : 'NOT SUBMITTED',
        'Submission Date': c.submittedAt ? new Date(c.submittedAt).toLocaleString('en-IN') : 'N/A',
        'Received By': c.submittedBy?.name || (c.isSubmitted ? 'Administration Block' : 'N/A'),
        'Remarks': c.submissionRemarks || ''
      }));

      await AuditService.log(
        req,
        'CERTIFICATES_EXPORTED',
        'NdcCertificate',
        `Exported ${certificates.length} certificate submission records as ${String(format).toUpperCase()}.`
      );

      const timestamp = new Date().toISOString().slice(0, 10);
      if (format === 'csv') {
        const worksheet = xlsx.utils.json_to_sheet(exportRows);
        const csvContent = xlsx.utils.sheet_to_csv(worksheet);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="NDC_Certificate_Submissions_${timestamp}.csv"`);
        res.status(200).send(csvContent);
      } else {
        const worksheet = xlsx.utils.json_to_sheet(exportRows);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Certificate Submissions');
        const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="NDC_Certificate_Submissions_${timestamp}.xlsx"`);
        res.status(200).send(buffer);
      }
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Export official Physical Certificate Submission Report PDF with Date Range filters.
   * Used by College Office / Administrative Section to generate date-range submission reports.
   */
  public static async exportSubmissionReportPdf(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { startDate, endDate, submissionStatus, search } = req.query;
      const where: any = { isReplaced: false, status: CertificateStatus.VALID };

      if (submissionStatus === 'SUBMITTED') {
        where.isSubmitted = true;
      } else if (submissionStatus === 'NOT_SUBMITTED') {
        where.isSubmitted = false;
      }

      // Date range filtering
      if (startDate || endDate) {
        const dateFilter: any = {};
        if (startDate) {
          dateFilter.gte = new Date(`${startDate}T00:00:00.000Z`);
        }
        if (endDate) {
          dateFilter.lte = new Date(`${endDate}T23:59:59.999Z`);
        }
        if (submissionStatus === 'SUBMITTED') {
          where.submittedAt = dateFilter;
        } else {
          where.issuedAt = dateFilter;
        }
      }

      if (search) {
        const searchStr = String(search).trim();
        where.OR = [
          { certificateNumber: { contains: searchStr, mode: 'insensitive' } },
          { studentUsn: { contains: searchStr, mode: 'insensitive' } },
          { studentName: { contains: searchStr, mode: 'insensitive' } },
          { student: { usn: { contains: searchStr, mode: 'insensitive' } } },
          { student: { fullName: { contains: searchStr, mode: 'insensitive' } } }
        ];
      }

      const [totalCount, submittedCount, notSubmittedCount, certificates] = await Promise.all([
        prisma.ndcCertificate.count({ where: { isReplaced: false, status: CertificateStatus.VALID } }),
        prisma.ndcCertificate.count({ where: { isReplaced: false, status: CertificateStatus.VALID, isSubmitted: true } }),
        prisma.ndcCertificate.count({ where: { isReplaced: false, status: CertificateStatus.VALID, isSubmitted: false } }),
        prisma.ndcCertificate.findMany({
          where,
          include: {
            student: {
              select: {
                usn: true,
                fullName: true,
                department: { select: { code: true, name: true } }
              }
            }
          },
          orderBy: { issuedAt: 'desc' }
        })
      ]);

      const startLabel = startDate ? String(startDate) : '';
      const endLabel = endDate ? String(endDate) : '';
      let dateRangeLabel = 'All Time';
      if (startLabel && endLabel) {
        dateRangeLabel = `${startLabel} to ${endLabel}`;
      } else if (startLabel) {
        dateRangeLabel = `From ${startLabel}`;
      } else if (endLabel) {
        dateRangeLabel = `Up to ${endLabel}`;
      }

      const statusFilterLabel =
        submissionStatus === 'SUBMITTED'
          ? 'Submitted Only'
          : submissionStatus === 'NOT_SUBMITTED'
          ? 'Pending Submission Only'
          : 'All Certificates';

      const records = certificates.map((c, index) => ({
        sNo: index + 1,
        fullName: c.student?.fullName || c.studentName || 'Student',
        usn: c.student?.usn || c.studentUsn || 'N/A',
        branch: c.student?.department?.code || 'N/A',
        certificateNumber: c.certificateNumber,
        issuedAt: new Date(c.issuedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        isSubmitted: c.isSubmitted,
        submittedAt: c.submittedAt ? new Date(c.submittedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : undefined,
        submissionRemarks: c.submissionRemarks || undefined
      }));

      const submissionRate = totalCount > 0 ? Math.round((submittedCount / totalCount) * 100) : 0;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Physical_Certificate_Submission_Report.pdf"`);

      await PdfService.generateSubmissionReportPdf(
        {
          collegeOfficeName: 'College Office / Administrative Section',
          officerName: req.user?.name || 'Administrative Office In-charge',
          officerEmployeeId: (req.user as any)?.officerProfile?.employeeId || 'EMP-ADM-01',
          dateRangeLabel,
          statusFilterLabel,
          totalCertificates: totalCount,
          totalSubmitted: submittedCount,
          totalNotSubmitted: notSubmittedCount,
          submissionRate,
          records
        },
        res
      );
    } catch (err: any) {
      console.error('Error generating physical certificate submission report PDF:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: err.message });
      }
    }
  }
}
