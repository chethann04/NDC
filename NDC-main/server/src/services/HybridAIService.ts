import crypto from 'crypto';
import { GeminiService, GeminiChatOptions, GeminiChatExecutionResult } from './GeminiService';

export interface ProviderErrorClassification {
  isFallbackEligible: boolean;
  category: 'RATE_LIMIT' | 'TIMEOUT' | 'SERVER_ERROR' | 'NETWORK_ERROR' | 'INVALID_RESPONSE' | 'INVALID_REQUEST' | 'AUTH_ERROR' | 'UNKNOWN';
  safeMessage: string;
  statusCode?: number;
}

export interface ProviderStatus {
  primaryProvider: 'groq' | 'gemini';
  groqConfigured: boolean;
  groqModel: string;
  geminiConfigured: boolean;
  geminiModel: string;
}

export interface HybridChatResult {
  text: string;
  provider: 'groq' | 'gemini' | 'mock';
  model: string;
  fallbackOccurred: boolean;
  requestId: string;
}

/**
 * Hybrid AI Service for NDC Assistant Chat Routing.
 *
 * Tiered Architecture:
 * 1. Primary Provider: Groq using high-efficiency open-weights models (Default: Qwen 3.8 27B).
 * 2. Secondary Provider: Google Gemini via existing GeminiService (Developer API).
 * 3. Offline / Test Provider: Local mock responder in GeminiService for disconnected environments.
 *
 * Security & Reliability Invariants:
 * - Error logs NEVER include request bodies, prompts, student records, USNs, or tokens.
 * - Only provider name, HTTP status code, error category, and request ID are logged.
 * - Only known transient provider errors (429, 408/timeout, 5xx, network drops, invalid response envelopes, invalid model output) trigger fallback.
 * - Unexpected programming errors and 400/401/403 errors fast-fail immediately without fallback.
 * - Request IDs are generated with crypto.randomUUID() and sanitized to prevent log injection.
 * - Request telemetry is request-scoped (no shared mutable static state).
 * - Accurate telemetry reports whether Gemini or the offline mock actually produced the output.
 * - AI providers ONLY perform read-only intent parsing and suggestions. ZERO direct database writes.
 * - Consequential mutations require 2-phase commit with one-time tokens and human confirmation.
 * - Document/Vision OCR operations remain isolated in GeminiService.analyzeDocument().
 */
export class HybridAIService {
  public static readonly DEFAULT_QWEN_MODEL = 'qwen/qwen3.8-27b';
  public static readonly DEFAULT_TIMEOUT_MS = 25_000;

  private static readonly PLACEHOLDER_PATTERNS = [
    'your_',
    'your-',
    '_here',
    '-here',
    'replace_me',
    'replace-me',
    'placeholder',
    'todo',
    'api_key',
    'api-key',
    'api key',
    'groq api key',
    'xxx',
    'none',
    'null',
    'undefined'
  ];

  /**
   * Returns whether Groq is configured with a valid API key (rejecting empty values and placeholders)
   */
  public static isGroqConfigured(): boolean {
    const key = process.env.GROQ_API_KEY;
    if (!key) return false;
    const trimmed = key.trim();
    if (trimmed.length === 0) return false;
    const lower = trimmed.toLowerCase();
    return !this.PLACEHOLDER_PATTERNS.some((pattern) => lower.includes(pattern));
  }

  /**
   * Returns whether Gemini is configured with a valid API key (rejecting empty values and placeholders)
   */
  public static isGeminiConfigured(): boolean {
    return GeminiService.isConfigured();
  }

  /**
   * Returns operational status and model identifiers for both providers
   */
  public static getProviderStatus(): ProviderStatus {
    const configuredPrimary = (process.env.AI_PRIMARY_PROVIDER || 'groq').toLowerCase();
    const primaryProvider: 'groq' | 'gemini' = configuredPrimary === 'gemini' ? 'gemini' : 'groq';

    return {
      primaryProvider,
      groqConfigured: this.isGroqConfigured(),
      groqModel: process.env.GROQ_MODEL?.trim() || this.DEFAULT_QWEN_MODEL,
      geminiConfigured: this.isGeminiConfigured(),
      geminiModel: GeminiService.getDefaultModel()
    };
  }

  /**
   * Generates a safe server-side request correlation ID using crypto.randomUUID()
   */
  public static generateSafeRequestId(): string {
    return `req_${crypto.randomUUID()}`;
  }

