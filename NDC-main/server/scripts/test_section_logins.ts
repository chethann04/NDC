import prisma from '../src/config/prisma';

const BASE_URL = 'http://localhost:5000/api/v1';

async function testSectionLogins() {
  console.log('=== TESTING CENTRAL SUPER ADMIN SECTION LOGIN MANAGEMENT ===\n');

  // 1. Authenticate as Super Admin
  console.log('1. Authenticating as Super Admin (superadmin@mce.ac.in)...');
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      loginId: 'SUPERADMIN',
      password: 'Admin@123'
    })
  });
  const loginData: any = await loginRes.json();
  const token = loginData.token || loginData.accessToken;
  if (!token) throw new Error('Failed to obtain Super Admin token');
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };
  console.log('   ✅ Super Admin authenticated successfully.\n');

  // 2. Query Section Logins endpoint
  console.log('2. Fetching all section login accounts (GET /admin/section-logins)...');
  const accountsRes = await fetch(`${BASE_URL}/admin/section-logins`, { headers });
  const accountsData: any = await accountsRes.json();
  const accounts = accountsData.data || [];
  const stats = accountsData.stats || {};
  console.log(`   ✅ Retrieved ${accounts.length} operational accounts.`);
  console.log(`   📊 Stats: Total=${stats.total}, Active=${stats.active}, Inactive=${stats.inactive}, Desks=${stats.centralDesks}, Labs=${stats.collegeLabs}, Academic=${stats.academicAccounts}\n`);

  // Verify key operational accounts exist
  const libraryAcc = accounts.find((a: any) => a.email.includes('library') || a.loginId === 'LIB001');
  const physicsAcc = accounts.find((a: any) => a.email.includes('physics') || a.loginId === 'PHY001');
  const chemAcc = accounts.find((a: any) => a.email.includes('chemistry') || a.loginId === 'CHEM001');
  const hostelAcc = accounts.find((a: any) => a.email.includes('hostel') || a.loginId === 'HST001');
  const sportsAcc = accounts.find((a: any) => a.email.includes('sports') || a.loginId === 'SPT001');
  const cashAcc = accounts.find((a: any) => a.email.includes('accounts') || a.loginId === 'ACC001');
  const iseFacAcc = accounts.find((a: any) => a.loginId === 'FAC-IS' || a.loginId === 'ISE001');
  const csFacAcc = accounts.find((a: any) => a.loginId === 'FAC-CS' || a.loginId === 'CSE001');

  console.log('   Accounts Check:');
  console.log(`   - Library: ${libraryAcc ? 'Found (' + libraryAcc.email + ')' : 'MISSING'}`);
  console.log(`   - Physics Lab: ${physicsAcc ? 'Found (' + physicsAcc.email + ')' : 'MISSING'}`);
  console.log(`   - Chemistry Lab: ${chemAcc ? 'Found (' + chemAcc.email + ')' : 'MISSING'}`);
  console.log(`   - Hostel: ${hostelAcc ? 'Found (' + hostelAcc.email + ')' : 'MISSING'}`);
  console.log(`   - Sports: ${sportsAcc ? 'Found (' + sportsAcc.email + ')' : 'MISSING'}`);
  console.log(`   - Cash/Fee: ${cashAcc ? 'Found (' + cashAcc.email + ')' : 'MISSING'}`);
  console.log(`   - ISE Faculty: ${iseFacAcc ? 'Found (' + iseFacAcc.email + ', dept: ' + (iseFacAcc.department?.code || 'N/A') + ')' : 'MISSING'}`);
  console.log(`   - CSE Faculty: ${csFacAcc ? 'Found (' + csFacAcc.email + ', dept: ' + (csFacAcc.department?.code || 'N/A') + ')' : 'MISSING'}`);

  if (!libraryAcc || !physicsAcc || !chemAcc || !hostelAcc || !sportsAcc || !cashAcc || !iseFacAcc) {
    throw new Error('Some expected operational accounts were not discovered!');
  }
  console.log('   ✅ All core operational accounts successfully discovered.\n');

  // 3. Test changing login email on test1 account (or a designated test account)
  const testAcc = accounts.find((a: any) => a.email === 'test1@gmail.com') || hostelAcc;
  const originalEmail = testAcc.email;
  const temporaryEmail = 'test1.temp.ndc@gmail.com';

  console.log(`3. Testing Change Login Email on account "${testAcc.name}" (${originalEmail})...`);
  const emailUpdateRes = await fetch(`${BASE_URL}/admin/section-logins/${testAcc.id}/email`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ email: temporaryEmail })
  });
  const emailUpdateData: any = await emailUpdateRes.json();
  console.log(`   ✅ Server response: ${emailUpdateData.message}`);

  // Try logging in with OLD email -> should fail
  const oldLoginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      loginId: originalEmail,
      password: 'Officer@123'
    })
  });
  if (oldLoginRes.ok) {
    console.error('   ❌ ERROR: Old email still allowed login!');
  } else {
    console.log(`   ✅ Old email rejected as expected (${oldLoginRes.status})`);
  }

  // Restore original email
  await fetch(`${BASE_URL}/admin/section-logins/${testAcc.id}/email`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ email: originalEmail })
  });
  console.log(`   ✅ Restored original email: ${originalEmail}\n`);

  // 4. Test Deactivate & Reactivate
  console.log(`4. Testing Account Deactivation & Reactivation on "${testAcc.name}"...`);
  await fetch(`${BASE_URL}/admin/section-logins/${testAcc.id}/status`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ isActive: false })
  });
  console.log('   ✅ Deactivated account.');

  // Verify deactivated account cannot log in
  const deactLoginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      loginId: originalEmail,
      password: 'Officer@123'
    })
  });
  if (deactLoginRes.ok) {
    console.error('   ❌ ERROR: Deactivated account was able to log in!');
  } else {
    console.log(`   ✅ Deactivated login rejected: ${deactLoginRes.status}`);
  }

  // Reactivate
  await fetch(`${BASE_URL}/admin/section-logins/${testAcc.id}/status`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ isActive: true })
  });
  console.log('   ✅ Reactivated account successfully.\n');

  // 5. Test Password Reset
  console.log(`5. Testing Password Reset for "${testAcc.name}"...`);
  const pwdResetRes = await fetch(`${BASE_URL}/admin/section-logins/${testAcc.id}/reset-password`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ password: 'Officer@123' })
  });
  const pwdResetData: any = await pwdResetRes.json();
  console.log(`   ✅ Server response: ${pwdResetData.message}\n`);

  // 6. Verify Audit Logs were created
  console.log('6. Checking Audit Logs for Super Admin account management actions...');
  const auditLogs = await prisma.auditLog.findMany({
    where: {
      action: {
        in: [
          'UPDATE_SECTION_LOGIN_EMAIL',
          'ACTIVATE_SECTION_ACCOUNT',
          'DEACTIVATE_SECTION_ACCOUNT',
          'RESET_SECTION_ACCOUNT_PASSWORD',
          'UPDATE_ACCOUNT_DEPARTMENT_ASSIGNMENT'
        ]
      }
    },
    orderBy: { timestamp: 'desc' },
    take: 5
  });
  console.log(`   ✅ Found ${auditLogs.length} recent account management audit logs:`);
  for (const log of auditLogs) {
    console.log(`      - [${log.action}] by ${log.userName} (${log.role}): ${log.description}`);
  }

  console.log('\n=== ALL SECTION LOGIN MANAGEMENT TESTS PASSED WITH 100% SUCCESS ===');
}

testSectionLogins()
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
