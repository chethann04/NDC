import crypto from 'crypto';
import xlsx from 'xlsx';
import bcrypt from 'bcryptjs';
import prisma from '../config/prisma';
import { UserRole } from '../constants/roles';
import { normalizeUsn } from '../utils/usnNormalizer';
import { AuditService } from './AuditService';
import { hashPassword } from '../utils/passwordUtils';

export interface ImportRow {
  rowNumber: number;
  usn: string;
  fullName: string;
  email: string;
  phone: string;
  departmentCodeOrName: string;
  detectedDepartmentCode?: string;
  detectedDepartmentName?: string;
  section: string;
  batch: string;
  academicYear: string;
  semester: string;
  year: string;
  admissionYear: number;
  graduationYear: number;
  isValid: boolean;
  isDuplicate: boolean;
  errors: string[];
  departmentId?: string;
}

export interface PreviewResult {
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  duplicateRecords: number;
  rows: ImportRow[];
}

export class ImportService {
  /**
   * Parse uploaded buffer (XLSX / XLS / CSV), normalize, validate, and check for duplicates.
   */
  public static async parseAndValidate(buffer: Buffer): Promise<PreviewResult> {
    const { resolveDepartmentFromUsn } = await import('../utils/usnDepartmentResolver');
    const existingDepts = await prisma.clearanceDepartment.findMany();
    const deptMapByCode = new Map<string, any>(
      existingDepts.map((d) => [d.code.toUpperCase().trim(), d])
    );
    const deptMapByName = new Map<string, any>(
      existingDepts.map((d) => [d.name.toLowerCase().trim(), d])
    );

    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Auto-detect header row (in case title rows exist above header)
    const rawMatrix: any[][] = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    let headerRowIndex = 0;
    for (let r = 0; r < Math.min(10, rawMatrix.length); r++) {
      const rowStr = rawMatrix[r].map((cell: any) => String(cell).toUpperCase().trim()).join(' ');
      if (rowStr.includes('USN') || rowStr.includes('STUDENT NAME') || rowStr.includes('SL.NO')) {
        headerRowIndex = r;
        break;
      }
    }

    const rawRows: any[] = xlsx.utils.sheet_to_json(worksheet, { range: headerRowIndex, defval: '' });

    const parsedRows: ImportRow[] = [];
    const usnSet = new Set<string>();

    for (let i = 0; i < rawRows.length; i++) {
      const raw = rawRows[i];
      const rowNum = headerRowIndex + i + 2; // Real Excel row number

      const rawUsn = raw['USN'] || raw['usn'] || raw['University Seat No'] || raw['Usn'] || '';
      const rawName = raw['STUDENT NAME'] || raw['Student Name'] || raw['fullName'] || raw['Name'] || raw['Full Name'] || '';
      const rawEmail = raw['EMAIL'] || raw['Email'] || raw['email'] || '';
      const rawPhone = raw['Phone'] || raw['phone'] || raw['Mobile'] || '';
      const rawDept = raw['DEPARTMENT'] || raw['Department'] || raw['department'] || raw['Dept'] || raw['STREAM'] || '';
      const rawBatch = raw['BATCH'] || raw['Batch'] || raw['batch'] || '';
      const rawAcadYear = raw['ACADEMIC YEAR'] || raw['Academic Year'] || raw['academicYear'] || '';
      const rawSem = raw['SEMESTER'] || raw['Semester'] || raw['semester'] || '8th Semester';
      const rawYear = raw['YEAR'] || raw['Year'] || raw['year'] || '4th Year';

      const normalizedUsn = normalizeUsn(String(rawUsn));
      const normalizedEmail = String(rawEmail).trim().toLowerCase();
      const normalizedName = String(rawName).trim();

      // Dynamic Batch calculation if not provided in Excel
      let finalBatch = String(rawBatch).trim();
      let finalAdmYear = parseInt(raw['Admission Year'] || raw['admissionYear'] || '0', 10);
      let finalGradYear = parseInt(raw['Graduation Year'] || raw['graduationYear'] || '0', 10);

      if (!finalBatch && normalizedUsn) {
        const usnMatch = normalizedUsn.match(/4MC(\d{2})/i);
        if (usnMatch) {
          const admYr = 2000 + parseInt(usnMatch[1], 10);
          finalAdmYear = finalAdmYear || admYr;
          finalGradYear = finalGradYear || (admYr + 4);
          finalBatch = `${admYr}-${admYr + 4}`;
        }
      }
      if (!finalBatch) finalBatch = '2022-2026';
      if (!finalAdmYear) finalAdmYear = 2022;
      if (!finalGradYear) finalGradYear = 2026;
      const finalAcadYear = rawAcadYear || `${finalGradYear - 1}-${finalGradYear}`;

      const errors: string[] = [];

      if (!normalizedUsn) errors.push('USN is required.');
      if (!normalizedName) errors.push('Student Name is required.');
      if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        errors.push('Valid Email address is required.');
      }

      // Automatic USN-based Department Identification
      const deptRes = resolveDepartmentFromUsn(normalizedUsn);
      const detectedDeptCode = deptRes.code || 'UNKNOWN';
      const detectedDeptName = deptRes.name || 'UNKNOWN_DEPARTMENT';
      let deptDbId: string | undefined;

      if (!deptRes.success || !deptRes.name) {
        errors.push('Unable to determine the department from this USN.');
      } else {
        const dCode = (deptRes.code || '').toUpperCase().trim();
        const dName = deptRes.name.toLowerCase().trim();
        let dept = deptMapByCode.get(dCode) || deptMapByName.get(dName);

        if (!dept) {
          dept = await prisma.clearanceDepartment.create({
            data: {
              code: deptRes.code!,
              name: deptRes.name,
              description: `${deptRes.name} Academic Branch Department (HOD)`,
              requiresClearance: true,
              isAcademicBranch: true,
              displayOrder: 10,
              isActive: true
            }
          });
          deptMapByCode.set(dCode, dept);
          deptMapByName.set(dName, dept);
        }
        deptDbId = dept.id;

        // If Excel already contains a Department column, compare USN-derived vs Excel supplied
        const userProvidedDept = String(rawDept).trim();
        if (userProvidedDept) {
          const isEquivalent = areDepartmentNamesEquivalent(deptRes.name, userProvidedDept, deptRes.code || '');
          if (!isEquivalent) {
            errors.push(`The department derived from the USN [${deptRes.name}] does not match the supplied department [${userProvidedDept}].`);
          }
        }
      }

      // File-internal duplicate USN check
      if (normalizedUsn) {
        if (usnSet.has(normalizedUsn)) {
          errors.push(`Duplicate USN [${normalizedUsn}] within file.`);
        } else {
          usnSet.add(normalizedUsn);
        }
      }

      parsedRows.push({
        rowNumber: rowNum,
        usn: normalizedUsn,
        fullName: normalizedName,
        email: normalizedEmail,
        phone: String(rawPhone).trim(),
        departmentCodeOrName: detectedDeptName,
        detectedDepartmentCode: detectedDeptCode,
        detectedDepartmentName: detectedDeptName,
        section: String(raw['SECTION'] || raw['Section'] || raw['section'] || 'A').trim().toUpperCase(),
        batch: finalBatch,
        academicYear: finalAcadYear,
        semester: String(rawSem).trim(),
        year: String(rawYear).trim(),
        admissionYear: finalAdmYear,
        graduationYear: finalGradYear,
        isValid: errors.length === 0,
        isDuplicate: false,
        errors,
        departmentId: deptDbId
      });
    }

