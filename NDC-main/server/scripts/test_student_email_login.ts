const BASE_URL = 'http://localhost:5000/api/v1';

async function runTests() {
  console.log('--- STARTING STUDENT USN + MAIL ID LOGIN TESTS ---');

  // Test 1: Student login with USN + registered email (chethuc809@gmail.com)
  console.log('\n[1] Testing Student login with USN [4MC22IS001] + Mail ID [chethuc809@gmail.com]...');
  const res1 = await fetch(`${BASE_URL}/auth/student-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      usn: '4MC22IS001',
      email: 'chethuc809@gmail.com'
    })
  });
  const data1: any = await res1.json();
  console.log('Status code:', res1.status);
  console.log('Login response message:', data1.message);
  console.log('Authenticated User Name:', data1.user?.name, '| Role:', data1.user?.role);
  if (!res1.ok || !data1.token) {
    throw new Error(`Test 1 Failed: ${JSON.stringify(data1)}`);
  }

  // Test 2: Student login with USN + alternative registered email (chirag.gowda@example.com)
  console.log('\n[2] Testing Student login with USN [4MC22IS001] + Mail ID [chirag.gowda@example.com]...');
  const res2 = await fetch(`${BASE_URL}/auth/student-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      usn: '4MC22IS001',
      email: 'chirag.gowda@example.com'
    })
  });
  const data2: any = await res2.json();
  console.log('Status code:', res2.status);
  if (!res2.ok || !data2.token) {
    throw new Error(`Test 2 Failed: ${JSON.stringify(data2)}`);
  }
  console.log('Verified 2nd registered email succeeds!');

  // Test 3: Student login with another student from database (4MC22EC008)
  console.log('\n[3] Testing Student login with USN [4MC22EC008] + Mail ID [aishwarya.s@example.com]...');
  const res3 = await fetch(`${BASE_URL}/auth/student-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      usn: '4MC22EC008',
      email: 'aishwarya.s@example.com'
    })
  });
  const data3: any = await res3.json();
  console.log('Status code:', res3.status);
  console.log('Authenticated Student:', data3.user?.name, '| Department:', data3.user?.studentProfile?.department?.code);
  if (!res3.ok || !data3.token) {
    throw new Error(`Test 3 Failed: ${JSON.stringify(data3)}`);
  }

  // Test 4: Rejection of wrong email for USN
  console.log('\n[4] Testing rejection of incorrect email for USN [4MC22EC008]...');
  const res4 = await fetch(`${BASE_URL}/auth/student-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      usn: '4MC22EC008',
      email: 'wrong.email@random.com'
    })
  });
  const data4: any = await res4.json();
  console.log('Status code:', res4.status);
  console.log('Expected rejection message:', data4.message);
  if (res4.status !== 401) {
    throw new Error(`Test 4 Failed: Expected 401 but got ${res4.status}`);
  }

  console.log('\nALL STUDENT USN + MAIL ID LOGIN TESTS PASSED 100%!');
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
