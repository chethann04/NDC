import prisma from '../config/prisma';

async function testStudentLogin() {
  const baseURL = 'http://localhost:5000/api/v1';

  try {
    console.log('--- 1. Testing Student Login with Valid USN and DOB (YYYY-MM-DD) ---');
    const res1 = await fetch(`${baseURL}/auth/student-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usn: '4MC22IS001',
        dob: '2004-05-15'
      })
    });
    const data1 = await res1.json() as any;
    console.log(`   Status: ${res1.status}, Success: ${data1.success}`);
    if (!res1.ok || !data1.token) {
      throw new Error(`Test 1 Failed: ${JSON.stringify(data1)}`);
    }
    console.log(`   Logged in student: ${data1.user.name} (${data1.user.studentProfile.usn})`);
    console.log(`   Token received: ${data1.token.slice(0, 25)}...`);

    console.log('\n--- 2. Testing Student Login with Valid USN and DOB (DD/MM/YYYY) ---');
    const res2 = await fetch(`${baseURL}/auth/student-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usn: '4mc22is001', // Lowercase test
        dob: '15/05/2004'
      })
    });
    const data2 = await res2.json() as any;
    console.log(`   Status: ${res2.status}, Success: ${data2.success}`);
    if (!res2.ok || !data2.token) {
      throw new Error(`Test 2 Failed: ${JSON.stringify(data2)}`);
    }

    console.log('\n--- 3. Testing Student Login with Incorrect DOB (Expected 401) ---');
    const res3 = await fetch(`${baseURL}/auth/student-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usn: '4MC22IS001',
        dob: '2001-01-01'
      })
    });
    const data3 = await res3.json() as any;
    console.log(`   Status: ${res3.status}, Expected: 401`);
    console.log(`   Message: ${data3.message}`);
    if (res3.status !== 401) {
      throw new Error('Test 3 Failed: Incorrect DOB was not rejected with 401!');
    }

    console.log('\n--- 4. Testing Student Login with Non-Existent USN (Expected 401) ---');
    const res4 = await fetch(`${baseURL}/auth/student-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usn: '4MC99XX999',
        dob: '2004-05-15'
      })
    });
    const data4 = await res4.json() as any;
    console.log(`   Status: ${res4.status}, Expected: 401`);
    console.log(`   Message: ${data4.message}`);
    if (res4.status !== 401) {
      throw new Error('Test 4 Failed: Non-existent USN was not rejected with 401!');
    }

    console.log('\n--- 5. Testing Authorized Student Endpoint with Student Token ---');
    const studentToken = data1.token;
    const reqRes = await fetch(`${baseURL}/ndc/requests/my-request`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    const reqData = await reqRes.json() as any;
    console.log(`   Status: ${reqRes.status}, Request Number: ${reqData.data?.requestNumber || 'Initialized'}`);

    console.log('\n=============================================');
    console.log('ALL STUDENT LOGIN TESTS PASSED SUCCESSFULLY! 🎓');
    console.log('=============================================');
    await prisma.$disconnect();
  } catch (err: any) {
    console.error('Error in student login verification:', err.message);
    await prisma.$disconnect();
    process.exit(1);
  }
}

testStudentLogin();
