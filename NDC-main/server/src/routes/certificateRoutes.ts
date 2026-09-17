import { Router } from 'express';
import { CertificateController } from '../controllers/CertificateController';
import { authenticateToken } from '../middleware/auth';
import { authorizeRoles } from '../middleware/rbac';
import { UserRole } from '../constants/roles';

const router = Router();

router.use(authenticateToken);

router.get('/', authorizeRoles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HOD, UserRole.DEPARTMENT_OFFICER), CertificateController.getAllCertificates);
router.get('/export', authorizeRoles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HOD, UserRole.DEPARTMENT_OFFICER), CertificateController.exportCertificates);
router.get('/submission-report/pdf', authorizeRoles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DEPARTMENT_OFFICER), CertificateController.exportSubmissionReportPdf);
router.get('/student', CertificateController.getStudentCertificates);
router.get('/student/:studentId', authorizeRoles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HOD), CertificateController.getStudentCertificates);
router.put('/:id/submission', authorizeRoles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DEPARTMENT_OFFICER), CertificateController.updateSubmissionStatus);
router.get('/:id/download', CertificateController.downloadPdf);
router.post('/:id/revoke', authorizeRoles(UserRole.SUPER_ADMIN, UserRole.ADMIN), CertificateController.revokeCertificate);
router.post('/reissue', authorizeRoles(UserRole.SUPER_ADMIN, UserRole.ADMIN), CertificateController.reissueCertificate);
router.post('/:id/regenerate', authorizeRoles(UserRole.SUPER_ADMIN, UserRole.ADMIN), CertificateController.regenerateCertificate);
router.post('/student/:studentId/regenerate', authorizeRoles(UserRole.SUPER_ADMIN, UserRole.ADMIN), CertificateController.regenerateByStudentId);

export default router;
