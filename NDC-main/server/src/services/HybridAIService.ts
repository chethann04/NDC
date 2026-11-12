import { GeminiService, GeminiChatOptions } from './GeminiService';

/**
 * Text-chat provider router.
 *
 * Qwen on Groq is the preferred provider. Gemini remains the fallback and
 * continues to power document/vision analysis through GeminiService.
 * The model only produces suggestions/structured intent; NDC services remain
 * responsible for authorization, validation, confirmation and database writes.
 */
export class HybridAIService {
  private static readonly DEFAULT_QWEN_MODEL = 'qwen/qwen3.8-27b';
  private static readonly REQUEST_TIMEOUT_MS = 25_000;

  public static async generateChat(options: GeminiChatOptions): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY?.trim();

    if (!apiKey) {
      return GeminiService.generateChat(options);
    }

    try {
      return await this.generateWithQwen(apiKey, options);
    } catch (error: any) {
      // Provider failures are isolated to the model layer. No NDC operation
      // has been executed at this point, so falling back cannot duplicate a write.
      console.warn(
        '[HybridAIService] Qwen provider unavailable; falling back to Gemini:',
        error?.message || error
      );
      return GeminiService.generateChat(options);
    }
  }

  private static async generateWithQwen(
    apiKey: string,
    options: GeminiChatOptions
  ): Promise<string> {
    const model = process.env.GROQ_MODEL?.trim() || this.DEFAULT_QWEN_MODEL;
    const messages = [
      ...(options.systemPrompt
        ? [{ role: 'system', content: options.systemPrompt }]
        : []),
      ...options.messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({
          role: message.role === 'model' ? 'assistant' : 'user',
          content: message.content
        }))
    ];

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.REQUEST_TIMEOUT_MS
    );

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature ?? 0.2,
          max_tokens: 2048,
          ...(options.jsonMode
            ? { response_format: { type: 'json_object' } }
            : {})
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Groq API returned HTTP ${response.status}: ${body.slice(0, 300)}`);
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      const text = data.choices?.[0]?.message?.content;

      if (typeof text !== 'string' || !text.trim()) {
        throw new Error('Qwen returned an empty chat completion.');
      }

      return text;
    } finally {
      clearTimeout(timeout);
    }
  }
}
