import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';
import { withId } from '../utils/formatters';

export interface AuthRequest extends Request {
  user?: any;
}

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

    req.user = withId(user);
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
};
