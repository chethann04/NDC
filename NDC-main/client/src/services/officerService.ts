import api from './api';

export interface OfficerData {
  _id?: string;
  employeeId: string;
  name: string;
  email: string;
  password?: string;
  departmentIds: string[];
  role?: 'DEPARTMENT_OFFICER' | 'HOD';
  isActive?: boolean;
}

export const officerService = {
  async getOfficers() {
    const response = await api.get('/officers');
    return response.data;
  },

  async createOfficer(data: OfficerData) {
    const response = await api.post('/officers', data);
    return response.data;
  },

  async updateOfficer(id: string, data: Partial<OfficerData>) {
    const response = await api.put(`/officers/${id}`, data);
    return response.data;
  },

  async toggleOfficerStatus(id: string) {
    const response = await api.patch(`/officers/${id}/toggle`);
    return response.data;
  }
};
