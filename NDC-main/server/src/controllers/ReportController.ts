import { Response } from 'express';
import xlsx from 'xlsx';
import prisma from '../config/prisma';
import { AuthRequest } from '../middleware/auth';

import { departmentCache } from '../utils/departmentCache';

export class ReportController {
  private static cachedStats: any = null;
  private static cachedActivities: any[] = [];
  private static cacheExpiry = 0;
  private static readonly STATS_TTL = 30 * 1000; // 30 seconds

  public static invalidateCache(): void {
    ReportController.cachedStats = null;
    ReportController.cachedActivities = [];
    ReportController.cacheExpiry = 0;
  }

  public static async getDashboardStats(req: AuthRequest, res: Response): Promise<void> {
    try {
      const now = Date.now();
      if (ReportController.cachedStats && now < ReportController.cacheExpiry) {
        res.status(200).json({
          success: true,
          stats: ReportController.cachedStats,
          recentActivity: ReportController.cachedActivities
        });
        return;
      }

      // Execute all top-level aggregations, departments from cache, and recent activity in parallel
      const [
        totalStudents,
        activeStudents,
        requestGroup,
        certGroup,
        departments,
        clearanceGroup,
        recentActivity
      ] = await Promise.all([
        prisma.student.count(),
        prisma.student.count({ where: { isActive: true } }),
        prisma.ndcRequest.groupBy({
          by: ['status'],
          _count: { _all: true }
        }),
        prisma.ndcCertificate.groupBy({
          by: ['status'],
          _count: { _all: true }
        }),
        departmentCache.getAllActiveDepartments(),
        prisma.ndcClearance.groupBy({
          by: ['departmentId', 'status'],
          _count: { _all: true }
        }),
        prisma.auditLog.findMany({
          orderBy: { timestamp: 'desc' },
          take: 6,
          select: {
            id: true,
            userName: true,
            role: true,
            action: true,
            description: true,
            timestamp: true
          }
        })
      ]);

      // Map request status counts and calculate total without extra count() query
      const reqStatusMap = new Map(requestGroup.map((g) => [g.status, g._count._all]));
      const totalRequests = Array.from(reqStatusMap.values()).reduce((a, b) => a + b, 0);
      const pendingRequests = reqStatusMap.get('PENDING' as any) || 0;
      const inProgressRequests = reqStatusMap.get('IN_PROGRESS' as any) || 0;
      const blockedRequests = reqStatusMap.get('BLOCKED' as any) || 0;
      const approvedRequests = reqStatusMap.get('APPROVED' as any) || 0;

      // Map certificate status counts and calculate total without extra count() query
      const certStatusMap = new Map(certGroup.map((g) => [g.status, g._count._all]));
      const totalCertificates = Array.from(certStatusMap.values()).reduce((a, b) => a + b, 0);
      const validCertificates = certStatusMap.get('VALID' as any) || 0;
      const revokedCertificates = certStatusMap.get('REVOKED' as any) || 0;

      // Index clearance counts by departmentId and status in O(1) memory lookup
      const deptClearanceMap = new Map<string, Record<string, number>>();
      clearanceGroup.forEach((cg) => {
        if (!deptClearanceMap.has(cg.departmentId)) {
          deptClearanceMap.set(cg.departmentId, {});
        }
        deptClearanceMap.get(cg.departmentId)![cg.status] = cg._count._all;
      });

      const departmentStats = departments.map((dept) => {
        const counts = deptClearanceMap.get(dept.id) || {};
        const cleared = counts['CLEARED'] || 0;
        const due = counts['DUE'] || 0;
        const onHold = counts['ON_HOLD'] || 0;
        const pending = counts['PENDING'] || 0;
        const notApplicable = counts['NOT_APPLICABLE'] || 0;
        const totalClearances = cleared + due + onHold + pending + notApplicable;
        const percentage = totalClearances > 0 ? Math.round(((cleared + notApplicable) / totalClearances) * 100) : 0;

        return {
          departmentId: dept.id,
          _id: dept.id,
          name: dept.name,
          code: dept.code,
          total: totalClearances,
          cleared,
          due,
          onHold,
          pending,
          notApplicable,
          completionPercentage: percentage
        };
      });

      const stats = {
        students: { total: totalStudents, active: activeStudents },
        requests: { total: totalRequests, pending: pendingRequests, inProgress: inProgressRequests, blocked: blockedRequests, approved: approvedRequests },
        certificates: { total: totalCertificates, valid: validCertificates, revoked: revokedCertificates },
        departmentStats
      };

      ReportController.cachedStats = stats;
      ReportController.cachedActivities = recentActivity;
      ReportController.cacheExpiry = Date.now() + ReportController.STATS_TTL;

      res.status(200).json({
        success: true,
        stats,
        recentActivity
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  public static async exportReport(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { type = 'NdcStatus', format = 'xlsx', departmentId, status } = req.query;

      let exportData: any[] = [];
      let filename = `Report_${type}_${Date.now()}`;

      if (type === 'StudentNdcStatus') {
        const where: any = {};
        if (status) where.status = status as any;

        const requests = await prisma.ndcRequest.findMany({
          where,
          include: {
            student: {
              include: { department: true }
            },
            certificate: true
          },
          orderBy: { submittedAt: 'desc' }
        });

        exportData = requests.map((r: any) => ({
          'Request Number': r.requestNumber,
          USN: r.student?.usn || 'N/A',
          'Student Name': r.student?.fullName || 'N/A',
          Department: r.student?.department?.name || 'N/A',
          Batch: r.student?.batch || 'N/A',
          Status: r.status,
          'Submitted Date': new Date(r.submittedAt).toLocaleDateString(),
          'Certificate Number': r.certificate?.certificateNumber || 'N/A'
        }));
      } else if (type === 'DepartmentClearance') {
        const where: any = {};
        if (departmentId) where.departmentId = String(departmentId);
        if (status) where.status = status as any;

        const clearances = await prisma.ndcClearance.findMany({
          where,
          include: {
            student: {
              include: { department: true }
            },
            department: true,
            ndcRequest: true,
            reviewedBy: {
              select: { name: true, email: true }
            }
          }
        });

        exportData = clearances.map((c: any) => ({
          USN: c.student?.usn || 'N/A',
          'Student Name': c.student?.fullName || 'N/A',
          Department: c.department?.name || 'N/A',
          'Clearance Status': c.status,
          Remarks: c.remarks || '',
          'Due Amount (₹)': c.dueAmount || 0,
          'Due Details': c.dueDetails || '',
          'Reviewed By': c.reviewedBy?.name || 'N/A',
          'Reviewed Date': c.reviewedAt ? new Date(c.reviewedAt).toLocaleDateString() : 'N/A'
        }));
      } else if (type === 'CertificateReport') {
        const certs = await prisma.ndcCertificate.findMany({
          include: {
            student: {
              include: { department: true }
            },
            issuedBy: {
              select: { name: true, email: true }
            }
          }
        });

        exportData = certs.map((c: any) => ({
          'Certificate Number': c.certificateNumber,
          USN: c.student?.usn || 'N/A',
          'Student Name': c.student?.fullName || 'N/A',
          Department: c.student?.department?.name || 'N/A',
          Batch: c.student?.batch || 'N/A',
          Status: c.status,
          'Issue Date': new Date(c.issuedAt).toLocaleDateString(),
          'Issued By': c.issuedBy?.name || 'System Auto',
          'Revocation Reason': c.revocationReason || 'N/A'
        }));
      }

      if (exportData.length === 0) {
        exportData = [{ Note: 'No records found matching specified filters.' }];
      }

      const worksheet = xlsx.utils.json_to_sheet(exportData);
      const workbook = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(workbook, worksheet, 'Report');

      const isCsv = String(format).toLowerCase() === 'csv';
      const fileType = isCsv ? 'csv' : 'xlsx';
      const buffer = xlsx.write(workbook, { type: 'buffer', bookType: fileType as any });

      const contentType = isCsv
        ? 'text/csv'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename=${filename}.${fileType}`);
      res.status(200).send(buffer);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}