    // Check DB for existing USNs
    const validUsns = parsedRows.filter((r) => r.usn).map((r) => r.usn);
    const existingStudents = await prisma.student.findMany({
      where: { usn: { in: validUsns } },
      select: { usn: true }
    });
    const existingUsnSet = new Set(existingStudents.map((s) => s.usn));

    let validCount = 0;
    let invalidCount = 0;
    let duplicateCount = 0;

    parsedRows.forEach((row) => {
      if (row.usn && existingUsnSet.has(row.usn)) {
        row.isDuplicate = true;
        row.errors.push(`USN [${row.usn}] already exists in database.`);
        duplicateCount++;
      }

      if (row.errors.length > 0) {
        row.isValid = false;
        invalidCount++;
      } else {
        row.isValid = true;
        validCount++;
      }
    });

    return {
      totalRecords: parsedRows.length,
      validRecords: validCount,
      invalidRecords: invalidCount,
      duplicateRecords: duplicateCount,
      rows: parsedRows
    };
  }

  /**
   * Confirm and execute database import.
   * duplicateAction: 'SKIP' | 'UPDATE'
   */
  public static async executeImport(
    rows: ImportRow[],
    duplicateAction: 'SKIP' | 'UPDATE' = 'SKIP',
    adminUserId?: string,
    reqObj?: any
  ): Promise<{
    totalRows: number;
    imported: number;
    skipped: number;
    updated: number;
    failed: number;
    errorReport: any[];
  }> {
    let imported = 0;
    let skipped = 0;
    let updated = 0;
    let failed = 0;
    const errorReport: any[] = [];

    // 1. Batch pre-resolve all departments upfront in a single DB query
    const { resolveDepartmentFromUsn } = await import('../utils/usnDepartmentResolver');
    const existingDepts = await prisma.clearanceDepartment.findMany();
    const deptMapByCode = new Map<string, string>(
      existingDepts.map((d) => [d.code.toUpperCase().trim(), d.id])
    );
    const deptMapByName = new Map<string, string>(
      existingDepts.map((d) => [d.name.toLowerCase().trim(), d.id])
    );

    const validRows: ImportRow[] = [];

    for (const row of rows) {
      if (!row.usn || !row.fullName || !row.email) {
        failed++;
        errorReport.push({
          row: row.rowNumber,
          usn: row.usn || 'N/A',
          fullName: row.fullName || 'N/A',
          errorReason: row.errors?.join('; ') || 'Missing critical fields (USN, Name, or Email).'
        });
        continue;
      }

      if (!row.departmentId) {
        const deptRes = resolveDepartmentFromUsn(row.usn);
        if (deptRes.success && deptRes.code) {
          const dCode = deptRes.code.toUpperCase().trim();
          const dName = (deptRes.name || '').toLowerCase().trim();
          let cachedDeptId = deptMapByCode.get(dCode) || deptMapByName.get(dName);
          if (cachedDeptId) {
            row.departmentId = cachedDeptId;
          } else {
            // Create department atomically if not in cache
            const newDept = await prisma.clearanceDepartment.create({
              data: {
                code: deptRes.code,
                name: deptRes.name || deptRes.code,
                description: `${deptRes.name} Academic Branch Department (HOD)`,
                requiresClearance: true,
                isAcademicBranch: true,
                displayOrder: 10,
                isActive: true
              }
            });
            deptMapByCode.set(dCode, newDept.id);
            deptMapByName.set(dName, newDept.id);
            row.departmentId = newDept.id;
          }
        }
      }

      if (!row.departmentId) {
        failed++;
        errorReport.push({
          row: row.rowNumber,
          usn: row.usn,
          fullName: row.fullName,
          errorReason: 'Unable to determine department from USN.'
        });
        continue;
      }

      validRows.push(row);
    }

    if (validRows.length === 0) {
      return { totalRows: rows.length, imported, skipped, updated, failed, errorReport };
    }

    const { NdcWorkflowService } = await import('./NdcWorkflowService');

    // Process records in batches of 500
    const CHUNK_SIZE = 500;
    for (let c = 0; c < validRows.length; c += CHUNK_SIZE) {
      const chunk = validRows.slice(c, c + CHUNK_SIZE);
      const usnList = chunk.map((r) => r.usn);
      const emailList = chunk.map((r) => r.email.toLowerCase().trim());

      const [existingStudents, existingUsers] = await Promise.all([
        prisma.student.findMany({ where: { usn: { in: usnList } } }),
        prisma.user.findMany({ where: { email: { in: emailList } } })
      ]);

      const studentMap = new Map<string, any>(existingStudents.map((s) => [s.usn, s]));
      const userMap = new Map<string, any>(existingUsers.map((u) => [u.email, u]));

      const toInsert: ImportRow[] = [];
      const toUpdate: ImportRow[] = [];

      for (const row of chunk) {
        const existingStudent = studentMap.get(row.usn);
        if (existingStudent) {
          if (duplicateAction === 'SKIP') {
            skipped++;
            errorReport.push({
              row: row.rowNumber,
              usn: row.usn,
              fullName: row.fullName,
              errorReason: 'Skipped: Duplicate USN already exists in database.'
            });
          } else if (duplicateAction === 'UPDATE') {
            toUpdate.push(row);
          }
        } else {
          toInsert.push(row);
        }
      }

      const affectedStudentIdsInChunk: string[] = [];

      // Bulk INSERT with prisma.student.createMany & prisma.user.createMany
      if (toInsert.length > 0) {
        // Parallel password hashing across worker threads
        const uniqueUsns = Array.from(new Set(toInsert.map((r) => r.usn)));
        const passwordHashMap = new Map<string, string>();
        const HASH_BATCH = 15;
        for (let h = 0; h < uniqueUsns.length; h += HASH_BATCH) {
          const usnSlice = uniqueUsns.slice(h, h + HASH_BATCH);
          const hashes = await Promise.all(
            usnSlice.map((u) => hashPassword(String(u || '123456')))
          );
          usnSlice.forEach((u, idx) => passwordHashMap.set(u, hashes[idx]));
        }

        const newStudentsData: any[] = [];
        const newUsersData: any[] = [];

        for (const row of toInsert) {
          const generatedId = crypto.randomUUID();
          const studentId = `STU-${row.usn}`;

          newStudentsData.push({
            id: generatedId,
            studentId,
            usn: row.usn,
            fullName: row.fullName,
            email: row.email,
            phone: row.phone || '',
            departmentId: row.departmentId!,
            section: row.section || 'A',
            batch: row.batch || '2022-2026',
            academicYear: row.academicYear || '2025-2026',
            semester: row.semester || '8th Semester',
            year: row.year || '4th Year',
            admissionYear: row.admissionYear || 2022,
            graduationYear: row.graduationYear || 2026,
            isActive: true
          });

          affectedStudentIdsInChunk.push(generatedId);

          if (!userMap.has(row.email)) {
            const usnHash = passwordHashMap.get(row.usn) || (await hashPassword(String(row.usn)));
            newUsersData.push({
              id: crypto.randomUUID(),
              email: row.email,
              passwordHash: usnHash,
              role: UserRole.STUDENT as any,
              name: row.fullName,
              associatedStudentId: generatedId,
              isActive: true,
              mustChangePassword: true
            });
            // Mark email as allocated in userMap so subsequent entries with the same email don't duplicate
            userMap.set(row.email, true);
          }
        }

        // Bulk insert students in 1 high-speed query
        const studentInsertRes = await prisma.student.createMany({
          data: newStudentsData,
          skipDuplicates: true
        });
        imported += studentInsertRes.count || newStudentsData.length;

        // Bulk insert users in 1 high-speed query
        if (newUsersData.length > 0) {
          await prisma.user.createMany({
            data: newUsersData,
            skipDuplicates: true
          });
        }
      }

      // Bulk UPDATE in transaction batches
      if (toUpdate.length > 0) {
        const UPDATE_BATCH = 50;
        for (let u = 0; u < toUpdate.length; u += UPDATE_BATCH) {
          const updateSlice = toUpdate.slice(u, u + UPDATE_BATCH);
          const ops: any[] = [];

          for (const row of updateSlice) {
            const existingStudent = studentMap.get(row.usn);
            if (!existingStudent) continue;

            ops.push(
              prisma.student.update({
                where: { id: existingStudent.id },
                data: {
                  fullName: row.fullName,
                  email: row.email,
                  phone: row.phone,
                  departmentId: row.departmentId!,
                  section: row.section,
                  batch: row.batch,
                  academicYear: row.academicYear,
                  semester: row.semester,
                  year: row.year,
                  admissionYear: row.admissionYear,
                  graduationYear: row.graduationYear
                }
              })
            );

            const existingUser = userMap.get(row.email);
            if (existingUser && typeof existingUser === 'object' && existingUser.id) {
              ops.push(
                prisma.user.update({
                  where: { id: existingUser.id },
                  data: { email: row.email, name: row.fullName }
                })
              );
            }

            affectedStudentIdsInChunk.push(existingStudent.id);
          }

          if (ops.length > 0) {
            await prisma.$transaction(ops);
          }
          updated += updateSlice.length;
        }
      }

      // Batch workflow creation for this chunk
      if (affectedStudentIdsInChunk.length > 0) {
        await NdcWorkflowService.ensureStudentNdcRequestsBulk(affectedStudentIdsInChunk, reqObj);
      }
    }

    await AuditService.log(
      reqObj || null,
      'STUDENT_IMPORTED',
      'Student',
      `Bulk student import completed: ${imported} imported, ${updated} updated, ${skipped} skipped, ${failed} failed. Total processed: ${rows.length}.`,
      adminUserId
    );

    return {
      totalRows: rows.length,
      imported,
      skipped,
      updated,
      failed,
      errorReport
    };
  }
}

