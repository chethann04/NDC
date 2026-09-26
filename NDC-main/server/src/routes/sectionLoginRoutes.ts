import { Router } from 'express';
import { SectionLoginController } from '../controllers/SectionLoginController';
import { authenticateToken } from '../middleware/auth';
import { authorizeRoles } from '../middleware/rbac';
import { UserRole } from '../constants/roles';

const router = Router();

// Strictly guard all Section Login Management endpoints to SUPER_ADMIN only
router.use(authenticateToken);
router.use(authorizeRoles(UserRole.SUPER_ADMIN));

router.get('/', SectionLoginController.getAllSectionLogins);
router.post('/department', SectionLoginController.createDepartment);
router.post('/hod', SectionLoginController.createHodAccount);
router.post('/faculty', SectionLoginController.createFacultyAccount);
router.put('/:id/email', SectionLoginController.updateLoginEmail);
router.patch('/:id/status', SectionLoginController.toggleAccountStatus);
router.put('/:id/department', SectionLoginController.updateDepartmentAssignment);
router.post('/:id/reset-password', SectionLoginController.resetAccountPassword);

export default router;
