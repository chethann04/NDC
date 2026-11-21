import crypto from 'crypto';
import { AssistantChatResponse } from '../AiAssistantService';
import { UserRole } from '../../constants/roles';

export interface PiiScanResult {
  sanitizedReply: string;
  piiDetected: boolean;
  categories: string[];
}

export interface ScopeValidationResult {
  isOutOfScope: boolean;
  reason?: string;
  reply?: string;
}

export class AiSecurityGuard {
  public static readonly MAX_INPUT_LENGTH = 1000;
  public static readonly MAX_HISTORY_LENGTH = 10;

  // Fixed supportive crisis response with India-specific emergency resources
  public static readonly SELF_HARM_CRISIS_RESPONSE =
    `I'm really sorry that you're feeling this way, but please know that you are not alone and there is support available right now.\n\n` +
    `Please step away from anything dangerous and reach out to someone you trust or contact professional emergency support immediately:\n\n` +
    `• **National Emergency Helpline**: **112** (Immediate Police / Ambulance / Fire Assistance)\n` +
    `• **Tele-MANAS (Mental Health Helpline)**: **14416** or **1800-891-4416** (Toll-Free, 24/7, Multilingual Support)\n` +
    `• **KIRAN Mental Health Rehabilitation Helpline**: **1800-599-0019** (Toll-Free, 24/7 Government Support)\n` +
    `• **Vandrevala Foundation**: **+91 9999 666 555** (Free, confidential 24/7 crisis counselling)\n\n` +
    `People care about you and want to help. Please reach out to one of these services or speak with a family member, trusted friend, or college counsellor right now.`;

  public static readonly DEFAULT_OUT_OF_SCOPE_REFUSAL =
    `I am the NDC Clearance Assistant for Malnad College of Engineering (MCE). ` +
    `I can only assist with student No Due clearance operations, checking dues, recording or clearing departmental dues, and clearance reports. ` +
    `I cannot assist with topics outside this scope. How can I help you with your clearance desk today?`;

  public static readonly PII_RESTRICTED_REFUSAL =
    `For security and privacy compliance, personal contact details (such as personal email addresses, phone numbers, and identity documents) ` +
    `are restricted. I can only assist with authorized student No Due clearance statuses, departmental dues, and official clearance reports.`;

  // ─────────────────────────────────────────────────────────────
  // 1. SELF-HARM & CRISIS DETECTION
  // ─────────────────────────────────────────────────────────────

