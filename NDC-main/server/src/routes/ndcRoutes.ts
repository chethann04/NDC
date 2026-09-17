import { Router } from 'express';
import { NdcController } from '../controllers/NdcController';
import { authenticateToken } from '../middleware/auth';
import { authorizeRoles } from '../middleware/rbac';
import { UserRole } from '../constants/roles';

const router = Router();

router.use(authenticateToken);

router.post('/apply', NdcController.applyForNdc);
router.get('/student-status', NdcController.getStudentNdcStatus);
router.get('/student-status/:studentId', NdcController.getStudentNdcStatus);

router.get('/requests', authorizeRoles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HOD), NdcController.getAllNdcRequests);
router.get('/requests/:requestId', NdcController.getNdcRequestById);
router.get('/officer/clearances', authorizeRoles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DEPARTMENT_OFFICER, UserRole.HOD), NdcController.getOfficerClearances);
router.get('/officer/stats', authorizeRoles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DEPARTMENT_OFFICER, UserRole.HOD), NdcController.getOfficerQueueStats);
router.get('/officer/cleared-report/pdf', authorizeRoles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DEPARTMENT_OFFICER, UserRole.HOD), NdcController.exportClearedReportPdf);

router.put('/clearance/:clearanceId', authorizeRoles(UserRole.SUPER_ADMIN, UserRole.DEPARTMENT_OFFICER, UserRole.HOD), NdcController.processClearance);
router.put('/clearance/:clearanceId/override', authorizeRoles(UserRole.SUPER_ADMIN), NdcController.adminOverride);
router.put('/requests/:requestId/approve-all', authorizeRoles(UserRole.SUPER_ADMIN), NdcController.approveAllAndIssueCertificate);

export default router;
