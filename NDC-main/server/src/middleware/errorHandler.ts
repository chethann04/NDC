import { Request, Response, NextFunction } from 'express';

export interface UserFriendlyError {
  title: string;
  message: string;
  code?: string;
}

export function formatServerUserError(err: any, statusCode: number): UserFriendlyError {
  const raw = String(err?.message || err || '').trim();
  const lower = raw.toLowerCase();

  // If already formatted
  if (err?.error && typeof err.error === 'object' && err.error.title && err.error.message) {
    return err.error;
  }

  if (statusCode === 401 || lower.includes('unauthorized') || lower.includes('token') || lower.includes('authentication required')) {
    return {
      title: 'Session expired',
      message: 'Your session ended because you were inactive for too long. Sign in again to continue.',
      code: 'UNAUTHORIZED'
    };
  }

  if (statusCode === 403 || lower.includes('forbidden') || lower.includes('restricted') || lower.includes('permission denied')) {
    return {
      title: 'Action not allowed',
      message: 'You don\'t have permission to perform this action. Contact the administrator if you believe you should have access.',
      code: 'FORBIDDEN'
    };
  }

  if (statusCode === 404 || lower.includes('not found')) {
    return {
      title: 'Not found',
      message: 'We couldn\'t find the requested information. Check your details and try again.',
      code: 'NOT_FOUND'
    };
  }

  if (statusCode === 429) {
    return {
      title: 'Too many requests',
      message: 'You\'ve made too many requests in a short period. Please wait a moment before trying again.',
      code: 'RATE_LIMIT'
    };
  }

  if (statusCode === 503) {
    return {
      title: 'Service temporarily unavailable',
      message: 'We couldn\'t complete your request because the college service is temporarily unavailable. Please wait a moment and try again.',
      code: 'SERVICE_UNAVAILABLE'
    };
  }

  if (statusCode === 400) {
    // Validation issues
    if (lower.includes('remarks are compulsory') || lower.includes('remarks are required')) {
      return {
        title: 'Remarks required',
        message: 'Please provide an explanatory remark before completing this action.',
        code: 'VALIDATION_ERROR'
      };
    }
    if (lower.includes('already exists')) {
      return {
        title: 'Record already exists',
        message: 'A record with these details already exists. Check the list to make updates.',
        code: 'CONFLICT'
      };
    }
    return {
      title: 'Request could not be processed',
      message: 'The submitted details are incomplete or could not be processed. Please check your information and try again.',
      code: 'BAD_REQUEST'
    };
  }

  // 500 Server error
  return {
    title: 'Something went wrong',
    message: 'We couldn\'t complete your request because the college server encountered a problem. Please try again in a moment.',
    code: 'SERVER_ERROR'
  };
}

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  // Keep developer diagnostic error logged in server console
  console.error('[NDC Server Error]:', {
    url: req.originalUrl,
    method: req.method,
    status: err.statusCode || err.status || 500,
    message: err.message,
    stack: err.stack
  });

  const statusCode = err.statusCode || err.status || 500;
  const userError = formatServerUserError(err, statusCode);

  res.status(statusCode).json({
    success: false,
    message: userError.message,
    error: userError,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
};
