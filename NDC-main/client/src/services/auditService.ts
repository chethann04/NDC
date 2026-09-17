import api from './api';

export const auditService = {
  async getAuditLogs(params?: { search?: string; action?: string; role?: string; page?: number; limit?: number }) {
    const response = await api.get('/audit-logs', { params });
    return response.data;
  }
};
