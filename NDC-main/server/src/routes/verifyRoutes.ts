import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { VerifyController } from '../controllers/VerifyController';
import { authenticateToken } from '../middleware/auth';
import { authorizeRoles } from '../middleware/rbac';
import { UserRole } from '../constants/roles';

const router = Router();

// Rate Limiting
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { success: false, status: 'RATE_LIMITED', message: 'Too many verification requests. Please try again later.' }
});

router.use(authenticateToken);

// Restricted to Faculty (DEPARTMENT_OFFICER), HOD, ADMIN, and SUPER_ADMIN
router.post(
  '/',
  verifyLimiter,
  authorizeRoles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HOD, UserRole.DEPARTMENT_OFFICER),
  VerifyController.verifyCertificate
);

export default router;
