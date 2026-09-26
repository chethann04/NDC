import crypto from 'crypto';
import { Response } from 'express';
import { Prisma } from '../generated/client';
import prisma from '../config/prisma';
import { NdcWorkflowService } from '../services/NdcWorkflowService';
import { CertificateService } from '../services/CertificateService';
import { ReportController } from './ReportController';
import { PdfService } from '../services/PdfService';
import { AuthRequest } from '../middleware/auth';
import { UserRole } from '../constants/roles';
import { DepartmentClearanceStatus, NdcRequestStatus } from '../constants/statuses';
import { AuditService } from '../services/AuditService';
import { LaboratoryAggregationService } from '../services/LaboratoryAggregationService';
import { withId, withIds } from '../utils/formatters';
import emailService from '../services/EmailService';

interface CachedResponse {
  data: any;
  expiresAt: number;
}
const STUDENT_STATUS_CACHE = new Map<string, CachedResponse>();
const STUDENT_STATUS_TTL_MS = 15_000; // 15 seconds

const OFFICER_STATS_CACHE = new Map<string, CachedResponse>();
const OFFICER_STATS_TTL_MS = 10_000; // 10 seconds

export const invalidateStudentStatusCache = (studentId?: string): void => {
  if (studentId) {
    STUDENT_STATUS_CACHE.delete(studentId);
  } else {
    STUDENT_STATUS_CACHE.clear();
  }
};

export const invalidateOfficerStatsCache = (): void => {
  OFFICER_STATS_CACHE.clear();
};

