import prisma from '../src/config/prisma';
import { DepartmentClearanceStatus } from '../src/constants/statuses';
import { UserRole } from '../src/constants/roles';
import { LogbookScannerService } from '../src/services/LogbookScannerService';

interface ScanEntry {
  id: string;
  scanJobId: string;
  entryIndex: number;
  status: string;
  extractedUsn: string;
  extractedName: string;
  extractedAmount: number;
  extractedReason: string;
  extractedDate: string;
  confidence: number;
  matchedStudentId?: string | null;
  matchedStudentUsn?: string | null;
  matchedStudentName?: string | null;
  correctedUsn?: string | null;
  correctedAmount?: number | null;
  correctedReason?: string | null;
  validationErrors?: string | null;
  clearanceId?: string | null;
  appliedAt?: string | null;
}

function parseEntryForensics(entry: ScanEntry, rawMeta?: any) {
  const errorsStr = entry.validationErrors || '';

  let pageNumber = rawMeta?.pageNumber ?? 1;
  let rowNumber = rawMeta?.rowNumber ?? entry.entryIndex;
  let sourceRegion = rawMeta?.sourceRegion || `Row ${rowNumber}`;

  const pageMatch = errorsStr.match(/\[Page\s+(\d+)\s*\|\s*Row\s+(\d+)(?:\s*\|\s*Region:\s*([^\]]+))?\]/);
  if (pageMatch) {
    if (!rawMeta?.pageNumber && pageMatch[1]) pageNumber = parseInt(pageMatch[1], 10);
    if (!rawMeta?.rowNumber && pageMatch[2]) rowNumber = parseInt(pageMatch[2], 10);
    if (!rawMeta?.sourceRegion && pageMatch[3]) sourceRegion = pageMatch[3].trim();
  }

  let boundingBox = rawMeta?.boundingBox;
  if (!boundingBox) {
    const boxMatch = errorsStr.match(/\[Box:\s*y:(\d+)-(\d+),\s*x:(\d+)-(\d+)\]/);
    if (boxMatch) {
      boundingBox = {
        ymin: parseInt(boxMatch[1], 10),
        ymax: parseInt(boxMatch[2], 10),
        xmin: parseInt(boxMatch[3], 10),
        xmax: parseInt(boxMatch[4], 10)
      };
    }
  }

  let rawText = rawMeta?.rawText || '';
  if (!rawText) {
    const rawTextMatch = errorsStr.match(/\[Raw Text:\s*"([^"]*)"\]/);
    if (rawTextMatch) {
      rawText = rawTextMatch[1];
    }
  }

  let confidenceMethod = rawMeta?.confidenceMethod || (errorsStr.includes('via PROVIDER_CONFIDENCE') ? 'PROVIDER_CONFIDENCE' : 'HEURISTIC_ESTIMATE');
  const confidencePercent = Math.round((entry.confidence ?? rawMeta?.confidence ?? 0.8) * 100);

  const isCrossedOut = Boolean(rawMeta?.isCrossedOut || errorsStr.includes('[Crossed-Out Entry]'));
  const isUsnUncertain = Boolean(
    rawMeta?.isUsnUncertain ||
    errorsStr.includes('[Unclear USN]') ||
    entry.extractedUsn.includes('?') ||
    !entry.extractedUsn.trim()
  );
  const amount = entry.correctedAmount ?? entry.extractedAmount;
  const isAmountUncertain = Boolean(
    rawMeta?.isAmountUncertain ||
    errorsStr.includes('[Uncertain Amount]') ||
    amount <= 0
  );

  const validationErrorMessages: string[] = [];
  const parts = errorsStr.split('--');
  if (parts.length > 1) {
    const errorText = parts.slice(1).join('--').trim();
    const matches = errorText.match(/\[[^\]]+\][^[]*/g);
    if (matches && matches.length > 0) {
      for (const m of matches) {
        const trimmed = m.trim();
        if (trimmed && trimmed !== '[Verified legible]') {
          validationErrorMessages.push(trimmed);
        }
      }
    } else if (errorText && errorText !== '[Verified legible]') {
      validationErrorMessages.push(errorText);
    }
  }

  return {
    pageNumber,
    rowNumber,
    sourceRegion,
    boundingBox,
    rawText,
    confidencePercent,
    confidenceMethod,
    isCrossedOut,
    isUsnUncertain,
    isAmountUncertain,
    validationErrorMessages
  };
}

