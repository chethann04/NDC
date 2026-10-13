import api from './api';

export const downloadCertificatePdf = async (
  certIdOrObj: any,
  certificateNumber?: string
): Promise<void> => {
  let certId = '';
  if (typeof certIdOrObj === 'object' && certIdOrObj !== null) {
    certId = certIdOrObj._id || certIdOrObj.id || certIdOrObj.certificateNumber || '';
    if (!certificateNumber) {
      certificateNumber = certIdOrObj.certificateNumber;
    }
  } else if (typeof certIdOrObj === 'string') {
    certId = certIdOrObj.trim();
  }

  if (!certId || certId === '[object Object]' || certId === 'undefined') {
    throw new Error('Valid certificate identifier is required for download.');
  }

  try {
    const response = await api.get(`/certificates/${encodeURIComponent(certId)}/download`, {
      responseType: 'blob'
    });

    const blob = new Blob([response.data], { type: 'application/pdf' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeName = (certificateNumber || certId).replace(/[\/\\:]/g, '_');
    link.setAttribute('download', `NDC_${safeName}.pdf`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => window.URL.revokeObjectURL(url), 10000);
  } catch (err: any) {
    // If response is a blob containing JSON error details, parse and extract readable error
    if (err.response?.data instanceof Blob) {
      try {
        const text = await err.response.data.text();
        const json = JSON.parse(text);
        if (json.message) {
          throw new Error(json.message);
        }
      } catch (parseErr: any) {
        if (parseErr.message && !parseErr.message.includes('JSON')) {
          throw parseErr;
        }
      }
    }
    throw err;
  }
};

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

  downloadCertificatePdf,

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

export default certificateService;
