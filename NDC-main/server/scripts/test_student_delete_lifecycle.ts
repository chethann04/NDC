import prisma from '../src/config/prisma';

const BASE_URL = 'http://localhost:5000/api/v1';

async function request(url: string, options: any = {}) {
  const fullUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const body = options.data ? JSON.stringify(options.data) : (options.body ? JSON.stringify(options.body) : undefined);
  
  const res = await fetch(fullUrl, {
    method: options.method || 'GET',
    headers,
    body
  });

  let data: any = null;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return {
    status: res.status,
    ok: res.ok,
    data
  };
}

async function getAdminToken(): Promise<string> {
  const res = await request('/auth/login', {
    method: 'POST',
    data: {
      email: 'superadmin@mce.ac.in',
      password: 'Admin@123'
    }
  });
  if (!res.data?.token) {
    throw new Error(`Failed to login as admin: ${JSON.stringify(res.data)}`);
  }
  return res.data.token;
}

async function runTests() {
  console.log('================================================================');
  console.log('STARTING STUDENT DELETE & ARCHIVE LIFECYCLE VERIFICATION');
  console.log('================================================================\n');

  const adminToken = await getAdminToken();
  const authHeaders = { headers: { Authorization: `Bearer ${adminToken}` } };

  // Get department for test students
  const dept = await prisma.clearanceDepartment.findFirst({ where: { code: 'IS' } }) 
    || await prisma.clearanceDepartment.findFirst();
  if (!dept) throw new Error('No department found in DB.');

  // ==========================================================================
  // SCENARIO 1: Delete a student with no dependencies
  // ==========================================================================
  console.log('--- TEST 1: Deleting a student with NO dependencies ---');
  const dummyUsn1 = '4MC99TEST01';
  // Cleanup any leftover
  await prisma.user.deleteMany({ where: { email: 'dummy1@mce.ac.in' } });
  await prisma.student.deleteMany({ where: { usn: dummyUsn1 } });

  const student1 = await prisma.student.create({
    data: {
      studentId: `STU-${dummyUsn1}`,
      usn: dummyUsn1,
      fullName: 'Test Student NoDeps',
      email: 'dummy1@mce.ac.in',
      departmentId: dept.id,
      batch: '2022-2026',
      academicYear: '2025-2026',
      section: 'A',
      isActive: true
    }
  });
  console.log(`Created test student 1: ${student1.id} (${student1.usn})`);

  // Attempt delete
  const delRes1 = await request(`/students/${student1.id}`, {
    method: 'DELETE',
    data: { remarks: 'Test deletion with no dependencies' },
    ...authHeaders
  });
  console.log('Delete response status:', delRes1.status);
  console.log('Delete response body:', delRes1.data);

  const check1 = await prisma.student.findUnique({ where: { id: student1.id } });
  if (check1) throw new Error('Test 1 Failed: Student was not deleted!');
  console.log('✔ TEST 1 PASSED: Student with no dependencies deleted successfully.\n');

  // ==========================================================================
  // SCENARIO 2: Delete a student with active NDC request & clearances (no certificate)
  // ==========================================================================
  console.log('--- TEST 2: Deleting a student with active NDC request and clearances ---');
  const dummyUsn2 = '4MC99TEST02';
  await prisma.ndcClearance.deleteMany({ where: { student: { usn: dummyUsn2 } } });
  await prisma.ndcRequest.deleteMany({ where: { student: { usn: dummyUsn2 } } });
  await prisma.user.deleteMany({ where: { email: 'dummy2@mce.ac.in' } });
  await prisma.student.deleteMany({ where: { usn: dummyUsn2 } });

  const student2 = await prisma.student.create({
    data: {
      studentId: `STU-${dummyUsn2}`,
      usn: dummyUsn2,
      fullName: 'Test Student WithRequests',
      email: 'dummy2@mce.ac.in',
      departmentId: dept.id,
      batch: '2022-2026',
      academicYear: '2025-2026',
      section: 'A',
      isActive: true
    }
  });

  const request2 = await prisma.ndcRequest.create({
    data: {
      requestNumber: `REQ-TEST-${Date.now()}`,
      studentId: student2.id,
      status: 'PENDING'
    }
  });

  await prisma.ndcClearance.create({
    data: {
      ndcRequestId: request2.id,
      studentId: student2.id,
      departmentId: dept.id,
      status: 'PENDING'
    }
  });
  console.log(`Created test student 2 with request ${request2.id} and clearance.`);

  const delRes2 = await request(`/students/${student2.id}`, {
    method: 'DELETE',
    data: { remarks: 'Test deletion with active request and clearances' },
    ...authHeaders
  });
  console.log('Delete response status:', delRes2.status);
  console.log('Delete response body:', delRes2.data);

  const check2Stu = await prisma.student.findUnique({ where: { id: student2.id } });
  const check2Req = await prisma.ndcRequest.findFirst({ where: { studentId: student2.id } });
  const check2Clr = await prisma.ndcClearance.findFirst({ where: { studentId: student2.id } });

  if (check2Stu || check2Req || check2Clr) {
    throw new Error('Test 2 Failed: Dependent records or student were not cleaned up properly!');
  }
  console.log('✔ TEST 2 PASSED: Student and dependent requests/clearances cleanly removed in transaction.\n');

  // ==========================================================================
  // SCENARIO 3: Deleting a student with an issued NDC certificate (MUST BE BLOCKED)
  // ==========================================================================
  console.log('--- TEST 3: Attempting to delete a student with an ISSUED CERTIFICATE ---');
  const dummyUsn3 = '4MC99TEST03';
  await prisma.ndcCertificate.deleteMany({ where: { student: { usn: dummyUsn3 } } });
  await prisma.ndcClearance.deleteMany({ where: { student: { usn: dummyUsn3 } } });
  await prisma.ndcRequest.deleteMany({ where: { student: { usn: dummyUsn3 } } });
  await prisma.user.deleteMany({ where: { email: 'dummy3@mce.ac.in' } });
  await prisma.student.deleteMany({ where: { usn: dummyUsn3 } });

  const testDob = new Date('2004-06-15T00:00:00.000Z');
  const student3 = await prisma.student.create({
    data: {
      studentId: `STU-${dummyUsn3}`,
      usn: dummyUsn3,
      fullName: 'Test Student WithCert',
      email: 'dummy3@mce.ac.in',
      departmentId: dept.id,
      departmentName: dept.name,
      batch: '2022-2026',
      academicYear: '2025-2026',
      section: 'A',
      dateOfBirth: testDob,
      isActive: true
    }
  });

  const request3 = await prisma.ndcRequest.create({
    data: {
      requestNumber: `REQ-CERT-${Date.now()}`,
      studentId: student3.id,
      status: 'APPROVED'
    }
  });

  const certNumber3 = `NDC/MCE/TEST/${Date.now().toString().slice(-6)}`;
  const cert3 = await prisma.ndcCertificate.create({
    data: {
      certificateNumber: certNumber3,
      ndcRequestId: request3.id,
      studentId: student3.id,
      studentName: student3.fullName,
      studentUsn: student3.usn,
      departmentName: dept.name,
      status: 'VALID'
    }
  });
  console.log(`Created test student 3 with Certificate: ${cert3.certificateNumber}`);

  const delRes3 = await request(`/students/${student3.id}`, {
    method: 'DELETE',
    data: { remarks: 'Attempt to delete student with certificate' },
    ...authHeaders
  });

  console.log('Delete response status:', delRes3.status);
  console.log('Error Code:', delRes3.data?.code);
  console.log('Error Message:', delRes3.data?.message);

  if (delRes3.status !== 400 || delRes3.data?.code !== 'CERTIFICATE_EXISTS') {
    throw new Error('Test 3 Failed: Deletion was NOT blocked with CERTIFICATE_EXISTS!');
  }

  // Verify certificate and student still exist in DB
  const cert3Check = await prisma.ndcCertificate.findUnique({ where: { id: cert3.id } });
  const stu3Check = await prisma.student.findUnique({ where: { id: student3.id } });
  if (!cert3Check || !stu3Check) {
    throw new Error('Test 3 Failed: Certificate or Student was accidentally deleted!');
  }
  console.log('✔ TEST 3 PASSED: Physical deletion safely blocked; certificate preserved intact.\n');

  // ==========================================================================
  // SCENARIO 4: Deactivate / Archive a student with a certificate
  // ==========================================================================
  console.log('--- TEST 4: Deactivating/Archiving student with certificate ---');
  const deactRes = await request(`/students/${student3.id}/deactivate`, {
    method: 'PUT',
    ...authHeaders
  });
  console.log('Deactivate response status:', deactRes.status);
  console.log('Deactivate response body:', deactRes.data);

  const stu3Archived = await prisma.student.findUnique({ where: { id: student3.id } });
  if (!stu3Archived || stu3Archived.isActive !== false) {
    throw new Error('Test 4 Failed: Student was not marked isActive = false!');
  }
  console.log('✔ TEST 4 PASSED: Student successfully deactivated/archived with isActive: false.\n');

  // ==========================================================================
  // SCENARIO 5: Login behavior for archived students (MUST RETURN 403)
  // ==========================================================================
  console.log('--- TEST 5: Student Login behavior for ARCHIVED student ---');
  const loginRes5 = await request('/auth/student-login', {
    method: 'POST',
    data: {
      usn: dummyUsn3,
      dob: '2004-06-15'
    }
  });

  console.log('Login HTTP status:', loginRes5.status);
  console.log('Login Message:', loginRes5.data?.message);

  if (loginRes5.status !== 403) {
    throw new Error(`Test 5 Failed: Inactive student was able to log in or received wrong status ${loginRes5.status}!`);
  }
  console.log('✔ TEST 5 PASSED: Archived student login correctly rejected with 403 Forbidden.\n');

  // ==========================================================================
  // SCENARIO 6: Certificate verification after student archival
  // ==========================================================================
  console.log('--- TEST 6: Public certificate verification for ARCHIVED student ---');
  const verifyRes = await request('/verify', {
    method: 'POST',
    data: {
      certificateNumber: certNumber3
    },
    ...authHeaders
  });
  console.log('Verify response status:', verifyRes.status);
  console.log('Verify response body:', verifyRes.data);

  if (verifyRes.data?.status !== 'VALID' || (verifyRes.data?.certificate?.studentUsn !== dummyUsn3 && verifyRes.data?.certificate?.usn !== dummyUsn3)) {
    throw new Error('Test 6 Failed: Certificate verification failed or snapshot missing!');
  }
  console.log('✔ TEST 6 PASSED: Certificate verification succeeds perfectly for archived student.\n');

  // ==========================================================================
  // SCENARIO 7: Reactivate student and verify login restored
  // ==========================================================================
  console.log('--- TEST 7: Reactivating student ---');
  const reactRes = await request(`/students/${student3.id}/reactivate`, {
    method: 'PUT',
    ...authHeaders
  });
  console.log('Reactivate response status:', reactRes.status);
  console.log('Reactivate response body:', reactRes.data);

  const stu3Reactivated = await prisma.student.findUnique({ where: { id: student3.id } });
  if (!stu3Reactivated || stu3Reactivated.isActive !== true) {
    throw new Error('Test 7 Failed: Student was not marked isActive = true!');
  }

  // Attempt login now
  const loginRes7 = await request('/auth/student-login', {
    method: 'POST',
    data: {
      usn: dummyUsn3,
      dob: '2004-06-15'
    }
  });
  console.log('Reactivated student login status:', loginRes7.status);
  if (loginRes7.status !== 200 || !loginRes7.data?.token) {
    throw new Error('Test 7 Failed: Reactivated student could not log in!');
  }
  console.log('✔ TEST 7 PASSED: Reactivated student logged in successfully!\n');

  // Cleanup test artifacts
  await prisma.ndcCertificate.deleteMany({ where: { id: cert3.id } });
  await prisma.ndcClearance.deleteMany({ where: { ndcRequestId: request3.id } });
  await prisma.ndcRequest.deleteMany({ where: { id: request3.id } });
  await prisma.student.deleteMany({ where: { id: student3.id } });

  console.log('================================================================');
  console.log('ALL 7 LIFECYCLE TESTS COMPLETED & PASSED WITH 100% SUCCESS!');
  console.log('================================================================');
}

runTests().catch((err) => {
  console.error('TEST ERROR:', err);
  process.exit(1);
});
