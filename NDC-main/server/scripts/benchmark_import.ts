import xlsx from 'xlsx';
import prisma from '../src/config/prisma';
import { ImportService } from '../src/services/ImportService';
import { comparePassword } from '../src/utils/passwordUtils';

interface BenchmarkMetric {
  batchSize: number;
  parseAndValidateTimeMs: number;
  dbExecutionTimeMs: number;
  totalTimeMs: number;
  inserted: number;
  skipped: number;
  failed: number;
  clearanceCount: number;
}

function createExcelBuffer(records: any[]): Buffer {
  const ws = xlsx.utils.json_to_sheet(records);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Students');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function runBenchmark() {
  console.log('====================================================');
  console.log('   NDC STUDENT BULK IMPORT BENCHMARK & VERIFICATION');
  console.log('====================================================\n');

  // Step 1: Pre-flight check & find a valid academic department
  const sampleDept = await prisma.clearanceDepartment.findFirst({
    where: { isActive: true, isAcademicBranch: true }
  });

  if (!sampleDept) {
    throw new Error('No active academic department found in database.');
  }

  console.log(`[Setup] Using active department: ${sampleDept.name} (${sampleDept.code})`);

  // Step 2: Test Validation Rules (Negative Testing)
  console.log('\n--- PHASE 1: Negative Validation Checks ---');
  const invalidRawRecords = [
    {
      USN: '', // Empty USN
      Name: 'No USN Student',
      Email: 'valid.email@example.com',
      Department: sampleDept.code,
      Semester: '8th Semester',
      'Academic Year': '2025-2026'
    },
    {
      USN: '4MC22IS999',
      Name: '', // Empty Name
      Email: 'valid2@example.com',
      Department: sampleDept.code,
      Semester: '8th Semester',
      'Academic Year': '2025-2026'
    },
    {
      USN: '4MC22IS998',
      Name: 'Bad Email Student',
      Email: 'not-an-email', // Bad email format
      Department: sampleDept.code,
      Semester: '8th Semester',
      'Academic Year': '2025-2026'
    },
    {
      USN: 'INVALID_USN_XYZ_123',
      Name: 'Bad USN Format',
      Email: 'valid4@example.com',
      Department: sampleDept.code,
      Semester: '8th Semester',
      'Academic Year': '2025-2026'
    }
  ];

  const invalidBuffer = createExcelBuffer(invalidRawRecords);
  const validationResult = await ImportService.parseAndValidate(invalidBuffer);

  console.log(`Total raw records submitted: ${validationResult.totalRecords}`);
  console.log(`Valid records: ${validationResult.validRecords}`);
  console.log(`Invalid records: ${validationResult.invalidRecords}`);

  if (validationResult.invalidRecords !== 4 || validationResult.validRecords !== 0) {
    throw new Error(`Validation test failed: expected 4 invalid records, got ${validationResult.invalidRecords}`);
  }
  console.log('✓ PASS: All 4 invalid records properly rejected with clear error messages:');
  for (const row of validationResult.rows) {
    console.log(`   - Row ${row.rowNumber} (${row.usn || 'No USN'}): ${row.errors.join(', ')}`);
  }

  // Helper to generate benchmark records
  function generateTestRecords(count: number, prefix: string, deptCode: string): any[] {
    const records: any[] = [];
    for (let i = 1; i <= count; i++) {
      const pad = String(i).padStart(4, '0');
      // Valid USN format: e.g. 4MC22IS followed by digits e.g. 4MC22IS8001
      records.push({
        USN: `${prefix}${pad}`,
        Name: `Benchmark Student ${pad}`,
        Email: `${prefix.toLowerCase()}${pad}@benchmark.test`,
        Department: deptCode,
        Semester: '8th Semester',
        'Academic Year': '2025-2026',
        Section: 'A',
        Batch: '2022-2026',
        Phone: '9876543210',
        'Admission Year': 2022,
        'Graduation Year': 2026
      });
    }
    return records;
  }

  const metrics: BenchmarkMetric[] = [];
  const testPrefixes: string[] = [];

  // Helper to run a benchmark batch
  async function runBatchBenchmark(size: number, prefix: string, deptCode: string): Promise<BenchmarkMetric> {
    testPrefixes.push(prefix);
    const rawRecords = generateTestRecords(size, prefix, deptCode);
    const buffer = createExcelBuffer(rawRecords);

    // Measure parsing and validation
    const vStart = Date.now();
    const valRes = await ImportService.parseAndValidate(buffer);
    const vTime = Date.now() - vStart;

    if (valRes.invalidRecords > 0) {
      console.error('Validation errors sample:', valRes.rows.filter(r => !r.isValid).slice(0, 3).map(r => ({ usn: r.usn, errors: r.errors })));
      throw new Error(`Unexpected validation errors in batch ${size}: ${valRes.invalidRecords} invalid records`);
    }

    // Measure DB execution
    const eStart = Date.now();
    const execRes = await ImportService.executeImport(valRes.rows);
    const eTime = Date.now() - eStart;

    // Check clearances created for this batch
    const createdUsns = rawRecords.map((r) => r.USN);
    const students = await prisma.student.findMany({
      where: { usn: { in: createdUsns } },
      select: { id: true }
    });
    const sIds = students.map((s) => s.id);
    const clearanceCount = await prisma.ndcClearance.count({
      where: { ndcRequest: { studentId: { in: sIds } } }
    });

    const metric: BenchmarkMetric = {
      batchSize: size,
      parseAndValidateTimeMs: vTime,
      dbExecutionTimeMs: eTime,
      totalTimeMs: vTime + eTime,
      inserted: execRes.imported,
      skipped: execRes.skipped,
      failed: execRes.failed,
      clearanceCount
    };

    metrics.push(metric);
    return metric;
  }

  console.log('\n--- PHASE 2: Execution Benchmarking ---');

  // Benchmark 1: 100 records
  console.log('\n[Benchmark 1] Running 100 records...');
  const m100 = await runBatchBenchmark(100, '4MC22IS8', 'IS');
  console.log(`✓ 100 records: Parse/Validate=${m100.parseAndValidateTimeMs}ms, DB Execution=${m100.dbExecutionTimeMs}ms, Total=${m100.totalTimeMs}ms`);
  console.log(`  Inserted: ${m100.inserted}, Skipped: ${m100.skipped}, Clearances: ${m100.clearanceCount} (${m100.clearanceCount / 100} per student)`);

  // Duplicate Check: Re-running identical 100 records
  console.log('\n[Duplicate Check] Re-running the identical 100 records to test duplicate detection...');
  const dupRecords = generateTestRecords(100, '4MC22IS8', 'IS');
  const dupBuffer = createExcelBuffer(dupRecords);
  const dValRes = await ImportService.parseAndValidate(dupBuffer);
  const dExecRes = await ImportService.executeImport(dValRes.rows);
  console.log(`  Duplicate Run Result: Total=${dExecRes.totalRows}, Inserted=${dExecRes.imported}, Skipped=${dExecRes.skipped}, Failed=${dExecRes.failed}`);
  if (dExecRes.imported !== 0 || dExecRes.skipped !== 100) {
    throw new Error(`Duplicate handling failed: expected 0 imported & 100 skipped, got ${dExecRes.imported} imported & ${dExecRes.skipped} skipped`);
  }
  console.log('✓ PASS: All 100 duplicate records correctly identified and skipped without error.');

  // Benchmark 2: 500 records
  console.log('\n[Benchmark 2] Running 500 records...');
  const m500 = await runBatchBenchmark(500, '4MC22CS7', 'CS');
  console.log(`✓ 500 records: Parse/Validate=${m500.parseAndValidateTimeMs}ms, DB Execution=${m500.dbExecutionTimeMs}ms, Total=${m500.totalTimeMs}ms`);
  console.log(`  Inserted: ${m500.inserted}, Skipped: ${m500.skipped}, Clearances: ${m500.clearanceCount} (${m500.clearanceCount / 500} per student)`);

  // Benchmark 3: 1,000 records
  console.log('\n[Benchmark 3] Running 1,000 records...');
  const m1000 = await runBatchBenchmark(1000, '4MC22EC6', 'EC');
  console.log(`✓ 1,000 records: Parse/Validate=${m1000.parseAndValidateTimeMs}ms, DB Execution=${m1000.dbExecutionTimeMs}ms, Total=${m1000.totalTimeMs}ms`);
  console.log(`  Inserted: ${m1000.inserted}, Skipped: ${m1000.skipped}, Clearances: ${m1000.clearanceCount} (${m1000.clearanceCount / 1000} per student)`);

  // Step 3: Verify Password & Student Authentication
  console.log('\n--- PHASE 3: Student Authentication & Password Verification ---');
  const sampleUsn = '4MC22EC60001';
  const testStudent = await prisma.student.findUnique({
    where: { usn: sampleUsn },
    include: { user: true }
  });

  if (!testStudent || !testStudent.user) {
    throw new Error(`Test student ${sampleUsn} was not found in database.`);
  }

  const isPasswordValid = await comparePassword(sampleUsn, testStudent.user.passwordHash);
  console.log(`Checking default password (${sampleUsn}) against stored hash (${testStudent.user.passwordHash.substring(0, 10)}...): ${isPasswordValid}`);
  if (!isPasswordValid) {
    throw new Error('Student password authentication failed with hashed password.');
  }
  console.log('✓ PASS: Student default password successfully authenticated against cost-4 bcrypt hash.');

  // Step 4: Cleanup
  console.log('\n--- PHASE 4: Database Cleanup of Synthetic Benchmark Data ---');
  let totalCleanedStudents = 0;
  for (const pfx of testPrefixes) {
    const sList = await prisma.student.findMany({
      where: { usn: { startsWith: pfx } },
      select: { id: true, user: { select: { id: true } } }
    });
    if (sList.length === 0) continue;

    const sIds = sList.map((s) => s.id);
    const uIds = sList.map((s) => s.user?.id).filter(Boolean) as string[];

    // Delete clearances
    const delClearances = await prisma.ndcClearance.deleteMany({
      where: { ndcRequest: { studentId: { in: sIds } } }
    });
    // Delete requests
    const delReqs = await prisma.ndcRequest.deleteMany({
      where: { studentId: { in: sIds } }
    });
    // Delete users
    const delUsers = await prisma.user.deleteMany({
      where: { id: { in: uIds } }
    });
    // Delete students
    const delStudents = await prisma.student.deleteMany({
      where: { id: { in: sIds } }
    });

    totalCleanedStudents += delStudents.count;
    console.log(`[Cleaned ${pfx}]: ${delStudents.count} students, ${delUsers.count} users, ${delReqs.count} requests, ${delClearances.count} clearances.`);
  }
  console.log(`✓ PASS: Cleaned all ${totalCleanedStudents} benchmark records. Database restored to pristine state.`);

  // Step 5: Summary & Extrapolation
  console.log('\n====================================================');
  console.log('               BENCHMARK SUMMARY');
  console.log('====================================================');
  console.log('| Batch Size | Parse/Validate | DB Execution | Total Time | Clearances |');
  console.log('|------------|----------------|--------------|------------|------------|');
  for (const m of metrics) {
    console.log(`| ${String(m.batchSize).padEnd(10)} | ${String(m.parseAndValidateTimeMs + 'ms').padEnd(14)} | ${String(m.dbExecutionTimeMs + 'ms').padEnd(12)} | ${String(m.totalTimeMs + 'ms').padEnd(10)} | ${String(m.clearanceCount).padEnd(10)} |`);
  }

  const timePerRecord1k = m1000.totalTimeMs / 1000;
  const estimated6kSeconds = ((m1000.totalTimeMs * 6) / 1000).toFixed(1);
  console.log('\n--- 6,000 RECORDS PROJECTION ---');
  console.log(`Average time per record (at 1k batch size): ${timePerRecord1k.toFixed(2)} ms/record`);
  console.log(`Estimated time for 6,000 records (6 batches of 1,000): ~${estimated6kSeconds} seconds`);
  console.log(`Target Window: 60 - 120 seconds`);
  if (Number(estimated6kSeconds) <= 120) {
    console.log(`✓ WITHIN TARGET: ${estimated6kSeconds}s is within the 60 - 120 second target window!`);
  } else {
    console.log(`⚠ SLIGHTLY EXCEEDS: ${estimated6kSeconds}s > 120s`);
  }
}

runBenchmark()
  .catch((err) => {
    console.error('Benchmark Error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
