import { Router } from 'express';
import { OfficerController } from '../controllers/OfficerController';
import { authenticateToken } from '../middleware/auth';
import { authorizeRoles } from '../middleware/rbac';
import { UserRole } from '../constants/roles';

const router = Router();

router.use(authenticateToken);

router.get('/', OfficerController.getAllOfficers);
router.get('/:id', OfficerController.getOfficerById);
router.post('/', authorizeRoles(UserRole.SUPER_ADMIN, UserRole.ADMIN), OfficerController.createOfficer);
router.put('/:id', authorizeRoles(UserRole.SUPER_ADMIN, UserRole.ADMIN), OfficerController.updateOfficer);
router.delete('/:id', authorizeRoles(UserRole.SUPER_ADMIN, UserRole.ADMIN), OfficerController.deleteOfficer);

export default router;
