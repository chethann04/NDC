import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { useAuthStore } from '../../store/useAuthStore';
import { ClearanceStatusBadge } from '../../components/ClearanceStatusBadge';
import {
  Search,
  CheckCircle2,
  AlertTriangle,
  Ban,
  Users,
  Clock,
  X,
  ChevronLeft,
  ChevronRight,
  ShieldAlert
} from 'lucide-react';

import { CollegeOfficeSubmissionDesk } from './CollegeOfficeSubmissionDesk';

export const OfficerClearanceQueue: React.FC = () => {
  const { user } = useAuthStore();

  const deptObj = user?.departmentId as any;
  const officerDeptObj = user?.officerProfile?.departmentIds?.[0] as any;

  // Check if current user is from College Office (ADM) or Admin Block
  const isAdmOrAdmin =
    user?.role === 'ADMIN' ||
    user?.email === 'office@mce.ac.in' ||
    officerDeptObj?.code === 'ADM' ||
    officerDeptObj?.name?.toLowerCase().includes('college office') ||
    officerDeptObj?.name?.toLowerCase().includes('administrative') ||
    deptObj?.code === 'ADM' ||
    (typeof deptObj === 'object' && (deptObj?.code === 'ADM' || deptObj?.name?.toLowerCase().includes('college office') || deptObj?.name?.toLowerCase().includes('administrative')));

  // For College Office (ADM): There is no clearance queue. They collect physical certificates & generate date-range reports.
  if (isAdmOrAdmin) {
    return <CollegeOfficeSubmissionDesk />;
  }

  // Designated Clearance Officers have full review capability
  const canReviewClearance = true;

  const [clearances, setClearances] = useState<any[]>([]);
  const [stats, setStats] = useState({
    TOTAL: 0,
    PENDING: 0,
    DUE: 0,
    CLEARED: 0,
    ON_HOLD: 0,
    NOT_APPLICABLE: 0
  });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('PENDING');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [selectedTask, setSelectedTask] = useState<any>(null);

  // Review Modal State
  const [actionStatus, setActionStatus] = useState<'CLEARED' | 'DUE'>('CLEARED');
  const [remarks, setRemarks] = useState('');
  const [dueAmount, setDueAmount] = useState('0');
  const [dueDetails, setDueDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');

  // Resolve Department Name dynamically from user profile or clearance data
  const fetchedDeptName = (clearances.find((c) => c.departmentId?.name) as any)?.departmentId?.name;

  const departmentName =
    officerDeptObj?.name ||
    (typeof deptObj === 'object' ? deptObj?.name : undefined) ||
    fetchedDeptName ||
    (user?.role === 'HOD' ? 'Academic Department' : 'Central Clearance Desk');

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    fetchClearances();
  }, [activeTab, search, page, limit]);

  const fetchStats = async () => {
    try {
      const response = await api.get('/ndc/officer/stats');
      if (response.data?.data) {
        setStats(response.data.data);
      }
    } catch (err) {
      console.error('Error fetching officer department stats:', err);
    }
  };

  const fetchClearances = async () => {
    try {
      setLoading(true);
      const response = await api.get('/ndc/officer/clearances', {
        params: { status: activeTab, search, page, limit }
      });
      setClearances(response.data.data || []);
      if (response.data.pagination) {
        setPagination({
          total: response.data.pagination.total,
          totalPages: response.data.pagination.totalPages || 1
        });
      } else {
        setPagination({ total: response.data.data?.length || 0, totalPages: 1 });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenReviewModal = (task: any) => {
    if (!canReviewClearance) return;
    setSelectedTask(task);
    setActionStatus(task.status === 'DUE' ? 'DUE' : 'CLEARED');
    setRemarks(task.remarks || '');
    setDueAmount(task.dueAmount ? String(task.dueAmount) : '0');
    setDueDetails(task.dueDetails || '');
    setModalError('');
  };

  const handleProcessClearance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canReviewClearance) {
      setModalError('Clearance review is strictly restricted to designated clearance officers.');
      return;
    }
    setModalError('');

    setSubmitting(true);
    try {
      await api.put(`/ndc/clearance/${selectedTask._id}`, {
        status: actionStatus,
        remarks: '',
        dueAmount: 0,
        dueDetails: ''
      });

      setSelectedTask(null);
      await fetchStats();
      await fetchClearances();
    } catch (err: any) {
      setModalError(err.response?.data?.message || 'Failed to update clearance status.');
    } finally {
      setSubmitting(false);
    }
  };

  // Live department statistics from fast stats endpoint
  const totalQueue = stats.TOTAL || 0;
  const pendingCount = stats.PENDING || 0;
  const dueCount = stats.DUE || 0;
  const clearedCount = (stats.CLEARED || 0) + (stats.NOT_APPLICABLE || 0);
  const onHoldCount = stats.ON_HOLD || 0;

  return (
    <div className="space-y-6">
      {/* Administrative View Banner for ADM / Admin Block */}
      {isAdmOrAdmin && (
        <div className="p-4 bg-blue-50/80 border border-blue-200 rounded-2xl flex items-start sm:items-center gap-3 text-xs text-blue-900 shadow-xs">
          <ShieldAlert className="w-5 h-5 text-blue-600 shrink-0 mt-0.5 sm:mt-0" />
          <div className="leading-relaxed">
            <span className="font-bold">Administrative View (Read-Only):</span> Clearance status review, verification, and status modification is strictly restricted to designated Clearance Officers. Officers in College Office (ADM) and Administration Block have oversight view only.
          </div>
        </div>
      )}

      {/* Section Header */}
      <div className="section-head">
        <div>
          <h1 className="page-title">{departmentName} — {isAdmOrAdmin ? 'Clearance Records' : 'Clearance Queue'}</h1>
          <p className="caption-text mt-1">
            {isAdmOrAdmin
              ? 'View institutional clearance records — Status verification is conducted by designated clearance officers'
              : 'Review student records, verify clearances, and update departmental status'}
          </p>
        </div>
      </div>

      {/* 5 Fraunces Display Stat Cards in Single Line */}
      <div className="stat-row-5">
        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--cobalt-50)', color: 'var(--cobalt-600)' }}>
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg">{totalQueue}</div>
          <div className="caption-text mt-1">Total queue</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--warning-50)', color: 'var(--warning-600)' }}>
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg">{pendingCount}</div>
          <div className="caption-text mt-1">Pending review</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--danger-50)', color: 'var(--danger-600)' }}>
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg">{dueCount}</div>
          <div className="caption-text mt-1">Marked due</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--success-50)', color: 'var(--success-600)' }}>
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg">{clearedCount}</div>
          <div className="caption-text mt-1">No Dues (Cleared)</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--surface-3)', color: 'var(--ink-500)' }}>
              <Ban className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg">{onHoldCount}</div>
          <div className="caption-text mt-1">On hold</div>
        </div>
      </div>

      {/* Table Container with Pill Filters */}
      <div className="table-wrap">
        <div className="filter-bar">
          {[
            { id: 'PENDING', label: 'Pending', count: pendingCount },
            { id: 'DUE', label: 'Due', count: dueCount },
            { id: 'CLEARED', label: 'No Due', count: clearedCount }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pill-filter ${activeTab === tab.id ? 'active' : ''}`}
            >
              {tab.label}
            </button>
          ))}

          <div className="filter-spacer"></div>

          <div className="relative max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search USN or student name…"
              className="input text-xs"
              style={{ paddingLeft: '34px' }}
            />
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-500 font-semibold">Loading clearance queue...</div>
        ) : clearances.length === 0 ? (
          <div className="p-12 text-center text-slate-500 font-semibold">
            No student clearance tasks found matching "{activeTab.replace('_', ' ')}".
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>USN</th>
                  <th>Academic Branch</th>
                  <th>Clearance Status</th>
                  <th className="text-right">{canReviewClearance ? 'Action' : 'Clearance Review'}</th>
                </tr>
              </thead>
              <tbody>
                {clearances.map((task) => {
                  const studentName = task.studentId?.fullName || 'Student';
                  const initials = studentName.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase();
                  const isDue = task.status === 'DUE';
                  return (
                    <tr key={task._id} className={isDue ? 'due-row-accent' : ''}>
                      <td>
                        <div className="name-cell">
                          <div className="avatar-sm">{initials}</div>
                          <span className="cell-primary">{studentName}</span>
                        </div>
                      </td>
                      <td className="mono-text font-bold text-blue-700">{task.studentId?.usn}</td>
                      <td>{task.studentId?.departmentId?.name || task.studentId?.batch || 'N/A'}</td>
                      <td>
                        <ClearanceStatusBadge status={task.status} />
                      </td>
                      <td className="text-right">
                        {canReviewClearance ? (
                          <button
                            onClick={() => handleOpenReviewModal(task)}
                            className="btn btn-secondary btn-compact"
                          >
                            Review
                          </button>
                        ) : (
                          <span className="inline-flex items-center text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-1 rounded-md border border-slate-200/60">
                            Designated Desks Only
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Numbered Page Buttons & Rows-Per-Page Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 border-t border-slate-200 text-xs bg-slate-50/50">
            <div className="flex items-center gap-2">
              <span className="text-slate-500 font-medium">Rows per page:</span>
              <select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setPage(1);
                }}
                className="input !w-36 h-8 font-semibold text-xs py-0"
              >
                <option value={20}>20 per page</option>
                <option value={50}>50 per page</option>
                <option value={100}>100 per page</option>
                <option value={500}>500 per page</option>
              </select>

              <span className="mono-text font-semibold text-slate-600 ml-2">
                {pagination.total > 0
                  ? `${(page - 1) * limit + 1}–${Math.min(page * limit, pagination.total)} of ${pagination.total} records`
                  : '0 of 0 records'}
              </span>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn btn-secondary h-8 px-2.5 text-xs disabled:opacity-40"
                title="Previous Page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                let pageNum: number;
                if (pagination.totalPages <= 5) {
                  pageNum = i + 1;
                } else if (page <= 3) {
                  pageNum = i + 1;
                } else if (page >= pagination.totalPages - 2) {
                  pageNum = pagination.totalPages - 4 + i;
                } else {
                  pageNum = page - 2 + i;
                }

                return (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={`h-8 min-w-[32px] px-2 rounded-lg font-bold text-xs transition-colors ${
                      page === pageNum
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}

              <button
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={page >= pagination.totalPages}
                className="btn btn-secondary h-8 px-2.5 text-xs disabled:opacity-40"
                title="Next Page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      )}
      </div>

      {/* Review Clearance Modal */}
      {selectedTask && canReviewClearance && (
        <>
          <div className="drawer-scrim" onClick={() => setSelectedTask(null)} />
          <div className="modal open max-w-md rounded-2xl p-0 overflow-hidden border border-slate-200/80 shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-white">
              <div>
                <h3 className="text-base font-bold text-slate-900">Process Clearance</h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  {selectedTask.studentId?.fullName} · <span className="font-mono text-blue-600 font-bold">{selectedTask.studentId?.usn}</span>
                </p>
              </div>
              <button onClick={() => setSelectedTask(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalError && (
              <div className="px-5 pt-3">
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium rounded-xl">
                  {modalError}
                </div>
              </div>
            )}

            <form onSubmit={handleProcessClearance}>
              <div className="p-5 space-y-4 bg-white">
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-2">Select Clearance Status</label>
                  <div className="grid grid-cols-2 gap-3 text-sm font-semibold">
                    <button
                      type="button"
                      onClick={() => setActionStatus('CLEARED')}
                      className={`py-3.5 px-4 rounded-xl border transition-all flex items-center justify-center gap-2 cursor-pointer ${
                        actionStatus === 'CLEARED'
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm font-bold'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>No Due</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActionStatus('DUE')}
                      className={`py-3.5 px-4 rounded-xl border transition-all flex items-center justify-center gap-2 cursor-pointer ${
                        actionStatus === 'DUE'
                          ? 'bg-rose-600 text-white border-rose-600 shadow-sm font-bold'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <AlertTriangle className="w-4 h-4" />
                      <span>Due</span>
                    </button>
                  </div>

                  {/* Dynamic Minimal Banner */}
                  <div className="mt-3">
                    {actionStatus === 'CLEARED' ? (
                      <div className="p-3 bg-emerald-50/70 border border-emerald-200/70 text-emerald-800 rounded-xl text-xs flex items-center gap-2 font-medium">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>Student is cleared (No Dues). Eligible for certificate once all departments clear.</span>
                      </div>
                    ) : (
                      <div className="p-3 bg-rose-50/70 border border-rose-200/70 text-rose-800 rounded-xl text-xs flex items-center gap-2 font-medium">
                        <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                        <span>Student has pending dues. Certificate download will be blocked.</span>
                      </div>
                    )}
                  </div>
                </div>

              </div>

              <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedTask(null)}
                  className="flex-1 py-2.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold rounded-xl text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-sm transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
};
