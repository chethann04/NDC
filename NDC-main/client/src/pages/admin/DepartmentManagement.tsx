import React, { useEffect, useState, useMemo } from 'react';
import api from '../../services/api';
import { Department } from '../../types';
import {
  Building2,
  Plus,
  Edit,
  Trash2,
  Search,
  RefreshCw,
  AlertTriangle,
  GraduationCap,
  Atom,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  FolderMinus,
  Sparkles,
  Key,
  Copy,
  Check,
  UserCheck
} from 'lucide-react';
import { ErrorAlert } from '../../components/ErrorAlert';
import { showErrorModal } from '../../store/useErrorModalStore';
import { useAuthStore } from '../../store/useAuthStore';
import { clientCache } from '../../utils/clientCache';

export const DepartmentManagement: React.FC = () => {
  const { user } = useAuthStore();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  // Add / Edit Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    category: 'CENTRAL_DESK',
    description: '',
    isAcademicBranch: false,
    requiresClearance: true,
    displayOrder: 0,
    hodName: '',
    hodDesignation: 'Head of the Department',
    isActive: true
  });
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<any>(null);

  // Delete Modal State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletingDepartment, setDeletingDepartment] = useState<Department | null>(null);
  const [forceDelete, setForceDelete] = useState(false);
  const [deleteWarningInfo, setDeleteWarningInfo] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<any>(null);

  // Auto-Provisioned Credentials Modal State
  const [provisionedInfo, setProvisionedInfo] = useState<{
    deptName: string;
    deptCode: string;
    isAcademicBranch: boolean;
    labCode?: string;
    hodLoginId?: string;
    hodEmail?: string;
    officerLoginId?: string;
    officerEmail?: string;
    defaultPassword?: string;
  } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  useEffect(() => {
    fetchDepartments();
  }, []);

  const fetchDepartments = async () => {
    try {
      setLoading(true);
      const res = await api.get('/departments');
      setDepartments(res.data.data || []);
    } catch (err) {
      console.error('[fetchDepartments Error]:', err);
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
        category: dept.category || (dept.isAcademicBranch ? 'ACADEMIC_BRANCH' : 'CENTRAL_DESK'),
        description: dept.description || '',
        isAcademicBranch: Boolean(dept.isAcademicBranch),
        requiresClearance: Boolean(dept.requiresClearance),
        displayOrder: dept.displayOrder || 0,
        hodName: dept.hodName || '',
        hodDesignation: dept.hodDesignation || 'Head of the Department',
        isActive: Boolean(dept.isActive)
      });
    } else {
      setEditingDepartment(null);
      setFormData({
        name: '',
        code: '',
        category: 'CENTRAL_DESK',
        description: '',
        isAcademicBranch: false,
        requiresClearance: true,
        displayOrder: departments.length + 1,
        hodName: '',
        hodDesignation: 'Head of the Department',
        isActive: true
      });
    }
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    setSubmitting(true);

    try {
      if (editingDepartment) {
        await api.put(`/departments/${editingDepartment._id}`, formData);
      } else {
        const res = await api.post('/departments', formData);
        if (res.data?.provisioned) {
          setProvisionedInfo({
            deptName: res.data.data?.name || formData.name,
            deptCode: res.data.data?.code || formData.code,
            isAcademicBranch: Boolean(formData.isAcademicBranch),
            ...res.data.provisioned
          });
        }
      }

      setIsModalOpen(false);
      clientCache.invalidate();
      await fetchDepartments();
    } catch (err: any) {
      setModalError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (id: string) => {
    try {
      await api.patch(`/departments/${id}/toggle`);
      clientCache.invalidate();
      await fetchDepartments();
    } catch (err: any) {
      showErrorModal(err, { title: 'Failed to Toggle Status' });
    }
  };

  const handleOpenDeleteModal = (dept: Department) => {
    setDeletingDepartment(dept);
    setForceDelete(false);
    setDeleteWarningInfo(null);
    setDeleteError(null);
    setIsDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingDepartment) return;
    setDeleting(true);
    setDeleteError(null);

    try {
      await api.delete(`/departments/${deletingDepartment._id}`, {
        params: { force: forceDelete }
      });
      setIsDeleteModalOpen(false);
      setDeletingDepartment(null);
      clientCache.invalidate();
      await fetchDepartments();
    } catch (err: any) {
      const respData = err.response?.data;
      if (respData?.requiresConfirmation) {
        setDeleteWarningInfo(respData);
      } else {
        setDeleteError(err);
      }
    } finally {
      setDeleting(false);
    }
  };

  // Filtered department list
  const filteredDepartments = useMemo(() => {
    return departments.filter((d) => {
      // Category filter
      if (selectedCategory === 'ACADEMIC_BRANCH') {
        if (!d.isAcademicBranch && d.category !== 'ACADEMIC_BRANCH') return false;
      } else if (selectedCategory === 'CENTRAL_DESK') {
        if (d.isAcademicBranch || (d.category && d.category !== 'CENTRAL_DESK')) return false;
      } else if (selectedCategory === 'COLLEGE_LAB') {
        if (d.category !== 'COLLEGE_LAB' && !['PHY', 'CHEM'].includes(d.code)) return false;
      } else if (selectedCategory === 'ADMINISTRATION') {
        if (d.category !== 'ADMINISTRATION' && !['ADM'].includes(d.code)) return false;
      }

      // Search filter
      if (search.trim()) {
        const query = search.toLowerCase().trim();
        const codeMatch = d.code?.toLowerCase().includes(query);
        const nameMatch = d.name?.toLowerCase().includes(query);
        const hodMatch = d.hodName?.toLowerCase().includes(query);
        return codeMatch || nameMatch || hodMatch;
      }

      return true;
    });
  }, [departments, selectedCategory, search]);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-extrabold text-slate-900">Department Management</h2>
            {isSuperAdmin && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-500" />
                Super Admin Access
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure academic branches, central clearance desks, HOD certificate signatories, and clearance requirements.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchDepartments}
            disabled={loading}
            className="p-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl transition-colors shadow-2xs"
            title="Refresh departments"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => handleOpenModal()}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Department
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
          {[
            { id: 'ALL', label: 'All Departments', count: departments.length },
            {
              id: 'ACADEMIC_BRANCH',
              label: 'Academic Branches',
              count: departments.filter((d) => d.isAcademicBranch || d.category === 'ACADEMIC_BRANCH').length
            },
            {
              id: 'CENTRAL_DESK',
              label: 'Clearance Desks',
              count: departments.filter((d) => !d.isAcademicBranch && d.category !== 'ADMINISTRATION').length
            },
            {
              id: 'ADMINISTRATION',
              label: 'Administrative Offices',
              count: departments.filter((d) => d.category === 'ADMINISTRATION' || ['ADM'].includes(d.code)).length
            }
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs whitespace-nowrap transition-all flex items-center gap-1.5 ${
                selectedCategory === cat.id
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
              }`}
            >
              <span>{cat.label}</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                selectedCategory === cat.id ? 'bg-white/20 text-white' : 'bg-white text-slate-700 border border-slate-200'
              }`}>
                {cat.count}
              </span>
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code, name, or HOD..."
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 transition-all"
          />
        </div>
      </div>

      {/* Departments Table */}
      {loading ? (
        <div className="p-12 text-center text-slate-500 font-semibold bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center justify-center gap-2">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
          <span>Loading departments...</span>
        </div>
      ) : filteredDepartments.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 shadow-sm space-y-2">
          <FolderMinus className="w-8 h-8 text-slate-400 mx-auto" />
          <p className="font-bold text-sm text-slate-800">No departments match your filter</p>
          <p className="text-xs text-slate-500">Try changing the category filter or clearing your search query.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                <tr>
                  <th className="p-4 w-12 text-center">#</th>
                  <th className="p-4">Code</th>
                  <th className="p-4">Department Name & Type</th>
                  <th className="p-4">HOD / Signatory</th>
                  <th className="p-4">Clearance Mandate</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDepartments.map((dept) => (
                  <tr key={dept._id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-mono font-bold text-slate-400 text-center">
                      {dept.displayOrder}
                    </td>

                    <td className="p-4">
                      <span className="font-mono font-extrabold text-blue-700 bg-blue-50 border border-blue-200/80 px-2 py-0.5 rounded text-xs">
                        {dept.code}
                      </span>
                    </td>

                    <td className="p-4">
                      <div>
                        <span className="font-bold text-slate-900 block text-xs">{dept.name}</span>
                        <div className="flex items-center gap-1.5 mt-1">
                          {dept.isAcademicBranch ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                              <GraduationCap className="w-3 h-3" />
                              Academic Branch
                            </span>
                          ) : dept.category === 'COLLEGE_LAB' || ['PHY', 'CHEM'].includes(dept.code) ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-teal-50 text-teal-700 border border-teal-200">
                              <Atom className="w-3 h-3" />
                              College Laboratory
                            </span>
                          ) : dept.category === 'ADMINISTRATION' || ['ADM'].includes(dept.code) ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                              <Building2 className="w-3 h-3" />
                              Administration
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                              <ShieldCheck className="w-3 h-3" />
                              Central Clearance Desk
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="p-4">
                      {dept.hodName ? (
                        <div>
                          <span className="font-bold text-slate-900 block">{dept.hodName}</span>
                          <span className="text-[10px] text-slate-500 font-medium">
                            {dept.hodDesignation || 'Head of the Department'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic text-[11px]">Not configured</span>
                      )}
                    </td>

                    <td className="p-4">
                      {dept.requiresClearance ? (
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-700 font-bold rounded border border-blue-200 text-[10px]">
                          Mandatory
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 font-bold rounded text-[10px]">
                          Exempt / Non-Clearance
                        </span>
                      )}
                    </td>

                    <td className="p-4">
                      <button
                        onClick={() => handleToggleStatus(dept._id)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border transition-colors ${
                          dept.isActive
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                            : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                        }`}
                        title="Click to toggle active state"
                      >
                        {dept.isActive ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            Active
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3 h-3 text-slate-400" />
                            Disabled
                          </>
                        )}
                      </button>
                    </td>

                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleOpenModal(dept)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Modify Department"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        {isSuperAdmin && (
                          <button
                            onClick={() => handleOpenDeleteModal(dept)}
                            className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            title="Delete Department (Super Admin)"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / Modify Department Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-blue-600" />
                <h3 className="text-base font-bold text-slate-900">
                  {editingDepartment ? `Modify Department [${editingDepartment.code}]` : 'Add New Department'}
                </h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-xl font-bold leading-none"
              >
                ×
              </button>
            </div>

            {modalError && (
              <ErrorAlert
                error={modalError}
                onDismiss={() => setModalError(null)}
                title="Department Save Error"
              />
            )}

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Department Code *</label>
                  <input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    placeholder="e.g. CS, LIB, PHY"
                    required
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold text-slate-900 focus:bg-white"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">Short unique identifier</p>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Display Order</label>
                  <input
                    type="number"
                    value={formData.displayOrder}
                    onChange={(e) => setFormData({ ...formData, displayOrder: parseInt(e.target.value, 10) || 0 })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-medium text-slate-900 focus:bg-white"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">Sort index in lists & tables</p>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Department Full Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Computer Science & Engineering"
                  required
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-medium text-slate-900 focus:bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Department Classification</label>
                  <select
                    value={formData.category}
                    onChange={(e) => {
                      const cat = e.target.value;
                      setFormData({
                        ...formData,
                        category: cat,
                        isAcademicBranch: cat === 'ACADEMIC_BRANCH'
                      });
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-medium text-slate-900 focus:bg-white"
                  >
                    <option value="ACADEMIC_BRANCH">Academic Degree Branch</option>
                    <option value="CENTRAL_DESK">Central Clearance Desk</option>
                    <option value="COLLEGE_LAB">College General Laboratory</option>
                    <option value="ADMINISTRATION">Administrative Office</option>
                  </select>
                </div>

                <div className="flex flex-col justify-end">
                  <label className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors">
                    <input
                      type="checkbox"
                      checked={formData.isAcademicBranch}
                      onChange={(e) => setFormData({
                        ...formData,
                        isAcademicBranch: e.target.checked,
                        category: e.target.checked ? 'ACADEMIC_BRANCH' : formData.category
                      })}
                      className="rounded text-blue-600 focus:ring-blue-500"
                    />
                    <span className="font-bold text-slate-800 text-[11px]">Academic Degree Branch</span>
                  </label>
                </div>
              </div>

              {/* HOD Configuration for Certificate Signature */}
              <div className="p-3.5 bg-blue-50/60 border border-blue-200 rounded-xl space-y-2.5">
                <div className="font-bold text-blue-950 text-xs flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <GraduationCap className="w-4 h-4 text-blue-600" />
                    <span>HOD / Department Officer Signatory</span>
                  </div>
                  <span className="text-[10px] text-blue-700 bg-blue-100 px-2 py-0.5 rounded font-mono font-semibold">
                    Certificate Signatory
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-0.5 text-[11px]">
                      Signatory Full Name
                    </label>
                    <input
                      type="text"
                      value={formData.hodName}
                      onChange={(e) => setFormData({ ...formData, hodName: e.target.value })}
                      placeholder="e.g. Dr. Umashankar M."
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-medium text-slate-900 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-0.5 text-[11px]">
                      Designation
                    </label>
                    <input
                      type="text"
                      value={formData.hodDesignation}
                      onChange={(e) => setFormData({ ...formData, hodDesignation: e.target.value })}
                      placeholder="e.g. Head of the Department"
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-medium text-slate-900 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Description / Notes</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Scope of clearance checks or administrative details..."
                  rows={2}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-medium text-slate-900 focus:bg-white"
                />
              </div>

              <div className="space-y-2 pt-1 border-t border-slate-100">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.requiresClearance}
                    onChange={(e) => setFormData({ ...formData, requiresClearance: e.target.checked })}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span className="font-bold text-slate-800">Requires Mandatory Clearance for NDC Approval</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isActive}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <span className="font-bold text-slate-800">Active / Enabled Department</span>
                </label>
              </div>

              <div className="flex gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md disabled:opacity-50 transition-colors"
                >
                  {submitting ? 'Saving...' : editingDepartment ? 'Update Department' : 'Create Department'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Super Admin Delete Confirmation Modal */}
      {isDeleteModalOpen && deletingDepartment && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-rose-200">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Delete Department</h3>
                <p className="text-xs text-slate-500">Super Admin Administrative Power</p>
              </div>
            </div>

            {deleteError && (
              <ErrorAlert
                error={deleteError}
                onDismiss={() => setDeleteError(null)}
                title="Delete Failed"
              />
            )}

            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs space-y-2">
              <div className="flex items-center gap-1.5 text-rose-900 font-bold">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>Permanent Deletion Warning</span>
              </div>
              <p className="text-rose-800 leading-relaxed">
                You are about to permanently delete department{' '}
                <strong className="font-mono bg-white px-1.5 py-0.5 rounded border border-rose-300">
                  {deletingDepartment.code}
                </strong>{' '}
                — <strong>{deletingDepartment.name}</strong>.
              </p>
            </div>

            {deleteWarningInfo && (
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs space-y-2">
                <p className="font-bold text-amber-900">{deleteWarningInfo.message}</p>
                <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                  <div className="p-2 bg-white rounded border border-amber-200 font-semibold text-amber-800">
                    Students: {deleteWarningInfo.data?.studentCount || 0}
                  </div>
                  <div className="p-2 bg-white rounded border border-amber-200 font-semibold text-amber-800">
                    Clearances: {deleteWarningInfo.data?.clearanceCount || 0}
                  </div>
                </div>

                <label className="flex items-center gap-2 pt-2 cursor-pointer font-bold text-rose-700">
                  <input
                    type="checkbox"
                    checked={forceDelete}
                    onChange={(e) => setForceDelete(e.target.checked)}
                    className="rounded text-rose-600 focus:ring-rose-500"
                  />
                  <span>Confirm Force Deletion (delete all linked records)</span>
                </label>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setDeletingDepartment(null);
                }}
                disabled={deleting}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs shadow-md transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {deleting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{forceDelete ? 'Force Delete' : 'Delete Department'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auto-Provisioned Credentials Success Modal */}
      {provisionedInfo && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 border border-emerald-200">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Department & Accounts Created!</h3>
                <p className="text-xs text-slate-500">
                  Faculty section and default officer accounts auto-provisioned
                </p>
              </div>
            </div>

            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs space-y-1">
              <p className="text-emerald-900 font-bold">
                {provisionedInfo.deptName} ({provisionedInfo.deptCode})
              </p>
              <p className="text-emerald-800 text-[11px]">
                {provisionedInfo.isAcademicBranch
                  ? 'Academic Branch Department, unified lab, and default staff credentials were automatically generated.'
                  : 'Clearance desk and default officer credentials were automatically generated.'}
              </p>
              {provisionedInfo.labCode && (
                <div className="pt-1 text-[11px] text-emerald-950 font-semibold">
                  <span>Provisioned Lab Section: </span>
                  <span className="font-mono bg-white px-2 py-0.5 rounded border border-emerald-300">
                    {provisionedInfo.labCode}
                  </span>
                </div>
              )}
            </div>

            {/* Account Credentials Cards */}
            <div className="space-y-3">
              {/* HOD Account (if applicable) */}
              {provisionedInfo.hodLoginId && (
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                    <span className="flex items-center gap-1.5 text-blue-700">
                      <GraduationCap className="w-4 h-4" /> Head of Department (HOD)
                    </span>
                    <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">
                      Auto-Provisioned
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2 bg-white rounded-lg border border-slate-200 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] text-slate-500 uppercase font-bold">Login ID</div>
                        <div className="font-mono font-semibold text-slate-800">{provisionedInfo.hodLoginId}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy(provisionedInfo.hodLoginId!, 'hodLogin')}
                        className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors"
                        title="Copy Login ID"
                      >
                        {copiedField === 'hodLogin' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <div className="p-2 bg-white rounded-lg border border-slate-200 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] text-slate-500 uppercase font-bold">Password</div>
                        <div className="font-mono font-semibold text-slate-800">{provisionedInfo.defaultPassword}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy(provisionedInfo.defaultPassword!, 'hodPass')}
                        className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors"
                        title="Copy Password"
                      >
                        {copiedField === 'hodPass' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">
                    Email: <span className="font-mono text-slate-700">{provisionedInfo.hodEmail}</span>
                  </div>
                </div>
              )}

              {/* Faculty Section / Clearance Officer Account */}
              {provisionedInfo.officerLoginId && (
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                    <span className="flex items-center gap-1.5 text-indigo-700">
                      <UserCheck className="w-4 h-4" />
                      {provisionedInfo.isAcademicBranch ? 'Department Faculty Section Officer' : 'Default Clearance Officer'}
                    </span>
                    <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-semibold">
                      Auto-Provisioned
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2 bg-white rounded-lg border border-slate-200 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] text-slate-500 uppercase font-bold">Login ID</div>
                        <div className="font-mono font-semibold text-slate-800">{provisionedInfo.officerLoginId}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy(provisionedInfo.officerLoginId!, 'offLogin')}
                        className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors"
                        title="Copy Login ID"
                      >
                        {copiedField === 'offLogin' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <div className="p-2 bg-white rounded-lg border border-slate-200 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] text-slate-500 uppercase font-bold">Password</div>
                        <div className="font-mono font-semibold text-slate-800">{provisionedInfo.defaultPassword}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy(provisionedInfo.defaultPassword!, 'offPass')}
                        className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors"
                        title="Copy Password"
                      >
                        {copiedField === 'offPass' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">
                    Email: <span className="font-mono text-slate-700">{provisionedInfo.officerEmail}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-[11px] text-blue-800 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
              <span>
                Workflow clearance requirements have been synced automatically across all active student NDC requests.
              </span>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => setProvisionedInfo(null)}
                className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs shadow-md transition-colors"
              >
                Close & View Department
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