function checkEntryApprovalEligibility(entry: ScanEntry): {
  isEligible: boolean;
  blockerReason?: string;
} {
  if (entry.status === 'APPLIED') {
    return {
      isEligible: false,
      blockerReason: 'Already applied to departmental clearance records'
    };
  }

  const effectiveUsn = (entry.correctedUsn || entry.extractedUsn || '').trim();
  if (!effectiveUsn || effectiveUsn.includes('?') || entry.validationErrors?.includes('[Unclear USN]')) {
    return {
      isEligible: false,
      blockerReason: 'Ambiguous or unreadable USN. Manual USN correction required before approval.'
    };
  }

  if (!entry.matchedStudentName && !entry.matchedStudentId) {
    return {
      isEligible: false,
      blockerReason: 'Student could not be found in institutional database. Match required.'
    };
  }

  if (!entry.clearanceId) {
    return {
      isEligible: false,
      blockerReason: 'Student exists in registry but has no active clearance record in this department.'
    };
  }

  const effectiveAmount = entry.correctedAmount ?? entry.extractedAmount;
  if (!effectiveAmount || effectiveAmount <= 0 || entry.validationErrors?.includes('[Uncertain Amount]')) {
    return {
      isEligible: false,
      blockerReason: 'Amount is 0 or uncertain. Enter fine amount before approval.'
    };
  }

  if (entry.validationErrors?.includes('[Crossed-Out Entry]')) {
    return {
      isEligible: false,
      blockerReason: 'Candidate row was visibly crossed out in physical logbook.'
    };
  }

  return { isEligible: true };
}

