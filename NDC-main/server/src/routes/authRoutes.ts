import { Router, Request, Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { AuthController } from '../controllers/AuthController';
import { CredentialController } from '../controllers/CredentialController';
import { authenticateToken } from '../middleware/auth';
import { generateTokens } from '../middleware/authMiddleware';

const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'fallback-refresh-secret-change-in-prod';

const router = Router();

router.post('/login', AuthController.login);
router.get('/student-check/:usn', AuthController.studentCheck);
router.post('/student-register', AuthController.studentRegister);
router.post('/student-login', AuthController.studentLogin);
router.get('/me', authenticateToken, AuthController.getMe);
router.post('/reset-password', authenticateToken, AuthController.resetPassword);

// Self-service Credential Management (OTP verification & password change)
router.post('/credentials/request-email-otp', authenticateToken, CredentialController.requestEmailChangeOtp);
router.post('/credentials/verify-otp', authenticateToken, CredentialController.verifyEmailChangeOtp);
router.post('/credentials/update', authenticateToken, CredentialController.updateCredentials);

// Refresh token endpoint
router.post('/refresh', async (req: Request, res: Response) => {
  const refreshToken = (req as any).cookies?.refreshToken || req.body?.refreshToken;
  if (!refreshToken) {
    return res.status(401).json({ success: false, error: 'Refresh token required' });
  }

  try {
    const decoded = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET, { algorithms: ['HS256'] }) as JwtPayload & { userId: string };
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(decoded.userId);

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({ success: true, accessToken, token: accessToken });
  } catch (err) {
    res.clearCookie('refreshToken');
    return res.status(401).json({ success: false, error: 'Invalid or expired refresh token' });
  }
});

// Logout endpoint
router.post('/logout', (req: Request, res: Response) => {
  res.clearCookie('refreshToken');
  res.json({ success: true, message: 'Logged out' });
});

export default router;

