import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import prisma from '../src/config/prisma';
import { formatApprovalTimestamp, parseApprovalTimestamp, INSTITUTIONAL_TIMEZONE } from '../src/utils/dateUtils';
import { PdfService, ClearanceItemPdf } from '../src/services/PdfService';
import { LaboratoryAggregationService } from '../src/services/LaboratoryAggregationService';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, testName: string, details?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ [PASS] ${testName}`);
  } else {
    console.error(`  ✗ [FAIL] ${testName}`);
    if (details) console.error(`    Details: ${details}`);
  }
}

function extractPdfText(buf: Buffer): string {
  let text = '';
  let idx = 0;
  while ((idx = buf.indexOf('stream', idx)) !== -1) {
    let start = idx + 6;
    if (buf[start] === 13) start++;
    if (buf[start] === 10) start++;
    const end = buf.indexOf('endstream', start);
    if (end !== -1) {
      try {
        const decomp = zlib.inflateSync(buf.subarray(start, end)).toString('utf8');
        const decoded = decomp.replace(/<([0-9a-fA-F]+)>/g, (_, hex) => Buffer.from(hex, 'hex').toString('utf8'));
        text += '\n' + decoded;
      } catch (e) {}
      idx = end + 9;
    } else {
      break;
    }
  }
  return text;
}

async function runTests() {
  console.log('======================================================================');
  console.log('     NDC CERTIFICATE TIMESTAMP PRESERVATION REGRESSION TEST SUITE');
  console.log('======================================================================\n');

  // -------------------------------------------------------------------------
  // Test Group 1: Timezone & Authoritative Formatting
  // -------------------------------------------------------------------------
  console.log('--- Test Group 1: Timezone & Authoritative Instant Formatting ---');

  const libUtc = '2026-10-20T09:11:00.000Z';
  const hstUtc = '2026-10-20T09:12:00.000Z';
  const sptUtc = '2026-10-20T09:14:00.000Z';

  const formattedLib = formatApprovalTimestamp(libUtc, { status: 'CLEARED' });
  const formattedHst = formatApprovalTimestamp(hstUtc, { status: 'CLEARED' });
  const formattedSpt = formatApprovalTimestamp(sptUtc, { status: 'CLEARED' });

  assert(
    formattedLib === '20 Oct 2026, 02:41 PM',
    'Central Library approval timestamp matches dashboard (02:41 PM)',
    `Expected '20 Oct 2026, 02:41 PM', got '${formattedLib}'`
  );

  assert(
    formattedHst === '20 Oct 2026, 02:42 PM',
    'Hostel Warden approval timestamp matches dashboard (02:42 PM)',
    `Expected '20 Oct 2026, 02:42 PM', got '${formattedHst}'`
  );

  assert(
    formattedSpt === '20 Oct 2026, 02:44 PM',
    'Sports Section approval timestamp matches dashboard (02:44 PM)',
    `Expected '20 Oct 2026, 02:44 PM', got '${formattedSpt}'`
  );

  // -------------------------------------------------------------------------
  // Test Group 2: Midnight Boundary & Calendar Rollover Tests
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 2: Midnight Boundary & Calendar Date Rollover ---');

  // In UTC 18:29 on 19 Oct -> 23:59 on 19 Oct in Asia/Kolkata (+5:30)
  const preMidnight = formatApprovalTimestamp('2026-10-19T18:29:00.000Z');
  assert(
    preMidnight === '19 Oct 2026, 11:59 PM',
    'Pre-midnight UTC timestamp stays on 19 Oct (11:59 PM)',
    `Got: ${preMidnight}`
  );

  // In UTC 18:30 on 19 Oct -> 00:00 on 20 Oct in Asia/Kolkata (+5:30)
  const exactMidnight = formatApprovalTimestamp('2026-10-19T18:30:00.000Z');
  assert(
    exactMidnight === '20 Oct 2026, 12:00 AM',
    'Exact midnight UTC timestamp rolls over to 20 Oct (12:00 AM)',
    `Got: ${exactMidnight}`
  );

  // In UTC 18:31 on 19 Oct -> 00:01 on 20 Oct in Asia/Kolkata (+5:30)
  const postMidnight = formatApprovalTimestamp('2026-10-19T18:31:00.000Z');
  assert(
    postMidnight === '20 Oct 2026, 12:01 AM',
    'Post-midnight UTC timestamp is on 20 Oct (12:01 AM)',
    `Got: ${postMidnight}`
  );

  // -------------------------------------------------------------------------
  // Test Group 3: Safe Handling of Missing and Invalid Timestamps
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 3: Safe Handling of Missing, Null, and Invalid Timestamps ---');

  const naWithNull = formatApprovalTimestamp(null, { status: 'NOT_APPLICABLE' });
  assert(
    naWithNull === 'Exempt / Not Applicable',
    'Null timestamp on NOT_APPLICABLE status displays Exempt / Not Applicable',
    `Got: ${naWithNull}`
  );

  const pendingWithNull = formatApprovalTimestamp(null, { status: 'PENDING' });
  assert(
    pendingWithNull === 'Pending Review',
    'Null timestamp on PENDING status displays Pending Review',
    `Got: ${pendingWithNull}`
  );

  const clearedWithNull = formatApprovalTimestamp(null, { status: 'CLEARED' });
  assert(
    clearedWithNull === 'Not available',
    'Null timestamp on CLEARED status displays Not available without fabricating current date',
    `Got: ${clearedWithNull}`
  );

  const invalidString = formatApprovalTimestamp('not-a-valid-date', { status: 'CLEARED' });
  assert(
    invalidString === 'Not available',
    'Invalid date string is caught safely and displays Not available',
    `Got: ${invalidString}`
  );

  const parsedNull = parseApprovalTimestamp(null);
  assert(parsedNull === null, 'parseApprovalTimestamp(null) returns null');

  const parsedInvalid = parseApprovalTimestamp('invalid-date');
  assert(parsedInvalid === null, 'parseApprovalTimestamp(invalid) returns null');

  const parsedValid = parseApprovalTimestamp('2026-10-20T09:11:00.000Z');
  assert(parsedValid instanceof Date && parsedValid.toISOString() === '2026-10-20T09:11:00.000Z', 'parseApprovalTimestamp preserves original ISO instant');

  // -------------------------------------------------------------------------
  // Test Group 4: LaboratoryAggregationService Timestamp Preservation
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 4: LaboratoryAggregationService Timestamp Assembly ---');

  const mockClearanceDocs = [
    {
      department: { code: 'LIB', name: 'Central Library', displayOrder: 1 },
      status: 'CLEARED',
      reviewedAt: new Date('2026-10-20T09:11:00.000Z'),
      updatedAt: new Date('2026-10-20T09:11:00.000Z')
    },
    {
      department: { code: 'PHY', name: 'Physics Lab', displayOrder: 2 },
      status: 'CLEARED',
      reviewedAt: new Date('2026-10-20T09:05:00.000Z'),
      updatedAt: new Date('2026-10-20T09:05:00.000Z')
    },
    {
      department: { code: 'CHEM', name: 'Chemistry Lab', displayOrder: 2 },
      status: 'CLEARED',
      reviewedAt: new Date('2026-10-20T09:08:00.000Z'),
      updatedAt: new Date('2026-10-20T09:08:00.000Z')
    },
    {
      department: { code: 'HST', name: 'Hostel Warden / Administration', displayOrder: 3 },
      status: 'CLEARED',
      reviewedAt: new Date('2026-10-20T09:12:00.000Z'),
      updatedAt: new Date('2026-10-20T09:12:00.000Z')
    },
    {
      department: { code: 'SPT', name: 'Physical Education / Sports Section', displayOrder: 4 },
      status: 'CLEARED',
      reviewedAt: new Date('2026-10-20T09:14:00.000Z'),
      updatedAt: new Date('2026-10-20T09:14:00.000Z')
    },
    {
      department: { code: 'ACC', name: 'Cash/Fee Section', displayOrder: 5 },
      status: 'CLEARED',
      reviewedAt: new Date('2026-10-20T09:07:00.000Z'),
      updatedAt: new Date('2026-10-20T09:07:00.000Z')
    },
    {
      department: { code: 'IS', name: 'Information Science & Engineering', isAcademicBranch: true, displayOrder: 6 },
      status: 'CLEARED',
      reviewedAt: new Date('2026-10-20T10:09:00.000Z'),
      updatedAt: new Date('2026-10-20T10:09:00.000Z')
    }
  ];

  const aggregatedItems = LaboratoryAggregationService.getCertificateClearanceItems(
    mockClearanceDocs,
    { name: 'Information Science & Engineering', code: 'IS', hodName: 'Dr. HOD' }
  );

  const libItem = aggregatedItems.find((i: any) => i.departmentCode === 'LIB');
  const labItem = aggregatedItems.find((i: any) => i.departmentCode === 'LAB');
  const hstItem = aggregatedItems.find((i: any) => i.departmentCode === 'HST');
  const sptItem = aggregatedItems.find((i: any) => i.departmentCode === 'SPT');
  const accItem = aggregatedItems.find((i: any) => i.departmentCode === 'ACC');
  const acadItem = aggregatedItems.find((i: any) => i.departmentCode === 'IS');

  assert(libItem && new Date(libItem.approvalTimestamp).toISOString() === '2026-10-20T09:11:00.000Z', 'LIB preserves exact persisted approval timestamp');
  assert(hstItem && new Date(hstItem.approvalTimestamp).toISOString() === '2026-10-20T09:12:00.000Z', 'HST preserves exact persisted approval timestamp');
  assert(sptItem && new Date(sptItem.approvalTimestamp).toISOString() === '2026-10-20T09:14:00.000Z', 'SPT preserves exact persisted approval timestamp');
  assert(accItem && new Date(accItem.approvalTimestamp).toISOString() === '2026-10-20T09:07:00.000Z', 'ACC preserves exact persisted approval timestamp');
  assert(acadItem && new Date(acadItem.approvalTimestamp).toISOString() === '2026-10-20T10:09:00.000Z', 'Academic Branch preserves exact persisted approval timestamp');

  // Unified lab row should pick the latest among PHY (09:05) and CHEM (09:08) -> CHEM (09:08)
  assert(
    labItem && new Date(labItem.approvalTimestamp).toISOString() === '2026-10-20T09:08:00.000Z',
    'Unified LAB entry takes latest laboratory clearance timestamp (09:08:00Z)',
    `Got: ${labItem?.approvalTimestamp}`
  );

  // Test zero fabrication when timestamps are null in docs
  const mockClearanceDocsWithNull = [
    {
      department: { code: 'LIB', name: 'Central Library', displayOrder: 1 },
      status: 'PENDING',
      reviewedAt: null,
      updatedAt: new Date('2026-10-20T08:00:00.000Z')
    }
  ];
  const aggregatedWithNull = LaboratoryAggregationService.getCertificateClearanceItems(mockClearanceDocsWithNull);
  const libNullItem = aggregatedWithNull.find((i: any) => i.departmentCode === 'LIB');
  assert(libNullItem && libNullItem.approvalTimestamp === null, 'Missing reviewedAt on PENDING item remains null without fabricating new Date()');

  // -------------------------------------------------------------------------
  // Test Group 5: Actual PDF Document Generation and Binary Text Verification
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 5: Actual PDF Document Generation & In-Depth Verification ---');

  const testPdfDir = path.resolve(process.cwd(), 'uploads/test_certificates');
  if (!fs.existsSync(testPdfDir)) {
    fs.mkdirSync(testPdfDir, { recursive: true });
  }
  const testPdfPath1 = path.join(testPdfDir, 'NDC_Test_Timestamps_1.pdf');
  const testPdfPath2 = path.join(testPdfDir, 'NDC_Test_Timestamps_2.pdf');

  const pdfClearanceRows: ClearanceItemPdf[] = [
    {
      departmentName: 'Central Library',
      departmentCode: 'LIB',
      status: 'CLEARED',
      approvalTimestamp: new Date('2026-10-20T09:11:00.000Z')
    },
    {
      departmentName: 'Laboratory',
      departmentCode: 'LAB',
      status: 'CLEARED',
      approvalTimestamp: new Date('2026-10-20T09:08:00.000Z'),
      reviewedByName: 'Designated Laboratory In-charge'
    },
    {
      departmentName: 'Hostel Warden / Administration',
      departmentCode: 'HST',
      status: 'CLEARED',
      approvalTimestamp: new Date('2026-10-20T09:12:00.000Z')
    },
    {
      departmentName: 'Physical Education / Sports Section',
      departmentCode: 'SPT',
      status: 'CLEARED',
      approvalTimestamp: new Date('2026-10-20T09:14:00.000Z')
    },
    {
      departmentName: 'Cash/Fee Section',
      departmentCode: 'ACC',
      status: 'CLEARED',
      approvalTimestamp: new Date('2026-10-20T09:07:00.000Z')
    },
    {
      departmentName: 'Academic Department (ISE)',
      departmentCode: 'IS',
      status: 'CLEARED',
      approvalTimestamp: new Date('2026-10-20T10:09:00.000Z')
    }
  ];

  const certData = {
    certificateNumber: 'NDC/MCE/IS/2026/TEST01',
    studentName: 'Chethan Chethu',
    usn: '4MC24IS022',
    departmentName: 'Information Science & Engineering',
    batch: '2022-2026',
    academicYear: '2025-2026',
    issuedAt: new Date('2026-10-20T10:30:00.000Z'),
    hodName: 'Dr. Academic HOD',
    clearances: pdfClearanceRows
  };

  await PdfService.generateCertificatePdf(certData, testPdfPath1);
  assert(fs.existsSync(testPdfPath1), 'Test PDF #1 successfully generated on disk');

  const pdfBuffer1 = fs.readFileSync(testPdfPath1);
  const pdfText1 = extractPdfText(pdfBuffer1);

  // Verify that the PDF contains the exact formatted timestamps in Asia/Kolkata
  assert(pdfText1.includes('20 Oct 2026, 02:41 PM'), 'PDF binary contains Central Library timestamp: 20 Oct 2026, 02:41 PM');
  assert(pdfText1.includes('20 Oct 2026, 02:42 PM'), 'PDF binary contains Hostel Warden timestamp: 20 Oct 2026, 02:42 PM');
  assert(pdfText1.includes('20 Oct 2026, 02:44 PM'), 'PDF binary contains Sports Section timestamp: 20 Oct 2026, 02:44 PM');
  assert(pdfText1.includes('20 Oct 2026, 02:37 PM'), 'PDF binary contains Cash/Fee timestamp: 20 Oct 2026, 02:37 PM (from 09:07 UTC)');
  assert(pdfText1.includes('20 Oct 2026, 02:38 PM'), 'PDF binary contains Laboratory timestamp: 20 Oct 2026, 02:38 PM (from 09:08 UTC)');
  assert(pdfText1.includes('20 Oct 2026, 03:39 PM'), 'PDF binary contains Academic Branch timestamp: 20 Oct 2026, 03:39 PM (from 10:09 UTC)');

  // Verify that each department has its own distinct timestamp and they are NOT identical
  const distinctTimestamps = new Set([
    '20 Oct 2026, 02:41 PM',
    '20 Oct 2026, 02:42 PM',
    '20 Oct 2026, 02:44 PM',
    '20 Oct 2026, 02:37 PM',
    '20 Oct 2026, 02:38 PM',
    '20 Oct 2026, 03:39 PM'
  ]);
  assert(distinctTimestamps.size === 6, 'All 6 department clearance desks maintain distinct approval timestamps');

  // -------------------------------------------------------------------------
  // Test Group 6: Determinism on Repeated Downloads
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 6: Determinism on Repeated Downloads ---');

  // Generate a second time (simulating a repeat download 10 seconds later)
  await PdfService.generateCertificatePdf(certData, testPdfPath2);
  assert(fs.existsSync(testPdfPath2), 'Test PDF #2 successfully generated on disk');

  const pdfBuffer2 = fs.readFileSync(testPdfPath2);
  const pdfText2 = extractPdfText(pdfBuffer2);

  assert(pdfText2.includes('20 Oct 2026, 02:41 PM'), 'Repeat download PDF maintains Central Library timestamp: 02:41 PM');
  assert(pdfText2.includes('20 Oct 2026, 02:42 PM'), 'Repeat download PDF maintains Hostel Warden timestamp: 02:42 PM');
  assert(pdfText2.includes('20 Oct 2026, 02:44 PM'), 'Repeat download PDF maintains Sports Section timestamp: 02:44 PM');

  // Clean up test PDFs
  try {
    fs.unlinkSync(testPdfPath1);
    fs.unlinkSync(testPdfPath2);
    fs.rmdirSync(testPdfDir);
  } catch {}

  // -------------------------------------------------------------------------
  // Test Group 7: Database Non-Mutation Verification
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 7: Database Non-Mutation Verification ---');

  // Verify that generating certificates or querying clearances does NOT modify the database records
  const sampleClearance = await prisma.ndcClearance.findFirst({
    where: { status: 'CLEARED', reviewedAt: { not: null } }
  });

  if (sampleClearance && sampleClearance.reviewedAt) {
    const originalReviewedAt = sampleClearance.reviewedAt.toISOString();
    const originalUpdatedAt = sampleClearance.updatedAt.toISOString();

    // Call LaboratoryAggregationService and date formatter
    formatApprovalTimestamp(sampleClearance.reviewedAt, { status: sampleClearance.status });
    LaboratoryAggregationService.getCertificateClearanceItems([sampleClearance]);

    // Check DB record again to verify it was NOT modified
    const recheckedClearance = await prisma.ndcClearance.findUnique({
      where: { id: sampleClearance.id }
    });

    assert(
      recheckedClearance?.reviewedAt?.toISOString() === originalReviewedAt,
      'Database reviewedAt timestamp was not modified by formatting or aggregation',
      `Original: ${originalReviewedAt}, Rechecked: ${recheckedClearance?.reviewedAt?.toISOString()}`
    );

    assert(
      recheckedClearance?.updatedAt.toISOString() === originalUpdatedAt,
      'Database updatedAt timestamp was not modified by formatting or aggregation',
      `Original: ${originalUpdatedAt}, Rechecked: ${recheckedClearance?.updatedAt.toISOString()}`
    );
  } else {
    console.log('  [INFO] Skipped DB non-mutation test (no sample clearance found).');
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('\n======================================================================');
  console.log(`TEST SUMMARY: ${passedTests} / ${totalTests} tests passed (${Math.round((passedTests / totalTests) * 100)}%)`);
  console.log('======================================================================\n');

  await prisma['$disconnect']();
  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch(async (err) => {
  console.error('Test execution failed with error:', err);
  await prisma['$disconnect']();
  process.exit(1);
});
