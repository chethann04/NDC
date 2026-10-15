/**
 * Centralized Client URL Resolver for Outbound Emails & Redirects.
 * 
 * Resolves frontend URL in order of priority:
 * 1. Explicitly provided client URL (e.g. from active request's Origin or Referer header).
 * 2. process.env.CLIENT_URL or FRONTEND_URL or APP_URL (with trailing slash stripped).
 * 3. Dynamically captured client origin from recent incoming HTTP requests.
 * 4. Hosting environment indicators (e.g. VERCEL_URL).
 * 5. Production fallback (https://ndc-mce.vercel.app) if running in production.
 * 6. Development fallback (http://localhost:5173).
 */

let lastKnownClientOrigin: string | null = null;

export const setLastKnownClientOrigin = (origin?: string | null): void => {
  if (!origin) return;
  try {
    const clean = origin.trim().replace(/\/+$/, '');
    // Ignore localhost and loopback when tracking deployed origin
    if (
      clean.startsWith('http://') ||
      clean.startsWith('https://')
    ) {
      if (!clean.includes('localhost') && !clean.includes('127.0.0.1')) {
        lastKnownClientOrigin = clean;
      }
    }
  } catch {
    // ignore invalid URL strings
  }
};

export const getLastKnownClientOrigin = (): string | null => {
  return lastKnownClientOrigin;
};

export const getClientBaseUrl = (preferredUrl?: string | null): string => {
  // 1. Explicit preferred URL (e.g. from current request header)
  if (preferredUrl) {
    const cleanPreferred = preferredUrl.trim().replace(/\/+$/, '');
    if (cleanPreferred.startsWith('http://') || cleanPreferred.startsWith('https://')) {
      // In production, only prefer localhost if there is no other deployed origin available
      const isProduction = process.env.NODE_ENV === 'production';
      const isLocalhost = cleanPreferred.includes('localhost') || cleanPreferred.includes('127.0.0.1');
      if (!isProduction || !isLocalhost) {
        return cleanPreferred;
      }
    }
  }

  // 2. Configured environment variables (CLIENT_URL, FRONTEND_URL, APP_URL)
  const envUrl = (
    process.env.CLIENT_URL ||
    process.env.FRONTEND_URL ||
    process.env.APP_URL
  )?.trim().replace(/\/+$/, '');

  const isProduction = process.env.NODE_ENV === 'production';

  if (envUrl) {
    const isLocalhost = envUrl.includes('localhost') || envUrl.includes('127.0.0.1');
    // If in production and envUrl points to localhost, see if we have a better remote origin
    if (isProduction && isLocalhost) {
      if (lastKnownClientOrigin) {
        return lastKnownClientOrigin;
      }
      if (process.env.VERCEL_URL) {
        return `https://${process.env.VERCEL_URL.replace(/\/+$/, '')}`;
      }
      // Production default deployed domain
      return 'https://ndc-mce.vercel.app';
    }
    return envUrl;
  }

  // 3. Dynamically captured origin from incoming requests
  if (lastKnownClientOrigin) {
    return lastKnownClientOrigin;
  }

  // 4. Hosting platform indicators
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/+$/, '')}`;
  }

  // 5. Production fallback
  if (isProduction) {
    return 'https://ndc-mce.vercel.app';
  }

  // 6. Local development default
  return 'http://localhost:5173';
};

export const extractOriginFromReq = (req?: any): string | undefined => {
  if (!req) return undefined;
  try {
    const origin = req.headers?.origin || req.get?.('origin');
    if (origin && typeof origin === 'string') {
      return origin.trim().replace(/\/+$/, '');
    }
    const referer = req.headers?.referer || req.get?.('referer');
    if (referer && typeof referer === 'string') {
      return new URL(referer).origin.replace(/\/+$/, '');
    }
  } catch {
    // ignore
  }
  return undefined;
};
