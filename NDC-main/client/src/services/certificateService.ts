import api from './api';

export const certificateService = {
  async getCertificates(params?: { search?: string; status?: string; page?: number; limit?: number }) {
    const response = await api.get('/certificates', { params });
    return response.data;
  },

  async getMyCertificates() {
    const response = await api.get('/certificates/my-certificates');
    return response.data;
  },

  async getCertificateById(id: string) {
    const response = await api.get(`/certificates/${id}`);
    return response.data;
  },

  async downloadCertificatePdf(certificateId: string) {
    const response = await api.get(`/certificates/${certificateId}/pdf`, {
      responseType: 'blob'
    });
    return response.data;
  },

  async revokeCertificate(certificateId: string, reason: string) {
    const response = await api.post(`/certificates/${certificateId}/revoke`, { reason });
    return response.data;
  },

  async replaceCertificate(certificateId: string, reason: string) {
    const response = await api.post(`/certificates/${certificateId}/replace`, { reason });
    return response.data;
  },

  async verifyCertificate(certificateNumber: string) {
    const response = await api.get(`/verify/${encodeURIComponent(certificateNumber)}`);
    return response.data;
  }
};
