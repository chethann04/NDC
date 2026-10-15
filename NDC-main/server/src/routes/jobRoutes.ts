import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { JobController } from '../controllers/JobController';
import { authenticateToken } from '../middleware/auth';
import { authorizeRolesOrCashFee } from '../middleware/rbac';
import { UserRole } from '../constants/roles';

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const importDir = path.join(process.cwd(), 'uploads', 'imports');
    if (!fs.existsSync(importDir)) {
      fs.mkdirSync(importDir, { recursive: true });
    }
    cb(null, importDir);
  },
  filename: (req, file, cb) => {
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${Date.now()}-${sanitizedName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowed = [
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ];
    const isExtAllowed = file.originalname.endsWith('.csv') || file.originalname.endsWith('.xlsx') || file.originalname.endsWith('.xls');
    if (allowed.includes(file.mimetype) || isExtAllowed) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only CSV/XLSX allowed.'));
    }
  }
});

const router = Router();

router.use(authenticateToken);

// Create background import job
router.post(
  '/import',
  authorizeRolesOrCashFee(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.DEPARTMENT_OFFICER),
  upload.single('file'),
  JobController.createImportJob
);

// Get all active jobs (queued or running)
router.get('/active', JobController.getActiveJobs);

// Get latest job for active user
router.get('/latest', JobController.getLatestJob);

// Get specific job status by ID
router.get('/:id', JobController.getJobStatus);

// Cancel a job
router.post(
  '/:id/cancel',
  authorizeRolesOrCashFee(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  JobController.cancelJob
);

export default router;
