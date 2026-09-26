import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { StudentController } from '../controllers/StudentController';
import { authenticateToken } from '../middleware/auth';
import { authorizeRoles, authorizeRolesOrCashFee } from '../middleware/rbac';
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
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
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

router.get('/template', StudentController.downloadTemplate);

router.use(authenticateToken);

// Bulk Import Routes with Hardened File Upload Security
router.post('/bulk-import', authorizeRolesOrCashFee(UserRole.ADMIN, UserRole.SUPER_ADMIN), upload.single('file'), StudentController.previewImport);
router.post('/import/preview', authorizeRolesOrCashFee(UserRole.ADMIN, UserRole.SUPER_ADMIN), upload.single('file'), StudentController.previewImport);
router.post('/import/confirm', authorizeRolesOrCashFee(UserRole.ADMIN, UserRole.SUPER_ADMIN), StudentController.confirmImport);
router.post('/sync-clearances', authorizeRolesOrCashFee(UserRole.ADMIN, UserRole.SUPER_ADMIN), StudentController.syncAllClearances);

router.get('/', StudentController.getAllStudents);
router.get('/:id', StudentController.getStudentById);
router.post('/', authorizeRolesOrCashFee(UserRole.SUPER_ADMIN, UserRole.ADMIN), StudentController.createStudent);
router.put('/:id', authorizeRolesOrCashFee(UserRole.SUPER_ADMIN, UserRole.ADMIN), StudentController.updateStudent);
router.put('/:id/deactivate', authorizeRolesOrCashFee(UserRole.SUPER_ADMIN, UserRole.ADMIN), StudentController.deactivateStudent);
router.put('/:id/reactivate', authorizeRolesOrCashFee(UserRole.SUPER_ADMIN, UserRole.ADMIN), StudentController.reactivateStudent);
router.delete('/:id', authorizeRolesOrCashFee(UserRole.SUPER_ADMIN, UserRole.ADMIN), StudentController.deleteStudent);
router.post('/bulk-delete', authorizeRolesOrCashFee(UserRole.SUPER_ADMIN, UserRole.ADMIN), StudentController.bulkDeleteStudents);
router.post('/bulk-batch', authorizeRolesOrCashFee(UserRole.SUPER_ADMIN, UserRole.ADMIN), StudentController.bulkUpdateBatch);

export default router;



