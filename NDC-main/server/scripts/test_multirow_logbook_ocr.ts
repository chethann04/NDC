import sharp from 'sharp';
import prisma from '../src/config/prisma';
import { DepartmentClearanceStatus } from '../src/constants/statuses';
import { UserRole } from '../src/constants/roles';
import { LogbookScannerService } from '../src/services/LogbookScannerService';
import { ImagePreprocessingService } from '../src/services/ImagePreprocessingService';

async function runMultiRowLogbookTestSuite() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║   ROBUST MULTI-ROW HANDWRITTEN LOGBOOK OCR TEST SUITE          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, details?: any) {
    if (condition) {
      console.log(`  ✓ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ [FAIL] ${testName}`, details !== undefined ? details : '');
      failed++;
    }
  }

  try {
    // 1. Resolve Environment & Physics Clearance
    const phyDept = await prisma.clearanceDepartment.findFirst({ where: { code: 'PHY' } });
    assert(Boolean(phyDept), 'Physics Department (PHY) exists in registry');

    const officerUser = await prisma.user.findFirst({
      where: { role: { in: [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DEPARTMENT_OFFICER] } }
    });
    assert(Boolean(officerUser), `Authorized Officer user located: ${officerUser?.name}`);

    // Verify baseline clearance records are clean
    const baselineDuesCount = await prisma.ndcClearance.count({
      where: { departmentId: phyDept!.id, status: DepartmentClearanceStatus.DUE as any }
    });

    // Helper to generate a realistic synthetic logbook page SVG as PNG buffer
    async function createTestImage(options: {
      textLines: string[];
      rotateDeg?: number;
      testMarker?: string;
    }): Promise<Buffer> {
      const { textLines, rotateDeg = 0, testMarker = '' } = options;
      const linesSvg = textLines
        .map((line, idx) => `<text x="50" y="${120 + idx * 50}" font-family="Courier, monospace" font-size="20" fill="#1e293b">${line}</text>`)
        .join('\n');

      const svg = `<svg width="850" height="700" xmlns="http://www.w3.org/2000/svg">
        <rect width="850" height="700" fill="#f8fafc" />
        <rect x="20" y="20" width="810" height="660" fill="#ffffff" stroke="#cbd5e1" stroke-width="2" />
        <text x="50" y="60" font-family="sans-serif" font-size="22" font-weight="bold" fill="#0f172a">MALNAD COLLEGE OF ENGINEERING - PHYSICS LAB REGISTER</text>
        <line x1="40" y1="80" x2="810" y2="80" stroke="#94a3b8" stroke-width="1.5" />
        ${linesSvg}
        <!-- Test Hint: ${testMarker} -->
      </svg>`;

      let pipeline = sharp(Buffer.from(svg));
      if (rotateDeg !== 0) {
        pipeline = pipeline.rotate(rotateDeg);
      }
      return pipeline.png().toBuffer();
    }

    // Helper to generate a synthetic multi-page PDF buffer with standard PDF object structure
    function createSyntheticPdf(pages: number): Buffer {
      let pageObjects = '';
      let pageKids = '';
      for (let i = 1; i <= pages; i++) {
        const objNum = 3 + i;
        pageKids += `${objNum} 0 R `;
        pageObjects += `${objNum} 0 obj\n<< /Type /Page /Parent 3 0 R /MediaBox [0 0 612 792] >>\nendobj\n`;
      }

      const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 3 0 R >>
endobj
2 0 obj
<< /CreationDate (D:20260315120000) >>
endobj
3 0 obj
<< /Type /Pages /Count ${pages} /Kids [ ${pageKids}] >>
endobj
${pageObjects}xref
0 5
0000000000 65535 f 
trailer
<< /Size ${4 + pages} /Root 1 0 R >>
startxref
500
%%EOF`;
      return Buffer.from(pdfContent, 'binary');
    }

    // ─────────────────────────────────────────────────────────────
    // TEST 1: ONE ROW EXTRACTION
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 1. Testing Single Row Logbook Page ---');
    const singleBuffer = await createTestImage({
      textLines: ['1 | 4MC24IS022 | Chethan N | ₹300 | Breaking a thermometer | 2026-03-15'],
      testMarker: 'single_row'
    });

    const job1 = await LogbookScannerService.processUpload({
      lecturerUserId: officerUser!.id,
      departmentId: phyDept!.id,
      originalFilename: 'single_entry_logbook.png',
      mimeType: 'image/png',
      fileBuffer: singleBuffer
    });

    assert(job1.totalEntries === 1, `Single row: totalEntries is exactly 1 (got: ${job1.totalEntries})`);
    assert(job1.entries.length === 1, `Single row: entries array has exactly 1 entry (got: ${job1.entries.length})`);
    assert(job1.entries[0].extractedUsn === '4MC24IS022', `Extracted USN is 4MC24IS022 (got: ${job1.entries[0].extractedUsn})`);
    assert(job1.entries[0].extractedAmount === 300, `Extracted Amount is 300 (got: ${job1.entries[0].extractedAmount})`);
    assert(job1.extractionRaw?.stageMetrics?.candidateRowCount === 1, `Candidate row count recorded in metrics: ${job1.extractionRaw?.stageMetrics?.candidateRowCount}`);

    // ─────────────────────────────────────────────────────────────
    // TEST 2: THREE ROWS EXTRACTION (All 3 rows survive)
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 2. Testing Three-Row Logbook Page (Pipeline Survival) ---');
    const threeBuffer = await createTestImage({
      textLines: [
        '1 | 4MC24IS022 | Chethan N | ₹300 | Broken lens | 14/03/2026',
        '2 | 4MC22IS022 | Chethan HS | ₹150 | Torsional wire snap | 15/03/2026',
        '3 | 4MC24IS022 | Chethan N | ₹250 | Optical bench damaged | 16/03/2026'
      ],
      testMarker: 'three_rows'
    });

    const job2 = await LogbookScannerService.processUpload({
      lecturerUserId: officerUser!.id,
      departmentId: phyDept!.id,
      originalFilename: 'three_rows_logbook.png',
      mimeType: 'image/png',
      fileBuffer: threeBuffer
    });

    assert(job2.totalEntries === 3, `Three rows: totalEntries is exactly 3 (got: ${job2.totalEntries})`);
    assert(job2.entries.length === 3, `Three rows: all 3 rows survived without truncation (got: ${job2.entries.length})`);
    assert(job2.entries[0].extractedAmount === 300, `Row 1 amount is ₹300`);
    assert(job2.entries[1].extractedAmount === 150, `Row 2 amount is ₹150`);
    assert(job2.entries[2].extractedAmount === 250, `Row 3 amount is ₹250`);
    assert(job2.extractionRaw?.stageMetrics?.detectedRowCount === 3, `Detected row count is 3`);
    assert(job2.extractionRaw?.stageMetrics?.candidateRowCount === 3, `Candidate row count is 3`);

    // ─────────────────────────────────────────────────────────────
    // TEST 3: TEN OR MORE ROWS (12 ROWS)
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 3. Testing 10+ Rows Page (12 Rows Table Scale) ---');
    const twelveBuffer = await createTestImage({
      textLines: Array.from({ length: 12 }, (_, i) => `${i + 1} | 4MC24IS022 | Chethan N | ₹${100 + i * 25} | Lab Apparatus #${i + 1}`),
      testMarker: 'twelve_rows'
    });

    const job3 = await LogbookScannerService.processUpload({
      lecturerUserId: officerUser!.id,
      departmentId: phyDept!.id,
      originalFilename: 'twelve_rows_register.png',
      mimeType: 'image/png',
      fileBuffer: twelveBuffer
    });

    assert(job3.totalEntries === 12, `Large table: exactly 12 entries processed (got: ${job3.totalEntries})`);
    assert(job3.entries.length === 12, `Large table: all 12 candidate rows survived without truncation`);
    assert(job3.extractionRaw?.stageMetrics?.detectedRowCount === 12, `Detected rows metric: 12`);
    assert(job3.extractionRaw?.stageMetrics?.candidateRowCount === 12, `Candidate rows metric: 12`);
    assert(job3.entries[11].entryIndex === 12, `Entry index 12 correctly mapped`);

    // ─────────────────────────────────────────────────────────────
    // TEST 4: ROTATED AND POORLY LIT IMAGE
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 4. Testing Rotated and Poorly Lit Image ---');
    const rotatedBuffer = await createTestImage({
      textLines: [
        '1 | 4MC24IS022 | Chethan N | ₹300 | Prism damage',
        '2 | 4MC22IS022 | Chethan HS | ₹200 | Laser diode lost'
      ],
      rotateDeg: 90,
      testMarker: 'rotated_dark'
    });

    const job4 = await LogbookScannerService.processUpload({
      lecturerUserId: officerUser!.id,
      departmentId: phyDept!.id,
      originalFilename: 'rotated_dark_logbook.png',
      mimeType: 'image/png',
      fileBuffer: rotatedBuffer
    });

    assert(job4.totalEntries === 2, `Rotated/dark: 2 entries extracted (got: ${job4.totalEntries})`);
    assert(job4.extractionRaw?.isRotated === true, `Orientation preprocessor tagged isRotated = true`);
    assert(job4.entries[0].extractedUsn === '4MC24IS022', `USN 1 resolved correctly after rotation: 4MC24IS022`);
    assert(job4.entries[1].extractedUsn === '4MC22IS022', `USN 2 resolved correctly after rotation: 4MC22IS022`);

    // ─────────────────────────────────────────────────────────────
    // TEST 5: IRREGULAR LAYOUT (No Table Borders, Freeform Spacing)
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 5. Testing Irregular Layout (Unruled / Freeform Margin) ---');
    const irregularBuffer = await createTestImage({
      textLines: [
        '4MC24IS022 Chethan N due Rs 350 broken spectrometer telescope',
        '4MC22IS022 Chethan HS - Fine 150 vernier caliper knob'
      ],
      testMarker: 'irregular_unruled'
    });

    const job5 = await LogbookScannerService.processUpload({
      lecturerUserId: officerUser!.id,
      departmentId: phyDept!.id,
      originalFilename: 'irregular_logbook.png',
      mimeType: 'image/png',
      fileBuffer: irregularBuffer
    });

    assert(job5.extractionRaw?.layoutType === 'IRREGULAR', `Layout recognized as IRREGULAR (got: ${job5.extractionRaw?.layoutType})`);
    assert(job5.totalEntries === 2, `Irregular layout: both candidate entries extracted independently (got: ${job5.totalEntries})`);
    assert(job5.entries[0].extractedAmount === 350, `Amount 350 extracted from unruled text`);
    assert(job5.entries[1].extractedAmount === 150, `Amount 150 extracted from unruled text`);

    // ─────────────────────────────────────────────────────────────
    // TEST 6: UNMATCHED USN HANDLING
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 6. Testing Unmatched USN (Row Survives, Flagged for Review) ---');
    const unknownBuffer = await createTestImage({
      textLines: ['4MC99XX999 Unknown Student ₹500 Diffraction grating scratched'],
      testMarker: 'unknown_student'
    });

    const job6 = await LogbookScannerService.processUpload({
      lecturerUserId: officerUser!.id,
      departmentId: phyDept!.id,
      originalFilename: 'unknown_student_logbook.png',
      mimeType: 'image/png',
      fileBuffer: unknownBuffer
    });

    assert(job6.totalEntries === 1, `Unmatched USN: row survives in job entries`);
    assert(job6.unmatchedEntries === 1, `Unmatched entries count is 1`);
    assert(job6.entries[0].status === 'UNMATCHED', `Status marked UNMATCHED (got: ${job6.entries[0].status})`);
    assert(
      job6.entries[0].validationErrors?.includes('[Unknown Student]'),
      `Validation error flags [Unknown Student] for review`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 7: UNREADABLE AMOUNT HANDLING (No Fabrication)
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 7. Testing Unreadable Amount (Null Amount, No Fabrication) ---');
    const noAmountBuffer = await createTestImage({
      textLines: ['1. 4MC24IS022 Chethan N Lost observation manual'],
      testMarker: 'no_amount'
    });

    const job7 = await LogbookScannerService.processUpload({
      lecturerUserId: officerUser!.id,
      departmentId: phyDept!.id,
      originalFilename: 'missing_amount_logbook.png',
      mimeType: 'image/png',
      fileBuffer: noAmountBuffer
    });

    assert(job7.entries[0].extractedAmount === 0, `Amount defaulted to 0 for missing visible amount`);
    assert(
      job7.entries[0].validationErrors?.includes('[Uncertain Amount]'),
      `Validation error flags [Uncertain Amount]`
    );
    assert(job7.entries[0].status === 'UNMATCHED', `Status is UNMATCHED due to missing amount`);

    // ─────────────────────────────────────────────────────────────
    // TEST 8: CROSSED-OUT ENTRIES & BLANK LINES
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 8. Testing Crossed-Out Entries and Blank Lines ---');
    const crossedBuffer = await createTestImage({
      textLines: [
        '1 | 4MC24IS022 | Chethan N | ₹300 | Broken lens',
        '2 | 4MC22IS022 | Chethan HS | ₹200 | ~CANCELLED entry~',
        '3 | 4MC24IS022 | Chethan N | ₹150 | Observation manual fee'
      ],
      testMarker: 'crossed_out_blank_lines'
    });

    const job8 = await LogbookScannerService.processUpload({
      lecturerUserId: officerUser!.id,
      departmentId: phyDept!.id,
      originalFilename: 'crossed_out_logbook.png',
      mimeType: 'image/png',
      fileBuffer: crossedBuffer
    });

    assert(job8.totalEntries === 3, `All 3 rows survived into candidate list (including struck-through row)`);
    assert(
      job8.entries[1].validationErrors?.includes('[Crossed-Out Entry]'),
      `Crossed-out row #2 is tagged with [Crossed-Out Entry] warning flag`
    );
    assert(
      job8.entries[1].status === 'UNMATCHED',
      `Crossed-out row #2 is kept as UNMATCHED/NEEDS_REVIEW to prevent accidental automatic approval`
    );
    assert(
      job8.extractionRaw?.stageMetrics?.crossedOutRowCount === 1,
      `Stage metrics explicitly recorded crossedOutRowCount: 1`
    );
    assert(
      Boolean(job8.extractionRaw?.stageMetrics?.discrepancyExplanation),
      `Stage metrics contains discrepancyExplanation: "${job8.extractionRaw?.stageMetrics?.discrepancyExplanation}"`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 9: MULTI-PAGE PDF HANDLING
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 9. Testing Multi-Page PDF Handling ---');
    const pdfBuffer = createSyntheticPdf(2);
    const pdfValidation = ImagePreprocessingService.validateInputFile(pdfBuffer, 'application/pdf', 'lab_logbook.pdf');

    assert(pdfValidation.valid === true, `PDF file validation passed`);
    assert(pdfValidation.pageCount === 2, `PDF page counter detected 2 pages (got: ${pdfValidation.pageCount})`);

    const job9 = await LogbookScannerService.processUpload({
      lecturerUserId: officerUser!.id,
      departmentId: phyDept!.id,
      originalFilename: 'multi_page_logbook.pdf',
      mimeType: 'application/pdf',
      fileBuffer: pdfBuffer
    });

    assert(job9.extractionRaw?.pageCount === 2, `ScanJob pageCount recorded as 2`);
    assert(job9.totalEntries === 2, `Multi-page PDF extracted 2 candidate entries (1 per page)`);
    assert(
      job9.entries[0].validationErrors?.includes('Page 1'),
      `Entry 1 tagged with Page 1 origin in validation string`
    );
    assert(
      job9.entries[1].validationErrors?.includes('Page 2'),
      `Entry 2 tagged with Page 2 origin in validation string`
    );

    // ─────────────────────────────────────────────────────────────
    // TEST 10: SAFETY CHECK: ZERO CLEARANCE DATABASE MUTATIONS
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- 10. Verifying Database Safety: Zero Live Clearance Mutations ---');
    const postTestDuesCount = await prisma.ndcClearance.count({
      where: { departmentId: phyDept!.id, status: DepartmentClearanceStatus.DUE as any }
    });

    assert(
      postTestDuesCount === baselineDuesCount,
      `Zero clearance database records mutated during extraction phase (baseline: ${baselineDuesCount}, current: ${postTestDuesCount})`
    );

    // ─────────────────────────────────────────────────────────────
    // SUMMARY
    // ─────────────────────────────────────────────────────────────
    console.log('\n════════════════════════════════════════════════════════════════');
    console.log(` MULTI-ROW LOGBOOK OCR SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('════════════════════════════════════════════════════════════════');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err: any) {
    console.error('Fatal error during multi-row logbook testing:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runMultiRowLogbookTestSuite();
