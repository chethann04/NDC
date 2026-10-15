import prisma from '../src/config/prisma';
import { BackgroundJobService } from '../src/services/BackgroundJobService';
import { isSyntheticOrTestEmail, emailService } from '../src/services/EmailService';
import { ImportRow } from '../src/services/ImportService';

async function runHardeningTests() {
  console.log('====================================================');
  console.log('  NDC PRODUCTION HARDENING & BACKGROUND JOBS TEST');
  console.log('====================================================\n');

  // TEST 1: Synthetic Email Address Detection (RFC 2606 & Loadtest protection)
  console.log('--- TEST 1: Synthetic Test Email Detection ---');
  const syntheticCases = [
    { email: 'ndc-loadtest-0001@loadtest.invalid', expected: true },
    { email: 'student@example.com', expected: true },
    { email: 'user@test.invalid', expected: true },
    { email: 'mock@demo.ndc.local', expected: true },
    { email: 'student.22@mce.ac.in', expected: false },
    { email: 'rahul.sharma@gmail.com', expected: false }
  ];

  let synthPass = true;
  for (const c of syntheticCases) {
    const isSynth = isSyntheticOrTestEmail(c.email);
    console.log(`Checking [${c.email}]: isSynthetic = ${isSynth} (Expected: ${c.expected})`);
    if (isSynth !== c.expected) {
      synthPass = false;
      console.error(`✗ Mismatch for ${c.email}`);
    }
  }
  if (!synthPass) throw new Error('Test 1 failed: Synthetic email filter did not match expected values.');
  console.log('✓ PASS: Synthetic email filter correctly identifies test/loadtest domains without SMTP calls.\n');

  // TEST 2: Email Service Detailed Dispatch on Synthetic Address
  console.log('--- TEST 2: EmailService Skipping Synthetic Test Addresses ---');
  const synthDispatchResult = await emailService.sendMailDetailed(
    'ndc-loadtest-0001@loadtest.invalid',
    'Test Subject',
    '<p>Test</p>'
  );
  console.log('Dispatch result on synthetic address:', synthDispatchResult);
  if (!synthDispatchResult.success || !synthDispatchResult.skipped) {
    throw new Error('Test 2 failed: Expected sendMailDetailed to skip synthetic address cleanly.');
  }
  console.log('✓ PASS: Synthetic email dispatch cleanly skipped without throwing ETIMEDOUT or hanging.\n');

  // TEST 3: Background Job Creation and Asynchronous Execution
  console.log('--- TEST 3: Background Job Creation & Async Checkpointing ---');
  const activeDept = await prisma.clearanceDepartment.findFirst({
    where: { isActive: true, isAcademicBranch: true }
  });
  if (!activeDept) throw new Error('No active academic department found in DB.');

  const sampleRows: ImportRow[] = [];
  const testPrefix = '4MC22BG';
  for (let i = 1; i <= 50; i++) {
    const pad = String(i).padStart(4, '0');
    sampleRows.push({
      rowNumber: i,
      usn: `${testPrefix}${pad}`,
      fullName: `Background Test Student ${pad}`,
      email: `${testPrefix.toLowerCase()}${pad}@loadtest.invalid`, // Synthetic email
      phone: '9876543210',
      departmentCodeOrName: activeDept.code,
      section: 'A',
      batch: '2022-2026',
      academicYear: '2025-2026',
      semester: '8th Semester',
      year: '4th Year',
      admissionYear: 2022,
      graduationYear: 2026,
      isValid: true,
      isDuplicate: false,
      errors: [],
      departmentId: activeDept.id
    });
  }

  const job = await BackgroundJobService.createImportJob({
    rows: sampleRows,
    duplicateAction: 'SKIP',
    autoInitiateClearances: true
  });

  console.log(`Created Job ID: [${job.id}], Initial Status: [${job.status}], Total: [${job.totalRecords}]`);
  if (!job.id || job.status !== 'QUEUED') {
    throw new Error('Test 3 failed: Job was not properly queued.');
  }

  // Poll job until completed
  console.log('Waiting for background worker loop to process job...');
  let completedJob: any = null;
  const pollStart = Date.now();
  while (Date.now() - pollStart < 45000) {
    await new Promise((r) => setTimeout(r, 1000));
    const polled = await BackgroundJobService.getJobById(job.id);
    if (!polled) continue;

    console.log(`  Job [${job.id}] Status: ${polled.status} | Processed: ${polled.processedRecords}/${polled.totalRecords} | Inserted: ${polled.insertedRecords}`);
    if (polled.status === 'COMPLETED' || polled.status === 'PARTIALLY_COMPLETED' || polled.status === 'FAILED') {
      completedJob = polled;
      break;
    }
  }

  if (!completedJob || completedJob.status !== 'COMPLETED') {
    throw new Error(`Test 3 failed: Job did not complete successfully. Status: ${completedJob?.status}`);
  }

  console.log(`✓ PASS: Background job completed in ${((Date.now() - pollStart) / 1000).toFixed(1)}s!`);
  console.log(`  Inserted: ${completedJob.insertedRecords}, Skipped: ${completedJob.skippedRecords}, Failed: ${completedJob.failedRecords}`);
  if (completedJob.insertedRecords !== 50) {
    throw new Error(`Expected 50 inserted records, got ${completedJob.insertedRecords}`);
  }

  // TEST 4: Verification of Database Records & Clearances
  console.log('\n--- TEST 4: Verification of Created Records & Clearances ---');
  const createdStudents = await prisma.student.findMany({
    where: { usn: { startsWith: testPrefix } },
    select: { id: true, usn: true, ndcRequests: { include: { clearances: true } } }
  });
  console.log(`Found ${createdStudents.length} students in DB with prefix ${testPrefix}.`);
  if (createdStudents.length !== 50) {
    throw new Error(`Expected 50 students in DB, got ${createdStudents.length}`);
  }

  const totalClearances = createdStudents.reduce(
    (acc, s) => acc + (s.ndcRequests[0]?.clearances?.length || 0),
    0
  );
  console.log(`Total clearances created across 50 students: ${totalClearances} (${totalClearances / 50} per student)`);
  if (totalClearances !== 350) { // 7 clearances per student
    throw new Error(`Expected 350 clearances (7 per student), got ${totalClearances}`);
  }
  console.log('✓ PASS: All 50 students and 350 clearances verified in database.\n');

  // TEST 5: Stale Job Recovery Routine
  console.log('--- TEST 5: Stale Job Recovery on Server Restart ---');
  // Create an artificial stale running job with an old heartbeat
  const staleJob = await prisma.backgroundJob.create({
    data: {
      type: 'STUDENT_BULK_IMPORT',
      status: 'RUNNING',
      totalRecords: 100,
      processedRecords: 40,
      insertedRecords: 40,
      currentStage: 'IMPORTING',
      heartbeatAt: new Date(Date.now() - 10 * 60 * 1000) // 10 minutes ago
    }
  });

  const recoveredCount = await BackgroundJobService.recoverStaleJobs();
  console.log(`Recovered stale jobs count: ${recoveredCount}`);
  const postRecovered = await prisma.backgroundJob.findUnique({ where: { id: staleJob.id } });
  console.log(`Stale job status after recovery: ${postRecovered?.status}, Stage: ${postRecovered?.currentStage}`);

  if (postRecovered?.status !== 'PARTIALLY_COMPLETED' || postRecovered?.currentStage !== 'RECOVERED_AFTER_RESTART') {
    throw new Error('Test 5 failed: Stale job was not properly marked as recovered.');
  }
  console.log('✓ PASS: Stale job recovery routine successfully detected and marked orphaned job.\n');

  // CLEANUP
  console.log('--- Database Cleanup ---');
  // Clean test students, requests, clearances, users
  const sIds = createdStudents.map((s) => s.id);
  await prisma.ndcClearance.deleteMany({ where: { ndcRequest: { studentId: { in: sIds } } } });
  await prisma.ndcRequest.deleteMany({ where: { studentId: { in: sIds } } });
  await prisma.user.deleteMany({ where: { email: { contains: testPrefix.toLowerCase() } } });
  const delStudents = await prisma.student.deleteMany({ where: { id: { in: sIds } } });
  // Clean test background jobs
  await prisma.backgroundJob.deleteMany({
    where: { id: { in: [job.id, staleJob.id] } }
  });

  console.log(`Cleaned ${delStudents.count} test students and test background jobs.`);
  console.log('✓ PASS: Database restored to pristine state.\n');

  console.log('====================================================');
  console.log('   ALL 5 HARDENING & BACKGROUND TESTS PASSED!');
  console.log('====================================================');
}

runHardeningTests()
  .catch((err) => {
    console.error('Hardening Test Error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