/**
 * Smart equivalence comparison between USN-derived department and user-supplied Excel department string.
 */
export function areDepartmentNamesEquivalent(derivedName: string, suppliedName: string, code: string): boolean {
  if (!derivedName || !suppliedName) return true;

  const normalizeStr = (str: string) =>
    str
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/engg/g, 'engineering')
      .replace(/dept\.?|department|branch/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/s\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const nDerived = normalizeStr(derivedName);
  const nSupplied = normalizeStr(suppliedName);
  const nCode = (code || '').toLowerCase().trim();

  if (nDerived === nSupplied) return true;
  if (nCode && (nSupplied === nCode || nSupplied.includes(nCode))) return true;
  if (nDerived.includes(nSupplied) || nSupplied.includes(nDerived)) return true;

  const stopWords = new Set(['and', 'of', 'in', '&', 'the']);
  const derivedTokens = nDerived.split(' ').filter((w) => w.length > 1 && !stopWords.has(w));
  const suppliedTokens = nSupplied.split(' ').filter((w) => w.length > 1 && !stopWords.has(w));

  if (derivedTokens.length === 0 || suppliedTokens.length === 0) return true;

  let matchCount = 0;
  for (const token of suppliedTokens) {
    if (derivedTokens.some((dt) => dt.includes(token) || token.includes(dt))) {
      matchCount++;
    }
  }

  const ratio = matchCount / Math.min(derivedTokens.length, suppliedTokens.length);
  return ratio >= 0.5 || matchCount >= 2;
}