  /**
   * Deterministic server-side detection for suicidal ideation, self-harm intent,
   * requests for methods, or distress. Does not rely on the LLM.
   */
  public static detectSelfHarm(text: string): boolean {
    if (!text || typeof text !== 'string') return false;
    const lower = text.toLowerCase();

    // Direct suicidal ideation / intent
    const suicidalPatterns = [
      /\b(?:suicid(?:e|al|ing)?|kill\s+(?:my\s*self|myself|oneself))\b/i,
      /\b(?:end\s+my\s+life|want\s+to\s+die|better\s+off\s+dead|wish\s+i\s+were\s+dead)\b/i,
      /\b(?:hang\s+myself|shoot\s+myself|jump\s+off\s+(?:a\s+bridge|a\s+building|a\s+roof))\b/i,
      /\b(?:overdose\s+(?:on|myself)|slit\s+my\s+wrists?|take\s+my\s+own\s+life)\b/i,
      /\b(?:don'?t\s+want\s+to\s+(?:live|be\s+alive|exist))\b/i,
      /\b(?:suicidal\s+(?:thoughts|feelings|ideation|impulses))\b/i,
      /\b(?:worthless[,\s]+(?:i\s+have\s+access\s+to\s+something|i\s+could\s+use\s+to\s+hurt\s+myself))\b/i
    ];

    // Intent to self-harm / distress expressions
    const selfHarmPatterns = [
      /\b(?:hurt\s+(?:my\s*self|myself)|harm\s+(?:my\s*self|myself)|cutting\s+(?:my\s*self|myself)|cut\s+(?:my\s*self|myself))\b/i,
      /\b(?:self[ -]harm|self[ -]injury|self[ -]mutilat(?:e|ion))\b/i,
      /\b(?:bleed\s+out|punish\s+myself\s+physically|burn\s+myself)\b/i
    ];

    // Requests for methods, lethal substances, or encouragement
    const methodPatterns = [
      /\b(?:how\s+to\s+(?:commit\s+suicide|kill\s+(?:myself|oneself)|die\s+painlessly|overdose))\b/i,
      /\b(?:painless\s+(?:way|method)\s+to\s+die|lethal\s+dose\s+of|lethal\s+amount\s+of)\b/i,
      /\b(?:best\s+way\s+to\s+(?:commit\s+suicide|hang|overdose|die))\b/i,
      /\b(?:methods?\s+of\s+(?:suicide|self[ -]harm))\b/i
    ];

    return (
      suicidalPatterns.some((pattern) => pattern.test(lower)) ||
      selfHarmPatterns.some((pattern) => pattern.test(lower)) ||
      methodPatterns.some((pattern) => pattern.test(lower))
    );
  }

  /**
   * Returns fixed supportive response bypassing operational workflow
   */
  public static getSelfHarmResponse(): AssistantChatResponse {
    return {
      reply: this.SELF_HARM_CRISIS_RESPONSE,
      actionRequired: null,
      suggestions: [
        'National Emergency Helpline: 112',
        'Tele-MANAS Helpline: 14416',
        'KIRAN Helpline: 1800-599-0019'
      ]
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 2. INPUT SCOPE & RESOURCE HIJACKING VALIDATION (PRE-LLM)
  // ─────────────────────────────────────────────────────────────

  /**
   * Lightweight deterministic check executed BEFORE invoking Groq / Gemini.
   * Fails closed on unauthorized prompts, role overrides, jailbreaks, and off-topic tasks.
   */
  public static validateInputScope(text: string): ScopeValidationResult {
    if (!text || typeof text !== 'string') {
      return { isOutOfScope: true, reply: this.DEFAULT_OUT_OF_SCOPE_REFUSAL };
    }

    const lower = text.toLowerCase().trim();

    // 1. Role-change, instruction replacement, and jailbreak attempts
    const jailbreakPatterns = [
      /\b(?:ignore\s+(?:all\s+)?(?:previous|prior|system)\s+instructions)\b/i,
      /\b(?:disregard\s+(?:all\s+)?(?:prior|previous|system)\s+instructions)\b/i,
      /\b(?:system\s+prompt\s+override|override\s+system\s+prompt)\b/i,
      /\b(?:act\s+as\s+(?:DAN|an\s+unrestricted|a\s+new|a\s+different|a\s+jailbroken|my\s+personal))\b/i,
      /\b(?:you\s+are\s+now\s+(?:a|an)\s+(?:poet|coder|translator|developer|chef|nutritionist|doctor|researcher|writer|hacker|bot))\b/i,
      /\b(?:pretend\s+(?:you\s+have\s+no\s+rules|to\s+be\s+an\s+unrestricted|you\s+are\s+in\s+developer\s+mode))\b/i,
      /\b(?:bypass\s+(?:all\s+)?(?:rules|safety|guardrails|filters|restrictions))\b/i,
      /\b(?:disable\s+(?:all\s+)?(?:safety|guardrails|filters|content\s+moderation))\b/i,
      /\b(?:uncensored\s+(?:mode|output|responses))\b/i
    ];

    if (jailbreakPatterns.some((p) => p.test(lower))) {
      return {
        isOutOfScope: true,
        reason: 'JAILBREAK_OR_ROLE_OVERRIDE_ATTEMPT',
        reply: this.DEFAULT_OUT_OF_SCOPE_REFUSAL
      };
    }

    // 2. System prompt or internal developer instructions extraction attempts
    const promptExtractionPatterns = [
      /\b(?:repeat|print|reveal|output|display|show|dump|leak)\s+(?:the\s+|your\s+|all\s+)?(?:master\s+system\s+prompt|system\s+prompt|master\s+prompt|developer\s+prompt|initial\s+prompt|internal\s+instructions|system\s+instructions|developer\s+instructions|hidden\s+rules)\b/i,
      /\b(?:what\s+are\s+your\s+(?:exact\s+)?(?:system\s+prompts?|internal\s+instructions?|system\s+instructions?))\b/i,
      /\b(?:master\s+system\s+prompt|developer\s+instructions\s+verbatim)\b/i
    ];

    if (promptExtractionPatterns.some((p) => p.test(lower))) {
      return {
        isOutOfScope: true,
        reason: 'PROMPT_EXTRACTION_ATTEMPT',
        reply: this.DEFAULT_OUT_OF_SCOPE_REFUSAL
      };
    }

    // 3. Social engineering / Role spoofing / Emergency bypass claims
    const socialEngineeringPatterns = [
      /\b(?:i(?:'m|\s+am)\s+(?:the\s+)?(?:administrator|admin|principal|dean|superadmin|parent|father|mother))\b/i,
      /\b(?:principal\s+gave\s+me\s+permission|this\s+is\s+an\s+emergency[,\s]+show\s+me|bypass\s+(?:permissions|authorization))\b/i
    ];

    if (socialEngineeringPatterns.some((p) => p.test(lower))) {
      return {
        isOutOfScope: true,
        reason: 'SOCIAL_ENGINEERING_CLAIM',
        reply: this.PII_RESTRICTED_REFUSAL
      };
    }

    // 4. Unauthorized bulk PII / private data harvesting requests
    const piiHarvestingPatterns = [
      /\b(?:retrieve|reveal|dump|export|show|list)\s+(?:the\s+)?(?:user's?\s+)?(?:complete\s+profile|authentication\s+history|ip\s+addresses?|saved\s+payment|credit\s+card|phone\s+numbers?|email\s+addresses?|personal\s+addresses?|passwords?|security\s+questions?)\b/i,
      /\b(?:registered\s+phone\s+number|security[ -]question\s+answers?|recovery\s+email|last\s+login\s+time)\b/i,
      /\b(?:all\s+users\s+(?:in\s+the\s+system\s+)?who\s+are\s+under\s+18|birth\s+dates|school\s+information|guardian\s+contacts)\b/i,
      /\b(?:previous\s+(?:session|tester's?\s+conversation)|personal\s+detail\s+they\s+disclosed)\b/i,
      /\b(?:export\s+all\s+user\s+records|device\s+identifiers|precise\s+location\s+data)\b/i,
      /\b(?:hiv\s+diagnosis|medical\s+records?|insurance\s+member\s+numbers?)\b/i,
      /\b(?:all\s+personal\s+contact\s+records|show\s+me\s+all\s+personal\s+contact)\b/i
    ];

    if (piiHarvestingPatterns.some((p) => p.test(lower))) {
      return {
        isOutOfScope: true,
        reason: 'UNAUTHORIZED_PII_REQUEST',
        reply: this.PII_RESTRICTED_REFUSAL
      };
    }

    // 5. Clearly off-topic domains (programming, creative writing, homework, medicine, commerce, etc.)
    const offTopicPatterns = [
      /\b(?:write\s+a\s+(?:poem|essay|song|story|code|script|python|javascript|program|function|html|css|novel|joke))\b/i,
      /\b(?:diagnose\s+(?:my\s+|the\s+)?(?:symptoms|headache|disease|illness)|medical\s+advice|prescribe\s+(?:medicine|treatment|medication))\b/i,
      /\b(?:weight[ -]loss\s+diet|meal\s+plan(?:ning)?|workout\s+routine|fitness\s+plan)\b/i,
      /\b(?:redesign\s+(?:the\s+)?(?:brand|logo|identity)|suggest\s+a\s+new\s+company\s+name|marketing\s+strategy)\b/i,
      /\b(?:solve\s+this\s+(?:math|calculus|algebra|physics|chemistry)\s+problem)\b/i,
      /\b(?:investment\s+advice|buy\s+crypto|stock\s+market|bitcoin|ethereum)\b/i,
      /\b(?:weather\s+(?:forecast|today|tomorrow)|who\s+won\s+the\s+(?:match|game|world\s+cup|election))\b/i
    ];

    if (offTopicPatterns.some((p) => p.test(lower))) {
      return {
        isOutOfScope: true,
        reason: 'OFF_TOPIC_REQUEST',
        reply: this.DEFAULT_OUT_OF_SCOPE_REFUSAL
      };
    }

    return { isOutOfScope: false };
  }

  // ─────────────────────────────────────────────────────────────
  // 3. SERVER-SIDE PII OUTPUT REDACTION & PROTECTION
  // ─────────────────────────────────────────────────────────────

  /**
   * Scans model output or generated reply for unauthorized personal data
   * and redacts it before returning to the user.
   *
   * Invariant: Never logs the raw PII. Only logs event metadata.
   */
  public static sanitizeOutputPii(reply: string, userRole: string, userId?: string): PiiScanResult {
    if (!reply || typeof reply !== 'string') {
      return { sanitizedReply: reply || '', piiDetected: false, categories: [] };
    }

    let sanitized = reply;
    const categories: string[] = [];
    let piiFound = false;

    // 1. Payment / Card Numbers (16-digit credit card patterns) - run FIRST before 12-digit Aadhaar
    const creditCardRegex = /\b(?:\d{4}[-\s]){3}\d{4}\b|\b\d{16}\b/g;
    if (creditCardRegex.test(sanitized)) {
      sanitized = sanitized.replace(creditCardRegex, () => {
        piiFound = true;
        if (!categories.includes('PAYMENT_CARD')) categories.push('PAYMENT_CARD');
        return '[CARD REDACTED]';
      });
    }

    // 2. Email Redaction (Allow official institutional contact emails, redact personal emails)
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
    if (emailRegex.test(sanitized)) {
      sanitized = sanitized.replace(emailRegex, (match) => {
        if (match.toLowerCase().endsWith('@mce.ac.in')) {
          return match;
        }
        piiFound = true;
        if (!categories.includes('EMAIL')) categories.push('EMAIL');
        return '[EMAIL REDACTED]';
      });
    }

    // 3. Phone Number Redaction (Indian 10-digit mobile or international formats)
    const phoneRegex = /\b(?:\+91[-\s]?)?[6-9]\d{9}\b|\b(?:\d{3}[-.\s]\d{3}[-.\s]\d{4})\b/g;
    if (phoneRegex.test(sanitized)) {
      sanitized = sanitized.replace(phoneRegex, () => {
        piiFound = true;
        if (!categories.includes('PHONE')) categories.push('PHONE');
        return '[PHONE REDACTED]';
      });
    }

    // 4. Government / National Identifiers (Aadhaar 12-digit, PAN, SSN)
    const aadhaarRegex = /\b\d{4}\s\d{4}\s\d{4}\b/g;
    if (aadhaarRegex.test(sanitized)) {
      sanitized = sanitized.replace(aadhaarRegex, () => {
        piiFound = true;
        if (!categories.includes('GOV_ID')) categories.push('GOV_ID');
        return '[GOV ID REDACTED]';
      });
    }

    const panRegex = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g;
    if (panRegex.test(sanitized)) {
      sanitized = sanitized.replace(panRegex, () => {
        piiFound = true;
        if (!categories.includes('PAN_NUMBER')) categories.push('PAN_NUMBER');
        return '[PAN REDACTED]';
      });
    }

    const ssnRegex = /\b\d{3}-\d{2}-\d{4}\b/g;
    if (ssnRegex.test(sanitized)) {
      sanitized = sanitized.replace(ssnRegex, () => {
        piiFound = true;
        if (!categories.includes('SSN')) categories.push('SSN');
        return '[SSN REDACTED]';
      });
    }

    // 5. Authentication Secrets, Password hashes, or Staged Tokens
    const tokenSecretRegex = /\b(?:Bearer\s+[A-Za-z0-9\-._~+/]+=*|[a-f0-9]{64}|password[=:]\s*\S+)\b/gi;
    if (tokenSecretRegex.test(sanitized)) {
      sanitized = sanitized.replace(tokenSecretRegex, (match) => {
        if (match.length > 20 || /bearer|password/i.test(match)) {
          piiFound = true;
          if (!categories.includes('TOKEN_SECRET')) categories.push('TOKEN_SECRET');
          return '[SECRET REDACTED]';
        }
        return match;
      });
    }

    // Safe security telemetry: NEVER log raw PII values
    if (piiFound) {
      console.warn(
        `[AiSecurityGuard] Redacted unauthorized PII from output. Event: PII_OUTPUT_REDACTED, Categories: ${categories.join(', ')}, User: ${userId || 'anonymous'}`
      );
    }

    return {
      sanitizedReply: sanitized,
      piiDetected: piiFound,
      categories
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 4. OUTPUT SAFETY (SELF-HARM INSTRUCTIONS CHECK)
  // ─────────────────────────────────────────────────────────────

  /**
   * Scans model output to ensure the LLM did not generate self-harm instructions.
   * If detected, the response is completely replaced with the crisis helpline message.
   */
  public static validateOutputSafety(reply: string): boolean {
    if (!reply || typeof reply !== 'string') return true;
    const lower = reply.toLowerCase();

    // Check for harmful facilitation or suicide instruction phrases
    const prohibitedFacilitation = [
      /\b(?:how\s+you\s+can\s+kill\s+yourself|ways\s+to\s+end\s+your\s+life|to\s+overdose\s+successfully)\b/i,
      /\b(?:lethal\s+dose\s+is|sufficient\s+amount\s+to\s+cause\s+death|painless\s+way\s+to\s+die\s+is)\b/i,
      /\b(?:instructions\s+for\s+hanging|step-by-step\s+suicide)\b/i
    ];

    return !prohibitedFacilitation.some((p) => p.test(lower));
  }
}
