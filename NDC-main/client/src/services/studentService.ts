import api from './api';

export interface StudentFilterParams {
  search?: string;
  departmentId?: string;
  batch?: string;
  academicYear?: string;
  year?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

export const studentService = {
  async getStudents(params?: StudentFilterParams) {
    const response = await api.get('/students', { params });
    return response.data;
  },

  async getStudentById(id: string) {
    const response = await api.get(`/students/${id}`);
    return response.data;
  },

  async createStudent(studentData: any) {
    const response = await api.post('/students', studentData);
    return response.data;
  },

  async updateStudent(id: string, studentData: any) {
    const response = await api.put(`/students/${id}`, studentData);
    return response.data;
  },

  async deleteStudent(id: string) {
    const response = await api.delete(`/students/${id}`);
    return response.data;
  },

  async bulkImport(formData: FormData) {
    const response = await api.post('/students/import', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    return response.data;
  }
};
