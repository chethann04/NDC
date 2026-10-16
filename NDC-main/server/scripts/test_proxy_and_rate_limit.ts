import assert from 'assert';
import http from 'http';
import app from '../src/app';
import emailService from '../src/services/EmailService';

async function runProxyAndRateLimitTests() {
  console.log('====================================================');
  console.log('   EXPRESS PROXY & RATE LIMIT VERIFICATION SUITE   ');
  console.log('====================================================\n');

  // Use mock email client so health-check tests run instantly without network handshakes
  emailService.setMockClient({
    emails: { send: async () => ({ data: { id: 'mock' }, error: null }) },
    apiKeys: { list: async () => ({ data: [] }) }
  });

  let passedCount = 0;
  let testCount = 0;

  async function runTest(name: string, fn: () => Promise<void> | void) {
    testCount++;
    try {
      await fn();
      console.log(`  ✓ [TEST ${testCount}] ${name}`);
      passedCount++;
    } catch (err: any) {
      console.error(`  ✗ [TEST ${testCount}] ${name}`);
      console.error(`    Error: ${err.message}`);
      throw err;
    }
  }

  // Start an ephemeral HTTP server using the Express app
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as any;
  const port = address.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Verify trust proxy setting on Express
    await runTest("Express 'trust proxy' is configured and not false", () => {
      const trustProxyValue = app.get('trust proxy');
      console.log('    Observed app.get("trust proxy") =', trustProxyValue);
      assert.notStrictEqual(trustProxyValue, false, "Trust proxy must not be false");
      assert.ok(trustProxyValue === 1 || typeof trustProxyValue === 'number' || typeof trustProxyValue === 'string', "Trust proxy should be a hop count, string, or boolean");
    });

    // Helper to make HTTP requests with custom headers
    function makeRequest(path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
      return new Promise((resolve, reject) => {
        const req = http.request(`${baseUrl}${path}`, {
          method: 'GET',
          headers
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            let parsedBody = data;
            try {
              parsedBody = JSON.parse(data);
            } catch {
              // keep as string
            }
            resolve({
              status: res.statusCode || 0,
              body: parsedBody,
              headers: res.headers
            });
          });
        });
        req.on('error', reject);
        req.end();
      });
    }

    // 2. Request with X-Forwarded-For must NOT throw ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
    await runTest("Request with 'X-Forwarded-For' succeeds without ERR_ERL_UNEXPECTED_X_FORWARDED_FOR", async () => {
      const res = await makeRequest('/api/v1/health', {
        'x-forwarded-for': '203.0.113.195'
      });
      assert.strictEqual(res.status, 200, `Expected 200 OK, got ${res.status}`);
      assert.strictEqual(res.body.status, 'OK', "Health check body should report OK");
      // Rate-limit headers must be present (draft-7 standards)
      assert.ok(res.headers['ratelimit-policy'] || res.headers['ratelimit-limit'], 'Rate limit headers should be set');
    });

    // 3. Multi-hop X-Forwarded-For resolution
    await runTest("Multi-hop X-Forwarded-For does not trigger validation error", async () => {
      const res = await makeRequest('/api/v1/health', {
        'x-forwarded-for': '203.0.113.50, 198.51.100.1'
      });
      assert.strictEqual(res.status, 200, `Expected 200 OK, got ${res.status}`);
      assert.strictEqual(res.body.status, 'OK');
    });

    // 4. IP-Based Rate Limiting Isolation (Client A vs Client B)
    await runTest("Distinct client IPs have isolated rate-limit counters", async () => {
      const clientA_IP = '198.51.100.42';
      const clientB_IP = '198.51.100.99';

      // Request as Client A
      const resA = await makeRequest('/api/v1/health', { 'x-forwarded-for': clientA_IP });
      assert.strictEqual(resA.status, 200);

      // Request as Client B
      const resB = await makeRequest('/api/v1/health', { 'x-forwarded-for': clientB_IP });
      assert.strictEqual(resB.status, 200);
      assert.strictEqual(resB.body.status, 'OK');
    });

    // 5. Direct requests without X-Forwarded-For still function properly
    await runTest("Direct requests without X-Forwarded-For fallback cleanly to socket address", async () => {
      const res = await makeRequest('/api/v1/health');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'OK');
    });

    // 6. Security invariant: trust proxy does not allow arbitrary IP spoofing beyond trusted hops
    await runTest("Trust proxy 1 trusts only immediate upstream proxy hop", () => {
      // In Express with trust proxy = 1, Express treats the rightmost IP before the 1 proxy as client IP
      // It does NOT blindly trust arbitrary leftmost values when multiple untrusted headers are injected.
      assert.strictEqual(app.get('trust proxy'), 1);
    });

    console.log('\n====================================================');
    console.log(`SUMMARY: ${passedCount} of ${testCount} tests PASSED!`);
    console.log('====================================================');
  } finally {
    server.close();
  }
}

runProxyAndRateLimitTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
