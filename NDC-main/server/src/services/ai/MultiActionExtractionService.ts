import prisma from '../../config/prisma';
import { DepartmentAgentRegistry, DepartmentAgentConfig } from './DepartmentAgentRegistry';

export interface ExtractedActionItem {
  actionId: string;
  action: 'CLEAR_DUE' | 'MARK_DUE' | 'HOLD';
  usn: string;
  studentId: string;
  studentName: string;
  clearanceId: string;
  amount?: number;
  reason: string;
  labName?: string;
  departmentCode: string;
  departmentName: string;
  consequences: string;
}

export interface MultiActionParseResult {
  isMultiAction: boolean;
  actions: ExtractedActionItem[];
  unresolvedUsns: string[];
  ambiguityWarning?: string;
  needsClarification: boolean;
  clarificationPrompt?: string;
}

export class MultiActionExtractionService {
  private static readonly USN_REGEX = /\b(4MC\d{2}[A-Z]{2}\d{3})\b/gi;
  private static readonly AMOUNT_REGEX = /(?:(?:rs\.?|inr|₹)\s*(\d+(?:,\d+)*(?:\.\d{1,2})?)|(\d+(?:,\d+)*(?:\.\d{1,2})?)\s*(?:rs\.?|inr|₹|rupees))/gi;

  /**
   * Parse conversational input text to extract one or multiple actions deterministically
   */
  public static async parseActions(
    text: string,
    department: { id: string; code: string; name: string },
    config?: DepartmentAgentConfig | null
  ): Promise<MultiActionParseResult> {
    const rawMatches = text.match(this.USN_REGEX) || [];
    // Deduplicate USNs while preserving first-seen order
    const usns: string[] = [];
    for (const m of rawMatches) {
      const u = m.toUpperCase();
      if (!usns.includes(u)) {
        usns.push(u);
      }
    }

    if (usns.length === 0) {
      return {
        isMultiAction: false,
        actions: [],
        unresolvedUsns: [],
        needsClarification: false
      };
    }

    // Extract all amounts
    const amounts = this.extractAllAmounts(text);
    const hasRespectively = /\brespectively\b/i.test(text);

    // Determine overall action intent
    const lower = text.toLowerCase();
    let actionType: 'CLEAR_DUE' | 'MARK_DUE' | 'HOLD' = 'MARK_DUE';
    if (
      lower.includes('clear') ||
      lower.includes('approve') ||
      lower.includes('no due') ||
      lower.includes('remove due') ||
      lower.includes('waive')
    ) {
      actionType = 'CLEAR_DUE';
    } else if (lower.includes('hold') || lower.includes('freeze')) {
      actionType = 'HOLD';
    }

    // Check for ambiguity in counts
    if (actionType === 'MARK_DUE') {
      const mentionsEach = /\b(?:each|per student|apiece)\b/i.test(text);
      if (usns.length > 1) {
        if (amounts.length === 1 && !mentionsEach) {
          return {
            isMultiAction: true,
            actions: [],
            unresolvedUsns: usns,
            needsClarification: true,
            clarificationPrompt: `I detected ${usns.length} students (${usns.join(', ')}) but only one amount (₹${amounts[0]}). Please clarify whether you would like to apply ₹${amounts[0]} to each student or split it between them.`
          };
        } else if (amounts.length > 1 && usns.length !== amounts.length) {
          return {
            isMultiAction: true,
            actions: [],
            unresolvedUsns: usns,
            needsClarification: true,
            clarificationPrompt: `I detected ${usns.length} students (${usns.join(', ')}) but found ${amounts.length} due amounts (₹${amounts.join(', ₹')}). Please clarify which amount corresponds to each student.`
          };
        }
      }
    }

    // Extract reasons: check if user separated clauses by "respectively", "and", or numbered bullets
    const reasons = this.extractReasonsForUsns(text, usns, hasRespectively);

    // Resolve each student & clearance in database
    const actions: ExtractedActionItem[] = [];
    const unresolvedUsns: string[] = [];

    for (let i = 0; i < usns.length; i++) {
      const usn = usns[i];
      const student = await prisma.student.findFirst({
        where: { usn: { equals: usn, mode: 'insensitive' } },
        include: {
          ndcClearances: {
            where: { departmentId: department.id }
          }
        }
      });

      if (!student) {
        unresolvedUsns.push(usn);
        continue;
      }

      const clearance = student.ndcClearances[0];
      if (!clearance) {
        unresolvedUsns.push(usn);
        continue;
      }

      // Assign amount
      let itemAmount: number | undefined;
      if (actionType === 'MARK_DUE') {
        if (amounts.length === 1) {
          // If 1 amount specified for multiple students without "respectively", apply that amount to each
          itemAmount = amounts[0];
        } else if (amounts.length > i) {
          itemAmount = amounts[i];
        }
      }

      // Assign reason
      let itemReason = reasons[i] || reasons[0] || `${department.name} clearance adjustment`;

      // Clean reason string
      itemReason = itemReason
        .replace(/\brespectively\b/gi, '')
        .replace(/\b(?:rs\.?|inr|₹)\s*\d+/gi, '')
        .trim();
      if (!itemReason) {
        itemReason = department.code === 'LIB'
          ? 'Central Library book overdue / fine'
          : `${department.name} clearance adjustment`;
      }

      const actionId = `act_${Date.now()}_${i + 1}_${Math.random().toString(36).substring(2, 7)}`;
      const consequences =
        actionType === 'MARK_DUE'
          ? `Status will become DUE (₹${itemAmount || 0}) in ${department.name}. Certificate generation will be blocked until paid.`
          : actionType === 'CLEAR_DUE'
          ? `Status will become CLEARED (₹0) in ${department.name}. Student advances towards graduation NDC.`
          : `Status placed ON_HOLD in ${department.name}. Requires further investigation.`;

      actions.push({
        actionId,
        action: actionType,
        usn: student.usn,
        studentId: student.id,
        studentName: student.fullName,
        clearanceId: clearance.id,
        amount: itemAmount,
        reason: itemReason,
        labName: department.name,
        departmentCode: department.code,
        departmentName: department.name,
        consequences
      });
    }

    return {
      isMultiAction: actions.length > 1,
      actions,
      unresolvedUsns,
      needsClarification: false
    };
  }

