import api from './api';

export const reportService = {
  async getDashboardAnalytics() {
    const response = await api.get('/reports/analytics');
    return response.data;
  },

  async getDepartmentStats() {
    const response = await api.get('/reports/departments');
    return response.data;
  },

  async exportReportExcel(type: string, params?: any) {
    const response = await api.get(`/reports/export/${type}`, {
      params,
      responseType: 'blob'
    });
    return response.data;
  }
};
