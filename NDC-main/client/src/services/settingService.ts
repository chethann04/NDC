import api from './api';

export interface SystemSettings {
  collegeName: string;
  collegeAddress: string;
  collegeLogoUrl?: string;
  certificateTitle: string;
  certificateStatement: string;
  certificatePrefix: string;
  signatoryName: string;
  signatoryDesignation: string;
  footerText: string;
  eligibleBatches: string[];
  eligibleYears: string[];
}

export const settingService = {
  async getSettings() {
    const response = await api.get('/settings');
    return response.data;
  },

  async updateSettings(data: Partial<SystemSettings>) {
    const response = await api.put('/settings', data);
    return response.data;
  }
};
