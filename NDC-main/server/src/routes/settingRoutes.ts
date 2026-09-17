import { Router } from 'express';
import { SettingController } from '../controllers/SettingController';
import { authenticateToken } from '../middleware/auth';
import { authorizeRoles } from '../middleware/rbac';
import { UserRole } from '../constants/roles';

const router = Router();

router.get('/', SettingController.getSettings);
router.put('/', authenticateToken, authorizeRoles(UserRole.SUPER_ADMIN), SettingController.updateSettings);

export default router;
