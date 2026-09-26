import React, { useEffect, useState, useMemo } from 'react';
import api from '../../services/api';
import {
  KeyRound,
  Search,
  RefreshCw,
  Mail,
  ShieldCheck,
  Building2,
  Atom,
  FlaskConical,
  GraduationCap,
  Power,
  Edit2,
  Check,
  X,
  Copy,
  Lock,
  Eye,
  EyeOff,
  UserCheck,
  UserX,
  AlertTriangle,
  ChevronDown,
  Plus,
  Users,
  UserPlus
} from 'lucide-react';

import { showErrorModal } from '../../store/useErrorModalStore';

interface SectionAccount {
  id: string;
  name: string;
  email: string;
  loginId: string | null;
  employeeId: string | null;
  role: string;
  sectionName: string;
  sectionCategory: 'CENTRAL_DESK' | 'COLLEGE_LAB' | 'ACADEMIC_FACULTY' | 'ACADEMIC_HOD' | 'ADMINISTRATION';
  isDepartmentFaculty: boolean;
  departmentId: string | null;
  department: {
    id: string;
    name: string;
    code: string;
    isAcademicBranch: boolean;
  } | null;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLogin: string | null;
  createdAt: string;
}

export const SectionLoginManagement: React.FC = () => {
  const [accounts, setAccounts] = useState<SectionAccount[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedDeptFilter, setSelectedDeptFilter] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Edit Email Modal State
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [targetAccount, setTargetAccount] = useState<SectionAccount | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

  // Change Department Modal State
  const [deptModalOpen, setDeptModalOpen] = useState(false);
  const [targetDeptId, setTargetDeptId] = useState('');
  const [savingDept, setSavingDept] = useState(false);

  // Reset Password Modal State
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  // Status Toggle Confirmation Dialog State
  const [statusConfirmOpen, setStatusConfirmOpen] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);

  // Add Department Modal State
  const [addDeptModalOpen, setAddDeptModalOpen] = useState(false);
  const [deptForm, setDeptForm] = useState({
    name: '',
    code: '',
    category: 'ACADEMIC_BRANCH',
    requiresClearance: true,
    hodName: '',
    description: ''
  });
  const [savingNewDept, setSavingNewDept] = useState(false);

  // Add HOD Modal State
  const [addHodModalOpen, setAddHodModalOpen] = useState(false);
  const [hodForm, setHodForm] = useState({
    name: '',
    email: '',
    loginId: '',
    departmentId: '',
    password: 'Admin@123'
  });
  const [showHodPassword, setShowHodPassword] = useState(false);
  const [savingNewHod, setSavingNewHod] = useState(false);

  // Add Faculty Modal State
  const [addFacultyModalOpen, setAddFacultyModalOpen] = useState(false);
  const [facultyForm, setFacultyForm] = useState({
    name: '',
    email: '',
    loginId: '',
    employeeId: '',
    departmentId: '',
    password: 'Officer@123'
  });
  const [showFacultyPassword, setShowFacultyPassword] = useState(false);
  const [savingNewFaculty, setSavingNewFaculty] = useState(false);

  // Toast / inline success notification
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => {
      setSuccessToast(null);
    }, 4500);
  };

  useEffect(() => {
    fetchAccounts();
    fetchDepartments();
  }, []);

  const fetchAccounts = async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/section-logins');
      setAccounts(res.data.data || []);
    } catch (err: any) {
      console.error('Error fetching section accounts:', err);
      showErrorModal(err, { title: 'Failed to load section accounts' });
    } finally {
      setLoading(false);
    }
  };

  const fetchDepartments = async () => {
    try {
      const res = await api.get('/departments');
      setDepartments(res.data.data || []);
    } catch (err) {
      console.error('Error fetching departments:', err);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Filter accounts
  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      // Category filter
      if (selectedCategory !== 'ALL' && acc.sectionCategory !== selectedCategory) {
        return false;
      }

      // Department filter
      if (selectedDeptFilter !== 'ALL') {
        const dId = acc.department?.id || acc.departmentId;
        const dCode = acc.department?.code;
        if (dId !== selectedDeptFilter && dCode !== selectedDeptFilter) {
          return false;
        }
      }

      // Status filter
      if (selectedStatus === 'ACTIVE' && !acc.isActive) return false;
      if (selectedStatus === 'INACTIVE' && acc.isActive) return false;

      // Search query
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchesName = acc.name.toLowerCase().includes(q);
        const matchesEmail = acc.email.toLowerCase().includes(q);
        const matchesLoginId = acc.loginId?.toLowerCase().includes(q) || false;
        const matchesEmployeeId = acc.employeeId?.toLowerCase().includes(q) || false;
        const matchesSection = acc.sectionName.toLowerCase().includes(q);
        const matchesDept = acc.department?.name.toLowerCase().includes(q) || acc.department?.code.toLowerCase().includes(q) || false;
        return matchesName || matchesEmail || matchesLoginId || matchesEmployeeId || matchesSection || matchesDept;
      }

      return true;
    });
  }, [accounts, selectedCategory, selectedDeptFilter, selectedStatus, search]);

  // Metric stats
  const stats = useMemo(() => {
    return {
      total: accounts.length,
      active: accounts.filter((a) => a.isActive).length,
      inactive: accounts.filter((a) => !a.isActive).length,
      labs: accounts.filter((a) => a.sectionCategory === 'COLLEGE_LAB').length,
      desks: accounts.filter((a) => a.sectionCategory === 'CENTRAL_DESK').length,
      academic: accounts.filter((a) => a.sectionCategory === 'ACADEMIC_FACULTY' || a.sectionCategory === 'ACADEMIC_HOD').length
    };
  }, [accounts]);

  // Action: Open Edit Email Modal
  const openEditEmail = (acc: SectionAccount) => {
    setTargetAccount(acc);
    setNewEmail(acc.email);
    setEmailModalOpen(true);
  };

  const handleSaveEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetAccount) return;
    const trimmed = newEmail.trim().toLowerCase();
    if (!trimmed) return;

    try {
      setSavingEmail(true);
      const res = await api.put(`/admin/section-logins/${targetAccount.id}/email`, { email: trimmed });
      setAccounts((prev) =>
        prev.map((a) => (a.id === targetAccount.id ? { ...a, email: trimmed } : a))
      );
      setEmailModalOpen(false);
      showToast(res.data.message || `Login email updated to ${trimmed}`);
    } catch (err: any) {
      showErrorModal(err, { title: 'Failed to update email' });
    } finally {
      setSavingEmail(false);
    }
  };

  // Action: Open Change Department Modal
  const openChangeDept = (acc: SectionAccount) => {
    setTargetAccount(acc);
    setTargetDeptId(acc.department?.id || acc.departmentId || (departments[0]?.id || ''));
    setDeptModalOpen(true);
  };

  const handleSaveDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetAccount || !targetDeptId) return;

    try {
      setSavingDept(true);
      const res = await api.put(`/admin/section-logins/${targetAccount.id}/department`, { departmentId: targetDeptId });
      const updatedDept = departments.find((d) => d.id === targetDeptId);

      setAccounts((prev) =>
        prev.map((a) =>
          a.id === targetAccount.id
            ? {
                ...a,
                departmentId: targetDeptId,
                department: updatedDept ? { id: updatedDept.id, name: updatedDept.name, code: updatedDept.code, isAcademicBranch: updatedDept.isAcademicBranch } : a.department,
                sectionName: updatedDept ? `${updatedDept.name} Faculty / Lab` : a.sectionName
              }
            : a
        )
      );
      setDeptModalOpen(false);
      showToast(res.data.message || 'Department scope updated.');
    } catch (err: any) {
      showErrorModal(err, { title: 'Failed to update department assignment' });
    } finally {
      setSavingDept(false);
    }
  };

  // Action: Open Reset Password Modal
  const openResetPassword = (acc: SectionAccount) => {
    setTargetAccount(acc);
    setNewPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setPasswordModalOpen(true);
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetAccount) return;
    if (newPassword.length < 6) {
      showErrorModal(new Error('Password must be at least 6 characters long.'), { title: 'Invalid Password' });
      return;
    }
    if (newPassword !== confirmPassword) {
      showErrorModal(new Error('Passwords do not match. Please re-enter.'), { title: 'Password Mismatch' });
      return;
    }

    try {
      setSavingPassword(true);
      const res = await api.post(`/admin/section-logins/${targetAccount.id}/reset-password`, { password: newPassword });
      setPasswordModalOpen(false);
      showToast(res.data.message || `Password reset successfully for ${targetAccount.name}.`);
    } catch (err: any) {
      showErrorModal(err, { title: 'Password Reset Failed' });
    } finally {
      setSavingPassword(false);
    }
  };

  // Action: Toggle Status Dialog
  const openStatusConfirm = (acc: SectionAccount) => {
    setTargetAccount(acc);
    setStatusConfirmOpen(true);
  };

  const handleToggleStatus = async () => {
    if (!targetAccount) return;
    const nextStatus = !targetAccount.isActive;

    try {
      setTogglingStatus(true);
      const res = await api.patch(`/admin/section-logins/${targetAccount.id}/status`, { isActive: nextStatus });
      setAccounts((prev) =>
        prev.map((a) => (a.id === targetAccount.id ? { ...a, isActive: nextStatus } : a))
      );
      setStatusConfirmOpen(false);
      showToast(res.data.message || `Account ${nextStatus ? 'activated' : 'deactivated'} successfully.`);
    } catch (err: any) {
      showErrorModal(err, { title: 'Failed to change account status' });
    } finally {
      setTogglingStatus(false);
    }
  };

  // Action: Open Add Department Modal
  const openAddDepartmentModal = () => {
    setDeptForm({
      name: '',
      code: '',
      category: 'ACADEMIC_BRANCH',
      requiresClearance: true,
      hodName: '',
      description: ''
    });
    setAddDeptModalOpen(true);
  };

  const handleSaveNewDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deptForm.name.trim() || !deptForm.code.trim()) {
      showErrorModal(new Error('Department Name and Code are required.'), { title: 'Missing Required Fields' });
      return;
    }

    try {
      setSavingNewDept(true);
      const res = await api.post('/admin/section-logins/department', deptForm);
      setAddDeptModalOpen(false);
      showToast(res.data.message || `Department ${deptForm.name} created successfully.`);
      await Promise.all([fetchDepartments(), fetchAccounts()]);
    } catch (err: any) {
      showErrorModal(err, { title: 'Failed to Create Department' });
    } finally {
      setSavingNewDept(false);
    }
  };

  // Action: Open Add HOD Modal
  const openAddHodModal = () => {
    const firstDept = departments.find((d) => d.isAcademicBranch) || departments[0];
    setHodForm({
      name: '',
      email: '',
      loginId: '',
      departmentId: firstDept ? firstDept.id : '',
      password: 'Admin@123'
    });
    setShowHodPassword(false);
    setAddHodModalOpen(true);
  };

  const handleSaveNewHod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hodForm.name.trim() || !hodForm.email.trim() || !hodForm.departmentId) {
      showErrorModal(new Error('HOD Name, Official Email, and Department are required.'), { title: 'Missing Required Fields' });
      return;
    }

    try {
      setSavingNewHod(true);
      const res = await api.post('/admin/section-logins/hod', hodForm);
      setAddHodModalOpen(false);
      showToast(res.data.message || `HOD account created successfully.`);
      await Promise.all([fetchAccounts(), fetchDepartments()]);
    } catch (err: any) {
      showErrorModal(err, { title: 'Failed to Create HOD Account' });
    } finally {
      setSavingNewHod(false);
    }
  };

  // Action: Open Add Faculty Modal
  const openAddFacultyModal = () => {
    const firstDept = departments.find((d) => d.isAcademicBranch) || departments[0];
    setFacultyForm({
      name: '',
      email: '',
      loginId: '',
      employeeId: '',
      departmentId: firstDept ? firstDept.id : '',
      password: 'Officer@123'
    });
    setShowFacultyPassword(false);
    setAddFacultyModalOpen(true);
  };

  const handleSaveNewFaculty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!facultyForm.name.trim() || !facultyForm.email.trim() || !facultyForm.employeeId.trim() || !facultyForm.departmentId) {
      showErrorModal(new Error('Faculty Name, Email, Employee ID, and Department are required.'), { title: 'Missing Required Fields' });
      return;
    }

    try {
      setSavingNewFaculty(true);
      const res = await api.post('/admin/section-logins/faculty', facultyForm);
      setAddFacultyModalOpen(false);
      showToast(res.data.message || `Faculty account created successfully.`);
      await fetchAccounts();
    } catch (err: any) {
      showErrorModal(err, { title: 'Failed to Create Faculty Account' });
    } finally {
      setSavingNewFaculty(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {successToast && (
        <div className="fixed top-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-zinc-900 text-white text-xs font-semibold shadow-2xl border border-zinc-700 animate-in fade-in slide-in-from-top-2 duration-200">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{successToast}</span>
          <button onClick={() => setSuccessToast(null)} className="ml-2 text-zinc-400 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-zinc-200/80">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white flex items-center justify-center shadow-sm">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-zinc-900 tracking-tight">
                Section Login Management
              </h1>
              <p className="text-xs text-zinc-500">
                Centralized access, login credentials &amp; department scope control for all operational clearance desks and faculty accounts.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Add Department */}
          <button
            onClick={openAddDepartmentModal}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors cursor-pointer"
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Add Department</span>
          </button>

          {/* Add HOD */}
          <button
            onClick={openAddHodModal}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-purple-600 hover:bg-purple-700 text-white shadow-xs transition-colors cursor-pointer"
          >
            <GraduationCap className="w-3.5 h-3.5" />
            <span>Add HOD</span>
          </button>

          {/* Add Faculty */}
          <button
            onClick={openAddFacultyModal}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Add Faculty Section</span>
          </button>

          {/* Refresh Accounts */}
          <button
            onClick={fetchAccounts}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>


      {/* Metric Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-2xl border border-zinc-200/80 bg-white shadow-xs">
          <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
            Total Operational Logins
          </p>
          <div className="flex items-baseline gap-2 mt-1.5">
            <span className="text-2xl font-extrabold text-zinc-900">{stats.total}</span>
            <span className="text-[11px] font-semibold text-zinc-400">accounts</span>
          </div>
        </div>

        <div className="p-4 rounded-2xl border border-emerald-200/70 bg-emerald-50/40 shadow-xs">
          <p className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">
            Active Accounts
          </p>
          <div className="flex items-baseline gap-2 mt-1.5">
            <span className="text-2xl font-extrabold text-emerald-900">{stats.active}</span>
            <span className="text-[11px] font-semibold text-emerald-700">operational</span>
          </div>
        </div>

        <div className="p-4 rounded-2xl border border-cyan-200/70 bg-cyan-50/40 shadow-xs">
          <p className="text-[11px] font-bold text-cyan-700 uppercase tracking-wider">
            Central Desks &amp; Labs
          </p>
          <div className="flex items-baseline gap-2 mt-1.5">
            <span className="text-2xl font-extrabold text-cyan-900">{stats.desks + stats.labs}</span>
            <span className="text-[11px] font-semibold text-cyan-700">sections</span>
          </div>
        </div>

        <div className="p-4 rounded-2xl border border-indigo-200/70 bg-indigo-50/40 shadow-xs">
          <p className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider">
            Academic Branches
          </p>
          <div className="flex items-baseline gap-2 mt-1.5">
            <span className="text-2xl font-extrabold text-indigo-900">{stats.academic}</span>
            <span className="text-[11px] font-semibold text-indigo-700">HODs &amp; faculty</span>
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="p-3.5 rounded-2xl border border-zinc-200/80 bg-white shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2.5">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by account name, email, login ID (e.g. PHY001, LIB001), or branch..."
              className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-zinc-200 bg-zinc-50/60 focus:bg-white focus:outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 transition-all font-medium text-zinc-900 placeholder:text-zinc-400"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-2.5 text-zinc-400 hover:text-zinc-700"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Section Category Dropdown */}
          <div className="flex items-center gap-2">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-2 text-xs rounded-xl border border-zinc-200 bg-white text-zinc-800 font-semibold focus:outline-none focus:border-zinc-900 shadow-xs"
            >
              <option value="ALL">All Categories</option>
              <option value="COLLEGE_LAB">🔬 College Labs (Physics / Chemistry)</option>
              <option value="CENTRAL_DESK">🏛️ Central Desks (Library, Hostel, Sports, Cash)</option>
              <option value="ACADEMIC_FACULTY">💻 Academic Department Faculty / Lab</option>
              <option value="ACADEMIC_HOD">🧑‍🏫 Academic Department Heads (HOD)</option>
              <option value="ADMINISTRATION">👑 Administration</option>
            </select>

            {/* Department Scope Dropdown */}
            <select
              value={selectedDeptFilter}
              onChange={(e) => setSelectedDeptFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-xl border border-zinc-200 bg-white text-zinc-800 font-semibold focus:outline-none focus:border-zinc-900 shadow-xs"
            >
              <option value="ALL">All Departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.code})
                </option>
              ))}
            </select>

            {/* Status Dropdown */}
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-3 py-2 text-xs rounded-xl border border-zinc-200 bg-white text-zinc-800 font-semibold focus:outline-none focus:border-zinc-900 shadow-xs"
            >
              <option value="ALL">All Status</option>
              <option value="ACTIVE">Active Only</option>
              <option value="INACTIVE">Inactive Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Accounts List Table */}
      <div className="rounded-2xl border border-zinc-200/80 bg-white shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-20 text-center">
            <RefreshCw className="w-6 h-6 text-zinc-400 animate-spin mx-auto mb-2" />
            <p className="text-xs text-zinc-500 font-medium">Loading operational section accounts...</p>
          </div>
        ) : filteredAccounts.length === 0 ? (
          <div className="py-16 text-center">
            <KeyRound className="w-8 h-8 text-zinc-300 mx-auto mb-2" />
            <p className="text-sm font-semibold text-zinc-700">No matching section accounts found</p>
            <p className="text-xs text-zinc-400 mt-0.5">Try clearing filters or adjusting your search term.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50/70 text-[11px] font-bold text-zinc-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Account / Officer</th>
                  <th className="py-3 px-4">Login Email &amp; ID</th>
                  <th className="py-3 px-4">Section / Unit</th>
                  <th className="py-3 px-4">Department Scope</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filteredAccounts.map((acc) => {
                  const isSuperAdminAccount = acc.role === 'SUPER_ADMIN';

                  return (
                    <tr
                      key={acc.id}
                      className={`hover:bg-zinc-50/80 transition-colors ${
                        !acc.isActive ? 'bg-zinc-50/40 opacity-75' : ''
                      }`}
                    >
                      {/* Name & Role */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                              acc.sectionCategory === 'COLLEGE_LAB'
                                ? 'bg-cyan-100 text-cyan-800'
                                : acc.sectionCategory === 'CENTRAL_DESK'
                                ? 'bg-amber-100 text-amber-800'
                                : acc.sectionCategory === 'ACADEMIC_HOD'
                                ? 'bg-purple-100 text-purple-800'
                                : acc.sectionCategory === 'ACADEMIC_FACULTY'
                                ? 'bg-indigo-100 text-indigo-800'
                                : 'bg-zinc-100 text-zinc-800'
                            }`}
                          >
                            {acc.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-zinc-900 leading-snug">
                              {acc.name}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-zinc-100 text-zinc-600 border border-zinc-200/60">
                                {acc.role}
                              </span>
                              {acc.employeeId && (
                                <span className="text-[10px] text-zinc-400 font-mono">
                                  {acc.employeeId}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Login Email & ID */}
                      <td className="py-3 px-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-zinc-800">
                            <Mail className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                            <span>{acc.email}</span>
                            <button
                              onClick={() => handleCopy(acc.email, `email-${acc.id}`)}
                              className="text-zinc-400 hover:text-zinc-700 p-0.5"
                              title="Copy email"
                            >
                              {copiedId === `email-${acc.id}` ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                          {acc.loginId && (
                            <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-100 border border-zinc-200/80 text-[10px] font-mono font-bold text-zinc-700">
                              <span>ID:</span>
                              <span className="text-zinc-900">{acc.loginId}</span>
                              <button
                                onClick={() => handleCopy(acc.loginId!, `id-${acc.id}`)}
                                className="text-zinc-400 hover:text-zinc-700 ml-0.5"
                                title="Copy Login ID"
                              >
                                {copiedId === `id-${acc.id}` ? (
                                  <Check className="w-2.5 h-2.5 text-emerald-600" />
                                ) : (
                                  <Copy className="w-2.5 h-2.5" />
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Section / Unit */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-zinc-900">{acc.sectionName}</div>
                        <div className="text-[10px] font-medium text-zinc-400 capitalize">
                          {acc.sectionCategory.toLowerCase().replace(/_/g, ' ')}
                        </div>
                      </td>

                      {/* Department Scope */}
                      <td className="py-3 px-4">
                        {acc.department ? (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200/70 text-blue-950 font-bold text-[11px]">
                            <Building2 className="w-3 h-3 text-blue-600 shrink-0" />
                            <span>{acc.department.name}</span>
                            <span className="px-1 py-0.2 rounded bg-blue-200/60 text-blue-800 text-[9px] font-mono">
                              {acc.department.code}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-zinc-400 font-medium italic">
                            Institutional Overview
                          </span>
                        )}
                      </td>

                      {/* Active Status */}
                      <td className="py-3 px-4 text-center">
                        {acc.isActive ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/80">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200/80">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                            Disabled
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          {/* Change Email */}
                          <button
                            onClick={() => openEditEmail(acc)}
                            className="p-1.5 rounded-lg border border-zinc-200 hover:bg-zinc-100 text-zinc-700 hover:text-zinc-900 transition-colors"
                            title="Edit login email"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          {/* Change Department Scope (if academic faculty or HOD) */}
                          <button
                            onClick={() => openChangeDept(acc)}
                            disabled={!acc.isDepartmentFaculty && acc.sectionCategory !== 'CENTRAL_DESK'}
                            className="p-1.5 rounded-lg border border-zinc-200 hover:bg-blue-50 text-zinc-700 hover:text-blue-700 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                            title="Change department scope"
                          >
                            <Building2 className="w-3.5 h-3.5" />
                          </button>

                          {/* Reset Password */}
                          <button
                            onClick={() => openResetPassword(acc)}
                            className="p-1.5 rounded-lg border border-zinc-200 hover:bg-amber-50 text-zinc-700 hover:text-amber-700 transition-colors"
                            title="Reset account password"
                          >
                            <Lock className="w-3.5 h-3.5" />
                          </button>

                          {/* Toggle Active / Inactive */}
                          {!isSuperAdminAccount && (
                            <button
                              onClick={() => openStatusConfirm(acc)}
                              className={`p-1.5 rounded-lg border transition-colors ${
                                acc.isActive
                                  ? 'border-zinc-200 hover:bg-rose-50 text-zinc-700 hover:text-rose-600'
                                  : 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800'
                              }`}
                              title={acc.isActive ? 'Deactivate account' : 'Reactivate account'}
                            >
                              <Power className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ================= EDIT EMAIL MODAL ================= */}
      {emailModalOpen && targetAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl bg-white border border-zinc-200 p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-zinc-900">Change Login Email</h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Update the authentication email for <strong className="text-zinc-800">{targetAccount.name}</strong>.
                </p>
              </div>
              <button
                onClick={() => setEmailModalOpen(false)}
                className="text-zinc-400 hover:text-zinc-700 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEmail} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Current Email
                </label>
                <input
                  type="text"
                  disabled
                  value={targetAccount.email}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-200 bg-zinc-100 text-zinc-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  New Login Email Address *
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
                  <input
                    type="email"
                    required
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="e.g. new.email@mce.ac.in"
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-zinc-300 focus:outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 font-medium text-zinc-900"
                  />
                </div>
                <p className="text-[11px] text-zinc-500 mt-1">
                  The old email will immediately stop working. The user must use this new email to log in.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100">
                <button
                  type="button"
                  onClick={() => setEmailModalOpen(false)}
                  disabled={savingEmail}
                  className="px-3.5 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEmail}
                  className="px-4 py-2 text-xs font-semibold text-white bg-zinc-900 hover:bg-zinc-800 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <span>{savingEmail ? 'Updating Email...' : 'Save New Email'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= CHANGE DEPARTMENT MODAL ================= */}
      {deptModalOpen && targetAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl bg-white border border-zinc-200 p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-zinc-900">Change Department Scope</h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Assign academic branch for <strong className="text-zinc-800">{targetAccount.name}</strong>.
                </p>
              </div>
              <button
                onClick={() => setDeptModalOpen(false)}
                className="text-zinc-400 hover:text-zinc-700 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveDepartment} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Assigned Academic Department *
                </label>
                <select
                  value={targetDeptId}
                  onChange={(e) => setTargetDeptId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-300 font-semibold text-zinc-900 focus:outline-none focus:border-zinc-900"
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.code}) {d.isAcademicBranch ? '• Academic Branch' : ''}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-zinc-500 mt-1.5">
                  Backend RBAC strictly binds this account to the assigned department. The officer will only be able to review clearances and manage labs for students enrolled in this department.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100">
                <button
                  type="button"
                  onClick={() => setDeptModalOpen(false)}
                  disabled={savingDept}
                  className="px-3.5 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingDept}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <span>{savingDept ? 'Saving Scope...' : 'Update Department Scope'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= RESET PASSWORD MODAL ================= */}
      {passwordModalOpen && targetAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl bg-white border border-zinc-200 p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-zinc-900">Reset Account Password</h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Set a new password for <strong className="text-zinc-800">{targetAccount.name}</strong> ({targetAccount.email}).
                </p>
              </div>
              <button
                onClick={() => setPasswordModalOpen(false)}
                className="text-zinc-400 hover:text-zinc-700 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSavePassword} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  New Password *
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    className="w-full pl-9 pr-10 py-2 text-xs rounded-xl border border-zinc-300 focus:outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 font-medium text-zinc-900"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-zinc-400 hover:text-zinc-700"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Confirm New Password *
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-zinc-300 focus:outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 font-medium text-zinc-900"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100">
                <button
                  type="button"
                  onClick={() => setPasswordModalOpen(false)}
                  disabled={savingPassword}
                  className="px-3.5 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPassword}
                  className="px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <span>{savingPassword ? 'Resetting Password...' : 'Save New Password'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= TOGGLE STATUS CONFIRM MODAL ================= */}
      {statusConfirmOpen && targetAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl bg-white border border-zinc-200 p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  targetAccount.isActive ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-zinc-900">
                  {targetAccount.isActive ? 'Deactivate Section Account?' : 'Reactivate Section Account?'}
                </h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {targetAccount.name} ({targetAccount.email})
                </p>
              </div>
            </div>

            <p className="text-xs text-zinc-600 leading-relaxed">
              {targetAccount.isActive
                ? 'Deactivating this account will immediately revoke login access. Existing clearances, historical approvals, and student certificates signed by this account will remain completely intact.'
                : 'Reactivating this account will immediately restore portal login access and allow the officer to resume clearance reviews.'}
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100">
              <button
                type="button"
                onClick={() => setStatusConfirmOpen(false)}
                disabled={togglingStatus}
                className="px-3.5 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleToggleStatus}
                disabled={togglingStatus}
                className={`px-4 py-2 text-xs font-semibold text-white rounded-xl shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer ${
                  targetAccount.isActive ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                <span>
                  {togglingStatus
                    ? 'Updating...'
                    : targetAccount.isActive
                    ? 'Yes, Deactivate Account'
                    : 'Yes, Reactivate Account'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ================= ADD DEPARTMENT MODAL ================= */}
      {addDeptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-2xl bg-white border border-zinc-200 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-zinc-900">Add New Department / Section</h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Provisions an academic branch or centralized clearance desk.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAddDeptModalOpen(false)}
                className="text-zinc-400 hover:text-zinc-700 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveNewDepartment} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Department Name *
                </label>
                <input
                  type="text"
                  required
                  value={deptForm.name}
                  onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })}
                  placeholder="e.g. Artificial Intelligence & Machine Learning"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-300 focus:outline-none focus:border-zinc-900 font-medium text-zinc-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Department Code *
                  </label>
                  <input
                    type="text"
                    required
                    value={deptForm.code}
                    onChange={(e) => setDeptForm({ ...deptForm, code: e.target.value.toUpperCase() })}
                    placeholder="e.g. AIML"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-300 focus:outline-none focus:border-zinc-900 font-mono font-bold uppercase text-zinc-900"
                  />
                  <p className="text-[10px] text-zinc-400 mt-0.5">Unique short abbreviation</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Section Category *
                  </label>
                  <select
                    value={deptForm.category}
                    onChange={(e) => setDeptForm({ ...deptForm, category: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-300 font-semibold text-zinc-800 focus:outline-none focus:border-zinc-900"
                  >
                    <option value="ACADEMIC_BRANCH">🎓 Academic Branch</option>
                    <option value="CENTRAL_DESK">🏛️ Central Clearance Desk</option>
                    <option value="COLLEGE_LAB">🔬 College Lab</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Head of Department (HOD) Name (Optional)
                </label>
                <input
                  type="text"
                  value={deptForm.hodName}
                  onChange={(e) => setDeptForm({ ...deptForm, hodName: e.target.value })}
                  placeholder="e.g. Dr. Ramesh Kumar"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-300 focus:outline-none focus:border-zinc-900 font-medium text-zinc-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Description / Purpose (Optional)
                </label>
                <textarea
                  rows={2}
                  value={deptForm.description}
                  onChange={(e) => setDeptForm({ ...deptForm, description: e.target.value })}
                  placeholder="Brief description of this section's function..."
                  className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-300 focus:outline-none focus:border-zinc-900 font-medium text-zinc-900"
                />
              </div>

              <div className="p-3 rounded-xl bg-zinc-50 border border-zinc-200/80 flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id="requiresClearance"
                  checked={deptForm.requiresClearance}
                  onChange={(e) => setDeptForm({ ...deptForm, requiresClearance: e.target.checked })}
                  className="mt-0.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="requiresClearance" className="text-xs text-zinc-700 cursor-pointer">
                  <span className="font-semibold text-zinc-900">Enforce clearance requirement</span>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    When enabled, graduating students will be required to obtain sign-off from this department before receiving final NDC approval.
                  </p>
                </label>
              </div>

              {deptForm.category === 'ACADEMIC_BRANCH' && (
                <div className="p-2.5 rounded-xl bg-blue-50/70 border border-blue-200/60 text-[11px] text-blue-900 font-medium">
                  💡 Note: Creating an Academic Branch automatically provisions the unified Department Lab (<strong className="font-mono">{deptForm.code || 'CODE'}-LAB</strong>) for this branch.
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100">
                <button
                  type="button"
                  onClick={() => setAddDeptModalOpen(false)}
                  disabled={savingNewDept}
                  className="px-3.5 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingNewDept}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <span>{savingNewDept ? 'Creating...' : 'Create Department'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= ADD HOD MODAL ================= */}
      {addHodModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-2xl bg-white border border-zinc-200 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
                  <GraduationCap className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-zinc-900">Add Head of Department (HOD)</h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Provisions an HOD account with departmental approval privileges.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAddHodModalOpen(false)}
                className="text-zinc-400 hover:text-zinc-700 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveNewHod} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  HOD Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={hodForm.name}
                  onChange={(e) => setHodForm({ ...hodForm, name: e.target.value })}
                  placeholder="e.g. Dr. Ramesh Kumar"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-300 focus:outline-none focus:border-zinc-900 font-medium text-zinc-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Official Email Address *
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
                  <input
                    type="email"
                    required
                    value={hodForm.email}
                    onChange={(e) => setHodForm({ ...hodForm, email: e.target.value })}
                    placeholder="e.g. hod.aiml@mce.ac.in"
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-zinc-300 focus:outline-none focus:border-zinc-900 font-medium text-zinc-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Academic Department *
                </label>
                <select
                  required
                  value={hodForm.departmentId}
                  onChange={(e) => setHodForm({ ...hodForm, departmentId: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-300 font-semibold text-zinc-800 focus:outline-none focus:border-zinc-900"
                >
                  <option value="">-- Select Department --</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.code}) {d.isAcademicBranch ? '• Academic Branch' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Login ID (Optional)
                  </label>
                  <input
                    type="text"
                    value={hodForm.loginId}
                    onChange={(e) => setHodForm({ ...hodForm, loginId: e.target.value.toUpperCase() })}
                    placeholder="Auto-generated if blank"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-300 focus:outline-none focus:border-zinc-900 font-mono text-zinc-900 uppercase"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Initial Password *
                  </label>
                  <div className="relative">
                    <input
                      type={showHodPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={hodForm.password}
                      onChange={(e) => setHodForm({ ...hodForm, password: e.target.value })}
                      placeholder="Min 6 chars"
                      className="w-full pr-8 pl-3 py-2 text-xs rounded-xl border border-zinc-300 focus:outline-none focus:border-zinc-900 font-mono text-zinc-900"
                    />
                    <button
                      type="button"
                      onClick={() => setShowHodPassword(!showHodPassword)}
                      className="absolute right-2.5 top-2.5 text-zinc-400 hover:text-zinc-700"
                    >
                      {showHodPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-purple-50/70 border border-purple-200/60 text-[11px] text-purple-950 font-medium">
                🛡️ Permissions: An HOD account has authority to conduct final departmental verification for students enrolled in this branch and view departmental clearance analytics.
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100">
                <button
                  type="button"
                  onClick={() => setAddHodModalOpen(false)}
                  disabled={savingNewHod}
                  className="px-3.5 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingNewHod}
                  className="px-4 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <span>{savingNewHod ? 'Creating HOD...' : 'Create HOD Account'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= ADD FACULTY / OFFICER MODAL ================= */}
      {addFacultyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-2xl bg-white border border-zinc-200 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-zinc-900">Add Faculty Section / Officer</h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Provisions a Department Officer account with linked Clearance Officer mapping.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAddFacultyModalOpen(false)}
                className="text-zinc-400 hover:text-zinc-700 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveNewFaculty} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Faculty / Officer Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={facultyForm.name}
                  onChange={(e) => setFacultyForm({ ...facultyForm, name: e.target.value })}
                  placeholder="e.g. Prof. Priya S"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-300 focus:outline-none focus:border-zinc-900 font-medium text-zinc-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Official Email Address *
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
                    <input
                      type="email"
                      required
                      value={facultyForm.email}
                      onChange={(e) => setFacultyForm({ ...facultyForm, email: e.target.value })}
                      placeholder="e.g. priya.aiml@mce.ac.in"
                      className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-zinc-300 focus:outline-none focus:border-zinc-900 font-medium text-zinc-900"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Employee ID *
                  </label>
                  <input
                    type="text"
                    required
                    value={facultyForm.employeeId}
                    onChange={(e) => setFacultyForm({ ...facultyForm, employeeId: e.target.value.toUpperCase() })}
                    placeholder="e.g. EMP-AIML-01"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-300 focus:outline-none focus:border-zinc-900 font-mono font-bold uppercase text-zinc-900"
                  />
                  <p className="text-[10px] text-zinc-400 mt-0.5">Unique officer employee ID</p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Assigned Department / Section Scope *
                </label>
                <select
                  required
                  value={facultyForm.departmentId}
                  onChange={(e) => setFacultyForm({ ...facultyForm, departmentId: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-300 font-semibold text-zinc-800 focus:outline-none focus:border-zinc-900"
                >
                  <option value="">-- Select Department / Section --</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.code}) {d.isAcademicBranch ? '• Academic Branch' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Login ID (Optional)
                  </label>
                  <input
                    type="text"
                    value={facultyForm.loginId}
                    onChange={(e) => setFacultyForm({ ...facultyForm, loginId: e.target.value.toUpperCase() })}
                    placeholder="Auto-generated if blank"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-zinc-300 focus:outline-none focus:border-zinc-900 font-mono text-zinc-900 uppercase"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Initial Password *
                  </label>
                  <div className="relative">
                    <input
                      type={showFacultyPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={facultyForm.password}
                      onChange={(e) => setFacultyForm({ ...facultyForm, password: e.target.value })}
                      placeholder="Min 6 chars"
                      className="w-full pr-8 pl-3 py-2 text-xs rounded-xl border border-zinc-300 focus:outline-none focus:border-zinc-900 font-mono text-zinc-900"
                    />
                    <button
                      type="button"
                      onClick={() => setShowFacultyPassword(!showFacultyPassword)}
                      className="absolute right-2.5 top-2.5 text-zinc-400 hover:text-zinc-700"
                    >
                      {showFacultyPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200/60 text-[11px] text-emerald-950 font-medium">
                💻 Operations: This account is granted Department Officer status, bound to the selected department to inspect laboratory equipment, clear department dues, and handle student NDC clearance requests.
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100">
                <button
                  type="button"
                  onClick={() => setAddFacultyModalOpen(false)}
                  disabled={savingNewFaculty}
                  className="px-3.5 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingNewFaculty}
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  <span>{savingNewFaculty ? 'Creating Faculty...' : 'Create Faculty Account'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

