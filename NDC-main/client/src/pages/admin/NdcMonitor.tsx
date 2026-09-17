import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { ClearanceStatusBadge } from '../../components/ClearanceStatusBadge';
import { useAuthStore } from '../../store/useAuthStore';
import {
  Search,
  ShieldAlert,
  Eye,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Award,
  Clock,
  FileText
} from 'lucide-react';
import { CertificatePreviewModal } from '../../components/CertificatePreviewModal';

export const NdcMonitor: React.FC = () => {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [section, setSection] = useState<'ALL'>('ALL');
  const [counts, setCounts] = useState({ total: 0, active: 0, approved: 0 });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [previewCert, setPreviewCert] = useState<any>(null);
  const [clearances, setClearances] = useState<any[]>([]);
  const [loadingClearances, setLoadingClearances] = useState(false);

  // Super Admin Override State
  const [overrideTask, setOverrideTask] = useState<any>(null);
  const [overrideStatus, setOverrideStatus] = useState<'CLEARED' | 'DUE' | 'NOT_APPLICABLE'>('CLEARED');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);
  const [overrideError, setOverrideError] = useState('');

  const currentUser = useAuthStore((state) => state.user);

  useEffect(() => {
    fetchRequests();
  }, [search, statusFilter, page, limit]);

  const fetchRequests = async () => {
    try {
      setLoading(true);
      const res = await api.get('/ndc/requests', {
        params: { search, status: statusFilter || undefined, page, limit }
      });
      setRequests(res.data.data || []);
      if (res.data.counts) {
        setCounts(res.data.counts);
      } else {
        const all = res.data.data || [];
        const app = all.filter((r: any) => r.status === 'APPROVED').length;
        setCounts({
          total: res.data.pagination?.total || all.length,
          active: Math.max(0, (res.data.pagination?.total || all.length) - app),
          approved: app
        });
      }
      if (res.data.pagination) {
        setPagination({
          total: res.data.pagination.total,
          totalPages: res.data.pagination.totalPages || 1
        });
      } else {
        setPagination({ total: (res.data.data || []).length, totalPages: 1 });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCertificatePreview = (reqItem: any) => {
    const cert = reqItem.certificateId || {};
    setPreviewCert({
      ...cert,
      id: cert.id || cert._id,
      _id: cert.id || cert._id,
      certificateNumber: cert.certificateNumber || reqItem.certificateNumber || 'NDC/MCE/PENDING',
      student: reqItem.studentId,
      studentId: reqItem.studentId,
      studentUsn: reqItem.studentId?.usn,
      studentName: reqItem.studentId?.fullName,
      departmentName: reqItem.studentId?.departmentId?.name,
      ndcRequestId: reqItem._id || reqItem.id,
      issuedAt: cert.issuedAt || reqItem.completedAt || reqItem.updatedAt
    });
  };

  const handleOpenDetailModal = async (reqItem: any) => {
    setSelectedRequest(reqItem);
    setLoadingClearances(true);
    try {
      const res = await api.get(`/ndc/student-status/${reqItem.studentId._id || reqItem.studentId}`);
      setClearances(res.data.clearances);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingClearances(false);
    }
  };

  const handleOpenOverrideModal = (task: any) => {
    setOverrideTask(task);
    setOverrideStatus('CLEARED');
    setOverrideReason('');
    setOverrideError('');
  };

  const handleExecuteOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    setOverrideError('');

    if (!overrideReason || overrideReason.trim() === '') {
      setOverrideError('Super Admin override reason is mandatory.');
      return;
    }

    setOverrideSubmitting(true);
    try {
      await api.put(`/ndc/clearance/${overrideTask._id}/override`, {
        newStatus: overrideStatus,
        overrideReason
      });

      setOverrideTask(null);
      if (selectedRequest) {
        handleOpenDetailModal(selectedRequest);
      }
      await fetchRequests();
    } catch (err: any) {
      setOverrideError(err.response?.data?.message || 'Override failed.');
    } finally {
      setOverrideSubmitting(false);
    }
  };

  const handleRegenerateCertificateByStudent = async (studentId: string) => {
    try {
      const res = await api.post(`/certificates/student/${studentId}/regenerate`);
      alert(res.data.message || 'Certificate regenerated successfully.');
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to regenerate certificate.');
    }
  };

  const [actionSubmitting, setActionSubmitting] = useState(false);

  const handleApproveAllAndIssue = async (reqId: string) => {
    if (actionSubmitting) return;
    setActionSubmitting(true);
    try {
      await api.put(`/ndc/requests/${reqId}/approve-all`, {
        reason: 'Instant Approval by System Administrator'
      });
      setSelectedRequest(null);
      await fetchRequests();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Approval failed.');
    } finally {
      setActionSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900">NDC Request Monitor</h2>
          <p className="text-xs text-slate-500">Global clearance workflow monitoring and administrative overrides</p>
        </div>
      </div>

      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-slate-900">All Requests</span>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-900 text-white">
            {counts.total}
          </span>
        </div>

        <div className="text-xs text-slate-400 font-medium">
          Showing all institutional clearance requests
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full min-w-[280px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by request number, student USN, or name..."
            className="input pl-10 text-xs w-full"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="select text-xs font-semibold shrink-0"
        >
          <option value="">All Statuses</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="APPROVED">Approved / Cleared</option>
          <option value="BLOCKED">Blocked (Dues Pending)</option>
        </select>
      </div>

      {loading ? (
        <div className="p-8 text-center text-slate-500 font-semibold">
          Loading NDC requests...
        </div>
      ) : requests.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 border border-slate-200 text-center shadow-sm">
          <p className="text-sm font-bold text-slate-600">
            No clearance requests found matching current filters.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                <tr>
                  <th className="p-4">Request Ref</th>
                  <th className="p-4">USN</th>
                  <th className="p-4">Student Name</th>
                  <th className="p-4">Department & Batch</th>
                  <th className="p-4">Certificate Ref</th>
                  <th className="p-4">Submitted Date</th>
                  <th className="p-4">Overall Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requests.map((reqItem) => (
                  <tr key={reqItem._id || reqItem.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-mono font-bold text-blue-700">{reqItem.requestNumber}</td>
                    <td className="p-4 font-mono font-bold text-slate-900">{reqItem.studentId?.usn}</td>
                    <td className="p-4 font-bold text-slate-900">{reqItem.studentId?.fullName}</td>
                    <td className="p-4 text-slate-600">
                      <div>{reqItem.studentId?.departmentId?.name || 'N/A'}</div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                        Batch: {reqItem.studentId?.batch || '2022-2026'}
                      </div>
                    </td>
                    <td className="p-4">
                      {reqItem.certificateId?.certificateNumber ? (
                        <button
                          type="button"
                          onClick={() => handleOpenCertificatePreview(reqItem)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200/80 text-emerald-800 hover:bg-emerald-100 font-mono text-xs font-bold transition-colors cursor-pointer"
                          title="Click to preview certificate"
                        >
                          <Award className="w-3.5 h-3.5 text-emerald-600" />
                          <span>{reqItem.certificateId.certificateNumber}</span>
                        </button>
                      ) : reqItem.status === 'APPROVED' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[11px] font-semibold">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>Ready to Issue</span>
                        </span>
                      ) : (
                        <span className="text-slate-400 font-mono text-xs">-</span>
                      )}
                    </td>
                    <td className="p-4 text-slate-500">{new Date(reqItem.submittedAt).toLocaleDateString()}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <ClearanceStatusBadge status={reqItem.status} />
                        {reqItem.certificateId?.isSubmitted && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold border border-blue-200/60">
                            Submitted to College
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleOpenDetailModal(reqItem)}
                          className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-lg text-xs transition-colors inline-flex items-center gap-1 cursor-pointer"
                          title="View Department Clearance Tasks"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Tasks</span>
                        </button>
                        {(reqItem.status === 'APPROVED' || reqItem.certificateId) && (
                          <button
                            onClick={() => handleOpenCertificatePreview(reqItem)}
                            className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs transition-colors inline-flex items-center gap-1 cursor-pointer shadow-xs"
                            title="Preview Certificate"
                          >
                            <Award className="w-3.5 h-3.5" />
                            <span>Certificate</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
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
                <option value={1000}>Show All (1000)</option>
              </select>

              <span className="mono-text font-semibold text-slate-600 ml-2">
                {pagination.total > 0
                  ? `${(page - 1) * limit + 1}–${Math.min(page * limit, pagination.total)} of ${pagination.total} requests`
                  : '0 of 0 requests'}
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
        </div>
      )}

      {/* Detail Breakdown Modal */}
      {selectedRequest && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900">NDC Request Clearance Tasks</h3>
                <p className="text-xs text-slate-500 font-mono">Ref: {selectedRequest.requestNumber}</p>
              </div>
              <div className="flex items-center gap-2">
                {selectedRequest.status === 'APPROVED' && (currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'ADMIN') && (
                  <button
                    onClick={() => handleRegenerateCertificateByStudent(selectedRequest.studentId?._id || selectedRequest.studentId)}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Regenerate PDF
                  </button>
                )}
                {selectedRequest.status !== 'APPROVED' && currentUser?.role === 'SUPER_ADMIN' && (
                  <button
                    onClick={() => handleApproveAllAndIssue(selectedRequest._id)}
                    disabled={actionSubmitting}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
                  >
                    <CheckCircle2 className={`w-4 h-4 ${actionSubmitting ? 'animate-spin' : ''}`} />
                    {actionSubmitting ? 'Approving...' : 'Approve & Issue Certificate'}
                  </button>
                )}
                <button onClick={() => setSelectedRequest(null)} className="text-slate-400 hover:text-slate-700 text-xl font-bold ml-2">
                  ×
                </button>
              </div>
            </div>

            {loadingClearances ? (
              <div className="p-6 text-center text-slate-500 font-semibold">Fetching clearance tasks...</div>
            ) : (
              <div className="space-y-3">
                {clearances.map((c) => (
                  <div key={c._id} className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-slate-900">{c.departmentId?.name}</h4>
                      {c.dueAmount > 0 && <p className="text-[11px] font-bold text-rose-600 mt-0.5">Due: ₹{c.dueAmount}</p>}
                    </div>

                    <div className="flex items-center gap-3">
                      <ClearanceStatusBadge status={c.status} size="sm" />
                      {currentUser?.role === 'SUPER_ADMIN' && (
                        <button
                          onClick={() => handleOpenOverrideModal(c)}
                          className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-[10px] rounded-lg shadow-xs transition-colors flex items-center gap-1"
                        >
                          <ShieldAlert className="w-3 h-3" />
                          Override
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Super Admin Override Modal */}
      {overrideTask && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-slate-200">
            <div className="flex items-center gap-2 text-amber-600">
              <ShieldAlert className="w-6 h-6" />
              <h3 className="text-base font-bold text-slate-900">Super Admin Clearance Override</h3>
            </div>

            {overrideError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-lg">
                {overrideError}
              </div>
            )}

            <form onSubmit={handleExecuteOverride} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Target Status *</label>
                <select
                  value={overrideStatus}
                  onChange={(e: any) => setOverrideStatus(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-bold text-slate-900"
                >
                  <option value="CLEARED">CLEARED (Force Clear)</option>
                  <option value="NOT_APPLICABLE">NOT APPLICABLE (Exempt)</option>
                  <option value="DUE">MARK DUE</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Mandatory Override Reason *</label>
                <textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Provide explicit justification for this administrative override..."
                  rows={3}
                  required
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-medium text-slate-900"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOverrideTask(null)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={overrideSubmitting}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold rounded-xl shadow-md disabled:opacity-50"
                >
                  {overrideSubmitting ? 'Processing...' : 'Confirm Override'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {previewCert && (
        <CertificatePreviewModal
          certificate={previewCert}
          onClose={() => setPreviewCert(null)}
        />
      )}
    </div>
  );
};
