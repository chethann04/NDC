import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';
import { withId } from '../utils/formatters';

export interface AuthRequest extends Request {
  user?: any;
}

/**
 * In-memory user cache to avoid hitting the database on every API request.
 * TTL: 60 seconds. Keyed by userId.
 */
interface CachedUser {
  data: any;
  expiresAt: number;
}

const USER_CACHE = new Map<string, CachedUser>();
const USER_CACHE_TTL_MS = 60_000; // 60 seconds
const USER_CACHE_MAX_SIZE = 500;

const getCachedUser = (userId: string): any | null => {
  const entry = USER_CACHE.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    USER_CACHE.delete(userId);
    return null;
  }
  return entry.data;
};

const setCachedUser = (userId: string, data: any): void => {
  // Evict oldest entries if cache grows too large
  if (USER_CACHE.size >= USER_CACHE_MAX_SIZE) {
    const firstKey = USER_CACHE.keys().next().value;
    if (firstKey) USER_CACHE.delete(firstKey);
  }
  USER_CACHE.set(userId, { data, expiresAt: Date.now() + USER_CACHE_TTL_MS });
};

/** Invalidate a specific user from the auth cache, or clear the entire cache. */
export const invalidateUserCache = (userId?: string): void => {
  if (userId) {
    USER_CACHE.delete(userId);
  } else {
    USER_CACHE.clear();
  }
};

export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    let token = '';
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query && req.query.token) {
      token = String(req.query.token);
    }

    if (!token) {
      return res.status(401).json({ success: false, message: 'Access token missing or invalid format.' });
    }
    const secret = process.env.JWT_SECRET || 'super_secret_ndc_jwt_key_2026_mce_auth_token_string';
    const decoded = jwt.verify(token, secret) as { userId: string; role: string };

    // Fast path: return cached user if available and fresh
    const cached = getCachedUser(decoded.userId);
    if (cached) {
      req.user = cached;
      return next();
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        associatedStudentId: true,
        associatedOfficerId: true,
        departmentId: true,
        mustChangePassword: true
      }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'User account is inactive or no longer exists.' });
    }

    const formatted = withId(user);
    setCachedUser(decoded.userId, formatted);

    req.user = formatted;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
};
