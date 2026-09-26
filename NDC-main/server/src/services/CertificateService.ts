import path from 'path';
import fs from 'fs';
import prisma from '../config/prisma';
import { CertificateStatus, DepartmentClearanceStatus, NdcRequestStatus } from '../constants/statuses';
import { PdfService } from './PdfService';
import { AuditService } from './AuditService';
import { LaboratoryAggregationService } from './LaboratoryAggregationService';
import { withId } from '../utils/formatters';
import emailService from './EmailService';

export class CertificateService {
  /**
   * Atomically generate a unique certificate number.
   * Format: NDC/{DEPT_CODE}/{YEAR}/{COUNTER_6_DIGITS} (or prefix from settings)
   */
  public static async generateUniqueCertificateNumber(departmentCode: string = 'GEN'): Promise<string> {
    const currentYear = new Date().getFullYear();
    const settings = await prisma.setting.findFirst();
    const prefixStr = settings?.certificatePrefix || 'NDC/MCE/';

    // Find and update sequence atomically
    const sequence = await prisma.certificateSequence.upsert({
      where: {
        key_year: {
          key: 'NDC',
          year: currentYear
        }
      },
      update: {
        currentNumber: { increment: 1 }
      },
      create: {
        key: 'NDC',
        year: currentYear,
        prefix: prefixStr,
        currentNumber: 1
      }
    });

    const formattedCounter = String(sequence.currentNumber).padStart(6, '0');
    return `${prefixStr}${departmentCode}/${currentYear}/${formattedCounter}`;
  }

