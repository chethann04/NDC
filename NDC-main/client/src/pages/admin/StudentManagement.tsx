import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { useAuthStore } from '../../store/useAuthStore';
import { clientCache } from '../../utils/clientCache';
import { extractDepartmentFromUsn, getDepartmentCodeFromUsn } from '../../constants/usnDepartmentMap';
import { Search, UserPlus, Edit, Trash2, BookOpen, Mail, Phone, Building, Eye, X, ChevronLeft, ChevronRight, Calendar, AlertTriangle, Archive, RotateCcw } from 'lucide-react';
import { ErrorAlert } from '../../components/ErrorAlert';
import { showErrorModal } from '../../store/useErrorModalStore';

export const StudentManagement: React.FC = () => {
  const { user } = useAuthStore();
  const cachedStudents = clientCache.get<any>('admin_students_list');
  const [students, setStudents] = useState<any[]>(() => cachedStudents?.data || []);
  const [departments, setDepartments] = useState<any[]>(() => clientCache.get<any[]>('departments_list') || []);
  const [loading, setLoading] = useState(!cachedStudents);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');

  const officerDeptObj = user?.officerProfile?.departmentIds?.[0] as any;
  const deptObj = user?.departmentId as any;
  const isCashFeeOfficer =
    user?.role === 'DEPARTMENT_OFFICER' &&
    (user?.email?.startsWith('cashfee') ||
      user?.email === 'accounts@mce.ac.in' ||
      officerDeptObj?.code === 'ACC' ||
      officerDeptObj?.name === 'Cash/Fee Section' ||
      deptObj?.code === 'ACC' ||
      deptObj?.name === 'Cash/Fee Section' ||
      officerDeptObj?.name?.includes('Fee') ||
      officerDeptObj?.name?.includes('Cash') ||
      (typeof deptObj === 'object' && (deptObj?.name?.includes('Fee') || deptObj?.name?.includes('Cash'))));

  // Pagination State
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [pagination, setPagination] = useState(() => cachedStudents?.pagination || { total: 0, totalPages: 1 });

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<any>(null);
  const [formData, setFormData] = useState({
    usn: '',
    fullName: '',
    email: '',
    phone: '',
    departmentId: '',
    section: 'A',
    batch: '2022-2026',
    academicYear: '2025-2026',
    semester: '8th Semester',
    year: '4th Year',
    admissionYear: '2022',
    graduationYear: '2026',
    remarks: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<any>(null);

  // Batch Update Modal State
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [newBatchYear, setNewBatchYear] = useState('2024-2028');
  const [batchUpdateAll, setBatchUpdateAll] = useState(false);
  const [batchUpdating, setBatchUpdating] = useState(false);

  // Single Student Delete Modal State
  const [studentToDelete, setStudentToDelete] = useState<any>(null);
  const [singleDeleteRemarks, setSingleDeleteRemarks] = useState('');
  const [singleDeleting, setSingleDeleting] = useState(false);
  const [deleteCertError, setDeleteCertError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  // Drawer State
  const [drawerStudent, setDrawerStudent] = useState<any>(null);

  // Bulk Selection & Delete State
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);
  const [isDeleteAllMode, setIsDeleteAllMode] = useState(false);
  const [bulkDeleteRemarks, setBulkDeleteRemarks] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);

  useEffect(() => {
    fetchDepartments();
  }, []);

  // Debounce search input by 300ms to avoid flooding backend on keystrokes
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    fetchStudents(!cachedStudents);
  }, [debouncedSearch, deptFilter, page, limit]);

  const fetchDepartments = async () => {
    try {
      const cached = clientCache.get<any[]>('departments_list');
      if (cached && cached.length > 0) {
        setDepartments(cached);
        return;
      }
      const res = await api.get('/departments');
      const data = res.data.data;
      setDepartments(data);
      clientCache.set('departments_list', data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchStudents = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await api.get('/students', {
        params: { search: debouncedSearch, departmentId: deptFilter, page, limit }
      });
      setStudents(res.data.data);
      if (!debouncedSearch && !deptFilter && page === 1) {
        clientCache.set('admin_students_list', {
          data: res.data.data,
          pagination: res.data.pagination
        });
      }
      if (res.data.pagination) {
        setPagination({
          total: res.data.pagination.total,
          totalPages: res.data.pagination.totalPages || 1
        });
      } else {
        setPagination({ total: res.data.data.length, totalPages: 1 });
      }
      setSelectedIds([]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSelectAll = () => {
    if (selectedIds.length === students.length && students.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(students.map((s) => s._id));
    }
  };

  const handleToggleSelectRow = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((item) => item !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleExecuteBulkDelete = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!bulkDeleteRemarks.trim()) {
      showErrorModal({
        title: 'Remarks required',
        message: 'Please provide an explanatory remark before deleting these student records.'
      });
      return;
    }

    setBulkDeleting(true);
    try {
      const payload: any = { remarks: bulkDeleteRemarks.trim() };
      if (isDeleteAllMode) {
        payload.deleteAll = true;
      } else {
        payload.studentIds = selectedIds;
      }
      await api.post('/students/bulk-delete', payload);
      setIsBulkDeleteModalOpen(false);
      setBulkDeleteRemarks('');
      setSelectedIds([]);
      await fetchStudents();
    } catch (err: any) {
      showErrorModal(err, { title: 'Bulk Deletion Failed' });
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleExecuteBatchUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBatchYear.trim()) {
      showErrorModal({
        title: 'Invalid batch year',
        message: 'Please enter a valid four-year batch range such as 2024-2028.'
      });
      return;
    }

    setBatchUpdating(true);
    try {
      await api.post('/students/bulk-batch', {
        studentIds: selectedIds,
        updateAll: batchUpdateAll,
        batch: newBatchYear.trim()
      });
      setIsBatchModalOpen(false);
      setSelectedIds([]);
      await fetchStudents();
    } catch (err: any) {
      showErrorModal(err, { title: 'Batch Update Failed' });
    } finally {
      setBatchUpdating(false);
    }
  };

  const handleOpenModal = (student: any = null) => {
    const academicDepts = departments.filter((d) => d.isAcademicBranch);
    const defaultDept = academicDepts[0] || departments[0];

    if (student) {
      setEditingStudent(student);
      setFormData({
        usn: student.usn,
        fullName: student.fullName,
        email: student.email || '',
        phone: student.phone || '',
        departmentId: student.departmentId?._id || student.departmentId?.id || student.departmentId || defaultDept?._id || defaultDept?.id || '',
        section: student.section || 'A',
        batch: student.batch || '2022-2026',
        academicYear: student.academicYear || '2025-2026',
        semester: student.semester || '8th Semester',
        year: student.year || '4th Year',
        admissionYear: String(student.admissionYear || '2022'),
        graduationYear: String(student.graduationYear || '2026'),
        remarks: student.remarks || ''
      });
    } else {
      setEditingStudent(null);
      setFormData({
        usn: '',
        fullName: '',
        email: '',
        phone: '',
        departmentId: defaultDept?._id || defaultDept?.id || '',
        section: 'A',
        batch: '2024-2028',
        academicYear: '2025-2026',
        semester: '8th Semester',
        year: '4th Year',
        admissionYear: '2024',
        graduationYear: '2028',
        remarks: ''
      });
    }
    setModalError('');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');

    if (!editingStudent && !formData.remarks.trim()) {
      setModalError('Remarks are compulsory when adding a student.');
      return;
    }

    setSubmitting(true);

    try {
      if (editingStudent) {
        await api.put(`/students/${editingStudent._id}`, formData);
      } else {
        await api.post('/students', formData);
      }

      clientCache.invalidate('admin_dashboard');
      setIsModalOpen(false);
      await fetchStudents();
    } catch (err: any) {
      setModalError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenDeleteModal = (student: any) => {
    setStudentToDelete(student);
    setSingleDeleteRemarks('');
    setDeleteCertError(null);
  };

  const handleArchiveStudent = async (student: any) => {
    const targetStudent = student || studentToDelete;
    if (!targetStudent?._id) return;
    setArchiving(true);
    try {
      await api.put(`/students/${targetStudent._id}/deactivate`);
      clientCache.invalidate('admin_dashboard');
      setStudentToDelete(null);
      setDeleteCertError(null);
      await fetchStudents();
    } catch (err: any) {
      showErrorModal(err, { title: 'Student Archival Failed' });
    } finally {
      setArchiving(false);
    }
  };

  const handleReactivateStudent = async (student: any) => {
    if (!student?._id) return;
    try {
      await api.put(`/students/${student._id}/reactivate`);
      clientCache.invalidate('admin_dashboard');
      await fetchStudents();
    } catch (err: any) {
      showErrorModal(err, { title: 'Student Reactivation Failed' });
    }
  };

  const handleExecuteSingleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!singleDeleteRemarks.trim()) {
      showErrorModal({
        title: 'Remarks required',
        message: 'Please provide an explanatory remark before deleting this student profile.'
      });
      return;
    }

    setSingleDeleting(true);
    setDeleteCertError(null);
    try {
      await api.delete(`/students/${studentToDelete._id}`, {
        data: { remarks: singleDeleteRemarks.trim() },
        params: { remarks: singleDeleteRemarks.trim() }
      });
      clientCache.invalidate('admin_dashboard');
      setStudentToDelete(null);
      setSingleDeleteRemarks('');
      await fetchStudents();
    } catch (err: any) {
      if (err.response?.data?.code === 'CERTIFICATE_EXISTS') {
        setDeleteCertError(
          err.response.data.message ||
          'Student cannot be deleted because an NDC certificate is associated with this student. Deactivate or archive the student instead.'
        );
      } else {
        showErrorModal(err, { title: 'Student Deletion Failed' });
      }
    } finally {
      setSingleDeleting(false);
    }
  };

  // Helper to render page number buttons 1 2 3 4 ... 50
  const renderPageNumbers = () => {
    const totalPages = pagination.totalPages || 1;
    const pages: (number | string)[] = [];

    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push('...');
      const start = Math.max(2, page - 1);
      const end = Math.min(totalPages - 1, page + 1);
      for (let i = start; i <= end; i++) {
        if (!pages.includes(i)) pages.push(i);
      }
      if (page < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }

    return pages.map((p, idx) => {
      if (p === '...') {
        return <span key={`ellipsis-${idx}`} className="px-1 text-slate-400 font-bold">...</span>;
      }
      const isCurrent = page === p;
      return (
        <button
          key={`page-${p}`}
          onClick={() => setPage(Number(p))}
          className="page-btn"
          style={isCurrent ? { backgroundColor: 'var(--cobalt-600)', color: '#ffffff', borderColor: 'var(--cobalt-600)', fontWeight: 'bold' } : {}}
        >
          {p}
        </button>
      );
    });
  };

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="section-head">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="page-title">Students</h1>
            {isCashFeeOfficer && (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 uppercase tracking-wider">
                Cash/Fee Section
              </span>
            )}
          </div>
          <p className="caption-text mt-1">
            {isCashFeeOfficer
              ? 'Manage fee clearance registrations, add single student entries, and remove records with compulsory audit remarks'
              : 'Manage student master profiles, batch assignments, and department accounts'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {students.length > 0 && (
            <>
              <button
                onClick={() => {
                  setBatchUpdateAll(true);
                  setIsBatchModalOpen(true);
                }}
                className="btn btn-secondary text-blue-700 border-blue-200 hover:bg-blue-50"
              >
                <Calendar className="w-3.5 h-3.5" />
                Change Batch for All ({pagination.total || students.length})
              </button>
              <button
                onClick={() => {
                  setIsDeleteAllMode(true);
                  setBulkDeleteRemarks('');
                  setIsBulkDeleteModalOpen(true);
                }}
                className="btn btn-secondary text-rose-600 border-rose-200 hover:bg-rose-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete All ({pagination.total || students.length})
              </button>
            </>
          )}
          <button onClick={() => handleOpenModal()} className="btn btn-primary">
            <UserPlus className="w-3.5 h-3.5" />
            Add Single Student
          </button>
        </div>
      </div>

      {/* Bulk Action Banner */}
      {selectedIds.length > 0 && (
        <div className="p-3 bg-slate-900 text-white rounded-xl shadow-md flex items-center justify-between text-xs font-semibold">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
            <span>{selectedIds.length} Student{selectedIds.length > 1 ? 's' : ''} Selected</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setBatchUpdateAll(false);
                setIsBatchModalOpen(true);
              }}
              className="btn btn-primary btn-compact"
            >
              <Calendar className="w-3.5 h-3.5" />
              Set Batch for Selected ({selectedIds.length})
            </button>
            <button
              onClick={() => {
                setIsDeleteAllMode(false);
                setBulkDeleteRemarks('');
                setIsBulkDeleteModalOpen(true);
              }}
              className="btn btn-danger btn-compact"
            >
              Delete Selected ({selectedIds.length})
            </button>
            <button onClick={() => setSelectedIds([])} className="text-slate-400 hover:text-white underline ml-2">
              Deselect All
            </button>
          </div>
        </div>
      )}

      {/* Table Container */}
      <div className="table-wrap">
        <div className="filter-bar">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search USN, student name, or email…"
              className="input pl-9 text-xs"
            />
          </div>

          {/* Department Filter */}
          <select
            value={deptFilter}
            onChange={(e) => {
              setDeptFilter(e.target.value);
              setPage(1);
            }}
            className="select w-56 text-xs font-semibold"
          >
            <option value="">All Academic Departments</option>
            {departments.map((d) => (
              <option key={d._id} value={d._id}>{d.name} ({d.code})</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-500 font-semibold">Loading student records...</div>
        ) : students.length === 0 ? (
          <div className="p-12 text-center text-slate-500 font-semibold">No student records found.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th className="w-10">
                      <input
                        type="checkbox"
                        checked={selectedIds.length === students.length && students.length > 0}
                        onChange={handleToggleSelectAll}
                        className="checkbox"
                      />
                    </th>
                    <th>Student</th>
                    <th>USN</th>
                    <th>Department</th>
                    <th>Batch</th>
                    <th>Contact</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => {
                    const isSelected = selectedIds.includes(student._id);
                    const nameInitials = student.fullName.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase();
                    return (
                      <tr key={student._id} className={isSelected ? 'selected' : ''}>
                        <td>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelectRow(student._id)}
                            className="checkbox"
                          />
                        </td>
                        <td>
                          <div className="name-cell">
                            <div className={`avatar-sm ${!student.isActive ? 'opacity-60' : ''}`}>{nameInitials}</div>
                            <div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className={`cell-primary ${!student.isActive ? 'text-slate-500 line-through' : ''}`}>
                                  {student.fullName}
                                </span>
                                {!student.isActive && (
                                  <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-50 text-amber-700 rounded border border-amber-300">
                                    Archived
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="mono-text font-bold text-blue-700">{student.usn}</td>
                        <td>{student.departmentId?.name || 'N/A'}</td>
                        <td>
                          <span className="mono-text font-semibold px-2 py-0.5 bg-slate-100 rounded text-slate-800 border border-slate-200">
                            {student.batch}
                          </span>
                        </td>
                        <td>
                          <div>{student.email}</div>
                          <div className="caption-text">{student.phone}</div>
                        </td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setDrawerStudent(student)}
                              className="btn-icon"
                              title="View Student Details"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleOpenModal(student)}
                              className="btn-icon"
                              title="Edit Student Profile / Change Batch"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            {student.isActive ? (
                              <button
                                onClick={() => handleArchiveStudent(student)}
                                className="btn-icon text-amber-600 hover:bg-amber-50"
                                title="Archive / Deactivate Student"
                              >
                                <Archive className="w-4 h-4" />
                              </button>
                            ) : (
                              <button
                                onClick={() => handleReactivateStudent(student)}
                                className="btn-icon text-emerald-600 hover:bg-emerald-50"
                                title="Reactivate Student"
                              >
                                <RotateCcw className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleOpenDeleteModal(student)}
                              className="btn-icon text-rose-600 hover:bg-rose-50"
                              title="Delete Student"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Numbered Page Buttons Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 border-t border-slate-200 text-xs">
              <div className="flex items-center gap-2">
                <span className="caption-text">Rows per page:</span>
                <select
                  value={limit}
                  onChange={(e) => {
                    setLimit(Number(e.target.value));
                    setPage(1);
                  }}
                  className="input !w-32 h-8 font-semibold text-xs py-0"
                >
                  <option value={20}>20 per page</option>
                  <option value={50}>50 per page</option>
                  <option value={100}>100 per page</option>
                  <option value={500}>500 per page</option>
                  <option value={1000}>Show All (1000)</option>
                </select>

                <span className="mono-text text-slate-500 ml-2">
                  {pagination.total > 0
                    ? `${(page - 1) * limit + 1}–${Math.min(page * limit, pagination.total)} of ${pagination.total}`
                    : '0 of 0'}
                </span>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="page-btn"
                  title="Previous Page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                {/* Direct Numbered Page Buttons: 1 2 3 4 ... 50 */}
                {renderPageNumbers()}

                <button
                  onClick={() => setPage((p) => Math.min(pagination.totalPages || 1, p + 1))}
                  disabled={page >= (pagination.totalPages || 1)}
                  className="page-btn"
                  title="Next Page"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Student Details Slide-out Drawer */}
      {drawerStudent && (
        <>
          <div className="drawer-scrim" onClick={() => setDrawerStudent(null)} />
          <div className="drawer-panel">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="avatar w-10 h-10 text-sm font-bold">
                  {drawerStudent.fullName.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()}
                </div>
                <div>
                  <h3 className="h2-title">{drawerStudent.fullName}</h3>
                  <p className="mono-text caption-text text-blue-600">{drawerStudent.usn}</p>
                </div>
              </div>
              <button onClick={() => setDrawerStudent(null)} className="btn-icon">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
              <div className="bg-slate-50 p-4 rounded-xl space-y-2 border border-slate-200">
                <div className="kv-row"><span className="muted">Department:</span><span className="font-bold text-slate-900">{drawerStudent.departmentId?.name}</span></div>
                <div className="kv-row"><span className="muted">Batch Year:</span><span className="mono-text font-bold text-blue-700">{drawerStudent.batch}</span></div>
                <div className="kv-row"><span className="muted">Email:</span><span className="font-medium text-slate-700">{drawerStudent.email}</span></div>
                <div className="kv-row"><span className="muted">Phone:</span><span className="mono-text">{drawerStudent.phone}</span></div>
                <div className="kv-row"><span className="muted">Section / Sem:</span><span className="font-medium">{drawerStudent.section} / {drawerStudent.semester}</span></div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100">
              <button onClick={() => setDrawerStudent(null)} className="btn btn-secondary w-full justify-center">
                Close Drawer
              </button>
            </div>
          </div>
        </>
      )}

      {/* Edit / Add Modal with Free Custom Batch Year Entry */}
      {isModalOpen && (
        <>
          <div className="drawer-scrim" onClick={() => setIsModalOpen(false)} />
          <div className="modal open">
            <div className="modal-header">
              <h3 className="h2-title">{editingStudent ? 'Edit Student Profile' : 'Add New Student'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="btn-icon">
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalError && (
              <div className="px-5 pt-3">
                <ErrorAlert
                  error={modalError}
                  onDismiss={() => setModalError(null)}
                  title="Student Profile Issue"
                />
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="modal-body space-y-3">
                <div>
                  <label className="field-label">USN *</label>
                  <input
                    type="text"
                    value={formData.usn}
                    onChange={(e) => {
                      const newUsn = e.target.value.toUpperCase();
                      const resolvedCode = getDepartmentCodeFromUsn(newUsn);
                      let newDeptId = formData.departmentId;

                      if (resolvedCode) {
                        const matchedDept = departments.find((d) => {
                          const code = (d.code || '').toUpperCase();
                          if (code === resolvedCode) return true;
                          if (resolvedCode === 'AI' && (code === 'AI' || code === 'AIML')) return true;
                          return false;
                        });
                        if (matchedDept) {
                          newDeptId = matchedDept._id || matchedDept.id;
                        }
                      }

                      // Auto-sync batch from 2-digit admission year in USN (e.g. 4MC22CS001 -> 2022-2026)
                      const yearMatch = newUsn.match(/\d{1,3}(\d{2})[A-Z]/);
                      let autoBatch = formData.batch;
                      let autoAdmYear = formData.admissionYear;
                      let autoGradYear = formData.graduationYear;
                      if (yearMatch && yearMatch[1] && !editingStudent) {
                        const yrNum = 2000 + parseInt(yearMatch[1], 10);
                        if (yrNum >= 2018 && yrNum <= 2035) {
                          autoAdmYear = String(yrNum);
                          autoGradYear = String(yrNum + 4);
                          autoBatch = `${yrNum}-${yrNum + 4}`;
                        }
                      }

                      setFormData((prev) => ({
                        ...prev,
                        usn: newUsn,
                        ...(resolvedCode && newDeptId ? { departmentId: newDeptId } : {}),
                        batch: autoBatch,
                        admissionYear: autoAdmYear,
                        graduationYear: autoGradYear
                      }));
                    }}
                    placeholder="4MC22CS001"
                    required
                    className="input mono-text font-bold"
                  />
                </div>

                <div>
                  <label className="field-label">Full Name *</label>
                  <input
                    type="text"
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    placeholder="Student Full Name"
                    required
                    className="input"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="field-label">Batch Year *</label>
                    <input
                      type="text"
                      value={formData.batch}
                      onChange={(e) => setFormData({ ...formData, batch: e.target.value })}
                      placeholder="e.g. 2024-2028"
                      required
                      className="input mono-text font-bold"
                    />
                  </div>

                  <div>
                    <label className="field-label">Academic Year</label>
                    <input
                      type="text"
                      value={formData.academicYear}
                      onChange={(e) => setFormData({ ...formData, academicYear: e.target.value })}
                      placeholder="e.g. 2026-2027"
                      className="input font-medium"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="field-label">Email Address *</label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="student@mce.ac.in"
                      required
                      className="input"
                    />
                  </div>

                  <div>
                    <label className="field-label">Phone Number</label>
                    <input
                      type="text"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="9876543210"
                      className="input"
                    />
                  </div>
                </div>

                <div>
                  <label className="field-label">Department *</label>
                  <select
                    value={formData.departmentId}
                    onChange={(e) => setFormData({ ...formData, departmentId: e.target.value })}
                    required
                    className="input font-semibold"
                  >
                    <optgroup label="Academic Branches">
                      {departments.filter((d) => d.isAcademicBranch).map((d) => (
                        <option key={d._id || d.id} value={d._id || d.id}>
                          {d.name} ({d.code})
                        </option>
                      ))}
                    </optgroup>
                    {departments.some((d) => !d.isAcademicBranch) && (
                      <optgroup label="Other Sections">
                        {departments.filter((d) => !d.isAcademicBranch && d.code !== 'ADM' && d.code !== 'LAB').map((d) => (
                          <option key={d._id || d.id} value={d._id || d.id}>
                            {d.name} ({d.code})
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>

                <div>
                  <label className="field-label">
                    Remarks / Admission Reason {!editingStudent && <span className="text-rose-600 font-bold">* (Compulsory)</span>}
                  </label>
                  <textarea
                    value={formData.remarks}
                    onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                    placeholder="Enter compulsory remarks (e.g., Fee clearance approved, manual admission entry, transfer case)..."
                    required={!editingStudent}
                    rows={2}
                    className="input font-medium text-xs resize-none"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Remarks are compulsory and logged in the immutable system audit trail.
                  </p>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" onClick={() => setIsModalOpen(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="btn btn-primary">
                  {submitting ? 'Saving...' : editingStudent ? 'Update Profile' : 'Create Student'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* Change Batch Year Modal */}
      {isBatchModalOpen && (
        <>
          <div className="drawer-scrim" onClick={() => setIsBatchModalOpen(false)} />
          <div className="modal open">
            <div className="modal-header">
              <h3 className="h2-title">Change Batch Year</h3>
              <button onClick={() => setIsBatchModalOpen(false)} className="btn-icon">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleExecuteBatchUpdate}>
              <div className="modal-body space-y-4">
                <p className="text-xs text-slate-600">
                  {batchUpdateAll
                    ? `Assign a new batch year to ALL ${pagination.total || students.length} students in the database:`
                    : `Assign a new batch year to the ${selectedIds.length} selected students:`}
                </p>

                <div>
                  <label className="field-label">New Batch Year (e.g. 2024-2028, 2023-2027) *</label>
                  <input
                    type="text"
                    value={newBatchYear}
                    onChange={(e) => setNewBatchYear(e.target.value)}
                    placeholder="e.g. 2024-2028"
                    required
                    className="input mono-text font-bold text-blue-700"
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" onClick={() => setIsBatchModalOpen(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={batchUpdating} className="btn btn-primary">
                  {batchUpdating ? 'Updating...' : 'Apply Batch Year'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* Single Student Delete Confirmation Modal with Compulsory Remarks */}
      {studentToDelete && (
        <>
          <div className="drawer-scrim" onClick={() => !singleDeleting && !archiving && setStudentToDelete(null)} />
          <div className="modal open max-w-md">
            <div className="modal-header">
              <h3 className="h2-title text-rose-600 flex items-center gap-2">
                <Trash2 className="w-4 h-4" />
                Confirm Student Deletion
              </h3>
              <button onClick={() => !singleDeleting && !archiving && setStudentToDelete(null)} className="btn-icon">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleExecuteSingleDelete}>
              <div className="modal-body space-y-3.5">
                <div className="p-3 bg-rose-50/70 border border-rose-200 rounded-xl text-xs space-y-1">
                  <div className="font-bold text-rose-900">
                    {studentToDelete.fullName} ({studentToDelete.usn})
                  </div>
                  <div className="text-rose-700">
                    Dept: {studentToDelete.departmentId?.name || studentToDelete.departmentName || 'N/A'} • Batch: {studentToDelete.batch}
                  </div>
                  <div className="text-[11px] text-rose-600 mt-1 font-medium">
                    ⚠️ Warning: Deleting this student will permanently erase their profile and associated login accounts.
                  </div>
                </div>

                {deleteCertError && (
                  <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl space-y-2.5">
                    <div className="flex items-start gap-2 text-amber-900 text-xs font-semibold">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <span>{deleteCertError}</span>
                    </div>
                    <button
                      type="button"
                      disabled={archiving}
                      onClick={() => handleArchiveStudent(studentToDelete)}
                      className="btn btn-warning w-full text-xs font-bold py-2 shadow-sm flex items-center justify-center gap-1.5"
                    >
                      <Archive className="w-4 h-4" />
                      {archiving ? 'Archiving...' : 'Deactivate / Archive Student Instead'}
                    </button>
                  </div>
                )}

                {!deleteCertError && (
                  <div>
                    <label className="field-label text-slate-800">
                      Compulsory Remarks / Reason for Deletion <span className="text-rose-600 font-bold">*</span>
                    </label>
                    <textarea
                      value={singleDeleteRemarks}
                      onChange={(e) => setSingleDeleteRemarks(e.target.value)}
                      placeholder="Please provide the mandatory reason for deleting this student (e.g., Admission cancelled, transferred, duplicate record)..."
                      required
                      rows={3}
                      className="input text-xs font-medium resize-none border-rose-200 focus:border-rose-500 focus:ring-rose-500"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      Remarks are mandatory and will be recorded in the immutable audit trail.
                    </p>
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  disabled={singleDeleting || archiving}
                  onClick={() => setStudentToDelete(null)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                {!deleteCertError && (
                  <button
                    type="submit"
                    disabled={singleDeleting || !singleDeleteRemarks.trim()}
                    className="btn btn-danger"
                  >
                    {singleDeleting ? 'Deleting...' : 'Delete Student'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </>
      )}

      {/* Bulk Delete Confirmation Modal with Compulsory Remarks */}
      {isBulkDeleteModalOpen && (
        <>
          <div className="drawer-scrim" onClick={() => !bulkDeleting && setIsBulkDeleteModalOpen(false)} />
          <div className="modal open max-w-md">
            <div className="modal-header">
              <h3 className="h2-title text-rose-600 flex items-center gap-2">
                <Trash2 className="w-4 h-4" />
                Confirm Bulk Deletion
              </h3>
              <button onClick={() => !bulkDeleting && setIsBulkDeleteModalOpen(false)} className="btn-icon">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleExecuteBulkDelete}>
              <div className="modal-body space-y-3.5 text-xs text-slate-700">
                <div className="p-3 bg-rose-50/70 border border-rose-200 rounded-xl space-y-1">
                  {isDeleteAllMode ? (
                    <p className="font-bold text-rose-900">
                      Are you sure you want to delete ALL {pagination.total || students.length} student records from the database? This action is irreversible.
                    </p>
                  ) : (
                    <p className="font-bold text-rose-900">
                      Are you sure you want to delete {selectedIds.length} selected student profiles?
                    </p>
                  )}
                  <p className="text-[11px] text-rose-600 font-medium">
                    This will permanently delete students and their associated system login accounts.
                  </p>
                </div>

                <div>
                  <label className="field-label text-slate-800">
                    Compulsory Remarks / Reason for Bulk Deletion <span className="text-rose-600 font-bold">*</span>
                  </label>
                  <textarea
                    value={bulkDeleteRemarks}
                    onChange={(e) => setBulkDeleteRemarks(e.target.value)}
                    placeholder="Enter compulsory remarks for deleting the selected student records (e.g., Discontinued admissions batch, duplicate import rollback)..."
                    required
                    rows={3}
                    className="input text-xs font-medium resize-none border-rose-200 focus:border-rose-500 focus:ring-rose-500"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Remarks are mandatory and will be recorded in the immutable audit trail.
                  </p>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  disabled={bulkDeleting}
                  onClick={() => setIsBulkDeleteModalOpen(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={bulkDeleting || !bulkDeleteRemarks.trim()}
                  className="btn btn-danger"
                >
                  {bulkDeleting ? 'Deleting...' : 'Confirm Bulk Delete'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
};
