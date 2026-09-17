import { Request, Response } from 'express';
import prisma from '../config/prisma';

export class VerifyController {
  /**
   * Verification endpoint supporting:
   * 1. Full Certificate Number (e.g. NDC/MCE/IS/2026/000001)
   * 2. Branch Code + Academic Year + Short 3-digit Sequence (e.g. Branch: IS, Year: 2026, ShortCode: 001 -> NDC/MCE/IS/2026/000001)
   * 3. USN Search (e.g. 4MC23IS112)
   */
  public static async verifyCertificate(req: Request, res: Response): Promise<void> {
    try {
      const { certificateNumber, branchCode, year, shortCode } = req.body;

      if (!certificateNumber && (!branchCode || !shortCode)) {
        res.status(400).json({
          success: false,
          status: 'INVALID_INPUT',
          message: 'Provide either a Certificate Number/USN or Branch Code + Sequence Number.'
        });
        return;
      }

      let whereCondition: any = null;

      if (branchCode && shortCode) {
        const branch = String(branchCode).trim().toUpperCase();
        const yr = String(year || new Date().getFullYear()).trim();
        const rawSeq = String(shortCode).trim().replace(/\D/g, '');
        const paddedSeq = rawSeq.padStart(6, '0');

        const fullCertNo = `NDC/MCE/${branch}/${yr}/${paddedSeq}`;
        whereCondition = {
          OR: [
            { certificateNumber: { equals: fullCertNo, mode: 'insensitive' } },
            { certificateNumber: { endsWith: `${branch}/${yr}/${paddedSeq}`, mode: 'insensitive' } },
            { certificateNumber: { endsWith: paddedSeq, mode: 'insensitive' } }
          ]
        };
      } else if (certificateNumber) {
        const formattedInput = String(certificateNumber).trim().toUpperCase();

        if (/^\d{1,6}$/.test(formattedInput)) {
          const paddedSeq = formattedInput.padStart(6, '0');
          whereCondition = {
            OR: [
              { certificateNumber: { endsWith: paddedSeq, mode: 'insensitive' } }
            ]
          };
        } else {
          // Check by certificateNumber (unique index) or studentUsn (index) first
          whereCondition = {
            OR: [
              { certificateNumber: formattedInput },
              { studentUsn: formattedInput }
            ]
          };
        }
      }

      const certificate = await prisma.ndcCertificate.findFirst({
        where: whereCondition,
        select: {
          id: true,
          certificateNumber: true,
          studentName: true,
          studentUsn: true,
          departmentName: true,
          status: true,
          issuedAt: true,
          revokedAt: true,
          revocationReason: true,
          student: {
            select: {
              fullName: true,
              usn: true,
              batch: true,
              academicYear: true,
              department: {
                select: { name: true }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      if (!certificate) {
        res.status(200).json({
          success: true,
          status: 'NOT_FOUND',
          message: 'Certificate not found. Please double check the branch code, academic year, and sequence number.'
        });
        return;
      }

      const student = certificate.student;
      const department = student?.department;

      const displayStudentName = student ? student.fullName : certificate.studentName || 'N/A';
      const displayUsn = student ? student.usn : certificate.studentUsn || 'N/A';
      const displayDeptName = department ? department.name : certificate.departmentName || 'N/A';

      if (certificate.status === 'REVOKED') {
        res.status(200).json({
          success: true,
          status: 'REVOKED',
          message: 'This certificate has been REVOKED by institutional administration.',
          certificate: {
            certificateNumber: certificate.certificateNumber,
            studentName: displayStudentName,
            usn: displayUsn,
            departmentName: displayDeptName,
            issuedAt: certificate.issuedAt,
            revokedAt: certificate.revokedAt,
            revocationReason: certificate.revocationReason || 'Issued in error or invalidated'
          }
        });
        return;
      }

      // Valid Certificate
      res.status(200).json({
        success: true,
        status: 'VALID',
        message: 'Certificate is VALID and officially recorded.',
        certificate: {
          certificateNumber: certificate.certificateNumber,
          studentName: displayStudentName,
          usn: displayUsn,
          departmentName: displayDeptName,
          batch: student ? student.batch : 'N/A',
          academicYear: student ? student.academicYear : 'N/A',
          issuedAt: certificate.issuedAt
        }
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}
