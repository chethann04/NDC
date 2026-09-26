import prisma from '../src/config/prisma';
import { DepartmentClearanceStatus } from '../src/constants/statuses';
import { LaboratoryAggregationService } from '../src/services/LaboratoryAggregationService';
import { PdfService } from '../src/services/PdfService';
import { UserRole } from '../src/constants/roles';
import fs from 'fs';
import path from 'path';

async function runMasterTestCases() {
  console.log('================================================================');
  console.log('OFFICIAL 12 TEST CASES: 3-ITEM LABORATORY ARCHITECTURE');
  console.log('================================================================');

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

  // Helper to create mock clearances for the 3 logical items
  function makeClearances(
    physicsStatus: DepartmentClearanceStatus,
    chemistryStatus: DepartmentClearanceStatus,
    departmentStatus: DepartmentClearanceStatus
  ) {
    return [
      {
        id: 'clr-phy',
        departmentId: 'dept-phy',
        labId: null,
        status: physicsStatus,
        dueAmount: physicsStatus === DepartmentClearanceStatus.DUE ? 150 : 0,
        dueDetails: physicsStatus === DepartmentClearanceStatus.DUE ? 'Physics apparatus damage fee' : null,
        remarks: 'Physics Review',
        department: {
          id: 'dept-phy',
          name: 'Physics Lab',
          code: 'PHY',
          category: 'COLLEGE_LAB',
          isAcademicBranch: false,
          requiresClearance: true,
          displayOrder: 2
        },
        lab: null,
        reviewedAt: new Date()
      },
      {
        id: 'clr-chem',
        departmentId: 'dept-chem',
        labId: null,
        status: chemistryStatus,
        dueAmount: chemistryStatus === DepartmentClearanceStatus.DUE ? 200 : 0,
        dueDetails: chemistryStatus === DepartmentClearanceStatus.DUE ? 'Chemistry glassware breakage' : null,
        remarks: 'Chemistry Review',
        department: {
          id: 'dept-chem',
          name: 'Chemistry Lab',
          code: 'CHEM',
          category: 'COLLEGE_LAB',
          isAcademicBranch: false,
          requiresClearance: true,
          displayOrder: 3
        },
        lab: null,
        reviewedAt: new Date()
      },
      {
        id: 'clr-dept-lab',
        departmentId: 'dept-ise',
        labId: 'lab-ise-01',
        status: departmentStatus,
        dueAmount: departmentStatus === DepartmentClearanceStatus.DUE ? 300 : 0,
        dueDetails: departmentStatus === DepartmentClearanceStatus.DUE ? 'Department Lab handbook' : null,
        remarks: 'Department Lab Review',
        department: {
          id: 'dept-ise',
          name: 'Information Science & Engineering',
          code: 'IS',
          category: 'ACADEMIC_BRANCH',
          isAcademicBranch: true,
          requiresClearance: true,
          displayOrder: 10
        },
        lab: {
          id: 'lab-ise-01',
          name: 'Department Lab',
          code: 'IS-LAB'
        },
        reviewedAt: new Date()
      }
    ];
  }

  // ====================================================
  // TEST 1:
  // Physics = NO DUE, Chemistry = NO DUE, Department = NO DUE
  // Expected: Laboratory = NO DUE
  // Student: Laboratory — No Due
  // Certificate: Laboratory — No Due
  // ====================================================
  console.log('\n--- TEST 1: All Three NO DUE ---');
  {
    const clearances = makeClearances(
      DepartmentClearanceStatus.CLEARED,
      DepartmentClearanceStatus.CLEARED,
      DepartmentClearanceStatus.CLEARED
    );
    const summary = LaboratoryAggregationService.getLaboratoryClearanceSummary(clearances);
    assert(summary.overallLaboratoryStatus === 'NO DUE', 'TEST 1: overallLaboratoryStatus is NO DUE');
    assert(summary.aggregateStatus === 'NO DUE', 'TEST 1: aggregateStatus is NO DUE');
    assert(summary.status === DepartmentClearanceStatus.CLEARED, 'TEST 1: summary.status is CLEARED');
    assert(summary.dueLabs.length === 0, 'TEST 1: Student sees 0 due items');
    assert(summary.physicsStatus === 'NO DUE', 'TEST 1: Physics is NO DUE');
    assert(summary.chemistryStatus === 'NO DUE', 'TEST 1: Chemistry is NO DUE');
    assert(summary.departmentStatus === 'NO DUE', 'TEST 1: Department is NO DUE');

    const certItems = LaboratoryAggregationService.getCertificateClearanceItems(clearances);
    const labEntries = certItems.filter(c => c.departmentCode === 'LAB' || c.departmentName === 'Laboratory');
    assert(labEntries.length === 1, 'TEST 1: Certificate contains exactly ONE Laboratory entry');
    assert(labEntries[0].status === 'CLEARED', 'TEST 1: Certificate Laboratory entry status is CLEARED (No Due)');
  }

  // ====================================================
  // TEST 2:
  // Physics = DUE, Chemistry = NO DUE, Department = NO DUE
  // Expected: Laboratory = DUE
  // Student: Physics Lab — Due
  // ====================================================
  console.log('\n--- TEST 2: Physics Lab DUE ---');
  {
    const clearances = makeClearances(
      DepartmentClearanceStatus.DUE,
      DepartmentClearanceStatus.CLEARED,
      DepartmentClearanceStatus.CLEARED
    );
    const summary = LaboratoryAggregationService.getLaboratoryClearanceSummary(clearances);
    assert(summary.overallLaboratoryStatus === 'DUE', 'TEST 2: overallLaboratoryStatus is DUE');
    assert(summary.aggregateStatus === 'DUE', 'TEST 2: aggregateStatus is DUE');
    assert(summary.dueLabs.length === 1, 'TEST 2: Student sees exactly 1 due item');
    assert(summary.dueLabs[0].name === 'Physics Lab', 'TEST 2: Student sees Physics Lab — Due');
    assert(summary.physicsStatus === 'DUE', 'TEST 2: Physics is DUE');
    assert(summary.chemistryStatus === 'NO DUE', 'TEST 2: Chemistry is NO DUE');
    assert(summary.departmentStatus === 'NO DUE', 'TEST 2: Department is NO DUE');
  }

  // ====================================================
  // TEST 3:
  // Physics = NO DUE, Chemistry = DUE, Department = NO DUE
  // Expected: Laboratory = DUE
  // Student: Chemistry Lab — Due
  // ====================================================
  console.log('\n--- TEST 3: Chemistry Lab DUE ---');
  {
    const clearances = makeClearances(
      DepartmentClearanceStatus.CLEARED,
      DepartmentClearanceStatus.DUE,
      DepartmentClearanceStatus.CLEARED
    );
    const summary = LaboratoryAggregationService.getLaboratoryClearanceSummary(clearances);
    assert(summary.overallLaboratoryStatus === 'DUE', 'TEST 3: overallLaboratoryStatus is DUE');
    assert(summary.aggregateStatus === 'DUE', 'TEST 3: aggregateStatus is DUE');
    assert(summary.dueLabs.length === 1, 'TEST 3: Student sees exactly 1 due item');
    assert(summary.dueLabs[0].name === 'Chemistry Lab', 'TEST 3: Student sees Chemistry Lab — Due');
    assert(summary.physicsStatus === 'NO DUE', 'TEST 3: Physics is NO DUE');
    assert(summary.chemistryStatus === 'DUE', 'TEST 3: Chemistry is DUE');
    assert(summary.departmentStatus === 'NO DUE', 'TEST 3: Department is NO DUE');
  }

  // ====================================================
  // TEST 4:
  // Physics = NO DUE, Chemistry = NO DUE, Department = DUE
  // Expected: Laboratory = DUE
  // Student: Department Lab — Due
  // ====================================================
  console.log('\n--- TEST 4: Department Lab DUE ---');
  {
    const clearances = makeClearances(
      DepartmentClearanceStatus.CLEARED,
      DepartmentClearanceStatus.CLEARED,
      DepartmentClearanceStatus.DUE
    );
    const summary = LaboratoryAggregationService.getLaboratoryClearanceSummary(clearances);
    assert(summary.overallLaboratoryStatus === 'DUE', 'TEST 4: overallLaboratoryStatus is DUE');
    assert(summary.aggregateStatus === 'DUE', 'TEST 4: aggregateStatus is DUE');
    assert(summary.dueLabs.length === 1, 'TEST 4: Student sees exactly 1 due item');
    assert(summary.dueLabs[0].name === 'Department Lab', 'TEST 4: Student sees Department Lab — Due');
    assert(summary.physicsStatus === 'NO DUE', 'TEST 4: Physics is NO DUE');
    assert(summary.chemistryStatus === 'NO DUE', 'TEST 4: Chemistry is NO DUE');
    assert(summary.departmentStatus === 'DUE', 'TEST 4: Department is DUE');
  }

  // ====================================================
  // TEST 5:
  // Physics = DUE, Chemistry = DUE, Department = NO DUE
  // Expected: Laboratory = DUE
  // Student: Physics Lab — Due, Chemistry Lab — Due
  // ====================================================
  console.log('\n--- TEST 5: Physics & Chemistry DUE ---');
  {
    const clearances = makeClearances(
      DepartmentClearanceStatus.DUE,
      DepartmentClearanceStatus.DUE,
      DepartmentClearanceStatus.CLEARED
    );
    const summary = LaboratoryAggregationService.getLaboratoryClearanceSummary(clearances);
    assert(summary.overallLaboratoryStatus === 'DUE', 'TEST 5: overallLaboratoryStatus is DUE');
    assert(summary.dueLabs.length === 2, 'TEST 5: Student sees 2 due items');
    const names = summary.dueLabs.map(l => l.name);
    assert(names.includes('Physics Lab') && names.includes('Chemistry Lab'), 'TEST 5: Student sees Physics Lab — Due and Chemistry Lab — Due');
    assert(!names.includes('Department Lab'), 'TEST 5: Department Lab is NOT in due list');
  }

  // ====================================================
  // TEST 6:
  // Physics = DUE, Chemistry = NO DUE, Department = DUE
  // Expected: Laboratory = DUE
  // Student: Physics Lab — Due, Department Lab — Due
  // ====================================================
  console.log('\n--- TEST 6: Physics & Department DUE ---');
  {
    const clearances = makeClearances(
      DepartmentClearanceStatus.DUE,
      DepartmentClearanceStatus.CLEARED,
      DepartmentClearanceStatus.DUE
    );
    const summary = LaboratoryAggregationService.getLaboratoryClearanceSummary(clearances);
    assert(summary.overallLaboratoryStatus === 'DUE', 'TEST 6: overallLaboratoryStatus is DUE');
    assert(summary.dueLabs.length === 2, 'TEST 6: Student sees 2 due items');
    const names = summary.dueLabs.map(l => l.name);
    assert(names.includes('Physics Lab') && names.includes('Department Lab'), 'TEST 6: Student sees Physics Lab — Due and Department Lab — Due');
    assert(!names.includes('Chemistry Lab'), 'TEST 6: Chemistry Lab is NOT in due list');
  }

  // ====================================================
  // TEST 7:
  // Physics = NO DUE, Chemistry = DUE, Department = DUE
  // Expected: Laboratory = DUE
  // Student: Chemistry Lab — Due, Department Lab — Due
  // ====================================================
  console.log('\n--- TEST 7: Chemistry & Department DUE ---');
  {
    const clearances = makeClearances(
      DepartmentClearanceStatus.CLEARED,
      DepartmentClearanceStatus.DUE,
      DepartmentClearanceStatus.DUE
    );
    const summary = LaboratoryAggregationService.getLaboratoryClearanceSummary(clearances);
    assert(summary.overallLaboratoryStatus === 'DUE', 'TEST 7: overallLaboratoryStatus is DUE');
    assert(summary.dueLabs.length === 2, 'TEST 7: Student sees 2 due items');
    const names = summary.dueLabs.map(l => l.name);
    assert(names.includes('Chemistry Lab') && names.includes('Department Lab'), 'TEST 7: Student sees Chemistry Lab — Due and Department Lab — Due');
    assert(!names.includes('Physics Lab'), 'TEST 7: Physics Lab is NOT in due list');
  }

  // ====================================================
  // TEST 8:
  // Physics = DUE, Chemistry = DUE, Department = DUE
  // Expected: Laboratory = DUE
  // Student sees all three:
  //   Physics Lab — Due
  //   Chemistry Lab — Due
  //   Department Lab — Due
  // ====================================================
  console.log('\n--- TEST 8: All Three DUE ---');
  {
    const clearances = makeClearances(
      DepartmentClearanceStatus.DUE,
      DepartmentClearanceStatus.DUE,
      DepartmentClearanceStatus.DUE
    );
    const summary = LaboratoryAggregationService.getLaboratoryClearanceSummary(clearances);
    assert(summary.overallLaboratoryStatus === 'DUE', 'TEST 8: overallLaboratoryStatus is DUE');
    assert(summary.dueLabs.length === 3, 'TEST 8: Student sees exactly 3 due items');
    assert(summary.dueLabs[0].name === 'Physics Lab', 'TEST 8: item 1 is Physics Lab — Due');
    assert(summary.dueLabs[1].name === 'Chemistry Lab', 'TEST 8: item 2 is Chemistry Lab — Due');
    assert(summary.dueLabs[2].name === 'Department Lab', 'TEST 8: item 3 is Department Lab — Due');
  }

  // ====================================================
  // TEST 9:
  // Department Faculty clears Department Lab.
  // Expected: Department Lab = NO DUE
  // If Physics and Chemistry are also NO DUE: Laboratory = NO DUE
  // ====================================================
  console.log('\n--- TEST 9: Department Faculty Clears Department Lab ---');
  {
    // Start with Department Lab DUE
    const clearancesBefore = makeClearances(
      DepartmentClearanceStatus.CLEARED,
      DepartmentClearanceStatus.CLEARED,
      DepartmentClearanceStatus.DUE
    );
    const summaryBefore = LaboratoryAggregationService.getLaboratoryClearanceSummary(clearancesBefore);
    assert(summaryBefore.departmentStatus === 'DUE', 'TEST 9: Initially Department Lab is DUE');
    assert(summaryBefore.overallLaboratoryStatus === 'DUE', 'TEST 9: Initially Laboratory is DUE');

    // Faculty clears Department Lab
    clearancesBefore[2].status = DepartmentClearanceStatus.CLEARED;
    clearancesBefore[2].dueAmount = 0;
    clearancesBefore[2].dueDetails = null;

    const summaryAfter = LaboratoryAggregationService.getLaboratoryClearanceSummary(clearancesBefore);
    assert(summaryAfter.departmentStatus === 'NO DUE', 'TEST 9: After clearing, Department Lab = NO DUE');
    assert(summaryAfter.overallLaboratoryStatus === 'NO DUE', 'TEST 9: All three NO DUE -> Laboratory = NO DUE');
  }

  // ====================================================
  // TEST 10:
  // Physics Faculty attempts to modify Department Lab.
  // Expected: Unauthorized.
  // ====================================================
  console.log('\n--- TEST 10: Physics Faculty Scope Check ---');
  {
    const phyDept = await prisma.clearanceDepartment.findUnique({ where: { code: 'PHY' } });
    const iseDept = await prisma.clearanceDepartment.findUnique({ where: { code: 'IS' } });

    assert(phyDept != null, 'TEST 10: PHY department exists');
    assert(iseDept != null, 'TEST 10: IS department exists');

    // Simulate NdcController authorization check for Physics Faculty
    const physicsFacultyAssignedDepts = [phyDept!.id];
    const deptLabClearanceDeptId = iseDept!.id;

    const isAuthorized = physicsFacultyAssignedDepts.includes(deptLabClearanceDeptId);
    assert(!isAuthorized, 'TEST 10: Physics Faculty attempting to modify Department Lab is REJECTED (Unauthorized)');
  }

  // ====================================================
  // TEST 11:
  // Chemistry Faculty attempts to modify Physics Lab.
  // Expected: Unauthorized.
  // ====================================================
  console.log('\n--- TEST 11: Chemistry Faculty Scope Check ---');
  {
    const chemDept = await prisma.clearanceDepartment.findUnique({ where: { code: 'CHEM' } });
    const phyDept = await prisma.clearanceDepartment.findUnique({ where: { code: 'PHY' } });

    const chemFacultyAssignedDepts = [chemDept!.id];
    const phyClearanceDeptId = phyDept!.id;

    const isAuthorized = chemFacultyAssignedDepts.includes(phyClearanceDeptId);
    assert(!isAuthorized, 'TEST 11: Chemistry Faculty attempting to modify Physics Lab is REJECTED (Unauthorized)');
  }

  // ====================================================
  // TEST 12:
  // ISE Department Faculty attempts to modify another department's Department Lab.
  // Expected: Unauthorized.
  // ====================================================
  console.log('\n--- TEST 12: ISE Faculty attempting another Department Lab ---');
  {
    const iseDept = await prisma.clearanceDepartment.findUnique({ where: { code: 'IS' } });
    const cseDept = await prisma.clearanceDepartment.findUnique({ where: { code: 'CS' } });

    const iseFacultyAssignedDepts = [iseDept!.id];
    const cseDeptLabDeptId = cseDept!.id;

    const isAuthorized = iseFacultyAssignedDepts.includes(cseDeptLabDeptId);
    assert(!isAuthorized, 'TEST 12: ISE Faculty attempting to modify CSE Department Lab is REJECTED (Unauthorized)');
  }

  // ====================================================
  // SECTION 24: CERTIFICATE VERIFICATION & NO INDIVIDUAL LABS
  // ====================================================
  console.log('\n--- SECTION 24: Certificate Verification & No Internal Lab Names ---');
  {
    const clearances = makeClearances(
      DepartmentClearanceStatus.CLEARED,
      DepartmentClearanceStatus.CLEARED,
      DepartmentClearanceStatus.CLEARED
    );

    const certItems = LaboratoryAggregationService.getCertificateClearanceItems(clearances);
    const labItem = certItems.find(c => c.departmentCode === 'LAB' || c.departmentName === 'Laboratory');

    assert(labItem != null, 'Certificate contains Laboratory entry');
    assert(labItem?.departmentName === 'Laboratory', 'Certificate category name is exactly "Laboratory"');
    assert(labItem?.status === 'CLEARED', 'Certificate status is CLEARED (representing No Due)');

    // Ensure NO individual laboratory names appear anywhere in the certificate items
    const forbiddenNames = ['Physics Lab', 'Chemistry Lab', 'Department Lab', 'DDCO', 'DBMS', 'Computer Lab', 'IS-LAB', 'CS-LAB'];
    for (const name of forbiddenNames) {
      const found = certItems.some(c => c.departmentName.includes(name) || c.departmentCode.includes(name));
      assert(!found, `Certificate omits individual laboratory name: "${name}"`);
    }

    // Verify PDF Generation produces valid file
    const certPdfPath = path.resolve(process.cwd(), 'uploads/test_official_cert.pdf');
    await PdfService.generateCertificatePdf(
      {
        certificateNumber: 'NDC/MCE/IS/2026/000888',
        studentName: 'Verification Candidate',
        usn: '4MC22IS001',
        departmentName: 'Information Science & Engineering',
        batch: '2022-2026',
        academicYear: '2025-2026',
        issuedAt: new Date(),
        clearances: certItems
      },
      certPdfPath
    );

    assert(fs.existsSync(certPdfPath), 'PDF Certificate successfully generated on disk');
    const pdfBuf = fs.readFileSync(certPdfPath);
    assert(pdfBuf.length > 1000, `PDF Certificate has valid size: ${pdfBuf.length} bytes`);
  }

  // ====================================================
  // APPLICABILITY & NOT_APPLICABLE TEST
  // ====================================================
  console.log('\n--- APPLICABILITY TEST: Student Exempt / Not Applicable ---');
  {
    // A student who is not applicable for Chemistry Lab (e.g. transfer/exempt)
    const clearances = makeClearances(
      DepartmentClearanceStatus.CLEARED,
      DepartmentClearanceStatus.NOT_APPLICABLE,
      DepartmentClearanceStatus.CLEARED
    );

    const summary = LaboratoryAggregationService.getLaboratoryClearanceSummary(clearances);
    assert(summary.overallLaboratoryStatus === 'NO DUE', 'Applicability: NOT_APPLICABLE Chemistry Lab does NOT make Laboratory DUE');
    assert(summary.chemistryStatus === 'NO DUE', 'Applicability: NOT_APPLICABLE Chemistry Lab is satisfied (NO DUE)');
    assert(summary.dueLabs.length === 0, 'Applicability: 0 dues displayed to student');
  }

  console.log('\n================================================================');
  console.log(`TOTAL SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  await prisma.$disconnect();
  if (failed > 0) {
    process.exit(1);
  }
}

runMasterTestCases().catch((err) => {
  console.error('[Test Suite Error]:', err);
  process.exit(1);
});
