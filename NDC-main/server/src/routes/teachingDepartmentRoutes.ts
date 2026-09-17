import { Router } from 'express';
import { TeachingDepartmentController } from '../controllers/TeachingDepartmentController';
import { authenticateToken } from '../middleware/auth';
import { authorizeRoles } from '../middleware/rbac';
import { UserRole } from '../constants/roles';

const router = Router();

// Protect all routes: Require JWT authentication & Faculty/Admin authorization
router.use(authenticateToken);
router.use(authorizeRoles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HOD, UserRole.DEPARTMENT_OFFICER));

router.get('/dashboard', TeachingDepartmentController.getDashboard);
router.get('/students', TeachingDepartmentController.getStudents);
router.get('/students/:studentId', TeachingDepartmentController.getStudentById);
router.get('/students/:studentId/dues', TeachingDepartmentController.getStudentDues);
router.get('/certificates/:certificateId/download', TeachingDepartmentController.downloadCertificate);

export default router;