export class NdcController {
  /**
   * Student applies for a No Due Certificate (NDC) clearance.
   * Atomically creates NDC Request and departmental clearance tasks for all required desks.
   * Dispatches persistent notifications to clearance officers and logs an audit event.
   */
  public static async applyForNdc(req: AuthRequest, res: Response): Promise<void> {
    const startTime = Date.now();
    try {
      // 1. Authenticate & strictly verify user is a student
      if (!req.user || req.user.role !== UserRole.STUDENT) {
        res.status(403).json({
          success: false,
          message: 'Forbidden: Only authenticated students can apply for an NDC clearance.'
        });
        return;
      }

      // Strictly derive studentId from authenticated user's profile (never trust request body)
      const studentId = req.user.associatedStudentId;
      if (!studentId) {
        res.status(404).json({
          success: false,
          message: 'No student profile is associated with this user account.'
        });
        return;
      }

      const remarks = req.body?.remarks ? String(req.body.remarks).trim() : 'Final clearance request submitted by student';

      // 2. Pre-transaction check for existing active NDC request (fast return)
      const existingActive = await prisma.ndcRequest.findFirst({
        where: {
          studentId,
          status: { in: ['PENDING', 'IN_PROGRESS', 'APPROVED', 'BLOCKED'] as any }
        },
        include: {
          certificate: true,
          clearances: {
            include: { department: true }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      if (existingActive) {
        const labSummary = LaboratoryAggregationService.getLaboratoryClearanceSummary(existingActive.clearances);
        const aggregatedClearances = LaboratoryAggregationService.aggregateClearancesForPresentation(existingActive.clearances);

        const formattedClearances = aggregatedClearances.map((c: any) => ({
          ...c,
          department: c.department?.name || c.department || 'Department',
          departmentId: withId(c.departmentId || c.department)
        }));

        res.status(200).json({
          success: true,
          alreadyExists: true,
          message: existingActive.status === 'APPROVED'
            ? 'Your clearance has already been approved and your certificate is ready.'
            : 'An active NDC clearance request already exists for your profile.',
          request: withId(existingActive),
          clearances: withIds(formattedClearances),
          laboratory: labSummary,
          data: withId(existingActive),
          executionTimeMs: Date.now() - startTime
        });
        return;
      }

      // 3. Fetch student profile
      const student = await prisma.student.findUnique({
        where: { id: studentId },
        include: { department: true }
      });

      if (!student) {
        res.status(404).json({
          success: false,
          message: 'Student record not found.'
        });
        return;
      }

      // 4. Atomic Transaction: Concurrency check, Request creation, Bulk clearances, and Audit log
      const result = await prisma.$transaction(async (tx) => {
        // Concurrency protection: Double check inside transaction for race conditions
        const doubleCheck = await tx.ndcRequest.findFirst({
          where: {
            studentId,
            status: { in: ['PENDING', 'IN_PROGRESS', 'APPROVED', 'BLOCKED'] as any }
          },
          include: {
            certificate: true,
            clearances: {
              include: { department: true }
            }
          }
        });

        if (doubleCheck) {
          return { alreadyExists: true, ndcRequest: doubleCheck, clearances: doubleCheck.clearances, targetDepts: [] };
        }

        // Fetch all required clearance departments (general desks + student's academic branch)
        const targetDepts = await tx.clearanceDepartment.findMany({
          where: {
            isActive: true,
            requiresClearance: true,
            OR: [
              { isAcademicBranch: false },
              { id: student.departmentId }
            ]
          },
          orderBy: { displayOrder: 'asc' }
        });

        if (targetDepts.length === 0) {
          throw new Error('No clearance departments configured in the system.');
        }

        // Generate unique request number
        const currentYear = new Date().getFullYear();
        const count = await tx.ndcRequest.count();
        let requestNumber = `NDC-${currentYear}-${String(count + 1).padStart(6, '0')}`;

        let attempts = 0;
        while (attempts < 5) {
          const exists = await tx.ndcRequest.findUnique({
            where: { requestNumber },
            select: { id: true }
          });
          if (!exists) break;
          attempts++;
          const rand = Math.floor(1000 + Math.random() * 9000);
          requestNumber = `NDC-${currentYear}-${String(count + attempts).padStart(4, '0')}-${rand}`;
        }

        const requestId = crypto.randomUUID();

        // Create NDC Request
        const newRequest = await tx.ndcRequest.create({
          data: {
            id: requestId,
            requestNumber,
            studentId: student.id,
            status: NdcRequestStatus.IN_PROGRESS as any,
            submittedAt: new Date(),
            remarks
          }
        });

        // Create clearance tasks for ALL required departments in a single batch
        const clearanceData: any[] = targetDepts.map((dept) => ({
          id: crypto.randomUUID(),
          ndcRequestId: requestId,
          studentId: student.id,
          departmentId: dept.id,
          labId: null,
          status: DepartmentClearanceStatus.PENDING as any
        }));

        // Dynamically add any department-specific laboratory clearance requirements
        if (student.departmentId) {
          const deptLabs = await tx.departmentLab.findMany({
            where: { departmentId: student.departmentId, isActive: true },
            take: 1,
            orderBy: { displayOrder: 'asc' }
          });
          for (const lab of deptLabs) {
            clearanceData.push({
              id: crypto.randomUUID(),
              ndcRequestId: requestId,
              studentId: student.id,
              departmentId: student.departmentId,
              labId: lab.id,
              status: DepartmentClearanceStatus.PENDING as any
            });
          }
        }

        await tx.ndcClearance.createMany({
          data: clearanceData,
          skipDuplicates: true
        });

        // Fetch created clearances with department and lab details
        const createdClearances = await tx.ndcClearance.findMany({
          where: { ndcRequestId: requestId },
          include: { department: true, lab: true },
          orderBy: { createdAt: 'asc' }
        });

        // Create Audit Log
        await tx.auditLog.create({
          data: {
            id: crypto.randomUUID(),
            userId: req.user?.id || req.user?._id || null,
            userName: student.fullName,
            role: 'STUDENT',
            action: 'NDC_REQUEST_CREATED',
            entityType: 'NdcRequest',
            entityId: requestId,
            description: `Student ${student.fullName} (${student.usn}) requested NDC clearance across ${targetDepts.length} departments. Remarks: ${remarks}`,
            timestamp: new Date()
          }
        });

        return { alreadyExists: false, ndcRequest: newRequest, clearances: createdClearances, targetDepts };
      });

      if (result.alreadyExists) {
        const formatted = (result.clearances || []).map((c: any) => ({
          ...c,
          department: c.department?.name || 'Department',
          departmentId: withId(c.department)
        }));

        res.status(200).json({
          success: true,
          alreadyExists: true,
          message: 'An active NDC request already exists for this student.',
          request: withId(result.ndcRequest),
          clearances: withIds(formatted),
          data: withId(result.ndcRequest),
          executionTimeMs: Date.now() - startTime
        });
        return;
      }

      // 5. Fire-and-forget persistent notification creation for clearance officers
      const dispatchNotificationsAsync = async () => {
        try {
          const deptIds = result.targetDepts.map((d: any) => d.id);

          // Find officers assigned to these departments
          const officers = await prisma.user.findMany({
            where: {
              isActive: true,
              role: { in: [UserRole.DEPARTMENT_OFFICER, UserRole.HOD] },
              OR: [
                { departmentId: { in: deptIds } },
                {
                  associatedOfficer: {
                    departmentMappings: {
                      some: { departmentId: { in: deptIds } }
                    }
                  }
                }
              ]
            },
            include: { department: true }
          });

          if (officers.length > 0) {
            const notifications = officers.map((off) => ({
              id: crypto.randomUUID(),
              recipientUserId: off.id,
              type: 'CLEARANCE_REQUEST',
              title: '🔔 New NDC Clearance Request',
              message: `Student ${student.fullName} (${student.usn}) has requested clearance. A new clearance request is waiting for your action.`,
              relatedEntityId: result.ndcRequest.id,
              isRead: false
            }));

            await prisma.notification.createMany({
              data: notifications,
              skipDuplicates: true
            });
          }
        } catch (notifErr) {
          // Notification failure should NEVER fail the NDC request transaction
          console.warn('[applyForNdc Notification warning]:', notifErr);
        }
      };

      dispatchNotificationsAsync().catch(() => { });

      const labSummary = LaboratoryAggregationService.getLaboratoryClearanceSummary(result.clearances);
      const aggregatedClearances = LaboratoryAggregationService.aggregateClearancesForPresentation(result.clearances);

      const formattedClearances = aggregatedClearances.map((c: any) => ({
        ...c,
        department: c.department?.name || c.department || 'Department',
        departmentId: withId(c.departmentId || c.department)
      }));

      ReportController.invalidateCache();
      invalidateStudentStatusCache(studentId);
      invalidateOfficerStatsCache();

      res.status(201).json({
        success: true,
        message: 'NDC request submitted successfully',
        request: withId(result.ndcRequest),
        clearances: withIds(formattedClearances),
        laboratory: labSummary,
        data: withId(result.ndcRequest),
        executionTimeMs: Date.now() - startTime
      });
    } catch (err: any) {
      console.error('[applyForNdc Error]:', err);
      res.status(500).json({
        success: false,
        message: err.message || 'Failed to submit clearance request.'
      });
    }
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

      // Fast-path in-memory cache check
      const cacheKey = String(studentId);
      const cached = STUDENT_STATUS_CACHE.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        res.status(200).json(cached.data);
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

      // Combined query: fetch student + latest NDC request + certificate + clearances in one single shot
      const student = await prisma.student.findUnique({
        where: { id: studentId },
        include: {
          department: true,
          ndcRequests: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            include: {
              certificate: true,
              clearances: {
                include: {
                  department: true,
                  lab: true,
                  reviewedBy: {
                    select: { id: true, name: true, email: true, role: true }
                  }
                },
                orderBy: { createdAt: 'asc' }
              }
            }
          }
        }
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

      let ndcRequest: any = student.ndcRequests?.[0] || null;
      let clearances = (ndcRequest?.clearances || []).filter((c: any) => c.department != null);

      // Automated Institutional Clearance: Ensure student NDC request and all mandatory clearances exist automatically
      if (!ndcRequest || ndcRequest.status !== 'APPROVED') {
        ndcRequest = await NdcWorkflowService.ensureStudentNdcRequest(student.id, req);
        const reqId = ndcRequest?.id || ndcRequest?._id;
        if (reqId) {
          const rawClearances = await prisma.ndcClearance.findMany({
            where: { ndcRequestId: reqId },
            include: {
              department: true,
              lab: true,
              reviewedBy: {
                select: { id: true, name: true, email: true, role: true }
              }
            },
            orderBy: { createdAt: 'asc' }
          });
          clearances = rawClearances.filter((c: any) => c.department != null);
        }
      }

      // Query active mandatory clearance departments applicable to this student
      const requiredDepartments = await prisma.clearanceDepartment.findMany({
        where: {
          isActive: true,
          requiresClearance: true,
          OR: [
            { isAcademicBranch: false },
            { id: student.departmentId }
          ]
        },
        orderBy: { displayOrder: 'asc' }
      });

      if (!ndcRequest) {
        res.status(200).json({
          success: true,
          hasActiveRequest: false,
          student: withId(student),
          requiredDepartments: withIds(requiredDepartments),
          clearances: [],
          progress: { total: 0, cleared: 0, percentage: 0 },
          message: 'Unable to initialize student clearance request.'
        });
        return;
      }

      const reqId = ndcRequest.id || ndcRequest._id;

      // Centralized Laboratory Aggregation
      const labSummary = LaboratoryAggregationService.getLaboratoryClearanceSummary(clearances);
      const aggregatedClearances = LaboratoryAggregationService.aggregateClearancesForPresentation(clearances);

      // Student progress evaluated at the aggregated category level
      const totalCategories = aggregatedClearances.length;
      const clearedCategories = aggregatedClearances.filter(
        (c: any) => c.status === 'CLEARED' || c.status === 'NOT_APPLICABLE'
      ).length;

      // Auto-heal / Auto-generate certificate if all departments and laboratories are cleared
      const allRawSatisfied = clearances.length > 0 && clearances.every(
        (c: any) => c.status === 'CLEARED' || c.status === 'NOT_APPLICABLE'
      );

      if (allRawSatisfied && labSummary.overallLaboratoryStatus === 'NO DUE') {
        const autoCertAsync = async () => {
          try {
            if (ndcRequest.status !== 'APPROVED') {
              await prisma.ndcRequest.update({
                where: { id: reqId },
                data: {
                  status: 'APPROVED' as any,
                  completedAt: new Date()
                }
              });
              ndcRequest.status = 'APPROVED';
            }
            let cert = ndcRequest.certificate || await prisma.ndcCertificate.findFirst({
              where: { ndcRequestId: reqId, status: 'VALID' as any }
            });
            if (!cert) {
              cert = await CertificateService.generateCertificate(reqId, req.user?.id || req.user?._id, req);
            }
            if (cert && (!ndcRequest.certificateId || ndcRequest.certificateId !== cert.id)) {
              await prisma.ndcRequest.update({
                where: { id: reqId },
                data: { certificateId: cert.id }
              });
              ndcRequest.certificateId = cert;
            }
          } catch (certErr) {
            console.error('[AutoCertGen Error]:', certErr);
          }
        };
        // Don't await — let it run in the background
        autoCertAsync().catch(() => { });
      }

      // Respond immediately with data we already have — no re-fetch needed
      const responsePayload = {
        success: true,
        hasActiveRequest: true,
        student: withId(student),
        ndcRequest: withId(ndcRequest),
        requiredDepartments: withIds(requiredDepartments),
        clearances: withIds(aggregatedClearances.map((c: any) => ({
          ...c,
          // Always prefer the populated relation object over the raw FK string
          departmentId: withId(c.department || c.departmentId),
          reviewedBy: withId(c.reviewedBy)
        }))),
        rawClearances: withIds(clearances.map((c: any) => ({
          ...c,
          departmentId: withId(c.department),
          reviewedBy: withId(c.reviewedBy)
        }))),
        laboratory: labSummary,
        progress: {
          total: totalCategories,
          cleared: clearedCategories,
          percentage: totalCategories > 0 ? Math.round((clearedCategories / totalCategories) * 100) : 0
        }
      };

      STUDENT_STATUS_CACHE.set(cacheKey, { data: responsePayload, expiresAt: Date.now() + STUDENT_STATUS_TTL_MS });
      res.status(200).json(responsePayload);
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

      const [total, requests, statusGroups] = await Promise.all([
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
        prisma.ndcRequest.groupBy({
          by: ['status'],
          where: baseScope,
          _count: { _all: true }
        })
      ]);

      let totalAll = 0;
      let totalActive = 0;
      let totalApproved = 0;
      statusGroups.forEach((g) => {
        const count = g._count._all;
        totalAll += count;
        if (g.status === 'APPROVED') totalApproved += count;
        if (['PENDING', 'IN_PROGRESS', 'BLOCKED'].includes(g.status)) totalActive += count;
      });

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
              lab: true,
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

      // Authorization scoping: Department and Lab officers can only see clearances within their scope
      let visibleClearances = request.clearances;
      if (req.user.role === UserRole.STUDENT) {
        if (req.user.associatedStudentId && req.user.associatedStudentId !== request.studentId) {
          res.status(403).json({ success: false, message: 'Forbidden: You can only view your own NDC request.' });
          return;
        }
      } else if (req.user.role === UserRole.DEPARTMENT_OFFICER) {
        let assignedDeptIds: string[] = [];
        const officer = await prisma.clearanceOfficer.findUnique({
          where: { userId: req.user.id || req.user._id },
          include: { departmentMappings: true }
        });
        if (officer && officer.departmentMappings.length > 0) {
          assignedDeptIds = officer.departmentMappings.map((m) => m.departmentId);
        }
        if (req.user.departmentId && !assignedDeptIds.includes(req.user.departmentId)) {
          assignedDeptIds.push(req.user.departmentId);
        }
        visibleClearances = request.clearances.filter((c) => assignedDeptIds.includes(c.departmentId));
      } else if (req.user.role === UserRole.HOD) {
        visibleClearances = request.clearances.filter((c) => c.departmentId === req.user.departmentId);
      }

      const formattedClearances = visibleClearances.map((c) => ({
        ...c,
        departmentId: withId(c.department),
        lab: withId(c.lab),
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
      const { status, search, departmentId, studentDepartmentId, labId, page = '1', limit = '50' } = req.query;
      const where: any = {
        department: {
          isActive: true,
          requiresClearance: true
        }
      };

      if (status) {
        where.status = status;
      }

      if (labId) {
        if (String(labId) === 'desk' || String(labId) === 'DEPT') {
          where.labId = null;
        } else if (String(labId) === 'lab' || String(labId) === 'DEPT_LAB' || String(labId) === 'LAB_ONLY') {
          where.labId = { not: null };
        } else {
          where.labId = String(labId);
        }
      }

      if (req.user.role === UserRole.DEPARTMENT_OFFICER) {
        let assignedDeptIds: string[] = [];
        const officer = await prisma.clearanceOfficer.findUnique({
          where: { userId: req.user.id || req.user._id },
          include: { departmentMappings: true }
        });
        if (officer && officer.departmentMappings.length > 0) {
          assignedDeptIds = officer.departmentMappings.map((m) => m.departmentId);
        }
        if (req.user.departmentId && !assignedDeptIds.includes(req.user.departmentId)) {
          assignedDeptIds.push(req.user.departmentId);
        }

        if (assignedDeptIds.length === 0) {
          res.status(403).json({ success: false, message: 'Forbidden: Officer has no assigned clearance department.' });
          return;
        }

        if (departmentId) {
          const reqDept = String(departmentId);
          if (!assignedDeptIds.includes(reqDept)) {
            res.status(403).json({
              success: false,
              message: 'Forbidden: You do not have permission to access records for another department.'
            });
            return;
          }
          where.departmentId = reqDept;
        } else {
          where.departmentId = assignedDeptIds.length === 1 ? assignedDeptIds[0] : { in: assignedDeptIds };
        }

        // Academic departments manage Department Lab only (no separate academic desk)
        if (!labId) {
          const hasAcademicBranch = await prisma.clearanceDepartment.findFirst({
            where: { id: { in: assignedDeptIds }, isAcademicBranch: true }
          });
          if (hasAcademicBranch) {
            where.labId = { not: null };
          }
        }
      } else if (req.user.role === UserRole.HOD) {
        if (!req.user.departmentId) {
          res.status(403).json({ success: false, message: 'Forbidden: HOD is not assigned to any academic department.' });
          return;
        }
        if (departmentId && String(departmentId) !== req.user.departmentId) {
          res.status(403).json({
            success: false,
            message: 'Forbidden: HOD cannot access records outside their academic department.'
          });
          return;
        }

        where.AND = where.AND || [];
        where.AND.push({
          OR: [
            { departmentId: req.user.departmentId },
            { reviewedBy: { departmentId: req.user.departmentId } },
            { reviewedById: req.user.id || req.user._id }
          ]
        });

        if (labId) {
          if (String(labId) === 'desk' || String(labId) === 'DEPT') {
            where.labId = null;
          } else if (String(labId) === 'lab' || String(labId) === 'DEPT_LAB' || String(labId) === 'LAB_ONLY') {
            where.labId = { not: null };
          } else {
            where.labId = String(labId);
          }
        }
      } else if (departmentId) {
        where.departmentId = String(departmentId);
      }

      if (studentDepartmentId && studentDepartmentId !== 'ALL') {
        where.student = {
          ...where.student,
          OR: [
            { departmentId: String(studentDepartmentId) },
            { department: { code: { equals: String(studentDepartmentId), mode: 'insensitive' } } },
            { department: { name: { equals: String(studentDepartmentId), mode: 'insensitive' } } }
          ]
        };
      }

      if (search) {
        const searchStr = String(search).trim();
        where.AND = where.AND || [];
        where.AND.push({
          OR: [
            { student: { fullName: { contains: searchStr, mode: 'insensitive' } } },
            { student: { usn: { contains: searchStr, mode: 'insensitive' } } },
            { ndcRequest: { requestNumber: { contains: searchStr, mode: 'insensitive' } } }
          ]
        });
      }

      const pageNum = Math.max(1, parseInt(String(page || '1'), 10));
      const limitNum = Math.min(1000, Math.max(1, parseInt(String(limit || '50'), 10)));
      const skip = (pageNum - 1) * limitNum;

      let [total, clearances] = await Promise.all([
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
            lab: {
              select: { id: true, name: true, code: true }
            },
            reviewedBy: {
              select: { id: true, name: true, email: true, role: true }
            }
          },
          orderBy: [
            { student: { usn: 'asc' } },
            { createdAt: 'desc' }
          ],
          skip,
          take: limitNum
        })
      ]);

      // Self-healing fallback: If queue is empty, check if students exist without clearances and auto-heal
      if (total === 0 && pageNum === 1) {
        const studentCount = await prisma.student.count({ where: { isActive: true } });
        if (studentCount > 0) {
          const totalClearancesCount = await prisma.ndcClearance.count();
          if (totalClearancesCount < studentCount) {
            const { NdcWorkflowService } = await import('../services/NdcWorkflowService');
            await NdcWorkflowService.ensureAllStudentsClearances(req);
            OFFICER_STATS_CACHE.clear();

            [total, clearances] = await Promise.all([
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
                  lab: {
                    select: { id: true, name: true, code: true }
                  },
                  reviewedBy: {
                    select: { id: true, name: true, email: true, role: true }
                  }
                },
                orderBy: [
                  { student: { usn: 'asc' } },
                  { createdAt: 'desc' }
                ],
                skip,
                take: limitNum
              })
            ]);
          }
        }
      }

      const formatted = clearances.map((c) => ({
        ...c,
        studentId: withId(c.student ? { ...c.student, departmentId: withId(c.student.department) } : null),
        ndcRequestId: withId(c.ndcRequest),
        departmentId: withId(c.department),
        lab: withId(c.lab),
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
   * Returns counts for PENDING, CLEARED, DUE, ON_HOLD, and TOTAL,
   * along with a breakdown separated by student academic department.
   */
  public static async getOfficerQueueStats(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { departmentId, studentDepartmentId, labId } = req.query;

      // In-memory cache check for fast response
      const cacheKey = `${req.user?.id || req.user?._id || 'user'}_${departmentId || ''}_${studentDepartmentId || ''}_${labId || ''}`;
      const cached = OFFICER_STATS_CACHE.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        res.status(200).json(cached.data);
        return;
      }

      const where: any = {
        department: {
          isActive: true,
          requiresClearance: true
        }
      };
      let officerDeptIds: string[] = [];

      if (req.user.role === UserRole.DEPARTMENT_OFFICER) {
        const officer = await prisma.clearanceOfficer.findUnique({
          where: { userId: req.user.id || req.user._id },
          include: { departmentMappings: true }
        });
        if (officer && officer.departmentMappings.length > 0) {
          officerDeptIds = officer.departmentMappings.map((m) => m.departmentId);
        }
        if (req.user.departmentId && !officerDeptIds.includes(req.user.departmentId)) {
          officerDeptIds.push(req.user.departmentId);
        }

        if (officerDeptIds.length === 0) {
          res.status(403).json({ success: false, message: 'Forbidden: Officer has no assigned clearance department.' });
          return;
        }

        if (departmentId) {
          const reqDept = String(departmentId);
          if (!officerDeptIds.includes(reqDept)) {
            res.status(403).json({
              success: false,
              message: 'Forbidden: You do not have permission to view stats for another department.'
            });
            return;
          }
          where.departmentId = reqDept;
        } else {
          where.departmentId = officerDeptIds.length === 1 ? officerDeptIds[0] : { in: officerDeptIds };
        }

        // Academic departments manage Department Lab only
        if (!labId) {
          const hasAcademicBranch = await prisma.clearanceDepartment.findFirst({
            where: { id: { in: officerDeptIds }, isAcademicBranch: true }
          });
          if (hasAcademicBranch) {
            where.labId = { not: null };
          }
        }
      } else if (req.user.role === UserRole.HOD) {
        if (!req.user.departmentId) {
          res.status(403).json({ success: false, message: 'Forbidden: HOD is not assigned to any academic department.' });
          return;
        }
        if (departmentId && String(departmentId) !== req.user.departmentId) {
          res.status(403).json({
            success: false,
            message: 'Forbidden: HOD cannot view stats outside their academic department.'
          });
          return;
        }
        where.departmentId = req.user.departmentId;
        officerDeptIds = [req.user.departmentId];

        // Academic departments manage Department Lab only
        if (!labId) {
          const hodDept = await prisma.clearanceDepartment.findUnique({
            where: { id: req.user.departmentId }
          });
          if (hodDept?.isAcademicBranch) {
            where.labId = { not: null };
          }
        }
      } else if (departmentId) {
        where.departmentId = String(departmentId);
        officerDeptIds = [String(departmentId)];
      }

      if (labId) {
        if (String(labId) === 'desk' || String(labId) === 'DEPT') {
          where.labId = null;
        } else if (String(labId) === 'lab' || String(labId) === 'DEPT_LAB' || String(labId) === 'LAB_ONLY') {
          where.labId = { not: null };
        } else {
          where.labId = String(labId);
        }
      }

      if (studentDepartmentId && studentDepartmentId !== 'ALL') {
        where.student = {
          ...where.student,
          OR: [
            { departmentId: String(studentDepartmentId) },
            { department: { code: { equals: String(studentDepartmentId), mode: 'insensitive' } } }
          ]
        };
      }

      // Calculate department breakdown for this clearance section via fast SQL aggregate
      const deskWhere = { ...where };
      delete deskWhere.student;

      let deptFilterSql: any;
      if (typeof deskWhere.departmentId === 'string') {
        deptFilterSql = Prisma.sql`c."departmentId" = ${deskWhere.departmentId}`;
      } else if (deskWhere.departmentId?.in && Array.isArray(deskWhere.departmentId.in)) {
        deptFilterSql = Prisma.sql`c."departmentId" IN (${Prisma.join(deskWhere.departmentId.in)})`;
      } else {
        deptFilterSql = Prisma.sql`1=1`;
      }

      let labFilterSql = Prisma.sql`1=1`;
      if (deskWhere.labId === null) {
        labFilterSql = Prisma.sql`c."labId" IS NULL`;
      } else if (deskWhere.labId && typeof deskWhere.labId === 'object' && deskWhere.labId.not === null) {
        labFilterSql = Prisma.sql`c."labId" IS NOT NULL`;
      } else if (typeof deskWhere.labId === 'string') {
        labFilterSql = Prisma.sql`c."labId" = ${deskWhere.labId}`;
      }

      // Execute all 3 queries concurrently in 1 round-trip
      const [groups, departmentLabs, deptAggRows] = await Promise.all([
        prisma.ndcClearance.groupBy({
          by: ['status'],
          where,
          _count: { _all: true }
        }),
        officerDeptIds.length > 0
          ? prisma.departmentLab.findMany({
            where: { departmentId: { in: officerDeptIds }, isActive: true },
            orderBy: { displayOrder: 'asc' }
          })
          : Promise.resolve([]),
        prisma.$queryRaw<any[]>`
          SELECT s."departmentId" as "departmentId",
                 COALESCE(d."name", 'General / Unassigned') as "departmentName",
                 COALESCE(d."code", 'GEN') as "departmentCode",
                 c."status"::text as "status",
                 COUNT(*)::int as "count"
          FROM "ndc_clearances" c
          JOIN "students" s ON c."studentId" = s."id"
          LEFT JOIN "clearance_departments" d ON s."departmentId" = d."id"
          WHERE ${deptFilterSql} AND ${labFilterSql}
          GROUP BY s."departmentId", d."name", d."code", c."status"
        `
      ]);

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

      const deptMap: Record<string, { departmentId: string; departmentName: string; departmentCode: string; total: number; pending: number; due: number; cleared: number; onHold: number }> = {};

      deptAggRows.forEach((r) => {
        const dId = r.departmentId || 'unassigned';
        if (!deptMap[dId]) {
          deptMap[dId] = {
            departmentId: dId,
            departmentName: r.departmentName,
            departmentCode: r.departmentCode,
            total: 0,
            pending: 0,
            due: 0,
            cleared: 0,
            onHold: 0
          };
        }
        const count = Number(r.count) || 0;
        deptMap[dId].total += count;
        if (r.status === 'PENDING') deptMap[dId].pending += count;
        else if (r.status === 'DUE') deptMap[dId].due += count;
        else if (r.status === 'CLEARED' || r.status === 'NOT_APPLICABLE') deptMap[dId].cleared += count;
        else if (r.status === 'ON_HOLD') deptMap[dId].onHold += count;
      });

      const byDepartment = Object.values(deptMap).sort((a, b) => a.departmentName.localeCompare(b.departmentName));

      const responsePayload = {
        success: true,
        data: {
          ...statsMap,
          byDepartment,
          departmentLabs: withIds(departmentLabs)
        }
      };

      OFFICER_STATS_CACHE.set(cacheKey, { data: responsePayload, expiresAt: Date.now() + OFFICER_STATS_TTL_MS });
      res.status(200).json(responsePayload);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Batch Clear all PENDING students of a specific academic department for this officer's clearance desk.
   */
  public static async batchClearDepartment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { studentDepartmentId, departmentId, labId, remarks } = req.body;
      if (!studentDepartmentId) {
        res.status(400).json({ success: false, message: 'Academic studentDepartmentId is required.' });
        return;
      }

      let assignedDeptIds: string[] = [];
      if (req.user.role === UserRole.DEPARTMENT_OFFICER) {
        const officer = await prisma.clearanceOfficer.findUnique({
          where: { userId: req.user.id || req.user._id },
          include: { departmentMappings: true }
        });
        if (officer && officer.departmentMappings.length > 0) {
          assignedDeptIds = officer.departmentMappings.map((m) => m.departmentId);
        }
        if (req.user.departmentId && !assignedDeptIds.includes(req.user.departmentId)) {
          assignedDeptIds.push(req.user.departmentId);
        }
      } else if (req.user.role === UserRole.HOD && req.user.departmentId) {
        assignedDeptIds = [req.user.departmentId];
      } else if (req.user.role === UserRole.SUPER_ADMIN && departmentId) {
        assignedDeptIds = [String(departmentId)];
      }

      if (assignedDeptIds.length === 0) {
        res.status(403).json({ success: false, message: 'Forbidden: Officer has no assigned clearance department.' });
        return;
      }

      let officerDeptId = assignedDeptIds[0];
      if (departmentId) {
        const reqDept = String(departmentId);
        if (req.user.role !== UserRole.SUPER_ADMIN && !assignedDeptIds.includes(reqDept)) {
          res.status(403).json({ success: false, message: 'Forbidden: You cannot clear records for another department.' });
          return;
        }
        officerDeptId = reqDept;
      }

      if (req.user.role !== UserRole.SUPER_ADMIN) {
        const isAcademicBranchOfficer = (await prisma.clearanceDepartment.findUnique({
          where: { id: officerDeptId }
        }))?.isAcademicBranch;

        if (isAcademicBranchOfficer && studentDepartmentId !== officerDeptId) {
          res.status(403).json({
            success: false,
            message: 'Forbidden: Department faculty can only clear records for students belonging to their own department.'
          });
          return;
        }
      }

      const where: any = {
        departmentId: officerDeptId,
        status: DepartmentClearanceStatus.PENDING,
        student: {
          OR: [
            { departmentId: studentDepartmentId },
            { department: { code: { equals: studentDepartmentId, mode: 'insensitive' } } }
          ]
        }
      };

      if (labId) {
        if (String(labId) === 'desk' || String(labId) === 'DEPT') {
          where.labId = null;
        } else if (String(labId) === 'lab' || String(labId) === 'DEPT_LAB' || String(labId) === 'LAB_ONLY') {
          where.labId = { not: null };
        } else {
          where.labId = String(labId);
        }
      }

      const pendingClearances = await prisma.ndcClearance.findMany({
        where,
        include: {
          department: true,
          lab: true,
          student: {
            select: {
              id: true,
              fullName: true,
              usn: true,
              email: true,
              user: { select: { id: true, email: true } }
            }
          },
          ndcRequest: {
            include: {
              clearances: {
                where: {
                  department: { isActive: true, requiresClearance: true }
                }
              }
            }
          }
        }
      });

      if (pendingClearances.length === 0) {
        res.status(200).json({ success: true, message: 'No pending clearances found for this department.', count: 0 });
        return;
      }

      const reviewerId = req.user.id || req.user._id;
      const now = new Date();
      const clearanceIds = pendingClearances.map((c) => c.id);

      await prisma.ndcClearance.updateMany({
        where: { id: { in: clearanceIds } },
        data: {
          status: DepartmentClearanceStatus.CLEARED as any,
          remarks: remarks || 'Batch cleared by department clearance officer',
          reviewedById: reviewerId,
          reviewedAt: now,
          dueAmount: 0,
          dueDetails: null
        }
      });

      // Recalculate NDC overall status for affected requests
      const requestIds = Array.from(new Set(pendingClearances.map((c) => c.ndcRequestId)));
      const { NdcWorkflowService } = await import('../services/NdcWorkflowService');
      for (const reqId of requestIds) {
        NdcWorkflowService.checkAndUpdateNdcStatus(reqId, reviewerId, req).catch(() => { });
      }

      // Asynchronously dispatch clearance update emails to students
      (async () => {
        for (const c of pendingClearances) {
          const student = c.student;
          const targetEmail = student?.user?.email || student?.email;
          if (!targetEmail) continue;

          const sectionName = c.lab?.name
            ? (c.department?.name ? `${c.department.name} - ${c.lab.name}` : c.lab.name)
            : c.department?.name || 'Department Clearance Section';

          const reqClearances = c.ndcRequest?.clearances || [];
          const clearedCount = reqClearances.filter(
            (rc: any) => rc.status === DepartmentClearanceStatus.CLEARED || rc.status === DepartmentClearanceStatus.NOT_APPLICABLE
          ).length;

          await emailService.sendClearanceUpdateEmail({
            toEmail: targetEmail,
            studentName: student.fullName,
            usn: student.usn,
            departmentName: sectionName,
            departmentCode: c.department?.code,
            status: DepartmentClearanceStatus.CLEARED,
            remarks: remarks || 'Batch cleared by department clearance officer',
            officerName: req.user.name || req.user.email,
            clearedCount,
            totalCount: reqClearances.length
          }).catch((err) => console.warn('[batchClear email warning]:', err));
        }
      })().catch(() => {});

      await AuditService.log(
        req,
        'DEPARTMENT_BATCH_CLEARED',
        'ClearanceDepartment',
        `Batch cleared ${pendingClearances.length} students of department [${studentDepartmentId}] by officer ${req.user.name || req.user.email}.`,
        officerDeptId,
        null,
        { clearedCount: pendingClearances.length, studentDepartmentId, remarks }
      );

      ReportController.invalidateCache();
      invalidateStudentStatusCache();
      invalidateOfficerStatsCache();

      res.status(200).json({
        success: true,
        message: `Successfully cleared all ${pendingClearances.length} pending students for this department.`,
        count: pendingClearances.length
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Bulk Clear manually selected student clearances across any clearance department.
   * Validates officer authorization, prevents cross-department clearance,
   * updates valid clearances atomically, re-evaluates NDC status, logs audit event,
   * and notifies affected students.
   * Returns: { success: true, cleared: X, skipped: Y, rejected: Z, clearedIds }
   */
  public static async bulkClearClearances(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { clearanceIds, remarks } = req.body;

      if (!Array.isArray(clearanceIds) || clearanceIds.length === 0) {
        res.status(400).json({
          success: false,
          message: 'An array of clearanceIds is required for bulk clearance.'
        });
        return;
      }

      // 1. Explicitly disallow Administration Block officers from modifying clearances
      if (req.user.role === UserRole.ADMIN) {
        res.status(403).json({
          success: false,
          message: 'Access denied. Administration Block officers are not authorized to review or modify student clearance statuses.'
        });
        return;
      }

      // 2. Resolve officer authorized department IDs
      const authorizedDeptIds = new Set<string>();
      const isSuperAdmin = req.user.role === UserRole.SUPER_ADMIN;

      if (!isSuperAdmin) {
        if (req.user.role === UserRole.DEPARTMENT_OFFICER) {
          const officer = await prisma.clearanceOfficer.findUnique({
            where: { userId: req.user.id || req.user._id },
            include: { departmentMappings: true }
          });
          if (officer && officer.departmentMappings.length > 0) {
            officer.departmentMappings.forEach((m) => authorizedDeptIds.add(m.departmentId));
          }
          if (req.user.departmentId) {
            authorizedDeptIds.add(req.user.departmentId);
          }
        } else if (req.user.role === UserRole.HOD && req.user.departmentId) {
          authorizedDeptIds.add(req.user.departmentId);
        }

        if (authorizedDeptIds.size === 0) {
          res.status(403).json({
            success: false,
            message: 'Unauthorized. Officer has no assigned clearance department.'
          });
          return;
        }
      }

      // 3. Fetch targeted clearance records in a single fast query
      const targetClearances = await prisma.ndcClearance.findMany({
        where: { id: { in: clearanceIds.map(String) } },
        include: {
          department: true,
          lab: true,
          student: {
            select: {
              id: true,
              fullName: true,
              usn: true,
              email: true,
              departmentId: true,
              user: { select: { id: true, email: true } }
            }
          },
          ndcRequest: {
            include: {
              clearances: {
                where: {
                  department: { isActive: true, requiresClearance: true }
                }
              }
            }
          }
        }
      });

      const foundIdSet = new Set(targetClearances.map((c) => c.id));
      const notFoundIds = clearanceIds.filter((id: string) => !foundIdSet.has(id));

      const toClear: any[] = [];
      const skipped: any[] = [];
      const rejected: any[] = [...notFoundIds.map((id: string) => ({ id, reason: 'Record not found' }))];

      for (const c of targetClearances) {
        // Cross-department permission check
        const isAuthorized = isSuperAdmin || authorizedDeptIds.has(c.departmentId);
        const isAdm = c.department?.code === 'ADM' || (c.department?.requiresClearance === false && c.labId == null);

        // Dedicated Department Lab enforcement: student must belong to officer's assigned department
        const isStudentDeptMismatch =
          !isSuperAdmin &&
          c.labId != null &&
          c.student?.departmentId &&
          !authorizedDeptIds.has(c.student.departmentId);

        if (!isAuthorized || isAdm || isStudentDeptMismatch) {
          rejected.push({ id: c.id, reason: 'Unauthorized for this department' });
          continue;
        }

        // Check current status
        if (c.status === DepartmentClearanceStatus.CLEARED || c.status === DepartmentClearanceStatus.NOT_APPLICABLE) {
          skipped.push({ id: c.id, reason: 'Already cleared or marked not applicable' });
          continue;
        }

        toClear.push(c);
      }

      const reviewerId = req.user.id || req.user._id;
      const now = new Date();
      const defaultRemarks = remarks && String(remarks).trim() !== ''
        ? String(remarks).trim()
        : 'Bulk cleared by department clearance officer';

      const clearanceIdsToUpdate = toClear.map((c) => c.id);

      // 4. Atomic Transaction for DB updates & Audit Log
      if (clearanceIdsToUpdate.length > 0) {
        await prisma.$transaction(async (tx) => {
          await tx.ndcClearance.updateMany({
            where: { id: { in: clearanceIdsToUpdate } },
            data: {
              status: DepartmentClearanceStatus.CLEARED as any,
              remarks: defaultRemarks,
              reviewedById: reviewerId,
              reviewedAt: now,
              dueAmount: 0,
              dueDetails: null
            }
          });

          await tx.auditLog.create({
            data: {
              id: crypto.randomUUID(),
              userId: reviewerId,
              userName: req.user.name || req.user.email,
              role: req.user.role,
              action: 'BULK_CLEAR',
              entityType: 'NdcClearance',
              entityId: toClear[0].departmentId,
              description: `Officer ${req.user.name || req.user.email} bulk cleared ${clearanceIdsToUpdate.length} students for department [${toClear[0].department?.name || 'Department'}].`,
              newValue: {
                clearedCount: clearanceIdsToUpdate.length,
                skippedCount: skipped.length,
                rejectedCount: rejected.length,
                clearanceIds: clearanceIdsToUpdate
              },
              timestamp: now
            }
          });
        });

        // 5. Post-transaction NDC re-evaluations & cache invalidation
        const affectedRequestIds = Array.from(new Set(toClear.map((c) => c.ndcRequestId)));
        const { NdcWorkflowService } = await import('../services/NdcWorkflowService');
        for (const reqId of affectedRequestIds) {
          NdcWorkflowService.checkAndUpdateNdcStatus(reqId, reviewerId, req).catch(() => { });
        }

        ReportController.invalidateCache();
        invalidateStudentStatusCache();
        invalidateOfficerStatsCache();

        // 6. Persistent notifications for affected students (fire-and-forget)
        const studentNotifications = toClear
          .filter((c) => c.student?.user?.id)
          .map((c) => ({
            id: crypto.randomUUID(),
            recipientUserId: c.student.user.id,
            type: 'CLEARANCE_UPDATE',
            title: '✓ Clearance Approved',
            message: `Your clearance for ${c.department?.name || 'Department'} has been marked as CLEARED.`,
            relatedEntityId: c.id,
            isRead: false
          }));

        if (studentNotifications.length > 0) {
          prisma.notification.createMany({
            data: studentNotifications,
            skipDuplicates: true
          }).catch((err) => console.warn('[bulkClear student notification warning]:', err));
        }

        // 7. Asynchronously dispatch clearance update emails to students
        (async () => {
          for (const c of toClear) {
            const student = c.student;
            const targetEmail = student?.user?.email || student?.email;
            if (!targetEmail) continue;

            const sectionName = c.lab?.name
              ? (c.department?.name ? `${c.department.name} - ${c.lab.name}` : c.lab.name)
              : c.department?.name || 'Department Clearance Section';

            const reqClearances = c.ndcRequest?.clearances || [];
            const clearedCount = reqClearances.filter(
              (rc: any) => rc.status === DepartmentClearanceStatus.CLEARED || rc.status === DepartmentClearanceStatus.NOT_APPLICABLE
            ).length;

            await emailService.sendClearanceUpdateEmail({
              toEmail: targetEmail,
              studentName: student.fullName,
              usn: student.usn,
              departmentName: sectionName,
              departmentCode: c.department?.code,
              status: DepartmentClearanceStatus.CLEARED,
              remarks: defaultRemarks,
              officerName: req.user.name || req.user.email,
              clearedCount,
              totalCount: reqClearances.length
            }).catch((err) => console.warn('[bulkClear email warning]:', err));
          }
        })().catch(() => {});
      }

      res.status(200).json({
        success: true,
        message: `Bulk clearance complete: ${toClear.length} cleared, ${skipped.length} skipped, ${rejected.length} rejected.`,
        cleared: toClear.length,
        skipped: skipped.length,
        rejected: rejected.length,
        clearedIds: clearanceIdsToUpdate
      });
    } catch (err: any) {
      console.error('[bulkClearClearances Error]:', err);
      res.status(500).json({ success: false, message: err.message || 'Failed to process bulk clearance.' });
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

      // Restrict NOT_APPLICABLE strictly to Hostel
      if (status === DepartmentClearanceStatus.NOT_APPLICABLE || status === 'NOT_APPLICABLE') {
        const targetClearance = await prisma.ndcClearance.findUnique({
          where: { id: clearanceId },
          include: { department: true }
        });
        const isHostel = targetClearance?.department?.code === 'HST' ||
          targetClearance?.department?.name?.toLowerCase().includes('hostel');
        if (!isHostel) {
          res.status(400).json({
            success: false,
            message: 'NOT_APPLICABLE status is strictly restricted to the Hostel clearance section.'
          });
          return;
        }
      }

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

        // Check if officer belongs to College Office (ADM) or any department where clearance is not required (excluding academic branches that manage labs)
        const isOnlyAdmOrExempt = userDepts.length > 0 && userDepts.every(
          (d) => d.code === 'ADM' || (d.requiresClearance === false && !d.isAcademicBranch)
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

        if (targetClearance.department.code === 'ADM' || (targetClearance.department.requiresClearance === false && targetClearance.labId == null)) {
          res.status(403).json({
            success: false,
            message: 'Clearance review is not applicable for College Office (ADM) or exempt desks.'
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

        // Dedicated Department Lab Authorization: Verify student belongs to this department
        if (targetClearance.labId != null) {
          const student = await prisma.student.findUnique({
            where: { id: targetClearance.studentId },
            select: { departmentId: true }
          });
          if (student && !userDepts.some((d) => d.id === student.departmentId)) {
            res.status(403).json({
              success: false,
              message: 'Unauthorized. You can only manage Department Lab clearances for students of your department.'
            });
            return;
          }
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
      invalidateStudentStatusCache();
      invalidateOfficerStatsCache();

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
      invalidateStudentStatusCache();
      invalidateOfficerStatsCache();

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
      invalidateStudentStatusCache();
      invalidateOfficerStatsCache();

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
        orderBy: [
          { student: { usn: 'asc' } },
          { reviewedAt: 'desc' }
        ]
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
