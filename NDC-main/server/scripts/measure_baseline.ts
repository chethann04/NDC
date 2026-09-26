import dotenv from 'dotenv';
dotenv.config();

const BASE_URL = 'http://localhost:5000/api/v1';

interface BenchmarkResult {
  endpoint: string;
  method: string;
  status: number;
  durationMs: number;
  payloadBytes: number;
}

async function requestBench(
  name: string,
  method: string,
  path: string,
  token?: string,
  body?: any,
  runs = 2
): Promise<BenchmarkResult> {
  const durations: number[] = [];
  let lastStatus = 0;
  let lastBytes = 0;

  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';

    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      });
      const text = await res.text();
      const end = performance.now();
      durations.push(end - start);
      lastStatus = res.status;
      lastBytes = Buffer.byteLength(text, 'utf8');
    } catch (e: any) {
      console.error(`Error on ${name}:`, e.message);
      durations.push(9999);
      lastStatus = 500;
      lastBytes = 0;
    }
  }

  durations.sort((a, b) => a - b);
  const medianDuration = Math.round(durations[Math.floor(durations.length / 2)]);
  console.log(`[DONE] ${name} -> ${medianDuration}ms (HTTP ${lastStatus}, ${lastBytes} bytes)`);

  return {
    endpoint: name,
    method,
    status: lastStatus,
    durationMs: medianDuration,
    payloadBytes: lastBytes
  };
}

async function run() {
  console.log('----------------------------------------------------');
  console.log('RUNNING BASELINE PERFORMANCE BENCHMARK');
  console.log('----------------------------------------------------\n');

  const results: BenchmarkResult[] = [];

  // 1. Admin Login
  const loginRes = await requestBench(
    '1. Admin Login',
    'POST',
    '/auth/login',
    undefined,
    { email: 'superadmin@mce.ac.in', password: 'Admin@123' },
    2
  );
  results.push(loginRes);

  const adminLoginRaw = await (await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'superadmin@mce.ac.in', password: 'Admin@123' })
  })).json();
  const adminToken = adminLoginRaw.token;

  // Officer Token (Library)
  const officerLoginRaw = await (await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'library@mce.ac.in', password: 'Officer@123' })
  })).json();
  const officerToken = officerLoginRaw.token;

  // 2. Student Login
  const studentLoginRes = await requestBench(
    '2. Student Login',
    'POST',
    '/auth/student-login',
    undefined,
    { usn: '4MC22EC001', password: '4MC22EC001' },
    2
  );
  results.push(studentLoginRes);

  const studentLoginRaw = await (await fetch(`${BASE_URL}/auth/student-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usn: '4MC22EC001', password: '4MC22EC001' })
  })).json();
  const studentToken = studentLoginRaw.token || adminToken;

  // 3. Student Dashboard
  results.push(
    await requestBench(
      '3. Student Dashboard (getStudentNdcStatus)',
      'GET',
      '/ndc/student-status',
      studentToken,
      undefined,
      2
    )
  );

  // 4. Officer Dashboard Stats
  results.push(
    await requestBench(
      '4. Officer Dashboard Stats',
      'GET',
      '/ndc/officer/stats',
      officerToken,
      undefined,
      2
    )
  );

  // 5. Clearance Queue
  results.push(
    await requestBench(
      '5. Clearance Queue (getOfficerClearances)',
      'GET',
      '/ndc/officer/clearances?page=1&limit=50&status=PENDING',
      officerToken,
      undefined,
      2
    )
  );

  // 6. Admin Dashboard Stats & Activity
  results.push(
    await requestBench(
      '6. Admin Dashboard (getDashboardStats)',
      'GET',
      '/reports/dashboard',
      adminToken,
      undefined,
      2
    )
  );

  // 7. Student Management List
  results.push(
    await requestBench(
      '7. Student List (getAllStudents)',
      'GET',
      '/students?page=1&limit=20',
      adminToken,
      undefined,
      2
    )
  );

  // 8. Certificate List
  results.push(
    await requestBench(
      '8. Certificate List (getAllCertificates)',
      'GET',
      '/certificates?page=1&limit=20',
      adminToken,
      undefined,
      2
    )
  );

  // 9. NDC Requests Monitor
  results.push(
    await requestBench(
      '9. NDC Requests (getAllNdcRequests)',
      'GET',
      '/ndc/requests?page=1&limit=50',
      adminToken,
      undefined,
      2
    )
  );

  // 10. Audit Logs List
  results.push(
    await requestBench(
      '10. Audit Logs (getAuditLogs)',
      'GET',
      '/audit-logs?page=1&limit=20',
      adminToken,
      undefined,
      2
    )
  );

  // 11. Verification
  results.push(
    await requestBench(
      '11. Verification (verifyCertificate)',
      'POST',
      '/verify',
      adminToken,
      { certificateNumber: 'NDC/MCE/2026/000001' },
      2
    )
  );

  console.log('\n================ BASELINE MEASUREMENT REPORT ================');
  console.table(
    results.map((r) => ({
      Endpoint: r.endpoint,
      Method: r.method,
      Status: r.status,
      'Median Latency (ms)': r.durationMs,
      'Payload (bytes)': r.payloadBytes
    }))
  );
  console.log('=============================================================\n');
}

run().catch((e) => {
  console.error('Benchmark error:', e);
  process.exit(1);
});