  private static extractAllAmounts(text: string): number[] {
    const amounts: number[] = [];
    const regex = new RegExp(this.AMOUNT_REGEX.source, 'gi');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const rawNum = match[1] || match[2];
      if (rawNum) {
        const parsed = parseFloat(rawNum.replace(/,/g, ''));
        if (!isNaN(parsed) && parsed > 0) {
          amounts.push(parsed);
        }
      }
    }
    return amounts;
  }

  private static extractReasonsForUsns(
    text: string,
    usns: string[],
    hasRespectively: boolean
  ): string[] {
    if (usns.length <= 1) {
      const match = text.match(/(?:for|due to|reason:|because of)\s+([^.,;]+)/i);
      return [match ? match[1].trim() : 'Laboratory breakage / fee adjustment'];
    }

    if (hasRespectively) {
      const respIdx = text.toLowerCase().indexOf('respectively');
      const textBeforeResp = respIdx !== -1 ? text.substring(0, respIdx) : text;
      const forMatches = Array.from(textBeforeResp.matchAll(/\b(?:for|due to|because of)\b/gi));
      const lastForMatch = forMatches.pop();
      if (lastForMatch && lastForMatch.index !== undefined) {
        const reasonSubstring = textBeforeResp.substring(lastForMatch.index + lastForMatch[0].length).trim();
        const parts = reasonSubstring.split(/\band\b|,/i).map((s) => s.trim()).filter(Boolean);
        if (parts.length >= usns.length) {
          return parts.slice(0, usns.length);
        }
      }
    }

    // Fallback: check if each student clause is separated
    const defaultReason = 'Laboratory equipment breakage / fee dues';
    const reasons: string[] = [];
    for (let i = 0; i < usns.length; i++) {
      reasons.push(defaultReason);
    }
    return reasons;
  }
}
