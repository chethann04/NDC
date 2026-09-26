import prisma from '../src/config/prisma';
import { LaboratoryAggregationService } from '../src/services/LaboratoryAggregationService';
import { NdcWorkflowService } from '../src/services/NdcWorkflowService';

const BASE_URL = 'http://localhost:5000/api/v1';

async function testArchitecture() {
  console.log('============================================================');
  console.log('🧪 TESTING END-TO-END 3-ITEM LABORATORY ARCHITECTURE');
  console.log('============================================================\n');

  // Helper for requests
  async function request(url: string, options: any = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const data = await res.json();
    return { status: res.status, ok: res.ok, data };
  }

  // 1. Verify Logins
  console.log('--- 1. TESTING INDEPENDENT LOGINS ---');
  
  // Physics Login
  const phyLogin = await request(`${BASE_URL}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ loginId: 'PHY001', password: 'Officer@123' })
  });
  console.log('✓ Physics Login [PHY001]:', phyLogin.ok, '| User:', phyLogin.data.user.name);
  const phyToken = phyLogin.data.token;

  // Chemistry Login
  const chemLogin = await request(`${BASE_URL}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ loginId: 'CHEM001', password: 'Officer@123' })
  });
  console.log('✓ Chemistry Login [CHEM001]:', chemLogin.ok, '| User:', chemLogin.data.user.name);
  const chemToken = chemLogin.data.token;

  // Department Faculty Login (ISE)
  const iseLogin = await request(`${BASE_URL}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ loginId: 'ISE001', password: 'Officer@123' })
  });
  console.log('✓ ISE Faculty Login [ISE001]:', iseLogin.ok, '| User:', iseLogin.data.user.name);
  const iseToken = iseLogin.data.token;

  // 2. Identify target student in ISE
  console.log('\n--- 2. VERIFYING STUDENT 3-LAB CLEARANCE STRUCTURE ---');
  let student = await prisma.student.findFirst({
    where: { department: { code: 'IS' } },
    include: { department: true }
  });

  if (!student) {
    throw new Error('No ISE student found.');
  }
  console.log(`Target Student: ${student.fullName} (${student.usn}) | Dept: ${student.department.code}`);

  // Ensure student has NDC request
  const ndcRequest = await NdcWorkflowService.ensureStudentNdcRequest(student.id);
  console.log('NDC Request Number:', ndcRequest.requestNumber);

  // Fetch clearances for this request
  const clearances = await prisma.ndcClearance.findMany({
    where: { ndcRequestId: ndcRequest.id },
    include: { department: true, lab: true }
  });

  const phyClearance = clearances.find((c) => c.department.code === 'PHY');
  const chemClearance = clearances.find((c) => c.department.code === 'CHEM');
  const deptLabClearance = clearances.find((c) => c.labId != null);
  const iseDeskClearance = clearances.find((c) => c.department.code === 'IS' && c.labId == null);

  console.log('Found Clearances:');
  console.log('  1. Physics Lab Clearance ID:', phyClearance?.id, '| Status:', phyClearance?.status);
  console.log('  2. Chemistry Lab Clearance ID:', chemClearance?.id, '| Status:', chemClearance?.status);
  console.log('  3. Department Lab Clearance ID:', deptLabClearance?.id, '| Lab:', deptLabClearance?.lab?.name, '| Status:', deptLabClearance?.status);
  console.log('  (Academic Desk Clearance ID:', iseDeskClearance?.id, '| Status:', iseDeskClearance?.status, ')');

  if (!phyClearance || !chemClearance || !deptLabClearance) {
    throw new Error('Student missing one of the 3 required lab clearances!');
  }

  // 3. Test Clearance Workflows & Scopes
  console.log('\n--- 3. TESTING INDEPENDENT CLEARANCE WORKFLOWS ---');

  // A. Physics Officer updates Physics Lab
  console.log('Action A: Physics Officer marks Physics Lab DUE (Apparatus breakage: ₹350)...');
  const phyUpdate = await request(`${BASE_URL}/ndc/clearance/${phyClearance.id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${phyToken}` },
    body: JSON.stringify({
      status: 'DUE',
      dueAmount: 350,
      dueDetails: 'Spectrometer prism chipped',
      remarks: 'Physics apparatus breakage'
    })
  });
  if (!phyUpdate.ok) throw new Error(`Physics update failed: ${JSON.stringify(phyUpdate.data)}`);
  console.log('✓ Physics Lab updated successfully by PHY001.');

  // Verify Physics Officer CANNOT update Chemistry Lab (Cross-scope authorization guard)
  const crossUpdate = await request(`${BASE_URL}/ndc/clearance/${chemClearance.id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${phyToken}` },
    body: JSON.stringify({ status: 'CLEARED' })
  });
  if (crossUpdate.ok) {
    throw new Error('❌ FAIL: Physics officer was able to update Chemistry clearance!');
  }
  console.log('✓ Security Verified: Physics Officer blocked from Chemistry Lab (HTTP', crossUpdate.status, crossUpdate.data?.message, ')');

  // B. Chemistry Officer updates Chemistry Lab
  console.log('\nAction B: Chemistry Officer marks Chemistry Lab CLEARED (No Due)...');
  const chemUpdate = await request(`${BASE_URL}/ndc/clearance/${chemClearance.id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${chemToken}` },
    body: JSON.stringify({
      status: 'CLEARED',
      dueAmount: 0,
      remarks: 'All glassware returned in good condition'
    })
  });
  if (!chemUpdate.ok) throw new Error(`Chemistry update failed: ${JSON.stringify(chemUpdate.data)}`);
  console.log('✓ Chemistry Lab updated successfully by CHEM001.');

  // C. Department Faculty updates Department Lab
  console.log('\nAction C: Department Faculty marks Department Lab CLEARED (No Due)...');
  const deptUpdate = await request(`${BASE_URL}/ndc/clearance/${deptLabClearance.id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${iseToken}` },
    body: JSON.stringify({
      status: 'CLEARED',
      dueAmount: 0,
      remarks: 'IoT kits & computer lab systems verified'
    })
  });
  if (!deptUpdate.ok) throw new Error(`Department Lab update failed: ${JSON.stringify(deptUpdate.data)}`);
  console.log('✓ Department Lab updated successfully by ISE001.');

  // 4. Test Aggregated Roll-up Status
  console.log('\n--- 4. TESTING AGGREGATED LABORATORY STATUS ROLL-UP ---');
  let summary = await LaboratoryAggregationService.getLaboratoryClearanceSummaryByStudentId(student.id);
  console.log('Current Constituent Statuses:');
  console.log('  - Physics Lab Status:', summary.physicsStatus, '| Due:', summary.physicsLab.dueAmount, summary.physicsLab.dueDetails);
  console.log('  - Chemistry Lab Status:', summary.chemistryStatus);
  console.log('  - Department Lab Status:', summary.departmentStatus);
  console.log('>>> Overall Laboratory Status:', summary.overallLaboratoryStatus);
  console.log('>>> Laboratory Due Labs Count:', summary.dueLabs.length, '| Names:', summary.dueLabs.map((l) => l.name));

  if (summary.overallLaboratoryStatus !== 'DUE' || summary.dueLabs[0]?.name !== 'Physics Lab') {
    throw new Error('Expected overall Laboratory to be DUE because Physics Lab is DUE!');
  }
  console.log('✓ Verified: Physics Lab DUE causes aggregated Laboratory = DUE!');

  // Now clear Physics Lab
  console.log('\nAction D: Physics Officer clears the due on Physics Lab...');
  const phyClear = await request(`${BASE_URL}/ndc/clearance/${phyClearance.id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${phyToken}` },
    body: JSON.stringify({
      status: 'CLEARED',
      dueAmount: 0,
      remarks: 'Apparatus dues settled'
    })
  });
  if (!phyClear.ok) throw new Error(`Physics clear failed: ${JSON.stringify(phyClear.data)}`);

  summary = await LaboratoryAggregationService.getLaboratoryClearanceSummaryByStudentId(student.id);
  console.log('New Constituent Statuses:');
  console.log('  - Physics Lab Status:', summary.physicsStatus);
  console.log('  - Chemistry Lab Status:', summary.chemistryStatus);
  console.log('  - Department Lab Status:', summary.departmentStatus);
  console.log('>>> Overall Laboratory Status:', summary.overallLaboratoryStatus);

  if (summary.overallLaboratoryStatus !== 'NO DUE') {
    throw new Error('Expected overall Laboratory to be NO DUE because all 3 are CLEARED!');
  }
  console.log('✓ Verified: All 3 CLEARED causes aggregated Laboratory = NO DUE!');

  // 5. Test Certificate Output
  console.log('\n--- 5. TESTING OFFICIAL CERTIFICATE ROW AGGREGATION ---');
  const certClearances = await prisma.ndcClearance.findMany({
    where: { ndcRequestId: ndcRequest.id },
    include: { department: true, lab: true }
  });
  const rows = LaboratoryAggregationService.getCertificateClearanceItems(certClearances);
  console.log('Certificate Clearance Table Rows:');
  rows.forEach((r: any) => {
    console.log(`  - [${r.departmentCode}] ${r.departmentName} -> Status: ${r.status}`);
  });

  const labRows = rows.filter((r: any) => r.departmentName.toLowerCase().includes('lab'));
  console.log(`Found ${labRows.length} laboratory rows in certificate table.`);

  if (labRows.length !== 1 || labRows[0].departmentName !== 'Laboratory') {
    throw new Error('Certificate must contain EXACTLY ONE row named "Laboratory"!');
  }
  console.log('✓ Verified: Certificate output contains EXACTLY ONE "Laboratory" row!');

  console.log('\n============================================================');
  console.log('🎉 ALL 3-ITEM LABORATORY ARCHITECTURE TESTS PASSED SUCCESSFULLY!');
  console.log('============================================================');
}

testArchitecture()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test Failed:', err);
    process.exit(1);
  });
