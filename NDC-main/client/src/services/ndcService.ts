import api from './api';

export interface NdcFilterParams {
  search?: string;
  status?: string;
  departmentId?: string;
  page?: number;
  limit?: number;
}

export const ndcService = {
  async applyForNdc() {
    const response = await api.post('/ndc/apply');
    return response.data;
  },

  async getMyNdcStatus() {
    const response = await api.get('/ndc/my-status');
    return response.data;
  },

  async getAllNdcRequests(params?: NdcFilterParams) {
    const response = await api.get('/ndc', { params });
    return response.data;
  },

  async getNdcById(id: string) {
    const response = await api.get(`/ndc/${id}`);
    return response.data;
  },

  async updateClearance(clearanceId: string, payload: {
    status: 'CLEARED' | 'DUE' | 'ON_HOLD' | 'NOT_APPLICABLE';
    remarks?: string;
    dueAmount?: number;
    dueDetails?: string;
  }) {
    const response = await api.put(`/ndc/clearances/${clearanceId}`, payload);
    return response.data;
  },

  async getOfficerClearanceQueue(params?: { status?: string; search?: string }) {
    const response = await api.get('/ndc/officer-queue', { params });
    return response.data;
  },

  async adminOverrideClearance(clearanceId: string, payload: {
    status: 'CLEARED' | 'DUE' | 'ON_HOLD' | 'NOT_APPLICABLE';
    remarks: string;
    dueAmount?: number;
  }) {
    const response = await api.put(`/ndc/admin-override/${clearanceId}`, payload);
    return response.data;
  }
};
