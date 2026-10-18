import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { authorizeRoles } from '../middleware/rbac';
import { UserRole } from '../constants/roles';
import { uploadDocument } from '../middleware/upload';
import { AiAssistantController } from '../controllers/AiAssistantController';
import { LogbookScannerController } from '../controllers/LogbookScannerController';

const router = Router();

// Protect all AI endpoints with authentication
router.use(authenticateToken);
router.use(authorizeRoles(
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.HOD,
  UserRole.DEPARTMENT_OFFICER
));

// ─────────────────────────────────────────────────────────────
// PHYSICS / DEPARTMENT AI ASSISTANT ROUTES
// ─────────────────────────────────────────────────────────────
router.post('/assistant/chat', AiAssistantController.chat);
router.post('/assistant/confirm', AiAssistantController.confirmAction);
router.post('/assistant/cancel', AiAssistantController.cancelAction);

// ─────────────────────────────────────────────────────────────
// AI LOGBOOK SCANNER ROUTES
// ─────────────────────────────────────────────────────────────
router.post('/scanner/upload', uploadDocument.single('file'), LogbookScannerController.uploadLogbook);
router.get('/scanner/jobs', LogbookScannerController.listJobs);
router.get('/scanner/jobs/:id', LogbookScannerController.getJob);
router.get('/scanner/jobs/:id/image', LogbookScannerController.getJobImage);
router.patch('/scanner/entries/:entryId', LogbookScannerController.updateEntry);
router.post('/scanner/jobs/:id/apply', LogbookScannerController.applyEntries);

export default router;