  /**
   * Sanitizes client-supplied correlation IDs to prevent log injection and oversized headers.
   * If invalid, replaces with a secure server-generated ID.
   */
  public static sanitizeRequestId(incomingId?: string): string {
    if (!incomingId || typeof incomingId !== 'string') {
      return this.generateSafeRequestId();
    }
    const trimmed = incomingId.trim();
    // Strictly require alphanumeric, underscore, hyphen with max length 64
    // Rejects newlines (\r, \n), control characters, and special characters
    if (trimmed.length > 64 || trimmed.length === 0 || !/^[a-zA-Z0-9_\-]+$/.test(trimmed)) {
      return this.generateSafeRequestId();
    }
    return trimmed;
  }

  /**
   * Classify an error to determine whether it is eligible for automated provider fallback.
   *
   * Invariant:
   * Only known transient provider errors are fallback-eligible.
   * Programming errors (TypeError, ReferenceError) and invalid request/auth errors (400, 401, 403)
   * must fast-fail and are NEVER fallback-eligible.
   */
  public static classifyError(error: any): ProviderErrorClassification {
    const status = typeof error?.status === 'number' ? error.status : (typeof error?.statusCode === 'number' ? error.statusCode : undefined);
    const errorName = error?.name || '';
    const rawMessage = error?.message || String(error);

    // 1. Explicitly tagged invalid responses from provider (envelope or model JSON)
    if (error?.category === 'INVALID_RESPONSE' || /empty chat completion|invalid json response|malformed provider http json response/i.test(rawMessage)) {
      return {
        isFallbackEligible: true,
        category: 'INVALID_RESPONSE',
        safeMessage: 'Model or provider returned empty or syntactically invalid output',
        statusCode: status
      };
    }

    // 2. Timeout errors (AbortError / 408) - Transient provider issue -> Fallback eligible
    if (errorName === 'AbortError' || status === 408 || /abort|timed out|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(rawMessage)) {
      return {
        isFallbackEligible: true,
        category: 'TIMEOUT',
        safeMessage: 'Provider request timed out',
        statusCode: 408
      };
    }

    // 3. Rate limits (HTTP 429) - Transient quota/capacity issue -> Fallback eligible
    if (status === 429 || /rate limit|429|too many requests/i.test(rawMessage)) {
      return {
        isFallbackEligible: true,
        category: 'RATE_LIMIT',
        safeMessage: 'Provider rate limit exceeded (HTTP 429)',
        statusCode: 429
      };
    }

    // 4. Server errors (HTTP 500..599) - Transient upstream failure -> Fallback eligible
    if (status && status >= 500 && status < 600) {
      return {
        isFallbackEligible: true,
        category: 'SERVER_ERROR',
        safeMessage: `Provider server error (HTTP ${status})`,
        statusCode: status
      };
    }

    // 5. Network / Socket connection drops - Transient connectivity failure -> Fallback eligible
    if (error?.category === 'NETWORK_ERROR' || /ECONNREFUSED|ECONNRESET|ENOTFOUND|fetch failed|network error/i.test(rawMessage)) {
      return {
        isFallbackEligible: true,
        category: 'NETWORK_ERROR',
        safeMessage: 'Network communication failure with provider'
      };
    }

    // 6. Invalid client request (HTTP 400) - Bad prompt or parameter bug; DO NOT mask with fallback
    if (status === 400 || /bad request|invalid request/i.test(rawMessage)) {
      return {
        isFallbackEligible: false,
        category: 'INVALID_REQUEST',
        safeMessage: 'Invalid request parameters (HTTP 400)',
        statusCode: 400
      };
    }

    // 7. Authentication errors (HTTP 401/403) - Misconfigured or invalid key; DO NOT mask with fallback
    if (status === 401 || status === 403 || /unauthorized|forbidden|invalid api key/i.test(rawMessage)) {
      return {
        isFallbackEligible: false,
        category: 'AUTH_ERROR',
        safeMessage: `Authentication failure (HTTP ${status || 401})`,
        statusCode: status || 401
      };
    }

    // 8. UNKNOWN / Programming errors (TypeError, ReferenceError, syntax bug) - DO NOT mask with fallback
    return {
      isFallbackEligible: false,
      category: 'UNKNOWN',
      safeMessage: 'Unhandled execution error',
      statusCode: status
    };
  }

