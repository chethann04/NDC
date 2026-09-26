import prisma from '../src/config/prisma';

const BASE_URL = 'http://localhost:5000/api/v1';

async function runTests() {
  console.log('--- STARTING SECTION CREATION VERIFICATION TESTS ---');

  // 1. Super Admin Login
  console.log('\n[1] Authenticating as Super Admin...');
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'superadmin@mce.ac.in',
      password: 'Admin@123'
    })
  });

  const loginData: any = await loginRes.json();
  const token = loginData.token || loginData.accessToken || loginData.data?.token;
  if (!token) {
    throw new Error(`Login failed: ${JSON.stringify(loginData)}`);
  }
  console.log('Super Admin authenticated successfully.');

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };

  // Clean up any previous test artifacts first
  const existingDept = await prisma.clearanceDepartment.findFirst({
    where: { code: 'TEST_AI' }
  });
  if (existingDept) {
    await prisma.ndcClearance.deleteMany({ where: { departmentId: existingDept.id } });
    await prisma.clearanceOfficerDepartment.deleteMany({ where: { departmentId: existingDept.id } });
    await prisma.departmentLab.deleteMany({ where: { departmentId: existingDept.id } });
    await prisma.clearanceOfficer.deleteMany({ where: { email: { in: ['test.hod.ai@mce.ac.in', 'test.fac.ai@mce.ac.in'] } } });
    await prisma.user.deleteMany({ where: { email: { in: ['test.hod.ai@mce.ac.in', 'test.fac.ai@mce.ac.in'] } } });
    await prisma.clearanceDepartment.delete({ where: { id: existingDept.id } });
  }

  // 2. Test Adding Department
  console.log('\n[2] Testing Super Admin creating Department Section...');
  const deptPayload = {
    name: 'Test Artificial Intelligence & Data Science',
    code: 'TEST_AI',
    category: 'ACADEMIC_BRANCH',
    requiresClearance: true,
    hodName: 'Dr. Test Kumar',
    description: 'Department for AI and Machine Learning research'
  };

  const createDeptRes = await fetch(`${BASE_URL}/admin/section-logins/department`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(deptPayload)
  });

  const createDeptData: any = await createDeptRes.json();
  console.log('Status code:', createDeptRes.status);
  console.log('Created department:', createDeptData.data?.name, `(${createDeptData.data?.code})`);

  if (!createDeptRes.ok) {
    throw new Error(`Failed to create department: ${JSON.stringify(createDeptData)}`);
  }

  const createdDeptId = createDeptData.data.id;

  // Verify DepartmentLab auto-created
  const lab = await prisma.departmentLab.findUnique({
    where: { departmentId: createdDeptId }
  });
  console.log('Auto-provisioned Department Lab:', lab?.code, lab?.name);
  if (!lab) {
    throw new Error('Department Lab was not auto-provisioned!');
  }

  // 3. Test Adding HOD
  console.log('\n[3] Testing Super Admin creating HOD Account...');
  const hodPayload = {
    name: 'Dr. Test Kumar',
    email: 'test.hod.ai@mce.ac.in',
    loginId: 'HOD-TEST-AI',
    departmentId: createdDeptId,
    password: 'Password@123'
  };

  const createHodRes = await fetch(`${BASE_URL}/admin/section-logins/hod`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(hodPayload)
  });

  const createHodData: any = await createHodRes.json();
  console.log('Status code:', createHodRes.status);
  console.log('Created HOD account:', createHodData.data?.name, createHodData.data?.email, createHodData.data?.role);

  if (!createHodRes.ok) {
    throw new Error(`Failed to create HOD: ${JSON.stringify(createHodData)}`);
  }

  // Test HOD Login with credentials
  const hodLoginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'test.hod.ai@mce.ac.in',
      password: 'Password@123'
    })
  });
  const hodLoginData: any = await hodLoginRes.json();
  console.log('HOD login verified successfully! Token received, role:', hodLoginData.data?.user?.role);
  if (!hodLoginRes.ok) {
    throw new Error(`Failed to login as HOD: ${JSON.stringify(hodLoginData)}`);
  }

  // 4. Test Adding Faculty Section / Officer
  console.log('\n[4] Testing Super Admin creating Faculty Section Officer...');
  const facultyPayload = {
    name: 'Prof. Test Faculty',
    email: 'test.fac.ai@mce.ac.in',
    employeeId: 'EMP-TEST-AI-01',
    loginId: 'FAC-TEST-AI-01',
    departmentId: createdDeptId,
    password: 'Password@123'
  };

  const createFacultyRes = await fetch(`${BASE_URL}/admin/section-logins/faculty`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(facultyPayload)
  });

  const createFacultyData: any = await createFacultyRes.json();
  console.log('Status code:', createFacultyRes.status);
  console.log('Created Faculty account:', createFacultyData.data?.name, createFacultyData.data?.email, createFacultyData.data?.employeeId);

  if (!createFacultyRes.ok) {
    throw new Error(`Failed to create Faculty: ${JSON.stringify(createFacultyData)}`);
  }

  // Test Faculty Login with credentials
  const facLoginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'test.fac.ai@mce.ac.in',
      password: 'Password@123'
    })
  });
  const facLoginData: any = await facLoginRes.json();
  console.log('Faculty login verified successfully! Token received, role:', facLoginData.data?.user?.role);
  if (!facLoginRes.ok) {
    throw new Error(`Failed to login as Faculty: ${JSON.stringify(facLoginData)}`);
  }

  // 5. Test Audit Logs
  console.log('\n[5] Verifying Audit Logs for creation events...');
  const auditLogs = await prisma.auditLog.findMany({
    where: {
      action: { in: ['CREATE_DEPARTMENT_SECTION', 'CREATE_HOD_ACCOUNT', 'CREATE_FACULTY_ACCOUNT'] }
    },
    orderBy: { timestamp: 'desc' },
    take: 3
  });
  console.log(`Found ${auditLogs.length} recent creation audit log entries:`);
  for (const log of auditLogs) {
    console.log(` - Action: ${log.action} | Target: ${log.entityType} (${log.entityId}) | Description: ${log.description}`);
  }

  // Clean up test data
  console.log('\n[6] Cleaning up test data...');
  await prisma.ndcClearance.deleteMany({ where: { departmentId: createdDeptId } });
  await prisma.clearanceOfficerDepartment.deleteMany({ where: { departmentId: createdDeptId } });
  await prisma.departmentLab.deleteMany({ where: { departmentId: createdDeptId } });
  await prisma.clearanceOfficer.deleteMany({ where: { email: { in: ['test.hod.ai@mce.ac.in', 'test.fac.ai@mce.ac.in'] } } });
  await prisma.user.deleteMany({ where: { email: { in: ['test.hod.ai@mce.ac.in', 'test.fac.ai@mce.ac.in'] } } });
  await prisma.clearanceDepartment.delete({ where: { id: createdDeptId } });
  console.log('Cleaned up test artifacts successfully.');

  console.log('\nALL VERIFICATION TESTS COMPLETED SUCCESSFULLY! 100% PASS');
}

runTests()
  .catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
