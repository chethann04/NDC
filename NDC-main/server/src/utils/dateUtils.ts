/**
 * Institutional Timezone & Clearance Timestamp Formatting Utility
 * 
 * Ensures 100% deterministic, timezone-consistent formatting for
 * Department Clearance Approvals across both the application dashboard/modal
 * and the downloaded official No Due Certificate (PDF).
 */

export const INSTITUTIONAL_TIMEZONE = 'Asia/Kolkata';

export interface FormatTimestampOptions {
  status?: string;
  fallback?: string;
  timeZone?: string;
}

/**
 * Authoritative formatter for Department Clearance Approval Timestamps.
 *
 * Rules:
 * - Uses the configured institutional timezone (Asia/Kolkata) so that server
 *   (regardless of OS/container timezone, e.g. UTC) produces the exact instant
 *   displayed on the institutional dashboard.
 * - Format: "DD MMM YYYY, hh:mm A" (e.g., "20 Oct 2026, 02:41 PM").
 * - Missing/null timestamps do NOT fabricate current execution time or certificate issuance time.
 * - Handles 'NOT_APPLICABLE' / 'EXEMPT' desks with "Exempt / Not Applicable".
 * - Handles 'PENDING' desks with "Pending Review".
 * - Handles unverified or missing timestamps with a deterministic fallback (default "Not available").
 * - Handles invalid date strings safely without throwing.
 */
export function formatApprovalTimestamp(
  timestamp?: Date | string | number | null,
  options?: FormatTimestampOptions
): string {
  const statusStr = String(options?.status || '').toUpperCase().trim();
  const isNA = statusStr === 'NOT_APPLICABLE' || statusStr === 'EXEMPT' || statusStr === 'N/A';
  const isPending = statusStr === 'PENDING';
  const targetTimeZone = options?.timeZone || INSTITUTIONAL_TIMEZONE;

  if (timestamp === null || timestamp === undefined || timestamp === '') {
    if (isNA) return 'Exempt / Not Applicable';
    if (isPending) return 'Pending Review';
    return options?.fallback || 'Not available';
  }

  const d = typeof timestamp === 'string' || typeof timestamp === 'number'
    ? new Date(timestamp)
    : timestamp;

  if (!(d instanceof Date) || isNaN(d.getTime())) {
    if (isNA) return 'Exempt / Not Applicable';
    if (isPending) return 'Pending Review';
    return options?.fallback || 'Not available';
  }

  // Consistent format: "20 Oct 2026, 02:41 PM"
  const dateStr = d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: targetTimeZone
  });

  const timeStr = d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: targetTimeZone
  });

  return `${dateStr}, ${timeStr}`;
}

/**
 * Safely parse a persisted timestamp without losing timezone information.
 * Returns null if the value is missing, empty, or an invalid date.
 */
export function parseApprovalTimestamp(
  timestamp?: Date | string | number | null
): Date | null {
  if (timestamp === null || timestamp === undefined || timestamp === '') {
    return null;
  }
  const d = typeof timestamp === 'string' || typeof timestamp === 'number'
    ? new Date(timestamp)
    : timestamp;
  if (!(d instanceof Date) || isNaN(d.getTime())) {
    return null;
  }
  return d;
}
