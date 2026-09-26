const BASE_URL = 'http://localhost:5000/api/v1';

async function timeEndpoint(name, url, options = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, options);
    const data = await res.json();
    const duration = Date.now() - t0;
    console.log(`[${duration.toString().padStart(4, ' ')} ms] ${name} (status: ${res.status})`);
    return { ok: res.ok, duration, data };
  } catch (err) {
    const duration = Date.now() - t0;
    console.error(`[${duration.toString().padStart(4, ' ')} ms] ${name} FAILED:`, err.message);
    return { ok: false, duration, error: err };
  }
}

async function main() {
  console.log('--- Testing API Latency & Health ---');

  // 1. Admin login
  const adminLogin = await timeEndpoint('POST /auth/login (Admin)', `${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginId: 'admin@mce.ac.in', password: 'Admin@123' })
  });

  const adminToken = adminLogin.data?.token;
  const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };

  if (adminToken) {
    await timeEndpoint('GET /reports/dashboard (Admin)', `${BASE_URL}/reports/dashboard`, { headers: adminHeaders });
    await timeEndpoint('GET /reports/dashboard [cached] (Admin)', `${BASE_URL}/reports/dashboard`, { headers: adminHeaders });
    await timeEndpoint('GET /ndc/requests (Admin)', `${BASE_URL}/ndc/requests?page=1&limit=50`, { headers: adminHeaders });
    await timeEndpoint('GET /students (Admin)', `${BASE_URL}/students?page=1&limit=20`, { headers: adminHeaders });
    await timeEndpoint('GET /departments (Admin)', `${BASE_URL}/departments`, { headers: adminHeaders });
  }

  // 2. Physics Lab Officer Login
  const officerLogin = await timeEndpoint('POST /auth/login (Physics Lab Officer)', `${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginId: 'PHY001', password: 'Officer@123' })
  });

  const officerToken = officerLogin.data?.token;
  const officerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${officerToken}` };

  if (officerToken) {
    await timeEndpoint('GET /ndc/officer/stats (Officer)', `${BASE_URL}/ndc/officer/stats`, { headers: officerHeaders });
    await timeEndpoint('GET /ndc/officer/clearances (Officer)', `${BASE_URL}/ndc/officer/clearances?status=PENDING&page=1&limit=50`, { headers: officerHeaders });
  }

  // 3. Student Login
  const studentLogin = await timeEndpoint('POST /auth/student-login (Student)', `${BASE_URL}/auth/student-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usn: '4MC22IS001', dob: '2004-05-15' })
  });

  const studentToken = studentLogin.data?.token;
  const studentHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${studentToken}` };

  if (studentToken) {
    await timeEndpoint('GET /ndc/student-status (Student)', `${BASE_URL}/ndc/student-status`, { headers: studentHeaders });
  }

  console.log('--- Test Complete ---');
}

main().catch(console.error);