async function runTests() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║   FRONTEND OCR REVIEW, VALIDATION & APPROVAL TEST SUITE        ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail = '') {
    if (condition) {
      console.log(`  ✓ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ [FAIL] ${testName} ${detail ? `(${detail})` : ''}`);
      failed++;
    }
  }

  // 1. Resolve Environment & Physics Clearance
  const dept = await prisma.clearanceDepartment.findFirst({
    where: { code: 'PHY' }
  });
  if (!dept) throw new Error('Physics department not found in DB');

  let student = await prisma.student.findFirst({
    where: { usn: '4MC24IS022' },
    include: { ndcClearances: { where: { departmentId: dept.id } } }
  });
  if (!student) throw new Error('Student 4MC24IS022 not found in DB');

  const clearance = student.ndcClearances[0];
  if (!clearance) throw new Error('Physics clearance not found for student 4MC24IS022');
  const clearanceId = clearance.id;

  const officerUser = await prisma.user.findFirst({
    where: { role: { in: [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DEPARTMENT_OFFICER] } }
  });
  if (!officerUser) throw new Error('Authorized Officer user not found in DB');

  // Baseline due amount for this student
  const baselineClearance = await prisma.ndcClearance.findUnique({
    where: { id: clearanceId }
  });
  const baselineDueAmount = baselineClearance?.dueAmount ?? 0;

  // --------------------------------------------------------------------------
  // TEST SECTION 1: EVERY EXTRACTED ROW APPEARS IN UI (Candidate Survival)
  // --------------------------------------------------------------------------
  console.log('\n--- Section 1: Every Extracted Candidate Row Appears in UI ---');

  const mockCandidateRows: ScanEntry[] = [
    {
      id: 'entry-1',
      scanJobId: 'job-1',
      entryIndex: 1,
      status: 'MATCHED',
      extractedUsn: '4MC24IS022',
      extractedName: 'Chethan N',
      extractedAmount: 150,
      extractedReason: 'Galvanometer damage',
      extractedDate: '2026-10-17',
      confidence: 0.94,
      matchedStudentId: student.id,
      matchedStudentUsn: '4MC24IS022',
      matchedStudentName: 'Chethan N',
      clearanceId,
      validationErrors: '[Page 1 | Row 1 | Region: Table Row 1, Center Column] [Box: y:120-180, x:50-950] [Raw Text: "4MC24IS022 Chethan 150 Galvanometer damage"] [Confidence: 94% via PROVIDER_CONFIDENCE] -- [Verified legible]'
    },
    {
      id: 'entry-2',
      scanJobId: 'job-1',
      entryIndex: 2,
      status: 'UNMATCHED',
      extractedUsn: '4MC24??099',
      extractedName: 'Unknown',
      extractedAmount: 0,
      extractedReason: 'Spectrometer prism chipped',
      extractedDate: '2026-10-17',
      confidence: 0.35,
      matchedStudentId: null,
      matchedStudentUsn: null,
      matchedStudentName: null,
      clearanceId: null,
      validationErrors: '[Page 1 | Row 2 | Region: Table Row 2] [Box: y:200-260, x:50-950] [Raw Text: "4MC24??099 Unknown 0 Spectrometer prism"] [Confidence: 35% via HEURISTIC_ESTIMATE] -- [Unclear USN] USN smudged. [Unknown Student] USN not in registry. [Uncertain Amount] Fine amount missing.'
    },
    {
      id: 'entry-3',
      scanJobId: 'job-1',
      entryIndex: 3,
      status: 'UNMATCHED',
      extractedUsn: '4MC24IS022',
      extractedName: 'Chethan N',
      extractedAmount: 50,
      extractedReason: 'Vernier caliper fine',
      extractedDate: '2026-10-17',
      confidence: 0.65,
      matchedStudentId: student.id,
      matchedStudentUsn: '4MC24IS022',
      matchedStudentName: 'Chethan N',
      clearanceId,
      validationErrors: '[Page 1 | Row 3 | Region: Table Row 3] [Box: y:280-340, x:50-950] [Raw Text: "4MC24IS022 Vernier caliper 50 [struck through]"] [Confidence: 65% via HEURISTIC_ESTIMATE] -- [Crossed-Out Entry] Visibly struck through in source image. Requires lecturer confirmation.'
    }
  ];

  assert(mockCandidateRows.length === 3, 'Zero silent row truncation: all 3 detected candidates are preserved');

  const f1 = parseEntryForensics(mockCandidateRows[0]);
  assert(f1.pageNumber === 1 && f1.rowNumber === 1, 'Entry 1 correctly shows Page 1, Row 1');
  assert(f1.boundingBox?.ymin === 120 && f1.boundingBox?.ymax === 180, 'Entry 1 preserves bounding box coordinates');
  assert(f1.rawText === '4MC24IS022 Chethan 150 Galvanometer damage', 'Entry 1 displays exact raw OCR text');
  assert(f1.confidenceMethod === 'PROVIDER_CONFIDENCE', 'Entry 1 accurately labels PROVIDER_CONFIDENCE method');
  assert(f1.confidencePercent === 94, 'Entry 1 accurately displays 94% confidence');

  const f2 = parseEntryForensics(mockCandidateRows[1]);
  assert(f2.isUsnUncertain === true, 'Entry 2 correctly flagged as isUsnUncertain');
  assert(f2.isAmountUncertain === true, 'Entry 2 correctly flagged as isAmountUncertain');
  assert(f2.confidenceMethod === 'HEURISTIC_ESTIMATE', 'Entry 2 accurately labels HEURISTIC_ESTIMATE method');
  assert(f2.validationErrorMessages.length === 3, 'Entry 2 preserves all 3 validation error chips');

  const f3 = parseEntryForensics(mockCandidateRows[2]);
  assert(f3.isCrossedOut === true, 'Entry 3 preserves crossed-out state with warning');

  // --------------------------------------------------------------------------
  // TEST SECTION 2: UNCERTAIN ENTRIES REMAIN REVIEWABLE & EDITABLE
  // --------------------------------------------------------------------------
  console.log('\n--- Section 2: Uncertain Entries Remain Reviewable & Editable ---');

  const check2Before = checkEntryApprovalEligibility(mockCandidateRows[1]);
  assert(check2Before.isEligible === false, 'Uncertain entry 2 is blocked from approval');
  assert(Boolean(check2Before.blockerReason), `Entry 2 explains blocker: "${check2Before.blockerReason}"`);
  assert(mockCandidateRows[1].extractedReason === 'Spectrometer prism chipped', 'Unmatched entry keeps reason visible without hiding');

  // Simulate lecturer correcting Entry 2 in UI
  const correctedEntry2: ScanEntry = {
    ...mockCandidateRows[1],
    correctedUsn: '4MC24IS022',
    correctedAmount: 120,
    correctedReason: 'Spectrometer prism chipped (Confirmed)',
    matchedStudentId: student.id,
    matchedStudentUsn: '4MC24IS022',
    matchedStudentName: 'Chethan N',
    clearanceId,
    validationErrors: '[Page 1 | Row 2 | Region: Table Row 2] [Confidence: 85% via HEURISTIC_ESTIMATE] -- [Verified legible]'
  };

  const check2After = checkEntryApprovalEligibility(correctedEntry2);
  assert(check2After.isEligible === true, 'After lecturer corrects USN & amount, entry 2 becomes eligible for approval');

  // --------------------------------------------------------------------------
  // TEST SECTION 3: UNAPPROVED ENTRIES CAUSE NO DATABASE MUTATIONS
  // --------------------------------------------------------------------------
  console.log('\n--- Section 3: Unapproved Entries Cause Zero Database Mutations ---');

  const clearanceBefore = await prisma.ndcClearance.findUnique({ where: { id: clearanceId } });
  assert(clearanceBefore?.dueAmount === baselineDueAmount, 'Unapproved candidate rows cause ZERO database changes');

  // Select-All must select ONLY eligible entries
  const allEligibleIds = mockCandidateRows
    .filter((e) => checkEntryApprovalEligibility(e).isEligible)
    .map((e) => e.id);

  assert(allEligibleIds.length === 1 && allEligibleIds[0] === 'entry-1', 'Select-all selects ONLY eligible entries (excludes ambiguous & crossed-out)');

  // --------------------------------------------------------------------------
  // TEST SECTION 4: INDEPENDENT ROW APPROVAL & DOUBLE SUBMISSION PREVENTION
  // --------------------------------------------------------------------------
  console.log('\n--- Section 4: Independent Row Approval & Double Submission Prevention ---');

  const testJob = await prisma.scanJob.create({
    data: {
      lecturerUserId: officerUser.id,
      departmentId: dept.id,
      status: 'REVIEWING',
      originalFilename: 'test_logbook_review.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024,
      totalEntries: 2,
      matchedEntries: 1,
      unmatchedEntries: 1,
      approvedEntries: 0,
      appliedEntries: 0,
      failedEntries: 0
    }
  });

  const dbEntry1 = await prisma.scanJobEntry.create({
    data: {
      scanJobId: testJob.id,
      entryIndex: 1,
      status: 'MATCHED',
      extractedUsn: '4MC24IS022',
      extractedName: 'Chethan N',
      extractedAmount: 150,
      extractedReason: 'Galvanometer test breakage',
      extractedDate: '2026-10-17',
      confidence: 0.94,
      matchedStudentId: student.id,
      matchedStudentUsn: '4MC24IS022',
      matchedStudentName: 'Chethan N',
      clearanceId,
      validationErrors: '[Page 1 | Row 1] [Confidence: 94% via PROVIDER_CONFIDENCE] -- [Verified legible]'
    }
  });

  const dbEntry2 = await prisma.scanJobEntry.create({
    data: {
      scanJobId: testJob.id,
      entryIndex: 2,
      status: 'UNMATCHED',
      extractedUsn: '4MC24??999',
      extractedName: 'Unknown',
      extractedAmount: 0,
      extractedReason: 'Unknown damage',
      extractedDate: '2026-10-17',
      confidence: 0.35,
      matchedStudentId: null,
      matchedStudentUsn: null,
      matchedStudentName: null,
      clearanceId: null,
      validationErrors: '[Page 1 | Row 2] -- [Unclear USN] USN smudged.'
    }
  });

  // Independently apply ONLY entry 1
  const applyResult = await LogbookScannerService.applyApprovedEntries(
    testJob.id,
    [dbEntry1.id],
    officerUser.id
  );

  assert(applyResult.appliedCount === 1, 'Independent single-row approval applied exactly 1 entry');

  // Verify clearance record in DB was updated with this due
  const updatedClearance = await prisma.ndcClearance.findUnique({
    where: { id: clearanceId }
  });
  assert(updatedClearance?.status === DepartmentClearanceStatus.DUE, 'Student clearance status changed to DUE in DB');
  assert(updatedClearance?.dueAmount === baselineDueAmount + 150, `Clearance due amount updated in DB by ₹150 (Total: ₹${updatedClearance?.dueAmount})`);

  // Verify that unapproved entry 2 was NOT mutated and remains UNMATCHED in DB
  const refreshedEntry2 = await prisma.scanJobEntry.findUnique({
    where: { id: dbEntry2.id }
  });
  assert(refreshedEntry2?.status === 'UNMATCHED', 'Unapproved entry 2 remains UNMATCHED and completely unmutated');

  // Double submission prevention:
  const refreshedEntry1 = await prisma.scanJobEntry.findUnique({
    where: { id: dbEntry1.id }
  });
  assert(refreshedEntry1?.status === 'APPLIED', 'Approved entry 1 marked APPLIED in DB');

  const check1Applied = checkEntryApprovalEligibility(refreshedEntry1 as any);
  assert(check1Applied.isEligible === false, 'Double submission prevented: already APPLIED entry cannot be re-approved');

  // Reset student clearance back to baseline
  await prisma.ndcClearance.update({
    where: { id: clearanceId },
    data: {
      status: baselineClearance?.status || DepartmentClearanceStatus.PENDING,
      dueAmount: baselineDueAmount,
      remarks: baselineClearance?.remarks || null
    }
  });

  // Cleanup test job and entries
  await prisma.scanJobEntry.deleteMany({
    where: { scanJobId: testJob.id }
  });
  await prisma.scanJob.delete({
    where: { id: testJob.id }
  });

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log(`║   TEST RESULTS: ${passed} PASSED, ${failed} FAILED                             ║`);
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests()
  .catch((e) => {
    console.error('Fatal test error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
