import api from './api';

export interface LoginResponse {
  message: string;
  token: string;
  user: {
    id: string;
    email: string;
    role: 'SUPER_ADMIN' | 'ADMIN' | 'HOD' | 'DEPARTMENT_OFFICER' | 'STUDENT';
    name: string;
    associatedStudentId?: string;
    associatedOfficerId?: string;
    departmentId?: string;
  };
}

export const authService = {
  async login(email: string, passwordHash: string): Promise<LoginResponse> {
    const response = await api.post<LoginResponse>('/auth/login', { email, password: passwordHash });
    return response.data;
  },

  async getCurrentUser() {
    const response = await api.get('/auth/me');
    return response.data;
  }
};
