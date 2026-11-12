import prisma from '../src/config/prisma';
import { UserRole } from '../src/constants/roles';
import { GeminiService } from '../src/services/GeminiService';
import { HybridAIService } from '../src/services/HybridAIService';
import { AiAssistantService } from '../src/services/AiAssistantService';
import { AgentToolExecutionService } from '../src/services/ai/AgentToolExecutionService';

async function runHybridAiTestSuite() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  NDC HYBRID AI ARCHITECTURE & RESILIENCE VERIFICATION SUITE   ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, details?: any) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}`, details || '');
      failed++;
    }
  }

  // Backup original global.fetch and env
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  try {
    // =========================================================================
    // SECTION 1: API KEY PLACEHOLDER & CONFIGURATION DETECTION
    // =========================================================================
    console.log('\n--- SECTION 1: API Key Placeholder & Configuration Detection ---');

    // 1.1 Empty Groq key is unconfigured
    process.env.GROQ_API_KEY = '';
    assert(HybridAIService.isGroqConfigured() === false, '1. Empty Groq key is unconfigured');

    // 1.2 Whitespace-only Groq key is unconfigured
    process.env.GROQ_API_KEY = '   ';
    assert(HybridAIService.isGroqConfigured() === false, '2. Whitespace-only Groq key is unconfigured');

    // 1.3 Groq placeholder variations are unconfigured
    const groqPlaceholders = [
      'your_groq_api_key_here',
      'YOUR_GROQ_API_KEY_HERE',
      'your_api_key_here',
      'replace_me',
      'placeholder',
      'todo',
      'xxx'
    ];
    for (const ph of groqPlaceholders) {
      process.env.GROQ_API_KEY = ph;
      assert(HybridAIService.isGroqConfigured() === false, `3. Groq placeholder "${ph}" is rejected as unconfigured`);
    }

    // 1.4 Valid Groq key is configured
    process.env.GROQ_API_KEY = 'gsk_live_sample_token_abc123';
    assert(HybridAIService.isGroqConfigured() === true, '4. Valid Groq key is recognized as configured');

    // 1.5 Empty Gemini key is unconfigured
    delete process.env.GOOGLE_GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = '';
    assert(GeminiService.isConfigured() === false, '5. Empty Gemini key is unconfigured');

    // 1.6 Whitespace-only Gemini key is unconfigured
    process.env.GEMINI_API_KEY = '   ';
    assert(GeminiService.isConfigured() === false, '6. Whitespace-only Gemini key is unconfigured');

    // 1.7 Gemini placeholder variations are unconfigured
    const geminiPlaceholders = [
      'gemini api key',
      'GEMINI API KEY',
      'your_gemini_api_key_here',
      'YOUR_GEMINI_API_KEY_HERE',
      'replace-me',
      'placeholder'
    ];
    for (const ph of geminiPlaceholders) {
      process.env.GEMINI_API_KEY = ph;
      assert(GeminiService.isConfigured() === false, `7. Gemini placeholder "${ph}" is rejected as unconfigured`);
    }

    // 1.8 Valid Gemini key is configured
    process.env.GEMINI_API_KEY = 'AIzaSyD_live_sample_key_999';
    assert(GeminiService.isConfigured() === true, '8. Valid Gemini key is recognized as configured');

    // 1.8a Whitespace-only GEMINI_API_KEY falls back to valid GOOGLE_GEMINI_API_KEY
    process.env.GEMINI_API_KEY = '   ';
    process.env.GOOGLE_GEMINI_API_KEY = 'AIzaSyD_live_secondary_sample_key_888';
    assert(GeminiService.isConfigured() === true, '8a. Whitespace-only GEMINI_API_KEY falls back to valid GOOGLE_GEMINI_API_KEY');
    delete process.env.GOOGLE_GEMINI_API_KEY;

    // 1.9 With no valid keys, system uses offline mock responder
    delete process.env.GROQ_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_GEMINI_API_KEY;
    const offlineMockResult = await HybridAIService.generateChatWithMetadata({
      messages: [{ role: 'user', content: 'Status summary' }]
    });
    assert(offlineMockResult.provider === 'mock', '9. With no valid keys, system automatically routes to offline mock');
    assert(offlineMockResult.fallbackOccurred === false, '10. Direct routing to mock does not mark fallbackOccurred = true');

    // 1.10 Unconfigured Groq does not produce 401 and routes directly to secondary/mock
    process.env.GROQ_API_KEY = 'your_groq_api_key_here'; // placeholder
    process.env.GEMINI_API_KEY = ''; // unconfigured
    const unconfGroqResult = await HybridAIService.generateChatWithMetadata({
      messages: [{ role: 'user', content: 'Check clearance' }]
    });
    assert(unconfGroqResult.provider === 'mock', '11. Placeholder Groq key safely routes without triggering 401');

    // =========================================================================
    // SECTION 2: REQUEST ID SECURITY & SANITIZATION
    // =========================================================================
    console.log('\n--- SECTION 2: Request ID Security & Sanitization ---');

    // 2.1 Server-generated request ID format
    const generatedId = HybridAIService.generateSafeRequestId();
    assert(
      /^req_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(generatedId),
      '12. Safe request ID matches crypto.randomUUID() format'
    );

    // 2.2 Rejection of newline injection
    const newlineInjected = 'req_12345\nINJECTED_LOG_ENTRY\r\nANOTHER_LINE';
    const sanitizedNewline = HybridAIService.sanitizeRequestId(newlineInjected);
    assert(!sanitizedNewline.includes('\n') && !sanitizedNewline.includes('\r'), '13. Newlines rejected in request ID');
    assert(sanitizedNewline.startsWith('req_'), '14. Injected ID replaced with safe server-generated ID');

    // 2.3 Rejection of oversized IDs (>64 chars)
    const oversizedId = 'req_' + 'a'.repeat(80);
    const sanitizedOversized = HybridAIService.sanitizeRequestId(oversizedId);
    assert(sanitizedOversized.length < 60, '15. Oversized request ID rejected and replaced');

    // 2.4 Rejection of invalid characters
    const specialCharsId = 'req_user; DROP TABLE; -- <script>';
    const sanitizedSpecial = HybridAIService.sanitizeRequestId(specialCharsId);
    assert(!sanitizedSpecial.includes(';') && !sanitizedSpecial.includes('<'), '16. Special characters rejected in request ID');

    // 2.5 Preservation of valid custom alphanumeric correlation IDs
    const validCustomId = 'req_trace-id_12345_ABC';
    const sanitizedValid = HybridAIService.sanitizeRequestId(validCustomId);
    assert(sanitizedValid === validCustomId, '17. Valid alphanumeric correlation ID preserved verbatim');

    // =========================================================================
    // SECTION 3: INVALID HTTP RESPONSE HANDLING & ENVELOPE CORRUPTION
    // =========================================================================
    console.log('\n--- SECTION 3: Invalid HTTP Response Handling ---');
    process.env.GROQ_API_KEY = 'gsk_valid_test_token';
    process.env.GROQ_MODEL = 'qwen/qwen3.8-27b';
    process.env.GEMINI_API_KEY = 'AIzaSyD_valid_fallback_test_key';

    // 3.1 Malformed HTTP JSON response envelope (e.g. HTML gateway page with 200 OK)
    global.fetch = async (url: any, init: any): Promise<any> => {
      const urlStr = String(url);
      if (urlStr.includes('api.groq.com')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'x-request-id': 'req_groq_html' }),
          text: async () => '<html><body>502 Bad Gateway NGINX</body></html>' // Malformed JSON envelope
        };
      }
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: JSON.stringify({ intent: 'CONVERSATIONAL', reply: 'Gemini handled malformed Groq envelope' }) }] } }]
          })
        };
      }
      return originalFetch(url, init);
    };

    const malformedEnvelopeRes = await HybridAIService.generateChatWithMetadata({
      messages: [{ role: 'user', content: 'Test envelope' }],
      jsonMode: true
    });
    assert(malformedEnvelopeRes.fallbackOccurred === true, '18. Malformed HTTP JSON envelope triggers fallback to secondary');
    assert(malformedEnvelopeRes.text.includes('Gemini handled'), '19. Secondary fulfilled request after envelope failure');

    // 3.2 Valid HTTP JSON envelope with empty completion
    global.fetch = async (url: any, init: any): Promise<any> => {
      const urlStr = String(url);
      if (urlStr.includes('api.groq.com')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => JSON.stringify({ choices: [{ message: { content: '   ' } }] })
        };
      }
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: JSON.stringify({ intent: 'CONVERSATIONAL', reply: 'Gemini handled empty content' }) }] } }]
          })
        };
      }
      return originalFetch(url, init);
    };

    const emptyContentRes = await HybridAIService.generateChatWithMetadata({
      messages: [{ role: 'user', content: 'Empty test' }]
    });
    assert(emptyContentRes.fallbackOccurred === true, '20. Empty completion triggers fallback to secondary');

    // 3.3 Malformed model JSON in JSON mode
    global.fetch = async (url: any, init: any): Promise<any> => {
      const urlStr = String(url);
      if (urlStr.includes('api.groq.com')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => JSON.stringify({ choices: [{ message: { content: 'This text is definitely not JSON!' } }] })
        };
      }
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: JSON.stringify({ intent: 'CONVERSATIONAL', reply: 'Gemini recovered from invalid model JSON' }) }] } }]
          })
        };
      }
      return originalFetch(url, init);
    };

    const invalidModelJsonRes = await HybridAIService.generateChatWithMetadata({
      messages: [{ role: 'user', content: 'JSON test' }],
      jsonMode: true
    });
    assert(invalidModelJsonRes.fallbackOccurred === true, '21. Malformed model output in JSON mode triggers fallback');

    // 3.4 Genuine application programming error (TypeError) must fast-fail and NEVER fallback
    global.fetch = async (url: any): Promise<any> => {
      const urlStr = String(url);
      if (urlStr.includes('api.groq.com')) {
        throw new TypeError('Cannot read properties of undefined (reading "execute")');
      }
      return originalFetch(url);
    };

    let programmingErrorCaught = false;
    try {
      await HybridAIService.generateChat({
        messages: [{ role: 'user', content: 'Programming error test' }]
      });
    } catch (err: any) {
      if (err instanceof TypeError) {
        programmingErrorCaught = true;
      }
    }
    assert(programmingErrorCaught, '22. Genuine application TypeError fast-fails without falling back to Gemini');

    // =========================================================================
    // SECTION 4: ACCURATE GEMINI TELEMETRY & ATTRIBUTION
    // =========================================================================
    console.log('\n--- SECTION 4: Accurate Gemini Telemetry & Attribution ---');
    delete process.env.GROQ_API_KEY;
    process.env.GEMINI_API_KEY = 'AIzaSyD_live_sample_key_999';
    process.env.GEMINI_MODEL = 'gemini-3.8-flash';

    // 4.1 When Gemini API succeeds, telemetry reports provider = 'gemini' and model = 'gemini-3.8-flash'
    global.fetch = async (url: any): Promise<any> => {
      const urlStr = String(url);
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: 'Live Gemini answer' }] } }]
          })
        };
      }
      return originalFetch(url);
    };

    const liveGeminiRes = await HybridAIService.generateChatWithMetadata({
      messages: [{ role: 'user', content: 'Gemini test' }]
    });
    assert(liveGeminiRes.provider === 'gemini', '23. Successful Gemini API reports provider = "gemini"');
    assert(liveGeminiRes.model === 'gemini-3.8-flash', '24. Telemetry reports exact active Gemini candidate model');

    // 4.2 When Gemini is configured but all candidate models fail (HTTP 503), telemetry reports provider = 'mock'
    global.fetch = async (url: any): Promise<any> => {
      const urlStr = String(url);
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        return {
          ok: false,
          status: 503,
          text: async () => 'Service Unavailable'
        };
      }
      return originalFetch(url);
    };

    const geminiExhaustedRes = await HybridAIService.generateChatWithMetadata({
      messages: [{ role: 'user', content: 'Exhausted test' }]
    });
    assert(geminiExhaustedRes.provider === 'mock', '25. When Gemini models fail, telemetry accurately reports provider = "mock" (not "gemini")');
    assert(geminiExhaustedRes.model === 'local-offline-mock', '26. Model accurately reported as "local-offline-mock"');

    // 4.3 Verify Gemini invocation catch block does not log raw error message or API key
    const capturedWarns: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => {
      capturedWarns.push(args.map((a) => String(a)).join(' '));
    };

    const secretKey = 'AIzaSyD_super_secret_test_key_xyz';
    process.env.GEMINI_API_KEY = secretKey;
    global.fetch = async (url: any): Promise<any> => {
      const urlStr = String(url);
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        const sensitiveErr = new TypeError(`fetch failed to https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${secretKey}`);
        throw sensitiveErr;
      }
      return originalFetch(url);
    };

    try {
      await GeminiService.generateChatWithDetails({
        messages: [{ role: 'user', content: 'Catch block logging test' }]
      });
    } finally {
      console.warn = originalWarn;
    }

    const logString = capturedWarns.join('\n');
    assert(!logString.includes(secretKey), '26a. Gemini error logging does not expose API key in logs');
    assert(!logString.includes('fetch failed to https://'), '26b. Gemini error logging does not log raw exception message');
    assert(logString.includes('(Class: TypeError)'), '26c. Gemini error logging sanitizes output to error class name');

    // =========================================================================
    // SECTION 5: GROQ SUCCESS & TRANSIENT ERROR FALLBACKS
    // =========================================================================
    console.log('\n--- SECTION 5: Groq Success & Transient Error Fallbacks ---');
    process.env.GROQ_API_KEY = 'gsk_live_sample_token_abc123';
    process.env.GROQ_MODEL = 'qwen/qwen3.8-27b';

    // 5.1 Groq success
    global.fetch = async (url: any, init: any): Promise<any> => {
      const urlStr = String(url);
      if (urlStr.includes('api.groq.com')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'x-request-id': 'req_groq_success' }),
          text: async () => JSON.stringify({ choices: [{ message: { content: '{"intent":"CONVERSATIONAL","reply":"Groq success"}' } }] })
        };
      }
      return originalFetch(url, init);
    };

    const groqSuccessRes = await HybridAIService.generateChatWithMetadata({
      messages: [{ role: 'user', content: 'Groq test' }],
      jsonMode: true
    });
    assert(groqSuccessRes.provider === 'groq', '27. Successful Groq request reports provider = "groq"');
    assert(groqSuccessRes.fallbackOccurred === false, '28. Fallback occurred = false on primary success');

    // 5.2 Groq rate limit (429) fallback
    global.fetch = async (url: any, init: any): Promise<any> => {
      const urlStr = String(url);
      if (urlStr.includes('api.groq.com')) {
        return {
          ok: false,
          status: 429,
          headers: new Headers({ 'x-request-id': 'req_groq_429' }),
          text: async () => 'Rate limit exceeded'
        };
      }
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: 'Gemini handled rate limit' }] } }]
          })
        };
      }
      return originalFetch(url, init);
    };

    const groq429Res = await HybridAIService.generateChatWithMetadata({
      messages: [{ role: 'user', content: '429 test' }]
    });
    assert(groq429Res.provider === 'gemini', '29. Rate limit fallback attributes provider = "gemini"');
    assert(groq429Res.fallbackOccurred === true, '30. Fallback occurred = true on rate limit');

    // 5.3 Groq timeout (AbortError) fallback
    global.fetch = async (url: any, init: any): Promise<any> => {
      const urlStr = String(url);
      if (urlStr.includes('api.groq.com')) {
        const timeoutErr: any = new Error('Timeout');
        timeoutErr.name = 'AbortError';
        throw timeoutErr;
      }
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: 'Gemini handled timeout' }] } }]
          })
        };
      }
      return originalFetch(url, init);
    };

    const groqTimeoutRes = await HybridAIService.generateChatWithMetadata({
      messages: [{ role: 'user', content: 'Timeout test' }]
    });
    assert(groqTimeoutRes.provider === 'gemini', '31. Timeout fallback attributes provider = "gemini"');
    assert(groqTimeoutRes.fallbackOccurred === true, '32. Fallback occurred = true on timeout');

    // =========================================================================
    // SECTION 6: ERROR CLASSIFICATION BOUNDARIES (FAST-FAIL AUDIT)
    // =========================================================================
    console.log('\n--- SECTION 6: Error Classification Boundaries ---');
    assert(HybridAIService.classifyError({ status: 429 }).isFallbackEligible === true, '33. 429 is fallback eligible');
    assert(HybridAIService.classifyError({ name: 'AbortError' }).isFallbackEligible === true, '34. AbortError is fallback eligible');
    assert(HybridAIService.classifyError({ status: 503 }).isFallbackEligible === true, '35. 503 is fallback eligible');
    assert(HybridAIService.classifyError({ status: 400 }).isFallbackEligible === false, '36. 400 fast-fails (not fallback eligible)');
    assert(HybridAIService.classifyError({ status: 401 }).isFallbackEligible === false, '37. 401 fast-fails (not fallback eligible)');
    assert(HybridAIService.classifyError(new TypeError()).isFallbackEligible === false, '38. TypeError fast-fails (not fallback eligible)');

    // =========================================================================
    // SECTION 7: EXISTING GEMINI VISION / DOCUMENT OCR PRESERVATION
    // =========================================================================
    console.log('\n--- SECTION 7: Existing Gemini Vision / Document OCR Preservation ---');
    const mockImageBase64 = Buffer.from('TEST_LOGBOOK_IMAGE_BUFFER').toString('base64');
    const visionResponse = await GeminiService.analyzeDocument({
      prompt: 'Extract student dues from this logbook',
      mimeType: 'image/png',
      base64Data: mockImageBase64,
      jsonMode: true,
      testHint: '__FORCE_MOCK__'
    });

    const parsedVision = JSON.parse(visionResponse);
    assert(Boolean(parsedVision.entries || parsedVision.layoutType), '39. GeminiService.analyzeDocument returned valid analysis structure');
    assert(typeof GeminiService.analyzeDocument === 'function', '40. GeminiService.analyzeDocument function signature intact');

    // =========================================================================
    // SECTION 8: DEPARTMENT AUTHORIZATION & WORKFLOW SAFETY (READ-ONLY)
    // =========================================================================
    console.log('\n--- SECTION 8: Department Authorization & Workflow Safety ---');
    const phyDept = await prisma.clearanceDepartment.findFirst({ where: { code: 'PHY' } });
    const chemDept = await prisma.clearanceDepartment.findFirst({ where: { code: { in: ['CHEM', 'CHM'] } } });

    assert(Boolean(phyDept && chemDept), '41. Physics and Chemistry departments verified in database');

    const testOfficer = await prisma.user.findFirst({
      where: { role: UserRole.DEPARTMENT_OFFICER, isActive: true, departmentId: { not: null } }
    });

    if (testOfficer && testOfficer.departmentId && phyDept && chemDept) {
      const ownDeptId = testOfficer.departmentId;
      const otherDept = ownDeptId === phyDept.id ? chemDept : phyDept;

      const authOwn = await AgentToolExecutionService.authorizeOfficerForDepartment(testOfficer.id, ownDeptId);
      assert(authOwn.authorized === true, '42. Officer authorized for assigned department');

      const authCross = await AgentToolExecutionService.authorizeOfficerForDepartment(testOfficer.id, otherDept.id);
      assert(authCross.authorized === false, `43. Cross-department permission denied (Officer blocked from ${otherDept.code} desk)`);
    }

    const adminUser = await prisma.user.findFirst({
      where: { role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] } }
    });
    if (adminUser && phyDept) {
      const adminAuth = await AgentToolExecutionService.authorizeOfficerForDepartment(adminUser.id, phyDept.id);
      assert(adminAuth.authorized === true, '44. Admin has institutional override authority across desks');
    }

    // =========================================================================
    // SECTION 9: PUBLIC STRING CONTRACT PRESERVATION
    // =========================================================================
    console.log('\n--- SECTION 9: Public String Contract Preservation ---');
    const stringContractRes = await HybridAIService.generateChat({
      messages: [{ role: 'user', content: 'String test' }]
    });
    assert(typeof stringContractRes === 'string' && stringContractRes.length > 0, '45. Public generateChat(options): Promise<string> contract intact');

  } finally {
    // Restore environment and global fetch
    global.fetch = originalFetch;
    process.env = originalEnv;
  }

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log(`║  TESTS COMPLETED: ${passed} PASSED, ${failed} FAILED                          ║`);
  console.log('╚════════════════════════════════════════════════════════════════╝');

  if (failed > 0) {
    process.exit(1);
  }
}

runHybridAiTestSuite()
  .catch((err) => {
    console.error('Fatal error during test suite execution:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
