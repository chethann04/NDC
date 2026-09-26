import axios from 'axios';

const BASE_URL = 'http://localhost:5000/api/v1';

async function timeEndpoint(name: string, fn: () => Promise<any>) {
  const t0 = Date.now();
  try {
    const res = await fn();
    const duration = Date.now() - t0;
    console.log(`[${duration.toString().padStart(4, ' ')} ms] ${name} (status: ${res.status})`);
    return { ok: true, duration, data: res.data };
  } catch (err: any) {
    const duration = Date.now() - t0;
    console.error(`[${duration.toString().padStart(4, ' ')} ms] ${name} FAILED:`, err.response?.data || err.message);
    return { ok: false, duration, error: err };
  }
}

async function main() {
  console.log('--- Testing API Latency & Health ---');

  // 1. Admin login
  const adminLogin = await timeEndpoint('POST /auth/login (Admin)', () =>
    axios.post(`${BASE_URL}/auth/login`, {
      identifier: 'admin@mce.ac.in',
      password: 'Admin@123'
    })
  );

  const adminToken = adminLogin.data?.token;
  const adminHeaders = { Authorization: `Bearer ${adminToken}` };

  if (adminToken) {
    await timeEndpoint('GET /reports/dashboard (Admin)', () =>
      axios.get(`${BASE_URL}/reports/dashboard`, { headers: adminHeaders })
    );

    // Run again to see if cached
    await timeEndpoint('GET /reports/dashboard [2nd call cached] (Admin)', () =>
      axios.get(`${BASE_URL}/reports/dashboard`, { headers: adminHeaders })
    );

    await timeEndpoint('GET /ndc/requests (Admin)', () =>
      axios.get(`${BASE_URL}/ndc/requests?page=1&limit=50`, { headers: adminHeaders })
    );

    await timeEndpoint('GET /students (Admin)', () =>
      axios.get(`${BASE_URL}/students?page=1&limit=20`, { headers: adminHeaders })
    );

    await timeEndpoint('GET /departments (Admin)', () =>
      axios.get(`${BASE_URL}/departments`, { headers: adminHeaders })
    );
  }

  // 2. Physics Lab Officer Login
  const officerLogin = await timeEndpoint('POST /auth/login (Physics Lab Officer)', () =>
    axios.post(`${BASE_URL}/auth/login`, {
      identifier: 'lab.physics@mce.ac.in',
      password: 'Officer@123'
    })
  );

  const officerToken = officerLogin.data?.token;
  const officerHeaders = { Authorization: `Bearer ${officerToken}` };

  if (officerToken) {
    await timeEndpoint('GET /ndc/officer/stats (Officer)', () =>
      axios.get(`${BASE_URL}/ndc/officer/stats`, { headers: officerHeaders })
    );

    await timeEndpoint('GET /ndc/officer/clearances (Officer)', () =>
      axios.get(`${BASE_URL}/ndc/officer/clearances?status=PENDING&page=1&limit=50`, { headers: officerHeaders })
    );
  }

  // 3. Student Login
  const studentLogin = await timeEndpoint('POST /auth/login (Student)', () =>
    axios.post(`${BASE_URL}/auth/login`, {
      identifier: '4MC22IS001',
      password: 'Student@123'
    })
  );

  const studentToken = studentLogin.data?.token;
  const studentHeaders = { Authorization: `Bearer ${studentToken}` };

  if (studentToken) {
    await timeEndpoint('GET /ndc/student-status (Student)', () =>
      axios.get(`${BASE_URL}/ndc/student-status`, { headers: studentHeaders })
    );
  }

  console.log('--- Test Complete ---');
}

main().catch(console.error);
