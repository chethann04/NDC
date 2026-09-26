import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { ClearanceStatusBadge } from '../../components/ClearanceStatusBadge';
import { showErrorModal } from '../../store/useErrorModalStore';
import { useAuthStore } from '../../store/useAuthStore';
import {
  Users,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Award,
  Search,
  Download,
  Eye,
  X,
  Laptop,
  RefreshCw,
  UserCheck,
  ChevronDown,
  Check,
  GraduationCap,
  Building2
} from 'lucide-react';

export const TeachingDepartmentView: React.FC = () => {
  const { user } = useAuthStore();
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('ALL');
  const [search, setSearch] = useState('');
  const [batchFilter, setBatchFilter] = useState('');
  const [dueDeptFilter, setDueDeptFilter] = useState('');
  const [selectedDeptId, setSelectedDeptId] = useState<string>('');

  // Dropdown open states
  const [isBranchOpen, setIsBranchOpen] = useState(false);
  const [isBatchOpen, setIsBatchOpen] = useState(false);
  const branchMenuRef = React.useRef<HTMLDivElement>(null);
  const batchMenuRef = React.useRef<HTMLDivElement>(null);

  // Pagination state
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });

  // Drawer States
  const [selectedStudentDues, setSelectedStudentDues] = useState<any>(null);
  const [duesLoading, setDuesLoading] = useState(false);

  const [selectedStudentDetail, setSelectedStudentDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Natural USN sorting: older series (e.g. 2021 before 2022) and roll numbers in ascending order
  const sortedStudents = React.useMemo(() => {
    return [...students].sort((a, b) => {
      const usnA = (a.usn || '').trim().toUpperCase();
      const usnB = (b.usn || '').trim().toUpperCase();
      return usnA.localeCompare(usnB, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [students]);

  const fetchDashboard = async (targetDeptId?: string) => {
    try {
      const deptToFetch = targetDeptId !== undefined ? targetDeptId : selectedDeptId;
      const res = await api.get('/teaching-department/dashboard', {
        params: { departmentId: deptToFetch || undefined }
      });
      setDashboardData(res.data.data);
      if (res.data.data?.department?.id && !selectedDeptId) {
        setSelectedDeptId(res.data.data.department.id);
      }
    } catch (err) {
      console.error('Error fetching teaching department dashboard:', err);
    }
  };

  const fetchStudents = async (page = 1, targetDeptId?: string) => {
    setLoading(true);
    try {
      const deptToFetch = targetDeptId !== undefined ? targetDeptId : selectedDeptId;
      const res = await api.get('/teaching-department/students', {
        params: {
          page,
          limit: 20,
          status: activeTab === 'ALL' ? '' : activeTab,
          search: search.trim() || undefined,
          batch: batchFilter || undefined,
          dueDepartment: dueDeptFilter || undefined,
          departmentId: deptToFetch || undefined
        }
      });
      setStudents(res.data.data || []);
      setPagination(
        res.data.pagination || { page, totalPages: 1, total: res.data.data?.length || 0 }
      );
    } catch (err) {
      console.error('Error fetching teaching department students:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (branchMenuRef.current && !branchMenuRef.current.contains(e.target as Node)) {
        setIsBranchOpen(false);
      }
      if (batchMenuRef.current && !batchMenuRef.current.contains(e.target as Node)) {
        setIsBatchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const handler = setTimeout(() => {
      fetchStudents(1);
    }, 250);
    return () => clearTimeout(handler);
  }, [activeTab, search, batchFilter, dueDeptFilter, selectedDeptId]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchDashboard(selectedDeptId), fetchStudents(pagination.page, selectedDeptId)]);
    } finally {
      setRefreshing(false);
    }
  };

  const handleBranchChange = (newDeptId: string) => {
    setSelectedDeptId(newDeptId);
    setBatchFilter('');
    fetchDashboard(newDeptId);
    fetchStudents(1, newDeptId);
  };

  const handleOpenDuesModal = async (student: any) => {
    setDuesLoading(true);
    try {
      const res = await api.get(`/teaching-department/students/${student._id}/dues`);
      setSelectedStudentDues(res.data);
    } catch (err: any) {
      showErrorModal(err, { title: 'Failed to Load Dues' });
    } finally {
      setDuesLoading(false);
    }
  };

  const handleOpenDetailModal = async (student: any) => {
    setDetailLoading(true);
    try {
      const res = await api.get(`/teaching-department/students/${student._id}`);
      setSelectedStudentDetail(res.data.data);
    } catch (err: any) {
      showErrorModal(err, { title: 'Failed to Load Student Record' });
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDownloadCertificate = (certId: string, certNo: string) => {
    if (!certId) return;
    const token = localStorage.getItem('ndc_token') || '';
    const downloadUrl = `${api.defaults.baseURL}/teaching-department/certificates/${certId}/download?token=${token}`;
    window.open(downloadUrl, '_blank');
  };

  const { department, statistics, allBranches = [] } = dashboardData || {};
  const deptName = department?.name || 'Department';
  const deptCode = department?.code || 'DEPT';
  const effectiveHod = department?.hodName || (user?.role === 'HOD' ? user?.name : 'Head of the Department');
  const hodDesignation = department?.hodDesignation || 'Head of the Department';

  return (
    <div className="space-y-6">
      {/* Top Banner (Faithful to Image 1, personalized dynamically for each individual branch) */}
      <div className="bg-gradient-to-r from-indigo-950 via-slate-900 to-blue-950 rounded-2xl p-6 text-white shadow-md relative overflow-hidden border border-indigo-900/40">
        <div className="absolute right-0 top-0 translate-x-8 -translate-y-8 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center shrink-0 text-indigo-300 shadow-inner">
              <Laptop className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-indigo-400/20 text-indigo-200 border border-indigo-300/30 uppercase tracking-wider">
                  {deptCode}-LAB DESK
                </span>
                <span className="text-xs text-indigo-200/90 font-medium">Department Faculty Scope</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white mt-1">
                {deptName} — Department Lab Clearance
              </h1>
              <p className="text-xs sm:text-sm text-indigo-100/90 mt-1 max-w-2xl leading-relaxed">
                Independent clearance for Department Computing & Hardware Laboratory equipment, project development kits, lab manuals, and asset handovers for students of {deptName}.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0 self-end md:self-center">
            {allBranches && allBranches.length > 1 && (
              <div className="relative" ref={branchMenuRef}>
                <button
                  type="button"
                  onClick={() => setIsBranchOpen(!isBranchOpen)}
                  className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold backdrop-blur-sm border border-white/15 transition-all flex items-center gap-2 cursor-pointer shadow-xs"
                  title="Switch Academic Branch (Admin)"
                >
                  <Building2 className="w-3.5 h-3.5 text-indigo-300" />
                  <span>
                    {allBranches.find((b: any) => b.id === (selectedDeptId || department?.id))?.code || deptCode} — {allBranches.find((b: any) => b.id === (selectedDeptId || department?.id))?.name || deptName}
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 text-indigo-300 transition-transform duration-200 ${isBranchOpen ? 'rotate-180' : ''}`} />
                </button>

                {isBranchOpen && (
                  <div className="absolute right-0 mt-2 w-72 bg-slate-900/95 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-150 max-h-80 overflow-y-auto">
                    <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-indigo-300/70 border-b border-white/10">
                      Switch Academic Branch
                    </div>
                    <div className="pt-1 space-y-0.5">
                      {allBranches.map((b: any) => {
                        const isSelected = (selectedDeptId || department?.id) === b.id;
                        return (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => {
                              handleBranchChange(b.id);
                              setIsBranchOpen(false);
                            }}
                            className={`w-full px-3 py-2 text-xs flex items-center justify-between text-left rounded-xl transition-all cursor-pointer ${
                              isSelected ? 'bg-indigo-600 text-white font-bold' : 'text-slate-200 hover:bg-white/10'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="px-1.5 py-0.5 rounded font-mono text-[10px] font-bold bg-white/15 text-indigo-200 shrink-0">
                                {b.code}
                              </span>
                              <span className="truncate">{b.name}</span>
                            </div>
                            {isSelected && <Check className="w-3.5 h-3.5 text-white shrink-0 ml-2" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={handleRefresh}
              disabled={loading || refreshing}
              className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold backdrop-blur-sm border border-white/15 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading || refreshing ? 'animate-spin' : ''}`} />
              <span>Refresh Records</span>
            </button>
          </div>
        </div>

        {/* Head of Department Info Strip */}
        <div className="relative z-10 mt-5 pt-3 border-t border-white/10 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-300/70">
            Head of Department:
          </span>
          <div className="text-white font-bold text-xs sm:text-sm flex items-center gap-1.5">
            <UserCheck className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>{effectiveHod}</span>
          </div>
          <span className="text-[11px] text-indigo-200/70 hidden sm:inline">
            ({hodDesignation})
          </span>
        </div>
      </div>

      {/* 5 Fraunces Display Stat Cards in Single Line (Faithful to Image 2) */}
      <div className="stat-row-5">
        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--cobalt-50)', color: 'var(--cobalt-600)' }}>
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg">{statistics?.totalStudents || 0}</div>
          <div className="caption-text mt-1">Students in dept.</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--success-50)', color: 'var(--success-600)' }}>
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg text-emerald-600">{statistics?.approved || 0}</div>
          <div className="caption-text mt-1">Approved</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--warning-50)', color: 'var(--warning-600)' }}>
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg text-amber-600">{statistics?.pending || 0}</div>
          <div className="caption-text mt-1">Pending</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--danger-50)', color: 'var(--danger-600)' }}>
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg text-rose-600">{statistics?.due || 0}</div>
          <div className="caption-text mt-1">
            {statistics?.totalDueAmount > 0 ? (
              <span className="text-rose-600 font-semibold">Due (₹{statistics.totalDueAmount.toLocaleString()})</span>
            ) : (
              'Due'
            )}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--gold-50)', color: 'var(--gold-600)' }}>
              <Award className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg text-amber-700">{statistics?.certificatesAvailable || 0}</div>
          <div className="caption-text mt-1">Certificates ready</div>
        </div>
      </div>

      {/* Table Container with Pill Filters */}
      <div className="table-wrap">
        <div className="filter-bar">
          {[
            { id: 'ALL', label: 'All', count: statistics?.totalStudents || 0 },
            { id: 'APPROVED', label: 'Approved', count: statistics?.approved || 0 },
            { id: 'PENDING', label: 'Pending', count: statistics?.pending || 0 },
            { id: 'WITH_DUES', label: 'Due', count: statistics?.due || 0 },
            { id: 'CERTIFICATES_AVAILABLE', label: 'Certificates ready', count: statistics?.certificatesAvailable || 0 }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pill-filter ${activeTab === tab.id ? 'active' : ''}`}
            >
              {tab.label} <span className="count">{tab.count}</span>
            </button>
          ))}

          <div className="filter-spacer"></div>

          {/* Graduating Batch Dropdown */}
          {statistics?.batchBreakdown && statistics.batchBreakdown.length > 0 && (
            <div className="relative" ref={batchMenuRef}>
              <button
                type="button"
                onClick={() => setIsBatchOpen(!isBatchOpen)}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 hover:border-slate-300 text-xs font-semibold text-slate-800 shadow-2xs transition-colors cursor-pointer"
                title="Filter by Batch"
              >
                <GraduationCap className="w-3.5 h-3.5 text-indigo-600" />
                <span>{batchFilter ? `Batch ${batchFilter}` : 'All Batches'}</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${
                    isBatchOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {isBatchOpen && (
                <div className="absolute left-0 mt-1.5 w-52 bg-white rounded-2xl border border-slate-200 shadow-xl p-1.5 z-40 animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                    Graduating Batches
                  </div>
                  <div className="pt-1 space-y-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setBatchFilter('');
                        setIsBatchOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-xs flex items-center justify-between text-left rounded-xl hover:bg-slate-50 transition-colors cursor-pointer ${
                        !batchFilter ? 'text-indigo-600 font-bold bg-indigo-50/50' : 'text-slate-700'
                      }`}
                    >
                      <span>All Batches</span>
                      <span className="text-[10px] text-slate-400">({statistics?.totalStudents || 0})</span>
                    </button>
                    {statistics.batchBreakdown.map((b: any) => {
                      const isSelected = batchFilter === b.batch;
                      return (
                        <button
                          key={b.batch}
                          type="button"
                          onClick={() => {
                            setBatchFilter(b.batch);
                            setIsBatchOpen(false);
                          }}
                          className={`w-full px-3 py-2 text-xs flex items-center justify-between text-left rounded-xl hover:bg-slate-50 transition-colors cursor-pointer ${
                            isSelected ? 'text-indigo-600 font-bold bg-indigo-50/50' : 'text-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Batch {b.batch}</span>
                            <span className="text-[10px] text-slate-400">({b.count})</span>
                          </div>
                          {isSelected && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="relative max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search USN or student name…"
              className="input pl-9 text-xs"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-500 font-semibold">Loading student records...</div>
        ) : students.length === 0 ? (
          <div className="p-12 text-center text-slate-500 font-semibold">No student records found matching current criteria.</div>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>USN</th>
                  <th>Batch</th>
                  <th>Clearance</th>
                  <th>Status</th>
                  <th>Due Details</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedStudents.map((student) => {
                  const initials = student.fullName.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase();
                  const isDue = student.ndcStatus === 'DUE' || student.duesCount > 0;
                  return (
                    <tr key={student._id} className={isDue ? 'due-row-accent' : ''}>
                      <td>
                        <div className="name-cell">
                          <div className="avatar-sm">{initials}</div>
                          <span className="cell-primary">{student.fullName}</span>
                        </div>
                      </td>
                      <td className="mono-text font-bold text-blue-700">{student.usn}</td>
                      <td>{student.batch}</td>
                      <td>
                        <div className="progress-frac">{student.progress.cleared} / {student.progress.total}</div>
                        <div className="seg-bar">
                          {Array.from({ length: student.progress.total || 6 }).map((_, i) => (
                            <div
                              key={i}
                              className={`seg ${i < student.progress.cleared ? 'done' : 'pend'}`}
                            />
                          ))}
                        </div>
                      </td>
                      <td>
                        <ClearanceStatusBadge status={student.ndcStatus} />
                      </td>
                      <td className="max-w-xs">
                        {isDue ? (
                          <div>
                            <span className="font-bold text-rose-700 block">{student.dueDepartment}</span>
                            {student.dueAmount > 0 && <span className="mono-text font-bold text-rose-800">₹{student.dueAmount.toLocaleString()}</span>}
                          </div>
                        ) : (
                          <span className="caption-text">-</span>
                        )}
                      </td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleOpenDetailModal(student)}
                            className="btn-icon"
                            title="View Student Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {isDue && (
                            <button
                              onClick={() => handleOpenDuesModal(student)}
                              className="btn btn-secondary btn-compact text-rose-700 border-rose-200"
                            >
                              View Dues
                            </button>
                          )}

                          {student.ndcStatus === 'APPROVED' && student.certificateId ? (
                            <button
                              onClick={() => handleDownloadCertificate(student.certificateId, student.certificateNumber)}
                              className="btn btn-primary btn-compact"
                            >
                              <Download className="w-3.5 h-3.5" />
                              Certificate
                            </button>
                          ) : !isDue && (
                            <span className="caption-text">Pending</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination Controls */}
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between p-4 border-t border-slate-100 text-xs bg-slate-50/50">
                <span className="text-slate-500 font-medium">
                  Showing page <strong className="text-slate-900">{pagination.page}</strong> of{' '}
                  <strong className="text-slate-900">{pagination.totalPages}</strong> ({pagination.total} total students)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    disabled={pagination.page <= 1}
                    onClick={() => fetchStudents(pagination.page - 1)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed font-medium shadow-2xs"
                  >
                    Previous
                  </button>
                  <button
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => fetchStudents(pagination.page + 1)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed font-medium shadow-2xs"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Itemized Student Dues Slide-out Drawer */}
      {selectedStudentDues && (
        <>
          <div className="drawer-scrim" onClick={() => setSelectedStudentDues(null)} />
          <div className="drawer-panel">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                <h3 className="h2-title">Due Details</h3>
                <p className="mono-text caption-text text-blue-600">
                  {selectedStudentDues.student?.fullName} · {selectedStudentDues.student?.usn}
                </p>
              </div>
              <button onClick={() => setSelectedStudentDues(null)} className="btn-icon">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-3 overflow-y-auto flex-1 text-xs">
              {duesLoading ? (
                <div className="p-8 text-center text-slate-500 font-semibold">Loading due details...</div>
              ) : selectedStudentDues.dues?.length === 0 ? (
                <div className="p-4 bg-emerald-50 text-emerald-800 rounded-xl font-bold text-center">
                  No active outstanding dues recorded for this student.
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedStudentDues.dues.map((dueItem: any) => (
                    <div key={dueItem.clearanceId} className="card card-pad bg-rose-50/50 border-rose-200 space-y-1">
                      <div className="kv-row border-none font-bold">
                        <span>{dueItem.departmentName}</span>
                        <span className="mono-text text-rose-700 font-bold">₹{dueItem.dueAmount?.toLocaleString()}</span>
                      </div>
                      <p className="caption-text text-slate-400">Reported by {dueItem.reportedBy} · {new Date(dueItem.reportedAt).toLocaleDateString()}</p>
                    </div>
                  ))}

                  <div className="kv-row font-bold text-sm pt-3 border-t border-slate-200">
                    <span>Total Outstanding</span>
                    <span className="mono-text text-rose-600 font-extrabold">₹{(selectedStudentDues.totalDueAmount || 0).toLocaleString()}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-100">
              <button onClick={() => setSelectedStudentDues(null)} className="btn btn-secondary w-full justify-center">
                Close Drawer
              </button>
            </div>
          </div>
        </>
      )}

      {/* Student Details Slide-out Drawer */}
      {selectedStudentDetail && (
        <>
          <div className="drawer-scrim" onClick={() => setSelectedStudentDetail(null)} />
          <div className="drawer-panel">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                <h3 className="h2-title">{selectedStudentDetail.student?.fullName}</h3>
                <p className="mono-text caption-text text-blue-600">
                  {selectedStudentDetail.student?.usn} · {selectedStudentDetail.student?.departmentId?.name}
                </p>
              </div>
              <button onClick={() => setSelectedStudentDetail(null)} className="btn-icon">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
              <div className="h3-title">Clearance Timeline</div>
              <div className="space-y-1">
                {selectedStudentDetail.clearances?.map((task: any) => (
                  <div key={task._id} className="kv-row">
                    <span>{task.departmentId?.name}</span>
                    <ClearanceStatusBadge status={task.status} />
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 border-t border-slate-100">
              <button onClick={() => setSelectedStudentDetail(null)} className="btn btn-secondary w-full justify-center">
                Close Drawer
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
