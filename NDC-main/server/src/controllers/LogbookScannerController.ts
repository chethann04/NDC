import fs from 'fs';
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { LogbookScannerService } from '../services/LogbookScannerService';
import { ImagePreprocessingService } from '../services/ImagePreprocessingService';
import { UserRole } from '../constants/roles';

export class LogbookScannerController {
  /**
   * Upload logbook image or PDF for OCR extraction
   */
  public static async uploadLogbook(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const allowedRoles = [
        UserRole.SUPER_ADMIN,
        UserRole.ADMIN,
        UserRole.HOD,
        UserRole.DEPARTMENT_OFFICER
      ];

      if (!allowedRoles.includes(user.role as any)) {
        res.status(403).json({
          success: false,
          message: 'Forbidden: Logbook scanner access is restricted to department officers.'
        });
        return;
      }

      if (!req.file) {
        res.status(400).json({
          success: false,
          message: 'Bad Request: File is required (image or PDF).'
        });
        return;
      }

      const departmentId = req.body.departmentId || user.departmentId;
      const labId = req.body.labId;

      const job = await LogbookScannerService.processUpload({
        lecturerUserId: user.id || user._id,
        departmentId,
        labId,
        originalFilename: req.file.originalname,
        mimeType: req.file.mimetype,
        fileBuffer: req.file.buffer,
        reqObj: req
      });

      res.status(201).json({
        success: true,
        data: job
      });
    } catch (err: any) {
      console.error('[LogbookScannerController] upload error:', err);
      res.status(500).json({
        success: false,
        message: err.message || 'Logbook extraction processing failed.'
      });
    }
  }

  /**
   * Get single scan job by ID
   */
  public static async getJob(req: AuthRequest, res: Response): Promise<void> {
    try {
      const job = await LogbookScannerService.getScanJob(req.params.id);
      res.status(200).json({
        success: true,
        data: job
      });
    } catch (err: any) {
      res.status(404).json({
        success: false,
        message: err.message || 'Scan job not found'
      });
    }
  }

  /**
   * List recent scan jobs
   */
  public static async listJobs(req: AuthRequest, res: Response): Promise<void> {
    try {
      const departmentId = (req.query.departmentId as string) || req.user?.departmentId;
      const jobs = await LogbookScannerService.listScanJobs(departmentId);
      res.status(200).json({
        success: true,
        data: jobs
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        message: err.message || 'Failed to list scan jobs'
      });
    }
  }

  /**
   * Edit or correct a single extracted entry
   */
  public static async updateEntry(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = req.user;
      const { correctedUsn, correctedAmount, correctedReason } = req.body;

      const updated = await LogbookScannerService.updateEntry({
        entryId: req.params.entryId,
        correctedUsn,
        correctedAmount,
        correctedReason,
        lecturerUserId: user.id || user._id
      });

      res.status(200).json({
        success: true,
        data: updated
      });
    } catch (err: any) {
      res.status(400).json({
        success: false,
        message: err.message || 'Failed to update scan entry'
      });
    }
  }

  /**
   * Batch apply approved entries to live student clearance records
   */
  public static async applyEntries(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = req.user;
      const { entryIds } = req.body;

      if (!Array.isArray(entryIds) || entryIds.length === 0) {
        res.status(400).json({
          success: false,
          message: 'Bad Request: "entryIds" array is required.'
        });
        return;
      }

      const result = await LogbookScannerService.applyApprovedEntries(
        req.params.id,
        entryIds,
        user.id || user._id,
        req
      );

      res.status(200).json({
        success: true,
        data: result
      });
    } catch (err: any) {
      console.error('[LogbookScannerController] applyEntries error:', err);
      res.status(400).json({
        success: false,
        message: err.message || 'Failed to apply scan entries.'
      });
    }
  }

  /**
   * Serve stored original or preprocessed logbook image for human verification
   */
  public static async getJobImage(req: AuthRequest, res: Response): Promise<void> {
    try {
      const jobId = req.params.id;
      const processed = req.query.processed === 'true';
      const imagePath = ImagePreprocessingService.getJobImagePath(jobId, processed);

      if (!imagePath || !fs.existsSync(imagePath)) {
        res.status(404).json({ success: false, message: 'Scan job image not found.' });
        return;
      }

      res.sendFile(imagePath);
    } catch (err: any) {
      console.error('[LogbookScannerController] getJobImage error:', err);
      res.status(500).json({ success: false, message: 'Failed to retrieve scan image.' });
    }
  }
}
