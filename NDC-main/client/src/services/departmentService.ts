import api from './api';
import { clientCache } from '../utils/clientCache';

export interface DepartmentData {
  _id?: string;
  name: string;
  code: string;
  description?: string;
  requiresClearance?: boolean;
  displayOrder?: number;
  isActive?: boolean;
}

export const departmentService = {
  async getDepartments(forceFresh = false) {
    if (!forceFresh) {
      const cached = clientCache.get<any>('departments_list');
      if (cached) return cached;
    }
    const response = await api.get('/departments');
    clientCache.set('departments_list', response.data);
    return response.data;
  },

  async createDepartment(data: DepartmentData) {
    const response = await api.post('/departments', data);
    clientCache.invalidate('departments');
    return response.data;
  },

  async updateDepartment(id: string, data: Partial<DepartmentData>) {
    const response = await api.put(`/departments/${id}`, data);
    clientCache.invalidate('departments');
    return response.data;
  },

  async toggleDepartmentStatus(id: string) {
    const response = await api.patch(`/departments/${id}/toggle`);
    clientCache.invalidate('departments');
    return response.data;
  }
};
