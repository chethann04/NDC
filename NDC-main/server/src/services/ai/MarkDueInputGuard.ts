export type MarkDueInputIssue = 'INVALID_AMOUNT' | 'MISSING_REASON';

const GENERIC_REASONS = new Set([
  'Central Library book overdue / fine',
  'Apparatus / Lab Equipment Damage',
  'Glassware / Chemistry Equipment Damage',
  'Sports Equipment Due',
  'Hostel Dues',
  'Tuition / Institutional Fee Due',
  'Clearance Adjustment Due'
]);

/**
 * Pure preflight guard shared by the operational handler and its regression tests.
 * Returns an issue when MARK_DUE must ask for more information instead of staging.
 */
export function getMarkDueInputIssue(
  amount: number | null,
  reason: string | null | undefined,
  departmentName: string
): MarkDueInputIssue | null {
  if (amount === null || !Number.isFinite(amount) || amount <= 0) {
    return 'INVALID_AMOUNT';
  }

  const suppliedReason = (reason || '').trim();
  if (
    !suppliedReason ||
    GENERIC_REASONS.has(suppliedReason) ||
    suppliedReason.toLowerCase() === `${departmentName} clearance adjustment`.toLowerCase()
  ) {
    return 'MISSING_REASON';
  }

  return null;
}
