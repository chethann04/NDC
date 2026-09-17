import { Router } from 'express';
import { ReportController } from '../controllers/ReportController';
import { authenticateToken } from '../middleware/auth';
import { authorizeRoles } from '../middleware/rbac';
import { UserRole } from '../constants/roles';

const router = Router();

router.use(authenticateToken);

router.get('/dashboard', authorizeRoles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HOD, UserRole.DEPARTMENT_OFFICER), ReportController.getDashboardStats);
router.get('/export', authorizeRoles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HOD), ReportController.exportReport);

export default router;
