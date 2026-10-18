import prisma from '../src/config/prisma';
import { LogbookScannerService } from '../src/services/LogbookScannerService';
import { DepartmentClearanceStatus } from '../src/constants/statuses';

async function runLibraryRegisterScannerTests() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  NDC CENTRAL LIBRARY REGISTER SCANNER VERIFICATION SUITE       ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, desc: string) {
    total++;
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc}`);
      process.exitCode = 1;
    }
  }

  // 1. SETUP: Resolve Central Library Dept, Officer, and Target Student
  console.log('--- SETUP: Resolving Central Library, Officer, and Student 4MC24IS022 ---');
  const libDept = await prisma.clearanceDepartment.findFirst({
    where: { code: 'LIB' }
  });
  assert(Boolean(libDept), 'Central Library Department (LIB) exists in database');
  if (!libDept) return;

  const libOfficer = await prisma.user.findFirst({
    where: {
      OR: [
        { email: 'library@mce.ac.in' },
        { loginId: 'LIB001' },
        { departmentId: libDept.id }
      ]
    }
  }) || await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });

  assert(Boolean(libOfficer), `Central Library officer resolved: ${libOfficer?.name} (${libOfficer?.email})`);
  if (!libOfficer) return;

  const targetStudent = await prisma.student.findFirst({
    where: { usn: '4MC24IS022' }
  });
  assert(Boolean(targetStudent), `Target student 4MC24IS022 resolved: ${targetStudent?.fullName}`);
  if (!targetStudent) return;

  // Ensure student has a Central Library clearance record
  let libClearance = await prisma.ndcClearance.findFirst({
    where: {
      studentId: targetStudent.id,
      departmentId: libDept.id
    }
  });

  if (!libClearance) {
    const ndcReq = await prisma.ndcRequest.findFirst({
      where: { studentId: targetStudent.id }
    });
    if (ndcReq) {
      libClearance = await prisma.ndcClearance.create({
        data: {
          ndcRequestId: ndcReq.id,
          studentId: targetStudent.id,
          departmentId: libDept.id,
          status: DepartmentClearanceStatus.PENDING,
          dueAmount: 0
        }
      });
    }
  }

  assert(Boolean(libClearance), `Student Central Library clearance record active (ID: ${libClearance?.id})`);
  if (!libClearance) return;

  // Reset clearance to 0 dues for clean test baseline
  await prisma.ndcClearance.update({
    where: { id: libClearance.id },
    data: {
      dueAmount: 0,
      dueDetails: null,
      status: DepartmentClearanceStatus.PENDING
    }
  });

  // 2. TEST: Upload and Process Central Library Register
  console.log('\n--- TEST 1: Scanning Central Library Circulation Register ---');
  // Create a 1x1 dummy PNG buffer
  const dummyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  const scanJob = await LogbookScannerService.processUpload({
    lecturerUserId: libOfficer.id,
    departmentId: libDept.id,
    originalFilename: 'central_library_overdue_register_test.png',
    mimeType: 'image/png',
    fileBuffer: dummyPng
  });

  assert(Boolean(scanJob && scanJob.id), 'Library ScanJob created successfully in database');
  assert(scanJob.departmentId === libDept.id, 'ScanJob is scoped to Central Library department ID');
  assert(Array.isArray(scanJob.entries) && scanJob.entries.length >= 1, `Extracted ${scanJob.entries.length} entries from library register`);

  const entry = scanJob.entries.find((e: any) => (e.extractedUsn || e.correctedUsn) === '4MC24IS022');
  assert(Boolean(entry), 'Extracted entry for target student 4MC24IS022');
  if (!entry) return;

  assert(Number(entry.extractedAmount) === 150, `Extracted library due amount is ₹150 (got ₹${entry.extractedAmount})`);
  assert(
    entry.extractedReason.toLowerCase().includes('textbook') || entry.extractedReason.toLowerCase().includes('physics'),
    `Extracted library reason is textbook fine (got "${entry.extractedReason}")`
  );
  assert(entry.matchedStudentId === targetStudent.id, 'Entry matched student ID in institutional database');
  assert(entry.clearanceId === libClearance.id, 'Entry matched student Central Library clearance record');
  assert(entry.status === 'MATCHED', `Entry status is MATCHED (got ${entry.status})`);

  // 3. TEST: Zero live database clearance mutation before applying
  console.log('\n--- TEST 2: Zero Database Mutation Prior to Approval ---');
  const preCheckClearance = await prisma.ndcClearance.findUnique({
    where: { id: libClearance.id }
  });
  assert(Number(preCheckClearance?.dueAmount) === 0, 'Target student Central Library dueAmount remains ₹0 before approval');
  assert(preCheckClearance?.status === 'PENDING', 'Clearance status remains PENDING prior to approval');

  // 4. TEST: Edit Extracted Entry (Correct fine amount or book title)
  console.log('\n--- TEST 3: Editing Library Register Entry Prior to Approval ---');
  const updatedEntry = await LogbookScannerService.updateEntry({
    entryId: entry.id,
    correctedAmount: 200,
    correctedReason: 'Engineering Physics Vol 1 - Overdue 45 days',
    lecturerUserId: libOfficer.id
  });

  assert(Number(updatedEntry.correctedAmount) === 200, 'Successfully updated library fine amount to ₹200');
  assert(
    updatedEntry.correctedReason === 'Engineering Physics Vol 1 - Overdue 45 days',
    'Successfully updated library book title / reason'
  );

  // 5. TEST: Apply Approved Library Due to Database
  console.log('\n--- TEST 4: Applying Approved Library Due to Live Database ---');
  const applyResult = await LogbookScannerService.applyApprovedEntries(
    scanJob.id,
    [entry.id],
    libOfficer.id
  );

  assert(applyResult.appliedCount === 1, 'applyApprovedEntries reported appliedCount === 1');
  assert(applyResult.results?.[0]?.status === 'SUCCESS', 'Entry status in applyResult is SUCCESS');

  // 6. TEST: Verify Database State After Applying Due
  console.log('\n--- TEST 5: Verifying Committed Database State ---');
  const postCheckClearance = await prisma.ndcClearance.findUnique({
    where: { id: libClearance.id }
  });

  assert(Number(postCheckClearance?.dueAmount) === 200, `Committed Central Library due amount is ₹200 (found ₹${postCheckClearance?.dueAmount})`);
  assert(postCheckClearance?.status === 'DUE', `Committed clearance status is DUE (found ${postCheckClearance?.status})`);

  // 7. TEST: Idempotency Protection (Applying same entry twice should skip)
  console.log('\n--- TEST 6: Idempotency Protection Against Duplicate Writes ---');
  const secondApplyResult = await LogbookScannerService.applyApprovedEntries(
    scanJob.id,
    [entry.id],
    libOfficer.id
  );

  assert(secondApplyResult.skippedCount === 1, 'Second apply correctly skipped already applied entry');
  assert(secondApplyResult.appliedCount === 0, 'Zero duplicate dues applied on replay');

  const idempotencyClearance = await prisma.ndcClearance.findUnique({
    where: { id: libClearance.id }
  });
  assert(Number(idempotencyClearance?.dueAmount) === 200, 'Due amount was not doubled or corrupted on replay');

  // 8. CLEANUP: Reset student's clearance
  await prisma.ndcClearance.update({
    where: { id: libClearance.id },
    data: {
      dueAmount: 0,
      dueDetails: null,
      status: DepartmentClearanceStatus.CLEARED
    }
  });

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log(`TOTAL TESTS: ${total} | PASSED: ${passed} | FAILED: ${total - passed}`);
  console.log('════════════════════════════════════════════════════════════════\n');

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runLibraryRegisterScannerTests().catch((err) => {
  console.error('[Library Scanner Test Error]:', err);
  process.exit(1);
});
