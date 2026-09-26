import { UserFriendlyError, ErrorPayload } from '../types/error';

/**
 * Normalizes any technical error, Axios failure, status code, or message
 * into a single cohesive, human-friendly error object:
 * - title: Short, clear, non-technical title
 * - message: 1-2 natural sentences combining what happened, the reason if known, and the action to take.
 *
 * Developers still get the full technical error in console.error.
 */
export function normalizeError(
  err: ErrorPayload,
  fallback?: Partial<UserFriendlyError>
): UserFriendlyError {
  if (!err) {
    return {
      title: fallback?.title || 'Something went wrong',
      message: fallback?.message || 'We couldn\'t complete your request because an unexpected problem occurred. Please try again in a moment.'
    };
  }

  // Developer logging (keeps technical details intact in developer tools)
  if (typeof window !== 'undefined') {
    console.error('[NDC API Diagnostic Error]:', {
      original: err,
      status: err?.response?.status,
      data: err?.response?.data,
      code: err?.code,
      message: err?.message
    });
  }

  // If already normalized with title and message
  if (typeof err === 'object' && err !== null && 'title' in err && 'message' in err) {
    return {
      title: err.title || fallback?.title || 'Something went wrong',
      message: err.message || fallback?.message || 'We couldn\'t complete your request. Please try again.',
      actionLabel: err.actionLabel || fallback?.actionLabel,
      onAction: err.onAction || fallback?.onAction,
      code: err.code || fallback?.code
    };
  }

  // Support legacy { what, why, action } objects by combining them into one natural sentence
  if (typeof err === 'object' && err !== null && ('what' in err || 'why' in err || 'action' in err)) {
    const what = err.what ? String(err.what).replace(/\.+$/, '') : '';
    const why = err.why ? String(err.why).replace(/\.+$/, '') : '';
    const action = err.action ? String(err.action) : '';

    let combined = '';
    if (what && why) {
      combined = `${what} because ${why.charAt(0).toLowerCase() + why.slice(1)}. ${action}`.trim();
    } else if (what) {
      combined = `${what}. ${action}`.trim();
    } else {
      combined = `${why}. ${action}`.trim();
    }

    return {
      title: fallback?.title || 'Action Required',
      message: combined,
      actionLabel: err.actionLabel || fallback?.actionLabel,
      onAction: err.onAction || fallback?.onAction
    };
  }

  // Inspect backend structured response
  const responseData = err?.response?.data;
  if (responseData && typeof responseData === 'object') {
    if (responseData.error && typeof responseData.error === 'object' && responseData.error.title && responseData.error.message) {
      return {
        title: responseData.error.title,
        message: responseData.error.message,
        actionLabel: responseData.error.actionLabel,
        code: responseData.error.code || responseData.code
      };
    }
  }

  // Extract raw text and status
  let rawMessage = '';
  if (typeof err === 'string') {
    rawMessage = err;
  } else if (responseData?.message && typeof responseData.message === 'string') {
    rawMessage = responseData.message;
  } else if (responseData?.error && typeof responseData.error === 'string') {
    rawMessage = responseData.error;
  } else if (err?.message && typeof err.message === 'string') {
    rawMessage = err.message;
  }

  const statusCode = err?.response?.status || err?.status;
  const lower = rawMessage.toLowerCase();

  // 1. Connection & Network Problems
  if (
    lower.includes('network error') ||
    lower.includes('econnrefused') ||
    lower.includes('failed to fetch') ||
    err?.code === 'ERR_NETWORK' ||
    err?.code === 'ECONNABORTED' ||
    lower.includes('timeout')
  ) {
    return {
      title: 'Connection problem',
      message: 'We couldn\'t reach the college server. Check your internet connection and try again.'
    };
  }

  // 2. Student Authentication
  if (lower.includes('please enter your university seat number') || lower.includes('usn is required') || lower.includes('usn required')) {
    return {
      title: 'USN required',
      message: 'Please enter your University Seat Number (USN) to sign in.'
    };
  }

  if (lower.includes('date of birth') && (lower.includes('select') || lower.includes('enter') || lower.includes('required'))) {
    return {
      title: 'Date of Birth required',
      message: 'Please enter or select your Date of Birth to verify your student identity.'
    };
  }

  if (lower.includes('invalid date of birth format')) {
    return {
      title: 'Invalid date format',
      message: 'We couldn\'t read your Date of Birth. Please use the calendar picker or enter it as DD/MM/YYYY.'
    };
  }

  if (lower.includes('no student record found') || lower.includes('student not found') || lower.includes('check your usn')) {
    return {
      title: 'Student not found',
      message: 'We couldn\'t find a student matching that USN. Double-check your University Seat Number and try again.'
    };
  }

  if (lower.includes('date of birth does not match') || lower.includes("verify your identity") || lower.includes("doesn't match our records") || (lower.includes('dob') && lower.includes('match'))) {
    return {
      title: 'Verification failed',
      message: 'The Date of Birth you entered doesn\'t match our records for this USN. Please check and try again.'
    };
  }

  if (lower.includes('student account is inactive') || lower.includes('account has been deactivated') || lower.includes('account is inactive') || lower.includes('account is deactivated')) {
    return {
      title: 'Account inactive',
      message: 'We couldn\'t sign you in because your account is currently inactive. Please contact the college office for assistance.'
    };
  }

  if (lower.includes('incorrect password') || lower.includes('password is required to sign in')) {
    return {
      title: 'Wrong password',
      message: 'The password you entered is incorrect. Please try again.'
    };
  }

  if (lower.includes('at least 6 characters') && lower.includes('password')) {
    return {
      title: 'Password too short',
      message: 'Your password must be at least 6 characters long. Please choose a stronger password.'
    };
  }

  // 3. Officer & Staff Login
  if (lower.includes('email and password are required')) {
    return {
      title: 'Missing credentials',
      message: 'Please enter both your college email and password to sign in.'
    };
  }

  if (lower.includes('invalid credentials')) {
    return {
      title: 'Sign-in failed',
      message: 'We couldn\'t sign you in because the email or password is incorrect. Check your details and try again.'
    };
  }

  // 4. Session & Permissions
  // Only treat as session-expired if NOT on an auth/login page
  const isOnAuthPage = typeof window !== 'undefined' &&
    ['/login', '/student-login', '/verify'].some((p) => window.location.pathname === p || window.location.pathname.startsWith(p));

  if (statusCode === 401 && !isOnAuthPage) {
    return {
      title: 'Session expired',
      message: 'Your session ended because you were inactive for too long. Sign in again to continue.',
      actionLabel: 'Sign In',
      onAction: () => {
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
      }
    };
  }

  // 401 on auth pages = wrong credentials
  if (statusCode === 401 && isOnAuthPage) {
    return {
      title: 'Sign In Failed',
      message: rawMessage || 'The credentials you entered are incorrect. Please check and try again.'
    };
  }

  if (statusCode === 403 || lower.includes('forbidden') || lower.includes('access restricted') || lower.includes('permission denied')) {
    return {
      title: 'Action not allowed',
      message: 'You don\'t have permission to perform this action. Contact the administrator if you believe you should have access.'
    };
  }

  // 5. Password Reset
  if (lower.includes('current password') || lower.includes('incorrect old password')) {
    return {
      title: 'Incorrect current password',
      message: 'The current password you entered does not match your records. Check your details and try again.'
    };
  }

  if (lower.includes('at least 6 characters')) {
    return {
      title: 'Password too short',
      message: 'Your new password must be at least 6 characters long. Choose a longer password and try again.'
    };
  }

  if (lower.includes('passwords do not match')) {
    return {
      title: 'Passwords do not match',
      message: 'The new password and confirmation password do not match. Please re-enter them carefully.'
    };
  }

  // 6. NDC Requests & Clearances
  if (lower.includes('already have an active ndc') || lower.includes('active request already exists')) {
    return {
      title: 'Request already active',
      message: 'You already have an active NDC request in progress. Check your dashboard to monitor its clearance status.'
    };
  }

  if (lower.includes('cannot download a revoked certificate') || lower.includes('revoked certificate')) {
    return {
      title: 'Certificate revoked',
      message: 'This certificate cannot be downloaded because it was revoked by college authorities. Contact the office for assistance.'
    };
  }

  if (lower.includes('failed to submit ndc application') || lower.includes('ndc request failed')) {
    return {
      title: 'NDC request failed',
      message: 'We couldn\'t submit your NDC request because the server couldn\'t complete the operation. Please try again. If the problem continues, contact the college office.'
    };
  }

  if (lower.includes('clearance') && (lower.includes('batch') || lower.includes('failed') || lower.includes('not updated'))) {
    return {
      title: 'Clearance not updated',
      message: 'We couldn\'t update this clearance request because an issue occurred on the server. Please try again.'
    };
  }

  // 7. Bulk Import & File Uploads
  if (lower.includes('excel or csv file is required') || lower.includes('file parsing') || lower.includes('import failed') || lower.includes('synchronization failed')) {
    return {
      title: 'Import failed',
      message: 'We couldn\'t import the student file because some of its data could not be processed. Check the file format and try again.'
    };
  }

  // 8. Mandatory Remarks
  if (lower.includes('remarks are compulsory') || lower.includes('remarks are required') || lower.includes('remarks mandatory')) {
    return {
      title: 'Remarks required',
      message: 'Please enter an explanatory remark before completing this action.'
    };
  }

  // 9. Duplicates & Batch Formats
  if (lower.includes('already exists')) {
    return {
      title: 'Record already exists',
      message: 'A record with these details already exists. Please verify the information and try again.'
    };
  }

  if (lower.includes('valid batch year')) {
    return {
      title: 'Invalid batch year',
      message: 'Please enter a valid four-year batch range such as 2024-2028.'
    };
  }

  // 10. Certificate Verification
  if (lower.includes('sequence number')) {
    return {
      title: 'Sequence number required',
      message: 'Please enter the certificate sequence number (e.g. 001, 112) to verify.'
    };
  }

  if (lower.includes('verification search failed') || (lower.includes('not found') && lower.includes('certificate'))) {
    return {
      title: 'Certificate not found',
      message: 'We couldn\'t verify this certificate because it was not found in the official registry. Check the certificate number and try again.'
    };
  }

  // 11. PDF Exporting
  if (lower.includes('pdf report') || lower.includes('export pdf') || lower.includes('submission report')) {
    return {
      title: 'Export failed',
      message: 'We couldn\'t generate the PDF report right now. Please wait a moment and try again.'
    };
  }

  // 12. HTTP Status Fallbacks
  if (statusCode === 404) {
    return {
      title: 'Information not found',
      message: 'We couldn\'t find the requested information. It may have been moved or removed.'
    };
  }

  if (statusCode === 409) {
    return {
      title: 'Conflict detected',
      message: 'This record conflicts with existing data in the system. Check the details and try again.'
    };
  }

  if (statusCode === 429) {
    return {
      title: 'Too many requests',
      message: 'You\'ve made too many requests in a short period. Please wait a moment before trying again.'
    };
  }

  if (statusCode === 503) {
    return {
      title: 'Service temporarily unavailable',
      message: 'We couldn\'t complete your request because the college service is temporarily unavailable. Please wait a moment and try again.'
    };
  }

  if (statusCode && statusCode >= 500) {
    return {
      title: 'Something went wrong',
      message: 'We couldn\'t complete your request because the college server encountered a problem. Please try again in a moment.'
    };
  }

  // 13. General Fallback
  return {
    title: fallback?.title || 'Something went wrong',
    message: fallback?.message || 'We couldn\'t complete your request because an unexpected problem occurred. Please try again in a moment.'
  };
}

// Backwards-compatible alias
export const parseStructuredError = normalizeError;
