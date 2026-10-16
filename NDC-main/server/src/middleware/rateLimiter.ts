import rateLimit from 'express-rate-limit';

// Strict limiter for authentication attempts (login, student-login, registration)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 requests per 15 minutes per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    status: 'RATE_LIMITED',
    message: 'Too many authentication attempts from this IP. Please wait 15 minutes before trying again.'
  }
});

// Stricter limiter for OTP requests to prevent SMS/email abuse and cost spikes
export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per 15 minutes per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    status: 'RATE_LIMITED',
    message: 'Too many OTP requests. Please wait 15 minutes before requesting another verification code.'
  }
});

// Limiter for password reset endpoints
export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    status: 'RATE_LIMITED',
    message: 'Too many password reset requests. Please wait 15 minutes before trying again.'
  }
});

// General limiter applied across all API endpoints to protect against DDoS & flooding
export const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000, // Up to 1000 requests per 15 mins per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    status: 'RATE_LIMITED',
    message: 'Request rate limit exceeded. Please slow down and try again later.'
  }
});

// Limiter for certificate verification requests
export const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    status: 'RATE_LIMITED',
    message: 'Too many verification requests. Please wait 15 minutes before trying again.'
  }
});
