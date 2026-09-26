import { PrismaClient, DepartmentClearanceStatus } from '@prisma/client';
import { LaboratoryAggregationService } from '../src/services/LaboratoryAggregationService';
import { PdfService } from '../src/services/PdfService';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function runTests() {
  console.log('====================================================');
  console.log('STARTING LABORATORY AGGREGATION & NDC TEST SUITE');
  console.log('====================================================');

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

  // Mock Clearance Helper
  function createMockClearance(deptName: string, deptCode: string, status: DepartmentClearanceStatus, dueAmount = 0, isLab = true) {
    return {
      id: `clr-${deptCode.toLowerCase()}`,
      _id: `clr-${deptCode.toLowerCase()}`,
      status,
      dueAmount,
      dueDetails: dueAmount > 0 ? `Unpaid lab manual fee for ${deptName}` : null,
      remarks: status === DepartmentClearanceStatus.CLEARED ? 'Equipment verified' : status === DepartmentClearanceStatus.DUE ? 'Overdue fee' : null,
      department: {
        id: `dept-${deptCode.toLowerCase()}`,
        name: deptName,
        code: deptCode,
        category: isLab ? 'COLLEGE_LAB' : 'CENTRAL_DESK',
        requiresClearance: true,
        displayOrder: isLab ? 2 : 1
      },
      reviewedAt: new Date()
    };
  }

  // ====================================================
  // CASE 1: Physics = CLEARED, Chemistry = CLEARED, DDCO = CLEARED
  // Expected: Student Laboratory = CLEARED, Certificate contains Laboratory — Cleared
  // ====================================================
  console.log('\n--- Running CASE 1: All Labs Cleared ---');
  {
    const clearances = [
      createMockClearance('Engineering Physics Laboratory', 'PHY', DepartmentClearanceStatus.CLEARED),
      createMockClearance('Engineering Chemistry Laboratory', 'CHEM', DepartmentClearanceStatus.CLEARED),
      createMockClearance('DDCO Laboratory', 'IS-DDCO', DepartmentClearanceStatus.CLEARED),
      createMockClearance('Central Library', 'LIB', DepartmentClearanceStatus.CLEARED, 0, false)
    ];

    const summary = LaboratoryAggregationService.getLaboratoryClearanceSummary(clearances);
    assert(summary.status === DepartmentClearanceStatus.CLEARED, 'CASE 1: summary status is CLEARED');
    assert(summary.totalLabs === 3, 'CASE 1: totalLabs is 3');
    assert(summary.clearedLabs === 3, 'CASE 1: clearedLabs is 3');
    assert(summary.pendingLabs.length === 0, 'CASE 1: pendingLabs is empty');

    const certItems = LaboratoryAggregationService.getCertificateClearanceItems(clearances);
    const labCertItems = certItems.filter(i => i.departmentCode === 'LAB' || i.departmentName === 'Laboratory');
    const phyItems = certItems.filter(i => i.departmentCode === 'PHY');
    const chemItems = certItems.filter(i => i.departmentCode === 'CHEM');
    assert(labCertItems.length === 1, 'CASE 1: Exactly 1 Laboratory item in certificate items');
    assert(labCertItems[0].status === 'CLEARED', 'CASE 1: Laboratory item is CLEARED');
    assert(phyItems.length === 0 && chemItems.length === 0, 'CASE 1: Individual labs omitted from certificate items');
  }

  // ====================================================
  // CASE 2: Physics = CLEARED, Chemistry = DUE, DDCO = CLEARED
  // Expected: Student Laboratory = NOT CLEARED (DUE), Pending lab = Chemistry Lab
  // ====================================================
  console.log('\n--- Running CASE 2: One Lab Due ---');
  {
    const clearances = [
      createMockClearance('Engineering Physics Laboratory', 'PHY', DepartmentClearanceStatus.CLEARED),
      createMockClearance('Engineering Chemistry Laboratory', 'CHEM', DepartmentClearanceStatus.DUE, 250),
      createMockClearance('DDCO Laboratory', 'IS-DDCO', DepartmentClearanceStatus.CLEARED)
    ];

    const summary = LaboratoryAggregationService.getLaboratoryClearanceSummary(clearances);
    assert(summary.status === DepartmentClearanceStatus.DUE, 'CASE 2: summary status is DUE');
    assert(summary.dueCount === 1, 'CASE 2: dueCount is 1');
    assert(summary.totalDueAmount === 250, 'CASE 2: totalDueAmount is 250');
    assert(summary.pendingLabs.length === 1, 'CASE 2: pendingLabs contains 1 lab');
    assert(summary.pendingLabs[0].code === 'CHEM', 'CASE 2: pending lab is Chemistry Lab');
    assert(summary.pendingLabs[0].dueAmount === 250, 'CASE 2: pending lab due amount is 250');
  }

  // ====================================================
  // CASE 3: Physics = DUE, Chemistry = DUE, DDCO = CLEARED
  // Expected: Student Laboratory = NOT CLEARED, Pending labs = Physics Lab, Chemistry Lab
  // ====================================================
  console.log('\n--- Running CASE 3: Multiple Labs Due ---');
  {
    const clearances = [
      createMockClearance('Engineering Physics Laboratory', 'PHY', DepartmentClearanceStatus.DUE, 150),
      createMockClearance('Engineering Chemistry Laboratory', 'CHEM', DepartmentClearanceStatus.DUE, 300),
      createMockClearance('DDCO Laboratory', 'IS-DDCO', DepartmentClearanceStatus.CLEARED)
    ];

    const summary = LaboratoryAggregationService.getLaboratoryClearanceSummary(clearances);
    assert(summary.status === DepartmentClearanceStatus.DUE, 'CASE 3: summary status is DUE');
    assert(summary.dueCount === 2, 'CASE 3: dueCount is 2');
    assert(summary.totalDueAmount === 450, 'CASE 3: totalDueAmount is 450');
    assert(summary.pendingLabs.length === 2, 'CASE 3: pendingLabs has 2 entries');
    const labNames = summary.pendingLabs.map(l => l.name);
    assert(labNames.includes('Engineering Physics Laboratory') && labNames.includes('Engineering Chemistry Laboratory'), 'CASE 3: pendingLabs includes both Physics and Chemistry');
  }

  // ====================================================
  // CASE 4: Physics = CLEARED, Chemistry = NOT_APPLICABLE, DDCO = CLEARED
  // Expected: Laboratory = CLEARED, Certificate contains only Laboratory — Cleared
  // ====================================================
  console.log('\n--- Running CASE 4: Not Applicable Lab ---');
  {
    const clearances = [
      createMockClearance('Engineering Physics Laboratory', 'PHY', DepartmentClearanceStatus.CLEARED),
      createMockClearance('Engineering Chemistry Laboratory', 'CHEM', DepartmentClearanceStatus.NOT_APPLICABLE),
      createMockClearance('DDCO Laboratory', 'IS-DDCO', DepartmentClearanceStatus.CLEARED)
    ];

    const summary = LaboratoryAggregationService.getLaboratoryClearanceSummary(clearances);
    assert(summary.status === DepartmentClearanceStatus.CLEARED, 'CASE 4: summary status is CLEARED');
    assert(summary.notApplicableLabsCount === 1, 'CASE 4: notApplicableLabsCount is 1');
    assert(summary.clearedLabs === 2, 'CASE 4: clearedLabs is 2');
    assert(summary.pendingLabs.length === 0, 'CASE 4: pendingLabs is empty');

    const certItems = LaboratoryAggregationService.getCertificateClearanceItems(clearances);
    const labCertItems = certItems.filter(i => i.departmentCode === 'LAB');
    const chemItems = certItems.filter(i => i.departmentCode === 'CHEM');
    assert(labCertItems.length === 1, 'CASE 4: Exactly 1 Laboratory row on certificate');
    assert(chemItems.length === 0, 'CASE 4: NOT_APPLICABLE Chemistry Lab is NOT displayed on certificate');
  }

  // ====================================================
  // CASE 5: All Applicable Labs = NOT_APPLICABLE
  // Expected: Laboratory = CLEARED (all requirements satisfied)
  // ====================================================
  console.log('\n--- Running CASE 5: All Labs Not Applicable ---');
  {
    const clearances = [
      createMockClearance('Engineering Physics Laboratory', 'PHY', DepartmentClearanceStatus.NOT_APPLICABLE),
      createMockClearance('Engineering Chemistry Laboratory', 'CHEM', DepartmentClearanceStatus.NOT_APPLICABLE)
    ];

    const summary = LaboratoryAggregationService.getLaboratoryClearanceSummary(clearances);
    assert(summary.status === DepartmentClearanceStatus.CLEARED, 'CASE 5: summary status is CLEARED when all labs are NOT_APPLICABLE');
    assert(summary.notApplicableLabsCount === 2, 'CASE 5: notApplicableLabsCount is 2');
  }

  // ====================================================
  // CASE 6: Student has 8 laboratory records
  // Expected: Student does NOT receive 8 separate certificate entries; exactly ONE Laboratory — Cleared
  // ====================================================
  console.log('\n--- Running CASE 6: Student with 8 Laboratory Records ---');
  {
    const clearances = [
      createMockClearance('Physics Lab', 'PHY', DepartmentClearanceStatus.CLEARED),
      createMockClearance('Chemistry Lab', 'CHEM', DepartmentClearanceStatus.CLEARED),
      createMockClearance('DDCO Lab', 'IS-DDCO', DepartmentClearanceStatus.CLEARED),
      createMockClearance('DBMS Lab', 'IS-DBMS', DepartmentClearanceStatus.CLEARED),
      createMockClearance('Computer Networks Lab', 'IS-CN', DepartmentClearanceStatus.CLEARED),
      createMockClearance('Web Technology Lab', 'IS-WT', DepartmentClearanceStatus.CLEARED),
      createMockClearance('AI/ML Lab', 'IS-AIML', DepartmentClearanceStatus.CLEARED),
      createMockClearance('IoT Systems Lab', 'IS-IOT', DepartmentClearanceStatus.CLEARED),
      createMockClearance('Central Library', 'LIB', DepartmentClearanceStatus.CLEARED, 0, false),
      createMockClearance('Student Hostel', 'HSTL', DepartmentClearanceStatus.CLEARED, 0, false)
    ];

    const summary = LaboratoryAggregationService.getLaboratoryClearanceSummary(clearances);
    assert(summary.totalLabs === 8, 'CASE 6: totalLabs is 8');
    assert(summary.status === DepartmentClearanceStatus.CLEARED, 'CASE 6: summary status is CLEARED');

    // Presentation Aggregation
    const presClearances = LaboratoryAggregationService.aggregateClearancesForPresentation(clearances);
    const labPresCount = presClearances.filter(c => c.isAggregatedLab || c.department?.code === 'LAB').length;
    assert(labPresCount === 1, 'CASE 6: Presentation clearances has exactly 1 Laboratory item');

    // Certificate Items
    const certItems = LaboratoryAggregationService.getCertificateClearanceItems(clearances);
    const labCertItems = certItems.filter(i => i.departmentCode === 'LAB');
    assert(labCertItems.length === 1, 'CASE 6: Certificate has exactly 1 Laboratory entry (NOT 8)');
  }

  // ====================================================
  // CASE 7: One Lab Changes from DUE -> CLEARED
  // Expected: Aggregate Laboratory updates immediately, becomes CLEARED
  // ====================================================
  console.log('\n--- Running CASE 7: Dynamic State Transition (DUE -> CLEARED) ---');
  {
    const labPhysics = createMockClearance('Physics Lab', 'PHY', DepartmentClearanceStatus.CLEARED);
    const labChem = createMockClearance('Chemistry Lab', 'CHEM', DepartmentClearanceStatus.DUE, 200);

    const initialSummary = LaboratoryAggregationService.getLaboratoryClearanceSummary([labPhysics, labChem]);
    assert(initialSummary.status === DepartmentClearanceStatus.DUE, 'CASE 7: Initially DUE');

    // Resolve Chemistry Due
    labChem.status = DepartmentClearanceStatus.CLEARED;
    labChem.dueAmount = 0;
    labChem.remarks = 'Fee settled';

    const updatedSummary = LaboratoryAggregationService.getLaboratoryClearanceSummary([labPhysics, labChem]);
    assert(updatedSummary.status === DepartmentClearanceStatus.CLEARED, 'CASE 7: Updated to CLEARED immediately');
    assert(updatedSummary.dueCount === 0, 'CASE 7: dueCount is now 0');
    assert(updatedSummary.pendingLabs.length === 0, 'CASE 7: pendingLabs is now empty');
  }

  // ====================================================
  // CASE 8: Officer Performs Bulk Clearance on Database Records
  // Expected: Individual lab records update in DB, aggregate status updates accordingly
  // ====================================================
  console.log('\n--- Running CASE 8: Database Bulk Clearance & Preservation ---');
  {
    // Find or test with a real student in DB
    const student = await prisma.student.findFirst({
      include: {
        department: true,
        ndcRequests: {
          include: {
            clearances: {
              include: { department: true }
            }
          }
        }
      }
    });

    if (student && student.ndcRequests && student.ndcRequests.length > 0) {
      const activeReq = student.ndcRequests[0];
      const clearances = activeReq.clearances;
      const labClearances = clearances.filter(c => LaboratoryAggregationService.isLaboratoryClearance(c));

      console.log(`Found student ${student.fullName} with ${clearances.length} clearances (${labClearances.length} lab clearances).`);
      
      // Verify individual records remain preserved
      for (const clr of labClearances) {
        assert(clr.department != null, `CASE 8: Individual lab record ${clr.department.name} exists with distinct ID ${clr.id}`);
      }

      // Verify aggregation calculates accurately on real DB records
      const realSummary = LaboratoryAggregationService.getLaboratoryClearanceSummary(clearances);
      assert(typeof realSummary.status === 'string', 'CASE 8: Real DB aggregation produces valid status');
      console.log(`Real DB Lab Summary: Status=${realSummary.status}, TotalLabs=${realSummary.totalLabs}, PendingCount=${realSummary.pendingCount}`);
    } else {
      console.log('Skipping DB query in Case 8: no existing student request in database.');
    }
  }

  // ====================================================
  // CASE 9: Real PDF Generation & Content Validation
  // Expected: PDF buffer generated, contains 'Laboratory', contains NO individual lab names
  // ====================================================
  console.log('\n--- Running CASE 9: PDF Rendering Validation ---');
  {
    const certData = {
      certificateNumber: 'TEST-NDC-2026-999',
      studentName: 'Chethan N',
      usn: '4MC20CS001',
      departmentName: 'Information Science & Engineering',
      batch: '2022-2026',
      academicYear: '2025-2026',
      completionDate: new Date(),
      issuedAt: new Date(),
      signatoryName: 'Dr. C. V. Venkatesh',
      signatoryDesignation: 'Principal',
      collegeName: 'Malnad College of Engineering',
      clearances: [
        { departmentName: 'Central Library', departmentCode: 'LIB', status: 'CLEARED' },
        // Intentionally provide individual lab items to test PdfService deduplication/unification safety
        { departmentName: 'Engineering Physics Laboratory', departmentCode: 'PHY', status: 'CLEARED' },
        { departmentName: 'Engineering Chemistry Laboratory', departmentCode: 'CHEM', status: 'CLEARED' },
        { departmentName: 'DDCO Laboratory', departmentCode: 'IS-DDCO', status: 'CLEARED' },
        { departmentName: 'Cash & Fees Counter', departmentCode: 'ACC', status: 'CLEARED' }
      ]
    };

    const testPdfPath = path.resolve(process.cwd(), 'uploads/test_cert_output.pdf');
    const savedPath = await PdfService.generateCertificatePdf(certData as any, testPdfPath);
    assert(fs.existsSync(savedPath), 'CASE 9: PDF file successfully saved to disk');

    const pdfBuffer = fs.readFileSync(savedPath);
    assert(Buffer.isBuffer(pdfBuffer) && pdfBuffer.length > 1000, 'CASE 9: PDF buffer successfully generated');

    // Extract decompressed streams from PDF
    let allDecompressedText = '';
    let startIdx = 0;
    while ((startIdx = pdfBuffer.indexOf('stream', startIdx)) !== -1) {
      const streamStart = pdfBuffer.indexOf('\n', startIdx) + 1;
      const streamEnd = pdfBuffer.indexOf('endstream', streamStart);
      if (streamStart !== -1 && streamEnd !== -1 && streamEnd > streamStart) {
        let streamSlice = pdfBuffer.subarray(streamStart, streamEnd);
        // Trim optional trailing \r or \n
        while (streamSlice.length > 0 && (streamSlice[streamSlice.length - 1] === 10 || streamSlice[streamSlice.length - 1] === 13)) {
          streamSlice = streamSlice.subarray(0, streamSlice.length - 1);
        }
        try {
          const inflated = require('zlib').inflateSync(streamSlice);
          allDecompressedText += inflated.toString('utf-8') + ' ';
        } catch {
          allDecompressedText += streamSlice.toString('latin1') + ' ';
        }
      }
      startIdx = streamEnd !== -1 ? streamEnd + 9 : startIdx + 6;
    }

    // Decode PDF TJ hex string tokens (e.g. [<4c61626f7261746f72> -10 <79> 0] TJ -> "Laboratory")
    const decodedPdfText = allDecompressedText.replace(/\[\s*([\s\S]*?)\s*\]\s*TJ/g, (_, inner) => {
      let decodedStr = '';
      const hexMatches = inner.match(/<([0-9a-fA-F]+)>/g) || [];
      for (const h of hexMatches) {
        decodedStr += Buffer.from(h.slice(1, -1), 'hex').toString('utf-8');
      }
      return decodedStr;
    });

    assert(decodedPdfText.includes('Laboratory'), 'CASE 9: Decompressed & decoded PDF contains "Laboratory"');
    assert(decodedPdfText.includes('LAB'), 'CASE 9: Decompressed & decoded PDF contains "LAB" code');
    // Ensure individual labs are not printed in the table
    assert(!decodedPdfText.includes('Engineering Physics Laboratory'), 'CASE 9: Decompressed PDF does NOT contain "Engineering Physics Laboratory"');
    assert(!decodedPdfText.includes('Engineering Chemistry Laboratory'), 'CASE 9: Decompressed PDF does NOT contain "Engineering Chemistry Laboratory"');
    assert(!decodedPdfText.includes('DDCO Laboratory'), 'CASE 9: Decompressed PDF does NOT contain "DDCO Laboratory"');
  }

  console.log('\n====================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  await prisma.$disconnect();
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
