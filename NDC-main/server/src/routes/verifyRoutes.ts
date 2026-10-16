import { Router } from 'express';
import { VerifyController } from '../controllers/VerifyController';
import { authenticateToken } from '../middleware/auth';
import { authorizeRoles } from '../middleware/rbac';
import { UserRole } from '../constants/roles';
import { verifyLimiter } from '../middleware/rateLimiter';

const router = Router();

router.use(authenticateToken);

// Restricted to Faculty (DEPARTMENT_OFFICER), HOD, ADMIN, and SUPER_ADMIN
router.post(
  '/',
  verifyLimiter,
  authorizeRoles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HOD, UserRole.DEPARTMENT_OFFICER),
  VerifyController.verifyCertificate
);

export default router;
