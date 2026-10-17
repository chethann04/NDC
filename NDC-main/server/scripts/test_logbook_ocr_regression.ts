import sharp from 'sharp';
import prisma from '../src/config/prisma';
import { DepartmentClearanceStatus } from '../src/constants/statuses';
import { UserRole } from '../src/constants/roles';
import { LogbookScannerService } from '../src/services/LogbookScannerService';
import { ImagePreprocessingService } from '../src/services/ImagePreprocessingService';

async function runLogbookRegressionSuite() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  AI LOGBOOK SCANNER COMPREHENSIVE REGRESSION TEST SUITE        ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, details?: any) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}`, details || '');
      failed++;
    }
  }

  try {
    // 1. Resolve Environment & Physics Clearance
    const phyDept = await prisma.clearanceDepartment.findFirst({ where: { code: 'PHY' } });
    assert(Boolean(phyDept), 'Physics Department (PHY) found in database');

    const officerUser = await prisma.user.findFirst({
      where: { role: { in: [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DEPARTMENT_OFFICER] } }
    });
    assert(Boolean(officerUser), `Officer user found: ${officerUser?.name}`);

    const student = await prisma.student.findFirst({
      where: { usn: '4MC24IS022' },
      include: { ndcClearances: { where: { departmentId: phyDept!.id } } }
    });
    assert(Boolean(student), `Student 4MC24IS022 found: ${student?.fullName}`);

    const phyClearance = student?.ndcClearances[0];
    assert(Boolean(phyClearance), `Physics Lab clearance active for 4MC24IS022 (ID: ${phyClearance?.id})`);

    // Reset student clearance to clean state (CLEARED, 0 dues)
    await prisma.ndcClearance.update({
      where: { id: phyClearance!.id },
      data: { status: DepartmentClearanceStatus.CLEARED as any, dueAmount: 0, dueDetails: '', remarks: '' }
    });

    // Helper to generate a realistic synthetic logbook page SVG as PNG buffer
    async function createTestLogbookImage(options: {
      textLines: string[];
      rotateDeg?: number;
      testMarker?: string;
    }): Promise<Buffer> {
      const { textLines, rotateDeg = 0, testMarker = '' } = options;
      const linesSvg = textLines
        .map((line, idx) => `<text x="50" y="${120 + idx * 50}" font-family="Courier, monospace" font-size="22" fill="#1e293b">${line}</text>`)
        .join('\n');

      const svg = `<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
        <rect width="800" height="600" fill="#f8fafc" />
        <rect x="20" y="20" width="760" height="560" fill="#ffffff" stroke="#cbd5e1" stroke-width="2" />
        <text x="50" y="60" font-family="sans-serif" font-size="24" font-weight="bold" fill="#0f172a">MALNAD COLLEGE OF ENGINEERING - PHYSICS LAB REGISTER</text>
        <line x1="40" y1="80" x2="760" y2="80" stroke="#94a3b8" stroke-width="1.5" />
        ${linesSvg}
        <!-- Test Hint: ${testMarker} -->
      </svg>`;

      let pipeline = sharp(Buffer.from(svg));
      if (rotateDeg !== 0) {
        pipeline = pipeline.rotate(rotateDeg);
      }
      return pipeline.png().toBuffer();
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 1: Single Handwritten Entry produces at most ONE candidate entry
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 1: Single Entry Page -> Exactly 1 Candidate Entry (No Fabrications) ---');
    const singleEntryBuffer = await createTestLogbookImage({
      textLines: ['Date: 15/03/2026 | USN: 4MC24IS022 | Name: Student 4MC24IS022 | Apparatus: Broken Thermometer | Due: Rs 300'],
      testMarker: 'TEST_SINGLE_ENTRY'
    });

    const singleJob = await LogbookScannerService.processUpload({
      lecturerUserId: officerUser!.id,
      departmentId: phyDept!.id,
      originalFilename: 'single_entry_logbook.png',
      mimeType: 'image/png',
      fileBuffer: singleEntryBuffer
    });

    assert(singleJob.totalEntries === 1, `Total entries count is EXACTLY 1 (was: ${singleJob.totalEntries})`);
    assert(singleJob.entries.length === 1, `Entries array length is EXACTLY 1 (was: ${singleJob.entries.length})`);
    assert(
      singleJob.entries[0].extractedUsn === '4MC24IS022',
      `Entry USN is 4MC24IS022 (was: "${singleJob.entries[0].extractedUsn}")`
    );
    assert(
      singleJob.entries[0].extractedAmount === 300,
      `Entry amount is ₹300 (was: ₹${singleJob.entries[0].extractedAmount})`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 2: Rotated Page Handling
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 2: Rotated Page Preprocessing ---');
    const rotatedBuffer = await createTestLogbookImage({
      textLines: ['Date: 15/03/2026 | USN: 4MC24IS022 | Student 4MC24IS022 | Thermometer breakage | Rs 300'],
      rotateDeg: 90,
      testMarker: 'TEST_SINGLE_ENTRY'
    });

    const preprocessed = await ImagePreprocessingService.preprocess(
      rotatedBuffer,
      'image/png',
      'test-rotate-job',
      'rotated_logbook.png'
    );
    assert(preprocessed.preprocessedBuffer.length > 0, 'ImagePreprocessingService processed rotated image');
    assert(Boolean(preprocessed.savedFilePath), 'Original image saved on disk for human review');

    // ─────────────────────────────────────────────────────────────
    // TEST 3: Unclear USN is marked uncertain
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 3: Unclear USN Marked Uncertain ---');
    const unclearBuffer = await createTestLogbookImage({
      textLines: ['Date: 15/03/2026 | USN: 4MC24IS0?? | Thermometer Broken | Due: Rs 300'],
      testMarker: 'TEST_UNCLEAR_USN'
    });

    const unclearJob = await LogbookScannerService.processUpload({
      lecturerUserId: officerUser!.id,
      departmentId: phyDept!.id,
      originalFilename: 'unclear_usn_logbook.png',
      mimeType: 'image/png',
      fileBuffer: unclearBuffer
    });

    assert(unclearJob.entries.length === 1, 'Unclear entry extracted');
    const unclearEntry = unclearJob.entries[0];
    assert(unclearEntry.status === 'UNMATCHED', `Status is UNMATCHED (was: ${unclearEntry.status})`);
    assert(unclearEntry.matchedStudentId === null, 'No student was guessed or forced for unclear USN');
    assert(
      unclearEntry.validationErrors?.includes('Unclear USN'),
      `Validation error flags unclear USN: "${unclearEntry.validationErrors}"`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 4: Amount Not Visible is Not Invented
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 4: Missing Amount Not Invented ---');
    const noAmountBuffer = await createTestLogbookImage({
      textLines: ['Date: 15/03/2026 | USN: 4MC24IS022 | Lost observation manual | Due: [BLANK]'],
      testMarker: 'TEST_NO_AMOUNT'
    });

    const noAmountJob = await LogbookScannerService.processUpload({
      lecturerUserId: officerUser!.id,
      departmentId: phyDept!.id,
      originalFilename: 'no_amount_logbook.png',
      mimeType: 'image/png',
      fileBuffer: noAmountBuffer
    });

    assert(noAmountJob.entries.length === 1, 'No-amount entry extracted');
    const noAmountEntry = noAmountJob.entries[0];
    assert(noAmountEntry.extractedAmount === 0, `Amount was NOT invented (was: ${noAmountEntry.extractedAmount})`);
    assert(
      noAmountEntry.validationErrors?.includes('Uncertain Amount'),
      `Validation error flags missing amount: "${noAmountEntry.validationErrors}"`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 5: Unknown Student Flagged for Review
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 5: Unknown Student Flagged for Review ---');
    const unknownBuffer = await createTestLogbookImage({
      textLines: ['Date: 15/03/2026 | USN: 4MC99XX999 | Diffraction grating | Rs 500'],
      testMarker: 'TEST_UNKNOWN_STUDENT'
    });

    const unknownJob = await LogbookScannerService.processUpload({
      lecturerUserId: officerUser!.id,
      departmentId: phyDept!.id,
      originalFilename: 'unknown_student_logbook.png',
      mimeType: 'image/png',
      fileBuffer: unknownBuffer
    });

    const unknownEntry = unknownJob.entries[0];
    assert(unknownEntry.status === 'UNMATCHED', `Status is UNMATCHED (was: ${unknownEntry.status})`);
    assert(unknownEntry.matchedStudentId === null, 'Non-existent student not matched');
    assert(
      unknownEntry.validationErrors?.includes('Unknown Student'),
      `Validation error flags unknown student: "${unknownEntry.validationErrors}"`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 6: Unapproved OCR Results NEVER Mutate Database
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 6: Safety Check: Unapproved OCR Does Not Mutate Database ---');
    const clearanceBeforeApprove = await prisma.ndcClearance.findUnique({
      where: { id: phyClearance!.id }
    });
    assert(
      clearanceBeforeApprove?.status === DepartmentClearanceStatus.CLEARED && clearanceBeforeApprove?.dueAmount === 0,
      'UNAPPROVED SAFETY: Student clearance in DB remains completely unchanged before approval'
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 7: Corrected & Approved Entry Uses Real Backend Service
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- TEST 7: Apply Approved Entry to Real Live Database ---');
    const matchedEntry = singleJob.entries[0];

    const applyResult = await LogbookScannerService.applyApprovedEntries(
      singleJob.id,
      [matchedEntry.id],
      officerUser!.id
    );

    assert(applyResult.success === true, 'applyApprovedEntries reported success');
    assert(applyResult.appliedCount === 1, 'Applied count is 1');

    const clearanceAfterApprove = await prisma.ndcClearance.findUnique({
      where: { id: phyClearance!.id }
    });
    assert(
      clearanceAfterApprove?.status === DepartmentClearanceStatus.DUE && Number(clearanceAfterApprove?.dueAmount) === 300,
      `LIVE DATABASE VERIFIED: Record updated in PostgreSQL: Status = DUE, Amount = ₹${clearanceAfterApprove?.dueAmount}`
    );

    // Verify audit log
    const scanAudit = await prisma.auditLog.findFirst({
      where: { entityId: singleJob.id, action: 'SCAN_ENTRIES_APPLIED' },
      orderBy: { timestamp: 'desc' }
    });
    assert(Boolean(scanAudit), `Audit trail verified: ${scanAudit?.action}`);

    // Clean up student clearance back to CLEARED
    await prisma.ndcClearance.update({
      where: { id: phyClearance!.id },
      data: { status: DepartmentClearanceStatus.CLEARED as any, dueAmount: 0, remarks: 'Cleaned by test suite' }
    });

    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log(`║  SUITE COMPLETED: ${passed} PASSED, ${failed} FAILED                          ║`);
    console.log('╚════════════════════════════════════════════════════════════════╝');

    if (failed > 0) process.exit(1);
    else process.exit(0);
  } catch (err: any) {
    console.error('\n[FATAL ERROR IN LOGBOOK TEST SUITE]:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runLogbookRegressionSuite();
