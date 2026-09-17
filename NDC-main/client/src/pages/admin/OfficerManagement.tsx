import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { UserCheck, UserPlus, Edit, Trash2, ShieldCheck, Mail } from 'lucide-react';

export const OfficerManagement: React.FC = () => {
  const [officers, setOfficers] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingOfficer, setEditingOfficer] = useState<any>(null);
  const [formData, setFormData] = useState({
    employeeId: '',
    name: '',
    email: '',
    role: 'DEPARTMENT_OFFICER',
    departmentIds: [] as string[]
  });
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');

  useEffect(() => {
    fetchDepartments();
    fetchOfficers();
  }, []);

  const fetchDepartments = async () => {
    try {
      const res = await api.get('/departments');
      setDepartments(res.data.data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchOfficers = async () => {
    try {
      const res = await api.get('/officers');
      setOfficers(res.data.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (officer: any = null) => {
    if (officer) {
      setEditingOfficer(officer);
      setFormData({
        employeeId: officer.employeeId,
        name: officer.name,
        email: officer.email,
        role: officer.userId?.role || 'DEPARTMENT_OFFICER',
        departmentIds: officer.departmentIds ? officer.departmentIds.map((d: any) => d._id || d) : []
      });
    } else {
      setEditingOfficer(null);
      setFormData({
        employeeId: '',
        name: '',
        email: '',
        role: 'DEPARTMENT_OFFICER',
        departmentIds: departments.length > 0 ? [departments[0]._id] : []
      });
    }
    setModalError('');
    setIsModalOpen(true);
  };

  const handleDepartmentToggle = (deptId: string) => {
    if (formData.departmentIds.includes(deptId)) {
      setFormData({
        ...formData,
        departmentIds: formData.departmentIds.filter((id) => id !== deptId)
      });
    } else {
      setFormData({
        ...formData,
        departmentIds: [...formData.departmentIds, deptId]
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');
    if (formData.departmentIds.length === 0) {
      setModalError('Please assign at least one clearance department to this officer.');
      return;
    }

    setSubmitting(true);
    try {
      if (editingOfficer) {
        await api.put(`/officers/${editingOfficer._id}`, formData);
      } else {
        await api.post('/officers', formData);
      }

      setIsModalOpen(false);
      await fetchOfficers();
    } catch (err: any) {
      setModalError(err.response?.data?.message || 'Operation failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to remove this officer and revoke login access?')) return;
    try {
      await api.delete(`/officers/${id}`);
      await fetchOfficers();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to delete officer.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900">Clearance Officers & HODs</h2>
          <p className="text-xs text-slate-500">Assign officers to single or multiple institutional clearance desks</p>
        </div>

        <button
          onClick={() => handleOpenModal()}
          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-2"
        >
          <UserPlus className="w-4 h-4" />
          Assign New Officer
        </button>
      </div>

      {loading ? (
        <div className="p-8 text-center text-slate-500 font-semibold">Loading officer directory...</div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                <tr>
                  <th className="p-4">Employee ID</th>
                  <th className="p-4">Officer Name</th>
                  <th className="p-4">Email</th>
                  <th className="p-4">Assigned Clearance Departments</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {officers.map((officer) => (
                  <tr key={officer._id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-mono font-bold text-blue-700">{officer.employeeId}</td>
                    <td className="p-4 font-bold text-slate-900">{officer.name}</td>
                    <td className="p-4 text-slate-600">{officer.email}</td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-1">
                        {officer.departmentIds?.map((dept: any) => (
                          <span key={dept._id || dept} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 font-bold rounded border border-indigo-200 text-[10px]">
                            {dept.code || dept.name || 'Dept'}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleOpenModal(officer)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Edit Officer"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(officer._id)}
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                          title="Delete Officer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">
                {editingOfficer ? 'Edit Officer Assignment' : 'Assign New Officer'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-700 text-xl font-bold">
                ×
              </button>
            </div>

            {modalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-lg">
                {modalError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Employee ID *</label>
                  <input
                    type="text"
                    value={formData.employeeId}
                    onChange={(e) => setFormData({ ...formData, employeeId: e.target.value.toUpperCase() })}
                    placeholder="EMP-LIB-01"
                    required
                    disabled={!!editingOfficer}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Account Role</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold text-slate-900"
                  >
                    <option value="DEPARTMENT_OFFICER">Department Officer</option>
                    <option value="HOD">Head of Department (HOD)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Officer Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Officer Full Name"
                  required
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-medium text-slate-900"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Email *</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="officer@mce.ac.in"
                  required
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-medium text-slate-900"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-2">
                  Assign Clearance Departments * (Select one or multiple)
                </label>
                <div className="space-y-1.5 max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2.5 bg-slate-50">
                  {departments.map((d) => (
                    <label key={d._id} className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-800 hover:text-blue-600">
                      <input
                        type="checkbox"
                        checked={formData.departmentIds.includes(d._id)}
                        onChange={() => handleDepartmentToggle(d._id)}
                        className="rounded text-blue-600 focus:ring-blue-500"
                      />
                      <span>{d.name} ({d.code})</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : editingOfficer ? 'Update Officer' : 'Assign Officer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
