import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { AuditService } from '../services/AuditService';
import { AuthRequest } from '../middleware/auth';
import { withId } from '../utils/formatters';

export class SettingController {
  public static async getSettings(req: Request, res: Response): Promise<void> {
    try {
      let settings = await prisma.setting.findFirst();
      if (!settings) {
        settings = await prisma.setting.create({
          data: {}
        });
      }
      res.status(200).json({ success: true, data: withId(settings) });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  public static async updateSettings(req: AuthRequest, res: Response): Promise<void> {
    try {
      let settings = await prisma.setting.findFirst();
      if (!settings) {
        settings = await prisma.setting.create({ data: {} });
      }

      const fields = [
        'collegeName',
        'collegeAddress',
        'collegeLogoUrl',
        'certificateTitle',
        'certificateStatement',
        'certificatePrefix',
        'signatoryName',
        'signatoryDesignation',
        'footerText',
        'eligibleBatches',
        'eligibleYears'
      ];

      const updateData: any = {};
      fields.forEach((field) => {
        if (req.body[field] !== undefined) {
          updateData[field] = req.body[field];
        }
      });

      const updated = await prisma.setting.update({
        where: { id: settings.id },
        data: updateData
      });

      await AuditService.log(req, 'SETTINGS_UPDATED', 'Setting', 'Updated system settings and certificate template config.', settings.id, settings, updated);

      res.status(200).json({ success: true, message: 'Settings updated successfully.', data: withId(updated) });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}