  /**
   * Generate an official No Due Certificate for an APPROVED NDC request.
   */
  public static async generateCertificate(
    ndcRequestId: string,
    issuedByUserId?: string,
    reqObj?: any,
    forceNew: boolean = false
  ): Promise<any> {
    const request = await prisma.ndcRequest.findUnique({
      where: { id: ndcRequestId }
    });

    if (!request) {
      throw new Error('NDC Request not found.');
    }

    const student = await prisma.student.findUnique({
      where: { id: request.studentId },
      include: {
        user: { select: { email: true } }
      }
    });

    const department = student
      ? await prisma.clearanceDepartment.findUnique({ where: { id: student.departmentId } })
      : null;

    // Strict Validation: Query all clearance tasks for active departments that require clearance
    const clearanceDocs = await prisma.ndcClearance.findMany({
      where: {
        ndcRequestId: request.id,
        department: {
          isActive: true,
          requiresClearance: true
        }
      },
      include: {
        department: true,
        lab: true,
        reviewedBy: {
          select: { id: true, name: true, role: true }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    const labSummary = LaboratoryAggregationService.getLaboratoryClearanceSummary(clearanceDocs);
    const hasDuesOrHolds = clearanceDocs.some((c: any) =>
      c.status === DepartmentClearanceStatus.DUE ||
      c.status === DepartmentClearanceStatus.ON_HOLD ||
      c.status === DepartmentClearanceStatus.PENDING ||
      (c.dueAmount && c.dueAmount > 0)
    ) || (labSummary.overallLaboratoryStatus === 'DUE');

    if (hasDuesOrHolds || clearanceDocs.length === 0) {
      throw new Error('Cannot generate or provide certificate: Student has pending departmental dues, unresolved holds, or pending evaluations.');
    }

    const existingCert = !forceNew
      ? await prisma.ndcCertificate.findFirst({
          where: {
            ndcRequestId: request.id,
            isReplaced: false
          },
          orderBy: { createdAt: 'desc' }
        })
      : null;

    // Use centralized LaboratoryAggregationService to aggregate all labs into ONE "Laboratory — Cleared" entry
    const clearanceItems = LaboratoryAggregationService.getCertificateClearanceItems(clearanceDocs);

    if (existingCert) {
      let activeCert = existingCert;
      if (existingCert.status !== (CertificateStatus.VALID as any)) {
        activeCert = await prisma.ndcCertificate.update({
          where: { id: existingCert.id },
          data: {
            status: CertificateStatus.VALID as any,
            revokedAt: null,
            revokedById: null,
            revocationReason: null,
            updatedAt: new Date()
          }
        });
      }

      if (request.certificateId !== activeCert.id) {
        await prisma.ndcRequest.update({
          where: { id: request.id },
          data: {
            certificateId: activeCert.id,
            completedAt: new Date()
          }
        });
      }

      if (activeCert.pdfPath) {
        const existingPdfFullPath = path.isAbsolute(activeCert.pdfPath)
          ? activeCert.pdfPath
          : path.resolve(process.cwd(), activeCert.pdfPath.replace(/^\//, ''));

        // Always ensure PDF exists and has latest clearance approval timestamps
        await PdfService.generateCertificatePdf(
          {
            certificateNumber: activeCert.certificateNumber,
            studentName: student?.fullName || activeCert.studentName || 'Student Name',
            usn: student?.usn || activeCert.studentUsn || 'USN',
            departmentName: department ? department.name : activeCert.departmentName || 'General',
            batch: student?.batch || '2022-2026',
            academicYear: student?.academicYear || '2025-2026',
            issuedAt: activeCert.issuedAt || new Date(),
            hodName: department?.hodName,
            clearances: clearanceItems
          },
          existingPdfFullPath
        );
      }
      return withId(activeCert);
    }

    if (!student) {
      throw new Error('Student record associated with this request was not found.');
    }

    const deptCode = department ? department.code : 'GEN';

    // Generate unique Certificate Number atomically
    const certificateNumber = await this.generateUniqueCertificateNumber(deptCode);

    // Build PDF output path
    const filename = `NDC_${certificateNumber.replace(/[\/\\:]/g, '_')}.pdf`;
    const uploadsDir = path.resolve(process.cwd(), 'uploads/certificates');
    const pdfPath = path.join(uploadsDir, filename);

    // Render PDF with Itemized Department Approval Timestamps
    await PdfService.generateCertificatePdf(
      {
        certificateNumber,
        studentName: student.fullName,
        usn: student.usn,
        departmentName: department ? department.name : student.departmentName || 'General',
        batch: student.batch,
        academicYear: student.academicYear,
        issuedAt: new Date(),
        hodName: department?.hodName,
        clearances: clearanceItems
      },
      pdfPath
    );

    // Double-check race condition right before creation to prevent rapid double-click duplicates
    const raceCheckCert = !forceNew
      ? await prisma.ndcCertificate.findFirst({
          where: {
            ndcRequestId: request.id,
            isReplaced: false
          }
        })
      : null;
    if (raceCheckCert) {
      return withId(raceCheckCert);
    }

    // Save Certificate Document
    const certificate = await prisma.ndcCertificate.create({
      data: {
        certificateNumber,
        ndcRequestId: request.id,
        studentId: student.id,
        studentName: student.fullName,
        studentUsn: student.usn,
        departmentName: department ? department.name : student.departmentName || 'General',
        issuedAt: new Date(),
        issuedById: issuedByUserId || undefined,
        pdfPath: `/uploads/certificates/${filename}`,
        status: CertificateStatus.VALID as any
      }
    });

    // Link certificate to request
    await prisma.ndcRequest.update({
      where: { id: request.id },
      data: {
        certificateId: certificate.id,
        completedAt: new Date()
      }
    });

    await AuditService.log(
      reqObj || null,
      'CERTIFICATE_GENERATED',
      'NdcCertificate',
      `Issued No Due Certificate [${certificateNumber}] for student [${student.usn}] (${student.fullName}).`,
      certificate.id
    );

    // Asynchronously dispatch certificate completion email to student's registered email
    const recipientEmail = student?.user?.email || student?.email;
    if (recipientEmail && student) {
      (async () => {
        try {
          const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
          await emailService.sendCertificateIssuedEmail({
            toEmail: recipientEmail,
            studentName: student.fullName,
            usn: student.usn,
            certificateNumber: certificate.certificateNumber,
            issuedAt: certificate.issuedAt,
            downloadUrl: `${clientUrl}/student/dashboard`
          });
        } catch (e) {
          console.warn('[CertificateService]: Failed to dispatch certificate issued email:', e);
        }
      })().catch(() => {});
    }

    return withId(certificate);
  }

  /**
   * Revoke an issued certificate. The certificate number is retired permanently.
   */
  public static async revokeCertificate(
    certificateId: string,
    revocationReason: string,
    revokedByUserId: string,
    reqObj?: any
  ): Promise<any> {
    const certificate = await prisma.ndcCertificate.findUnique({
      where: { id: certificateId }
    });

    if (!certificate) {
      throw new Error('Certificate not found.');
    }

    if (certificate.status === CertificateStatus.REVOKED) {
      throw new Error('Certificate is already revoked.');
    }

    const updated = await prisma.ndcCertificate.update({
      where: { id: certificateId },
      data: {
        status: CertificateStatus.REVOKED as any,
        revokedAt: new Date(),
        revokedById: revokedByUserId,
        revocationReason
      }
    });

    await AuditService.log(
      reqObj || null,
      'CERTIFICATE_REVOKED',
      'NdcCertificate',
      `Revoked certificate [${certificate.certificateNumber}]. Reason: ${revocationReason}`,
      certificate.id,
      { status: CertificateStatus.VALID },
      { status: CertificateStatus.REVOKED, revocationReason }
    );

    return withId(updated);
  }

  /**
   * Reissue a new certificate for an APPROVED request.
   * Generates a NEW certificate number and marks the previous certificate as replaced.
   */
  public static async reissueCertificate(
    ndcRequestId: string,
    adminUserId: string,
    reqObj?: any
  ): Promise<any> {
    const request = await prisma.ndcRequest.findUnique({
      where: { id: ndcRequestId }
    });

    if (!request) {
      throw new Error('NDC Request not found.');
    }

    if (request.status !== NdcRequestStatus.APPROVED) {
      throw new Error('Cannot reissue certificate for unapproved NDC request.');
    }

    // Mark current active certificate as replaced if exists
    const currentCert = await prisma.ndcCertificate.findFirst({
      where: {
        ndcRequestId: request.id,
        status: CertificateStatus.VALID as any
      }
    });

    if (currentCert) {
      await prisma.ndcCertificate.update({
        where: { id: currentCert.id },
        data: { isReplaced: true }
      });
    }

    // Generate brand new certificate with new certificate number
    const newCert = await this.generateCertificate(request.id, adminUserId, reqObj, true);

    if (currentCert) {
      await prisma.ndcCertificate.update({
        where: { id: currentCert.id },
        data: { replacementCertificateId: newCert.id || newCert._id }
      });
    }

    return newCert;
  }
}
