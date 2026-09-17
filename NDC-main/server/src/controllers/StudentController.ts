import { Request, Response } from 'express';
import xlsx from 'xlsx';
import path from 'path';
import fs from 'fs';
import prisma from '../config/prisma';
import bcrypt from 'bcryptjs';
import { UserRole } from '../constants/roles';
import { ImportService } from '../services/ImportService';
import { AuditService } from '../services/AuditService';
import { NdcWorkflowService } from '../services/NdcWorkflowService';
import { AuthRequest } from '../middleware/auth';
import { withId, withIds } from '../utils/formatters';
import { hashPassword } from '../utils/passwordUtils';
import { getOrCreateDepartmentByUsn, normalizeUsnString } from '../utils/usnDepartmentResolver';

export class StudentController {
  public static async getAllStudents(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { search, departmentId, batch, academicYear, page = '1', limit = '20' } = req.query;
      const where: any = {};

      if (search) {
        const searchStr = String(search).trim();
        where.OR = [
          { fullName: { contains: searchStr, mode: 'insensitive' } },
          { usn: { contains: searchStr, mode: 'insensitive' } },
          { email: { contains: searchStr, mode: 'insensitive' } },
          { studentId: { contains: searchStr, mode: 'insensitive' } }
        ];
      }

      if (departmentId) where.departmentId = String(departmentId);
      if (batch) where.batch = String(batch);
      if (academicYear) where.academicYear = String(academicYear);

      // Backend RBAC Scoping Enforcement
      if (req.user) {
        if (req.user.role === UserRole.HOD && req.user.departmentId) {
          where.departmentId = req.user.departmentId;
        } else if (req.user.role === UserRole.STUDENT && req.user.associatedStudentId) {
          where.id = req.user.associatedStudentId;
        }
      }

      const pageNum = parseInt(String(page), 10);
      const limitNum = parseInt(String(limit), 10);
      const skip = (pageNum - 1) * limitNum;

      const [total, students] = await Promise.all([
        prisma.student.count({ where }),
        prisma.student.findMany({
          where,
          include: { department: true },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limitNum
        })
      ]);

      res.status(200).json({
        success: true,
        data: withIds(students),
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

  public static async getStudentById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const student = await prisma.student.findUnique({
        where: { id: req.params.id },
        include: { department: true }
      });

      if (!student) {
        res.status(404).json({ success: false, message: 'Student not found.' });
        return;
      }

      // Backend RBAC Scoping Enforcement
      if (req.user) {
        if (req.user.role === UserRole.HOD && req.user.departmentId) {
          if (student.departmentId !== req.user.departmentId) {
            res.status(403).json({ success: false, message: 'Forbidden: You can only access students from your academic department.' });
            return;
          }
        } else if (req.user.role === UserRole.STUDENT && req.user.associatedStudentId) {
          if (student.id !== req.user.associatedStudentId) {
            res.status(403).json({ success: false, message: 'Forbidden: You can only access your own profile.' });
            return;
          }
        }
      }

      res.status(200).json({ success: true, data: withId(student) });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  public static async createStudent(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { usn, fullName, email, phone, section, batch, academicYear, semester, year, admissionYear, graduationYear, dateOfBirth, dob } = req.body;

      const normalizedUsn = normalizeUsnString(usn);
      if (!normalizedUsn) {
        res.status(400).json({ success: false, message: 'Please enter a valid USN.' });
        return;
      }
      const normalizedEmail = (email || '').toLowerCase().trim();

      // 1. Parallelize USN lookup, User email lookup, and Department resolution (0ms from cache)
      const [existingUsn, existingUser, deptResolution] = await Promise.all([
        prisma.student.findUnique({ where: { usn: normalizedUsn }, select: { id: true } }),
        normalizedEmail ? prisma.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } }) : null,
        getOrCreateDepartmentByUsn(normalizedUsn)
      ]);

      if (existingUsn) {
        res.status(400).json({ success: false, message: `Student with USN [${normalizedUsn}] already exists.` });
        return;
      }

      if (!deptResolution.success || !deptResolution.departmentId) {
        res.status(400).json({
          success: false,
          status: 'UNKNOWN_DEPARTMENT',
          message: deptResolution.error || 'Unable to determine department from USN.'
        });
        return;
      }

      const studentId = `STU-${normalizedUsn}`;
      const birthDate = (dateOfBirth || dob) ? new Date(dateOfBirth || dob) : new Date('2004-05-15T00:00:00.000Z');

      // 2. Hash password concurrently
      const usnHash = await hashPassword(normalizedUsn);

      // 3. Atomically create Student, User, NDC Request and Clearances in 1 round trip
      const student = await prisma.$transaction(async (tx) => {
        const newStudent = await tx.student.create({
          data: {
            studentId,
            usn: normalizedUsn,
            fullName,
            email: normalizedEmail,
            phone: phone || '',
            departmentId: deptResolution.departmentId!,
            departmentName: deptResolution.name || undefined,
            section: section ? section.toUpperCase() : 'A',
            batch: batch || '2022-2026',
            academicYear: academicYear || '2025-2026',
            semester: semester || '8th Semester',
            year: year || '4th Year',
            admissionYear: parseInt(admissionYear || '2022', 10),
            graduationYear: parseInt(graduationYear || '2026', 10),
            dateOfBirth: birthDate,
            isActive: true
          }
        });

        if (!existingUser && normalizedEmail) {
          await tx.user.create({
            data: {
              email: normalizedEmail,
              passwordHash: usnHash,
              role: UserRole.STUDENT as any,
              name: newStudent.fullName,
              associatedStudentId: newStudent.id,
              mustChangePassword: true
            }
          });
        }

        // Initialize NDC Request and departmental clearance tasks with bulk createMany
        await NdcWorkflowService.initializeNewStudentNdc(newStudent.id, deptResolution.departmentId!, tx);

        return newStudent;
      });

      // 4. Asynchronous audit logging - do not block client response
      AuditService.log(req, 'STUDENT_CREATED', 'Student', `Created student [${student.usn}] (${student.fullName}).`, student.id).catch(() => {});

      res.status(201).json({ success: true, message: 'Student created successfully.', data: withId(student) });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  public static async updateStudent(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { fullName, email, phone, departmentId, section, batch, academicYear, semester, year, admissionYear, graduationYear, isActive, dateOfBirth, dob } = req.body;

      const student = await prisma.student.findUnique({ where: { id: req.params.id } });
      if (!student) {
        res.status(404).json({ success: false, message: 'Student not found.' });
        return;
      }

      const updateData: any = {};
      if (fullName !== undefined) updateData.fullName = fullName;
      if (email !== undefined) updateData.email = email.toLowerCase().trim();
      if (phone !== undefined) updateData.phone = phone;
      if (departmentId !== undefined) updateData.departmentId = departmentId;
      if (section !== undefined) updateData.section = section.toUpperCase();
      if (batch !== undefined) updateData.batch = batch;
      if (academicYear !== undefined) updateData.academicYear = academicYear;
      if (semester !== undefined) updateData.semester = semester;
      if (year !== undefined) updateData.year = year;
      if (admissionYear !== undefined) updateData.admissionYear = parseInt(admissionYear, 10);
      if (graduationYear !== undefined) updateData.graduationYear = parseInt(graduationYear, 10);
      if (isActive !== undefined) updateData.isActive = isActive;
      if (dateOfBirth !== undefined || dob !== undefined) {
        const val = dateOfBirth || dob;
        updateData.dateOfBirth = val ? new Date(val) : null;
      }

      const updated = await prisma.student.update({
        where: { id: req.params.id },
        data: updateData
      });

      await AuditService.log(req, 'STUDENT_UPDATED', 'Student', `Updated student details for [${student.usn}].`, student.id, student, updated);

      res.status(200).json({ success: true, message: 'Student updated successfully.', data: withId(updated) });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  public static async deleteStudent(req: AuthRequest, res: Response): Promise<void> {
    try {
      const student = await prisma.student.findUnique({ where: { id: req.params.id } });
      if (!student) {
        res.status(404).json({ success: false, message: 'Student not found.' });
        return;
      }

      // Cascade delete student's User account and student record
      await prisma.user.deleteMany({
        where: {
          OR: [{ associatedStudentId: student.id }, { email: student.email }]
        }
      });
      await prisma.student.delete({ where: { id: student.id } });

      await AuditService.log(req, 'STUDENT_DELETED', 'Student', `Deleted student record [${student.usn}].`, student.id);

      res.status(200).json({ success: true, message: 'Student deleted successfully.' });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Bulk Import Preview
   */
  public static async previewImport(req: Request, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ success: false, message: 'Excel or CSV file is required for upload.' });
        return;
      }

      const fileBuffer = req.file.buffer || (req.file.path ? fs.readFileSync(req.file.path) : null);
      if (!fileBuffer) {
        res.status(400).json({ success: false, message: 'Unable to read uploaded file contents.' });
        return;
      }

      const previewResult = await ImportService.parseAndValidate(fileBuffer);
      res.status(200).json({
        success: true,
        data: {
          totalRows: previewResult.totalRecords,
          totalRecords: previewResult.totalRecords,
          validRecords: previewResult.validRecords,
          invalidRecords: previewResult.invalidRecords,
          duplicateRecords: previewResult.duplicateRecords,
          rows: previewResult.rows
        }
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Bulk Import Confirmation & Execution
   */
  public static async confirmImport(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { rows, duplicateAction } = req.body;
      if (!rows || !Array.isArray(rows) || rows.length === 0) {
        res.status(400).json({ success: false, message: 'Rows data array is required for import execution.' });
        return;
      }

      const result = await ImportService.executeImport(rows, duplicateAction || 'SKIP', req.user.id || req.user._id, req);
      res.status(200).json({
        success: true,
        message: 'Import operation completed.',
        data: {
          totalRows: result.totalRows || rows.length,
          imported: result.imported,
          skipped: result.skipped,
          updated: result.updated,
          invalid: result.failed,
          failed: result.failed,
          errorReport: result.errorReport
        }
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Download Excel Import Template
   */
  public static async downloadTemplate(req: Request, res: Response): Promise<void> {
    try {
      const candidatePaths = [
        path.resolve(process.cwd(), '../Students.xlsx'),
        'd:/NDC/Students.xlsx',
        path.resolve(process.cwd(), 'Students.xlsx')
      ];

      for (const filePath of candidatePaths) {
        if (fs.existsSync(filePath)) {
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', 'attachment; filename="Students.xlsx"');
          const fileStream = fs.createReadStream(filePath);
          fileStream.pipe(res);
          return;
        }
      }

      const templateData = [
        {
          USN: '4MC22IS001',
          'Student Name': 'Rahul Sharma',
          Email: 'rahul.is22@mce.ac.in',
          Phone: '9876543210',
          Department: 'ISE',
          Section: 'A',
          Batch: '2022-2026',
          'Academic Year': '2025-2026',
          Semester: '8th Semester',
          Year: '4th Year',
          'Admission Year': 2022,
          'Graduation Year': 2026
        }
      ];

      const worksheet = xlsx.utils.json_to_sheet(templateData);
      const workbook = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(workbook, worksheet, 'StudentImportTemplate');

      const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="Students.xlsx"');
      res.send(buffer);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Bulk Delete Students & Associated Login Accounts
   */
  public static async bulkDeleteStudents(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { studentIds, deleteAll } = req.body;

      let targetStudentIds: string[] = [];
      if (deleteAll) {
        const allStudents = await prisma.student.findMany({ select: { id: true } });
        targetStudentIds = allStudents.map((s) => s.id);
      } else if (Array.isArray(studentIds) && studentIds.length > 0) {
        targetStudentIds = studentIds;
      } else {
        res.status(400).json({ success: false, message: 'Please provide studentIds array or set deleteAll to true.' });
        return;
      }

      if (targetStudentIds.length === 0) {
        res.status(200).json({ success: true, message: 'No students selected for deletion.', deletedCount: 0 });
        return;
      }

      const studentsToDelete = await prisma.student.findMany({
        where: { id: { in: targetStudentIds } },
        select: { email: true }
      });
      const emails = studentsToDelete.map((s) => s.email).filter(Boolean);

      // Cascade deletion of login User accounts
      await prisma.user.deleteMany({
        where: {
          OR: [
            { associatedStudentId: { in: targetStudentIds } },
            { email: { in: emails } }
          ]
        }
      });

      // Delete Student records
      const deleteResult = await prisma.student.deleteMany({
        where: { id: { in: targetStudentIds } }
      });

      await AuditService.log(
        req,
        'STUDENTS_BULK_DELETED',
        'Student',
        `Bulk deleted ${deleteResult.count} student records and login accounts.`
      );

      res.status(200).json({
        success: true,
        message: `Successfully deleted ${deleteResult.count} student records.`,
        deletedCount: deleteResult.count
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Bulk Update Batch Year for Selected or All Students
   */
  public static async bulkUpdateBatch(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { studentIds, updateAll, batch, academicYear } = req.body;
      if (!batch || !batch.trim()) {
        res.status(400).json({ success: false, message: 'Batch Year (e.g. 2024-2028) is required.' });
        return;
      }

      const cleanBatch = batch.trim();
      const updateData: any = { batch: cleanBatch };
      if (academicYear) updateData.academicYear = academicYear.trim();

      const where: any = {};
      if (!updateAll) {
        if (!Array.isArray(studentIds) || studentIds.length === 0) {
          res.status(400).json({ success: false, message: 'Please select student records or specify updateAll.' });
          return;
        }
        where.id = { in: studentIds };
      }

      const updateResult = await prisma.student.updateMany({
        where,
        data: updateData
      });

      await AuditService.log(
        req,
        'STUDENTS_BATCH_UPDATED',
        'Student',
        `Updated batch year to [${cleanBatch}] for ${updateResult.count} students.`
      );

      res.status(200).json({
        success: true,
        message: `Successfully updated batch year to "${cleanBatch}" for ${updateResult.count} students.`,
        modifiedCount: updateResult.count
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}
