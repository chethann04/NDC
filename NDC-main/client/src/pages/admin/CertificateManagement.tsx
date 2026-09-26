import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { ClearanceStatusBadge } from '../../components/ClearanceStatusBadge';
import {
  Search,
  Download,
  XCircle,
  RefreshCw,
  Eye,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  FileText,
  X,
  RotateCcw
} from 'lucide-react';
import { CertificatePreviewModal } from '../../components/CertificatePreviewModal';
import { clientCache } from '../../utils/clientCache';
import { ErrorAlert } from '../../components/ErrorAlert';
import { showErrorModal } from '../../store/useErrorModalStore';

export const CertificateManagement: React.FC = () => {
  const cacheKey = 'certificates_list_default';
  const [certificates, setCertificates] = useState<any[]>(() => clientCache.get<any[]>(cacheKey) || []);
  const [loading, setLoading] = useState(!clientCache.get<any[]>(cacheKey));
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [submissionFilter, setSubmissionFilter] = useState(''); // '' | 'SUBMITTED' | 'NOT_SUBMITTED'
  const [previewCert, setPreviewCert] = useState<any>(null);

  // Revoke Modal State
  const [revokingCert, setRevokingCert] = useState<any>(null);
  const [revocationReason, setRevocationReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<any>(null);

  // Submission Modal State
  const [submittingCert, setSubmittingCert] = useState<any>(null);
  const [submissionTargetStatus, setSubmissionTargetStatus] = useState<boolean>(true);
  const [submissionRemarks, setSubmissionRemarks] = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);
  const [submissionModalError, setSubmissionModalError] = useState<any>(null);

  useEffect(() => {
    fetchCertificates();
  }, [search, statusFilter, submissionFilter]);

  const fetchCertificates = async () => {
    const isDefault = !search && !statusFilter && !submissionFilter;
    const currentKey = isDefault ? cacheKey : `certificates_${search}_${statusFilter}_${submissionFilter}`;
    const cached = clientCache.get<any[]>(currentKey);
    if (cached) {
      setCertificates(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }

    try {
      const res = await api.get('/certificates', {
        params: {
          search,
          status: statusFilter,
          submissionStatus: submissionFilter,
          limit: 100
        }
      });
      const data = res.data.data || [];
      setCertificates(data);
      clientCache.set(currentKey, data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerateCertificate = async (cert: any) => {
    try {
      const res = await api.post(`/certificates/${cert._id}/regenerate`);
      await fetchCertificates();
      setPreviewCert(res.data.data);
      alert(`Certificate [${cert.certificateNumber}] regenerated successfully.`);
    } catch (err: any) {
      showErrorModal(err, { title: 'Certificate Regeneration Failed' });
    }
  };

  const handleOpenRevokeModal = (cert: any) => {
    setRevokingCert(cert);
    setRevocationReason('');
    setModalError(null);
  };

  const handleExecuteRevocation = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    if (!revocationReason || revocationReason.trim() === '') {
      setModalError({
        title: 'Revocation reason required',
        message: 'Please enter a clear explanation for revoking this certificate.'
      });
      return;
    }

    setSubmitting(true);
    try {
      await api.post(`/certificates/${revokingCert._id}/revoke`, {
        revocationReason
      });

      setRevokingCert(null);
      await fetchCertificates();
    } catch (err: any) {
      setModalError(err);
    } finally {
      setSubmitting(false);
    }
  };

  // Submission Modal Handlers
  const handleOpenSubmissionModal = (cert: any, targetStatus: boolean) => {
    setSubmittingCert(cert);
    setSubmissionTargetStatus(targetStatus);
    setSubmissionRemarks('');
    setSubmissionModalError(null);
  };

  const handleExecuteSubmission = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmissionModalError(null);
    setSubmittingAction(true);

    try {
      await api.put(`/certificates/${submittingCert._id}/submission`, {
        isSubmitted: submissionTargetStatus,
        remarks: submissionRemarks
      });

      setSubmittingCert(null);
      await fetchCertificates();
    } catch (err: any) {
      setSubmissionModalError(err);
    } finally {
      setSubmittingAction(false);
    }
  };

  // Export File Downloader
  const handleExport = (format: 'xlsx' | 'csv') => {
    const token = localStorage.getItem('ndc_token') || '';
    const params = new URLSearchParams({
      format,
      search,
      status: statusFilter,
      submissionStatus: submissionFilter,
      token
    });
    window.open(`/api/v1/certificates/export?${params.toString()}`, '_blank');
  };

  // Count metrics for current filter view
  const submittedCount = certificates.filter((c) => c.isSubmitted).length;
  const notSubmittedCount = certificates.filter((c) => !c.isSubmitted).length;

  return (
    <div className="space-y-6">
      {/* Header with Title & Export Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-900 tracking-tight">Certificate Registry & Submissions</h2>
          <p className="text-xs text-slate-500 font-medium mt-1">
            Search by USN or Certificate Number, verify student physical certificate submissions, and export registry reports
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => handleExport('xlsx')}
            className="btn btn-secondary inline-flex items-center gap-2 text-xs font-bold"
            title="Export filtered records to Microsoft Excel"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>Export Excel</span>
          </button>
          <button
            onClick={() => handleExport('csv')}
            className="btn btn-secondary inline-flex items-center gap-2 text-xs font-bold"
            title="Export filtered records to CSV"
          >
            <FileText className="w-4 h-4 text-blue-600" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Submission Status Pill Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setSubmissionFilter('')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
            submissionFilter === ''
              ? 'bg-blue-600 text-white shadow-xs'
              : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
          }`}
        >
          All Certificates ({certificates.length})
        </button>
        <button
          onClick={() => setSubmissionFilter('NOT_SUBMITTED')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
            submissionFilter === 'NOT_SUBMITTED'
              ? 'bg-amber-600 text-white shadow-xs'
              : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>Pending Submission</span>
          {submissionFilter === '' && <span className="opacity-80">({notSubmittedCount})</span>}
        </button>
        <button
          onClick={() => setSubmissionFilter('SUBMITTED')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
            submissionFilter === 'SUBMITTED'
              ? 'bg-emerald-600 text-white shadow-xs'
              : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Submitted to Admin</span>
          {submissionFilter === '' && <span className="opacity-80">({submittedCount})</span>}
        </button>
      </div>

      {/* Search & Validity Filter Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full min-w-[280px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by USN (e.g. 4MC22CS001), Certificate Number (e.g. NDC/MCE/2026/000001), or Student Name..."
            className="input pl-10 text-xs w-full"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="select text-xs font-semibold shrink-0"
        >
          <option value="">All Validity Statuses</option>
          <option value="VALID">Valid</option>
          <option value="REVOKED">Revoked</option>
        </select>
      </div>

      {/* Certificates Data Table */}
      {loading ? (
        <div className="p-8 text-center text-slate-500 font-semibold">Loading certificate records...</div>
      ) : certificates.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 border border-slate-200 text-center shadow-sm">
          <p className="text-sm font-bold text-slate-600">No certificates found matching your criteria.</p>
          <p className="caption-text mt-1">Try clearing the search or changing the submission filter.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                <tr>
                  <th className="p-4">Certificate Number</th>
                  <th className="p-4">USN</th>
                  <th className="p-4">Student Name</th>
                  <th className="p-4">Department</th>
                  <th className="p-4">Issued Date</th>
                  <th className="p-4">Validity</th>
                  <th className="p-4">Submission Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {certificates.map((cert) => (
                  <tr key={cert._id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-mono font-bold text-blue-700">{cert.certificateNumber}</td>
                    <td className="p-4 font-mono font-bold text-slate-900">{cert.studentId?.usn || cert.studentUsn}</td>
                    <td className="p-4 font-bold text-slate-900">{cert.studentId?.fullName || cert.studentName}</td>
                    <td className="p-4 text-slate-600">{cert.studentId?.departmentId?.name || cert.departmentName || 'N/A'}</td>
                    <td className="p-4 text-slate-500">{new Date(cert.issuedAt).toLocaleDateString()}</td>
                    <td className="p-4">
                      <ClearanceStatusBadge status={cert.status} />
                    </td>

                    {/* Submission Status Column */}
                    <td className="p-4">
                      {cert.isSubmitted ? (
                        <div>
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            Submitted
                          </span>
                          <span className="block text-[10px] text-slate-500 mt-0.5 font-medium">
                            {cert.submittedAt ? new Date(cert.submittedAt).toLocaleDateString('en-IN') : 'Recorded'}
                          </span>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          Not Submitted
                        </span>
                      )}
                    </td>

                    {/* Action Buttons */}
                    <td className="p-4 text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        {/* Administration Block Submission Action */}
                        {cert.status === 'VALID' && (
                          <>
                            {cert.isSubmitted ? (
                              <button
                                onClick={() => handleOpenSubmissionModal(cert, false)}
                                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-[11px] transition-colors inline-flex items-center gap-1 cursor-pointer"
                                title="Revert submission back to Not Submitted"
                              >
                                <RotateCcw className="w-3 h-3 text-slate-500" />
                                <span>Revert</span>
                              </button>
                            ) : (
                              <button
                                onClick={() => handleOpenSubmissionModal(cert, true)}
                                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] shadow-xs transition-colors inline-flex items-center gap-1 cursor-pointer"
                                title="Mark certificate as physically submitted to Administration Block"
                              >
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Mark Submitted</span>
                              </button>
                            )}
                          </>
                        )}

                        {/* Standard Preview & PDF Actions */}
                        {cert.status === 'VALID' ? (
                          <>
                            <button
                              onClick={() => setPreviewCert(cert)}
                              className="w-8 h-8 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors inline-flex items-center justify-center cursor-pointer"
                              title="View Certificate Preview"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <a
                              href={`/api/v1/certificates/${cert._id}/download?token=${localStorage.getItem('ndc_token') || ''}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="w-8 h-8 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors inline-flex items-center justify-center cursor-pointer"
                              title="Download PDF"
                            >
                              <Download className="w-4 h-4" />
                            </a>
                            <button
                              onClick={() => handleRegenerateCertificate(cert)}
                              className="w-8 h-8 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors inline-flex items-center justify-center cursor-pointer"
                              title="Regenerate Certificate PDF"
                            >
                              <RefreshCw className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleOpenRevokeModal(cert)}
                              className="w-8 h-8 rounded-lg text-rose-600 hover:bg-rose-50 transition-colors inline-flex items-center justify-center cursor-pointer"
                              title="Revoke Certificate"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <span className="text-[11px] text-rose-600 font-bold px-2.5 py-1 bg-rose-50 rounded-lg">
                            Revoked
                          </span>
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

      {/* Preview Modal */}
      {previewCert && (
        <CertificatePreviewModal certificate={previewCert} onClose={() => setPreviewCert(null)} />
      )}

      {/* Submission Status Modal */}
      {submittingCert && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                {submissionTargetStatus ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                ) : (
                  <RotateCcw className="w-5 h-5 text-amber-600" />
                )}
                <h3 className="text-base font-bold text-slate-900">
                  {submissionTargetStatus ? 'Confirm Certificate Submission' : 'Revert Certificate Submission'}
                </h3>
              </div>
              <button
                onClick={() => setSubmittingCert(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Certificate:</span>
                <span className="font-mono font-bold text-blue-700">{submittingCert.certificateNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Student USN:</span>
                <span className="font-mono font-bold text-slate-900">{submittingCert.studentId?.usn || submittingCert.studentUsn}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Student Name:</span>
                <span className="font-bold text-slate-900">{submittingCert.studentId?.fullName || submittingCert.studentName}</span>
              </div>
            </div>

            <p className="text-xs text-slate-600">
              {submissionTargetStatus
                ? 'Record that the student has physically submitted their official No Due Certificate to the Administration Block.'
                : 'Revert this certificate back to "Not Submitted" state. This action will be logged in the audit trail.'}
            </p>

            {submissionModalError && (
              <ErrorAlert
                error={submissionModalError}
                onDismiss={() => setSubmissionModalError(null)}
                title="Submission Update Issue"
              />
            )}

            <form onSubmit={handleExecuteSubmission} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Remarks (Optional)</label>
                <input
                  type="text"
                  value={submissionRemarks}
                  onChange={(e) => setSubmissionRemarks(e.target.value)}
                  placeholder={submissionTargetStatus ? 'e.g. Physical hardcopy verified and received.' : 'e.g. Marked submitted by error.'}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-900 text-xs"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSubmittingCert(null)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAction}
                  className={`flex-1 py-2.5 text-white font-bold rounded-xl shadow-md transition-colors cursor-pointer disabled:opacity-50 ${
                    submissionTargetStatus
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-amber-600 hover:bg-amber-700'
                  }`}
                >
                  {submittingAction
                    ? 'Updating...'
                    : submissionTargetStatus
                    ? 'Confirm Submission'
                    : 'Confirm Revert'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Revoke Modal */}
      {revokingCert && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 border border-slate-200">
            <div className="flex items-center gap-2 text-rose-600">
              <XCircle className="w-6 h-6" />
              <h3 className="text-base font-bold text-slate-900">Revoke Certificate</h3>
            </div>

            <p className="text-xs text-slate-600">
              You are about to revoke certificate <span className="font-mono font-bold text-slate-900">[{revokingCert.certificateNumber}]</span>. This action is permanent and the certificate number will be retired.
            </p>

            {modalError && (
              <ErrorAlert
                error={modalError}
                onDismiss={() => setModalError(null)}
                title="Revocation Blocked"
              />
            )}

            <form onSubmit={handleExecuteRevocation} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Revocation Reason *</label>
                <textarea
                  value={revocationReason}
                  onChange={(e) => setRevocationReason(e.target.value)}
                  placeholder="e.g. Certificate issued in error due to unrecorded library fine."
                  rows={3}
                  required
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-medium text-slate-900"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRevokingCert(null)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-md disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? 'Revoking...' : 'Confirm Revocation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
