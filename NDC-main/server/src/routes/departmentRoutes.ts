import { Router } from 'express';
import { DepartmentController } from '../controllers/DepartmentController';
import { authenticateToken } from '../middleware/auth';
import { authorizeRoles } from '../middleware/rbac';
import { UserRole } from '../constants/roles';

const router = Router();

router.use(authenticateToken);

router.get('/', DepartmentController.getAllDepartments);
router.get('/:id', DepartmentController.getDepartmentById);
router.post('/', authorizeRoles(UserRole.SUPER_ADMIN, UserRole.ADMIN), DepartmentController.createDepartment);
router.put('/:id', authorizeRoles(UserRole.SUPER_ADMIN, UserRole.ADMIN), DepartmentController.updateDepartment);
router.patch('/:id/toggle', authorizeRoles(UserRole.SUPER_ADMIN, UserRole.ADMIN), DepartmentController.toggleDepartmentStatus);

export default router;
