import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { Department } from '../../types';
import { Building2, Plus, Edit, CheckCircle2, XCircle, ToggleLeft, ToggleRight } from 'lucide-react';

export const DepartmentManagement: React.FC = () => {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    description: '',
    requiresClearance: true,
    displayOrder: 0,
    hodName: '',
    hodDesignation: 'Head of the Department'
  });
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');

  useEffect(() => {
    fetchDepartments();
  }, []);

  const fetchDepartments = async () => {
    try {
      const res = await api.get('/departments');
      setDepartments(res.data.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (dept: Department | null = null) => {
    if (dept) {
      setEditingDepartment(dept);
      setFormData({
        name: dept.name,
        code: dept.code,
        description: dept.description || '',
        requiresClearance: dept.requiresClearance,
        displayOrder: dept.displayOrder || 0,
        hodName: dept.hodName || '',
        hodDesignation: dept.hodDesignation || 'Head of the Department'
      });
    } else {
      setEditingDepartment(null);
      setFormData({
        name: '',
        code: '',
        description: '',
        requiresClearance: true,
        displayOrder: departments.length + 1,
        hodName: '',
        hodDesignation: 'Head of the Department'
      });
    }
    setModalError('');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');
    setSubmitting(true);

    try {
      if (editingDepartment) {
        await api.put(`/departments/${editingDepartment._id}`, formData);
      } else {
        await api.post('/departments', formData);
      }

      setIsModalOpen(false);
      await fetchDepartments();
    } catch (err: any) {
      setModalError(err.response?.data?.message || 'Operation failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (id: string) => {
    try {
      await api.patch(`/departments/${id}/toggle`);
      await fetchDepartments();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to toggle status.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900">Clearance Departments</h2>
          <p className="text-xs text-slate-500">Configure clearance sections, required workflow checks, and display order</p>
        </div>

        <button
          onClick={() => handleOpenModal()}
          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Department
        </button>
      </div>

      {loading ? (
        <div className="p-8 text-center text-slate-500 font-semibold">Loading clearance departments...</div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                <tr>
                  <th className="p-4">Order</th>
                  <th className="p-4">Code</th>
                  <th className="p-4">Department Name</th>
                  <th className="p-4">HOD (Certificate Signatory)</th>
                  <th className="p-4">Clearance Required</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {departments.map((dept) => (
                  <tr key={dept._id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-bold text-slate-400">#{dept.displayOrder}</td>
                    <td className="p-4 font-mono font-bold text-blue-700">{dept.code}</td>
                    <td className="p-4 font-bold text-slate-900">{dept.name}</td>
                    <td className="p-4">
                      {dept.hodName ? (
                        <div>
                          <span className="font-bold text-slate-900 block">{dept.hodName}</span>
                          <span className="text-[10px] text-slate-500">{dept.hodDesignation || 'Head of the Department'}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">Not configured</span>
                      )}
                    </td>
                    <td className="p-4">
                      {dept.requiresClearance ? (
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-700 font-bold rounded border border-blue-200 text-[10px]">
                          Mandatory
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 font-bold rounded text-[10px]">
                          Optional / Exempt
                        </span>
                      )}
                    </td>
                    <td className="p-4">
                      <button
                        onClick={() => handleToggleStatus(dept._id)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border transition-colors ${
                          dept.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'
                        }`}
                      >
                        {dept.isActive ? 'Active' : 'Disabled'}
                      </button>
                    </td>
                    <td className="p-4 text-right">
                      <button
                        onClick={() => handleOpenModal(dept)}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Edit Department"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / Edit Department Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">
                {editingDepartment ? 'Edit Department' : 'Add New Department'}
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
                  <label className="block font-bold text-slate-700 mb-1">Department Code *</label>
                  <input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    placeholder="e.g. LIB"
                    required
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Display Order</label>
                  <input
                    type="number"
                    value={formData.displayOrder}
                    onChange={(e) => setFormData({ ...formData, displayOrder: parseInt(e.target.value, 10) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-medium text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Department Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Information Science & Engineering"
                  required
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-medium text-slate-900"
                />
              </div>

              {/* HOD Configuration for Certificate Signature */}
              <div className="p-3 bg-blue-50/60 border border-blue-200 rounded-xl space-y-2">
                <div className="font-bold text-blue-950 text-xs flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-blue-600" />
                  HOD Certificate Signatory
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-0.5 text-[11px]">HOD Full Name (Printed on Certificate)</label>
                    <input
                      type="text"
                      value={formData.hodName}
                      onChange={(e) => setFormData({ ...formData, hodName: e.target.value })}
                      placeholder="e.g. Dr. Umashankar M."
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-medium text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-0.5 text-[11px]">HOD Designation</label>
                    <input
                      type="text"
                      value={formData.hodDesignation}
                      onChange={(e) => setFormData({ ...formData, hodDesignation: e.target.value })}
                      placeholder="e.g. Head of the Department"
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-medium text-slate-900"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Scope of clearance checks..."
                  rows={2}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-medium text-slate-900"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="requiresClearance"
                  checked={formData.requiresClearance}
                  onChange={(e) => setFormData({ ...formData, requiresClearance: e.target.checked })}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="requiresClearance" className="font-bold text-slate-700 cursor-pointer">
                  Requires Mandatory Clearance for NDC Approval
                </label>
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
                  {submitting ? 'Saving...' : editingDepartment ? 'Update Department' : 'Create Department'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
