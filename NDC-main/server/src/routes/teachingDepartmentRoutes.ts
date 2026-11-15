import { Router } from 'express';
import { TeachingDepartmentController } from '../controllers/TeachingDepartmentController';
import { authenticateToken } from '../middleware/auth';
import { authorizeRoles } from '../middleware/rbac';
import { UserRole } from '../constants/roles';

const router = Router();

// Teaching department records are scoped to the authenticated academic department.
// Institution administrators use the institution-wide admin dashboard instead.
router.use(authenticateToken);
router.use(authorizeRoles(UserRole.HOD, UserRole.DEPARTMENT_OFFICER));

router.get('/dashboard', TeachingDepartmentController.getDashboard);
router.get('/students', TeachingDepartmentController.getStudents);
router.get('/students/:studentId', TeachingDepartmentController.getStudentById);
router.get('/students/:studentId/dues', TeachingDepartmentController.getStudentDues);
router.get('/certificates/:certificateId/download', TeachingDepartmentController.downloadCertificate);

export default router;
