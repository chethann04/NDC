import { Response, Request } from 'express';
import fs from 'fs';
import { AuthRequest } from '../middleware/auth';
import { BackgroundJobService } from '../services/BackgroundJobService';
import { ImportService } from '../services/ImportService';
import { extractOriginFromReq } from '../utils/urlHelper';
import { UserRole } from '../constants/roles';

export class JobController {
  /**
   * Create a background import job.
   * Can accept either an uploaded file or an array of validated preview rows.
   */
  public static async createImportJob(req: AuthRequest, res: Response): Promise<void> {
    try {
      let rowsToImport = req.body?.rows;
      const duplicateAction = req.body?.duplicateAction || 'SKIP';
      const autoInitiateClearances = req.body?.autoInitiateClearances !== false;

      // If file was uploaded directly via multipart form
      if (req.file) {
        const fileBuffer = req.file.buffer || (req.file.path ? fs.readFileSync(req.file.path) : null);
        if (!fileBuffer) {
          res.status(400).json({ success: false, message: 'Unable to read uploaded file contents.' });
          return;
        }
        const preview = await ImportService.parseAndValidate(fileBuffer);
        rowsToImport = preview.rows;
      }

      if (!rowsToImport || !Array.isArray(rowsToImport) || rowsToImport.length === 0) {
        res.status(400).json({ success: false, message: 'No student rows provided to import.' });
        return;
      }

      const clientUrl = extractOriginFromReq(req);
      const job = await BackgroundJobService.createImportJob({
        initiatedByUserId: req.user?.id || req.user?._id,
        rows: rowsToImport,
        duplicateAction,
        autoInitiateClearances,
        reqClientUrl: clientUrl
      });

      res.status(202).json({
        success: true,
        message: `Bulk import job [${job.id}] queued successfully for ${job.totalRecords} records.`,
        data: job
      });
    } catch (err: any) {
      console.error('[JobController]: Error creating import job:', err);
      res.status(500).json({ success: false, message: err.message || 'Internal error creating import job' });
    }
  }

  /**
   * Get status and progress metrics of a specific background job.
   */
  public static async getJobStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const job = await BackgroundJobService.getJobById(id);

      if (!job) {
        res.status(404).json({ success: false, message: 'Job not found.' });
        return;
      }

      // Authorization check: Super Admin / Admin / Department Officer can view, or the user who initiated
      const callerRole = req.user?.role;
      const callerId = req.user?.id || req.user?._id;
      const isAdminOrOfficer = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DEPARTMENT_OFFICER, UserRole.HOD].includes(callerRole);

      if (!isAdminOrOfficer && job.id !== callerId) {
        res.status(403).json({ success: false, message: 'Unauthorized to view this job status.' });
        return;
      }

      res.status(200).json({
        success: true,
        data: job
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Get all active (queued or running) jobs.
   */
  public static async getActiveJobs(req: AuthRequest, res: Response): Promise<void> {
    try {
      const callerRole = req.user?.role;
      const callerId = req.user?.id || req.user?._id;
      const isAdmin = [UserRole.SUPER_ADMIN, UserRole.ADMIN].includes(callerRole);

      // Admins see all active jobs; others see only their own
      const jobs = await BackgroundJobService.getActiveJobs(isAdmin ? undefined : callerId);

      res.status(200).json({
        success: true,
        data: jobs
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Get the most recent job for the active user (to restore UI on refresh or navigation).
   */
  public static async getLatestJob(req: AuthRequest, res: Response): Promise<void> {
    try {
      const callerRole = req.user?.role;
      const callerId = req.user?.id || req.user?._id;
      const isAdmin = [UserRole.SUPER_ADMIN, UserRole.ADMIN].includes(callerRole);

      const job = await BackgroundJobService.getLatestJob(isAdmin ? undefined : callerId);

      res.status(200).json({
        success: true,
        data: job
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  /**
   * Cancel a running or queued job.
   */
  public static async cancelJob(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const cancelled = await BackgroundJobService.cancelJob(id, `Cancelled by user ${req.user?.name || req.user?.email}`);

      if (!cancelled) {
        res.status(400).json({ success: false, message: 'Job could not be cancelled (it may have already completed or failed).' });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Job cancelled successfully.'
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}