  /**
   * Request-scoped chat generation entrypoint returning rich, accurate telemetry metadata.
   */
  public static async generateChatWithMetadata(
    options: GeminiChatOptions,
    clientRequestId?: string
  ): Promise<HybridChatResult> {
    const requestId = this.sanitizeRequestId(clientRequestId);
    const status = this.getProviderStatus();

    // If Gemini is explicitly forced as primary or Groq is unconfigured, route to Gemini directly
    if (status.primaryProvider === 'gemini' || !status.groqConfigured) {
      const fallbackResult = await this.invokeGeminiFallback(options, requestId);
      return {
        text: fallbackResult.text,
        provider: fallbackResult.source,
        model: fallbackResult.model,
        fallbackOccurred: false,
        requestId
      };
    }

    // Attempt Primary: Groq + Qwen
    try {
      const groqText = await this.generateWithGroq(options, requestId);
      return {
        text: groqText,
        provider: 'groq',
        model: status.groqModel,
        fallbackOccurred: false,
        requestId
      };
    } catch (primaryError: any) {
      const classification = this.classifyError(primaryError);

      if (!classification.isFallbackEligible) {
        // Fast-fail: Log safe diagnostic info without exposing user prompts or body text
        console.error(
          `[HybridAIService] Non-fallback error from primary provider [Category: ${classification.category}] (Status: ${classification.statusCode || 'N/A'}, Request ID: ${requestId}). Fast-failing.`
        );
        throw primaryError;
      }

      // Safe logging: Only category, status code, and safe request ID
      console.warn(
        `[HybridAIService] Primary provider transient error [Category: ${classification.category}] (Status: ${classification.statusCode || 'N/A'}, Request ID: ${requestId}). Falling back to secondary provider (Gemini)...`
      );

      const geminiResult = await this.invokeGeminiFallback(options, requestId);
      return {
        text: geminiResult.text,
        provider: geminiResult.source,
        model: geminiResult.model,
        fallbackOccurred: true,
        requestId
      };
    }
  }

  /**
   * Preserves existing public response contract: options in, string out.
   */
  public static async generateChat(options: GeminiChatOptions): Promise<string> {
    const result = await this.generateChatWithMetadata(options);
    return result.text;
  }

  /**
   * Calls Groq chat completions API with Qwen model
   */
  private static async generateWithGroq(
    options: GeminiChatOptions,
    requestId: string
  ): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('Groq API key is missing.');
    }

    const model = process.env.GROQ_MODEL?.trim() || this.DEFAULT_QWEN_MODEL;
    const timeoutMs = this.getTimeoutMs();

    // Prepare system instruction with explicit JSON reminder when jsonMode is active
    let systemInstruction = options.systemPrompt || '';
    if (options.jsonMode && !/json/i.test(systemInstruction)) {
      systemInstruction = `${systemInstruction}\nYou must respond strictly with a valid JSON object.`.trim();
    }

    const messages = [
      ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
      ...options.messages
        .filter((msg) => msg.role !== 'system')
        .map((msg) => ({
          role: msg.role === 'model' ? 'assistant' : 'user',
          content: msg.content
        }))
    ];

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Client-Request-Id': requestId
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature ?? 0.1,
          max_tokens: 2048,
          ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {})
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        // Safe error creation: extract request ID if present, but NEVER attach response body
        const upstreamReqId = response.headers.get('x-request-id') || requestId;
        const err: any = new Error(`Groq HTTP ${response.status}`);
        err.status = response.status;
        err.statusCode = response.status;
        err.requestId = upstreamReqId;
        throw err;
      }

      let responseText = '';
      try {
        responseText = await response.text();
      } catch {
        const err: any = new Error('Failed to read provider HTTP response body');
        err.category = 'NETWORK_ERROR';
        throw err;
      }

      let data: any;
      try {
        data = JSON.parse(responseText);
      } catch {
        const err: any = new Error('malformed provider http json response');
        err.category = 'INVALID_RESPONSE';
        throw err;
      }

      const rawContent = data?.choices?.[0]?.message?.content;
      if (typeof rawContent !== 'string' || !rawContent.trim()) {
        const err: any = new Error('empty chat completion from provider');
        err.category = 'INVALID_RESPONSE';
        throw err;
      }

      const trimmed = rawContent.trim();

      // If JSON mode was requested, validate that the output is syntactically parseable
      if (options.jsonMode) {
        const cleanJson = trimmed.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        try {
          JSON.parse(cleanJson);
        } catch {
          const err: any = new Error('invalid json response from model');
          err.category = 'INVALID_RESPONSE';
          throw err;
        }
      }

      return trimmed;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /**
   * Invokes secondary fallback provider with detailed execution telemetry
   */
  private static async invokeGeminiFallback(
    options: GeminiChatOptions,
    requestId: string
  ): Promise<GeminiChatExecutionResult> {
    try {
      return await GeminiService.generateChatWithDetails(options);
    } catch (fallbackError: any) {
      // Safe error logging: log only status/class and request ID
      console.error(
        `[HybridAIService] Secondary provider (Gemini) failed (Request ID: ${requestId}).`
      );
      throw fallbackError;
    }
  }

  private static getTimeoutMs(): number {
    const envVal = process.env.GROQ_TIMEOUT_MS;
    if (envVal) {
      const parsed = parseInt(envVal, 10);
      if (!isNaN(parsed) && parsed > 1000) {
        return parsed;
      }
    }
    return this.DEFAULT_TIMEOUT_MS;
  }
}
