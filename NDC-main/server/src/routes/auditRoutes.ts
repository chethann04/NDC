import { Router } from 'express';
import { AuditController } from '../controllers/AuditController';
import { authenticateToken } from '../middleware/auth';
import { authorizeRolesOrCashFee } from '../middleware/rbac';
import { UserRole } from '../constants/roles';

const router = Router();

router.use(authenticateToken);
router.get('/', authorizeRolesOrCashFee(UserRole.SUPER_ADMIN, UserRole.ADMIN), AuditController.getAuditLogs);

export default router;
