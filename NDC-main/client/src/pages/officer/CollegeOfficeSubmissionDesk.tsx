import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { useAuthStore } from '../../store/useAuthStore';
import { CertificatePreviewModal } from '../../components/CertificatePreviewModal';
import {
  Search,
  CheckCircle2,
  Clock,
  Award,
  FileDown,
  Eye,
  Calendar,
  Filter,
  Check,
  RotateCcw,
  Building2,
  X,
  Layers,
  ChevronLeft,
  ChevronRight,
  TrendingUp
} from 'lucide-react';

export const CollegeOfficeSubmissionDesk: React.FC = () => {
  const { user } = useAuthStore();
  const [certificates, setCertificates] = useState<any[]>([]);
  const [counts, setCounts] = useState({
    total: 0,
    submitted: 0,
    notSubmitted: 0,
    submissionRate: 0
  });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'ALL' | 'SUBMITTED' | 'NOT_SUBMITTED'>('ALL');
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });

  // Modals & Action States
  const [previewCert, setPreviewCert] = useState<any>(null);
  const [selectedForSubmission, setSelectedForSubmission] = useState<any>(null);
  const [submissionRemarks, setSubmissionRemarks] = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  useEffect(() => {
    fetchCertificates();
  }, [activeTab, search, startDate, endDate, page, limit]);

  const fetchCertificates = async () => {
    try {
      setLoading(true);
      const params: any = {
        page,
        limit,
        status: 'VALID'
      };

      if (activeTab === 'SUBMITTED') params.submissionStatus = 'SUBMITTED';
      else if (activeTab === 'NOT_SUBMITTED') params.submissionStatus = 'NOT_SUBMITTED';

      if (search) params.search = search;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const res = await api.get('/certificates', { params });
      setCertificates(res.data.data || []);
      if (res.data.counts) {
        setCounts(res.data.counts);
      }
      if (res.data.pagination) {
        setPagination({
          total: res.data.pagination.total,
          totalPages: res.data.pagination.totalPages || 1
        });
      }
    } catch (err) {
      console.error('Error fetching certificates for College Office submission registry:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkSubmitted = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedForSubmission) return;

    try {
      setSubmittingAction(true);
      await api.put(`/certificates/${selectedForSubmission._id || selectedForSubmission.id}/submission`, {
        isSubmitted: true,
        remarks: submissionRemarks || 'Physical copy received at College Office'
      });

      setSelectedForSubmission(null);
      setSubmissionRemarks('');
      await fetchCertificates();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to update physical submission status.');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleRevertSubmission = async (cert: any) => {
    const confirm = window.confirm(
      `Revert physical certificate submission for ${cert.student?.fullName || cert.studentName} (${cert.student?.usn || cert.studentUsn})?`
    );
    if (!confirm) return;

    try {
      setSubmittingAction(true);
      await api.put(`/certificates/${cert._id || cert.id}/submission`, {
        isSubmitted: false,
        remarks: ''
      });
      await fetchCertificates();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to revert submission status.');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleGeneratePdfReport = async () => {
    try {
      setDownloadingPdf(true);
      const params: any = {};
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (activeTab !== 'ALL') params.submissionStatus = activeTab;
      if (search) params.search = search;

      const response = await api.get('/certificates/submission-report/pdf', {
        params,
        responseType: 'blob'
      });

      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const dateSuffix = startDate || endDate ? `_${startDate || 'start'}_to_${endDate || 'end'}` : '';
      link.download = `Physical_Certificate_Submission_Report${dateSuffix}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Error generating submission report PDF:', err);
      alert('Failed to generate submission report PDF.');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const clearDateRange = () => {
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="section-head">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">📋</span>
            <h1 className="page-title">College Office — Physical Certificate Collection Desk</h1>
          </div>
          <p className="caption-text mt-1">
            Collect physical No Due Certificates submitted by students, record receipt verification, and export date-range official reports.
          </p>
        </div>

        {/* Generate PDF Report Button */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleGeneratePdfReport}
            disabled={downloadingPdf}
            className="btn btn-primary h-9 text-xs px-3.5 flex items-center gap-2 shadow-xs"
            title="Generate and download official PDF report"
          >
            <FileDown className={`w-4 h-4 ${downloadingPdf ? 'animate-bounce' : ''}`} />
            <span>{downloadingPdf ? 'Generating PDF...' : 'Generate PDF Report'}</span>
          </button>
        </div>
      </div>

      {/* 4 Fraunces Display Stat Cards in Single Row */}
      <div className="stat-row-5">
        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--cobalt-50)', color: 'var(--cobalt-600)' }}>
              <Award className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg text-slate-900">{counts.total}</div>
          <div className="caption-text mt-1">Total Issued Certificates</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--success-50)', color: 'var(--success-600)' }}>
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg text-emerald-600">{counts.submitted}</div>
          <div className="caption-text mt-1">Physically Submitted</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--warning-50)', color: 'var(--warning-600)' }}>
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg text-amber-600">{counts.notSubmitted}</div>
          <div className="caption-text mt-1">Pending Submission</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--cobalt-50)', color: 'var(--cobalt-600)' }}>
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg text-blue-700">{counts.submissionRate}%</div>
          <div className="caption-text mt-1">Collection Rate</div>
        </div>
      </div>

      {/* Filters, Date Range & Search Container */}
      <div className="table-wrap">
        <div className="p-4 border-b border-slate-200 bg-white space-y-3">
          {/* Top Bar: Tabs & Search */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                { id: 'ALL', label: 'All Certificates', count: counts.total },
                { id: 'SUBMITTED', label: 'Submitted', count: counts.submitted },
                { id: 'NOT_SUBMITTED', label: 'Pending Submission', count: counts.notSubmitted }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id as any);
                    setPage(1);
                  }}
                  className={`pill-filter ${activeTab === tab.id ? 'active' : ''}`}
                >
                  <span>{tab.label}</span>
                  <span className="ml-1 text-[10px] opacity-75 font-mono">({tab.count})</span>
                </button>
              ))}
            </div>

            <div className="relative max-w-xs w-full">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search USN, name, certificate..."
                className="input text-xs w-full"
                style={{ paddingLeft: '34px' }}
              />
            </div>
          </div>

          {/* Bottom Bar: Date Range Pickers */}
          <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-slate-500 font-semibold">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>Date Range:</span>
              </div>

              <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
                <span className="text-[11px] text-slate-400">From:</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setPage(1);
                  }}
                  className="bg-transparent border-0 text-xs font-semibold text-slate-700 outline-hidden p-0"
                />
              </div>

              <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
                <span className="text-[11px] text-slate-400">To:</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setPage(1);
                  }}
                  className="bg-transparent border-0 text-xs font-semibold text-slate-700 outline-hidden p-0"
                />
              </div>

              {(startDate || endDate) && (
                <button
                  onClick={clearDateRange}
                  className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded text-xs flex items-center gap-1 font-semibold"
                  title="Clear Date Range"
                >
                  <X className="w-3 h-3" />
                  <span>Reset Dates</span>
                </button>
              )}
            </div>

            <span className="text-slate-400 text-[11px] font-medium italic">
              PDF reports will filter based on the active tab and date range.
            </span>
          </div>
        </div>

        {/* Certificate Table */}
        {loading ? (
          <div className="p-12 text-center text-slate-500 font-semibold">Loading physical certificate records...</div>
        ) : certificates.length === 0 ? (
          <div className="p-12 text-center text-slate-500 font-semibold">
            No certificates found matching the selected criteria.
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
                    <th>Certificate Ref</th>
                    <th>Issued Date</th>
                    <th>Physical Status</th>
                    <th className="text-right">Collection Action</th>
                  </tr>
                </thead>
                <tbody>
                  {certificates.map((cert) => {
                    const studentName = cert.student?.fullName || cert.studentName || 'Student';
                    const initials = studentName.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase();
                    const isSubmitted = Boolean(cert.isSubmitted);
                    const usn = cert.student?.usn || cert.studentUsn || 'N/A';
                    const branch = cert.student?.department?.name || cert.departmentName || cert.student?.batch || 'N/A';

                    return (
                      <tr key={cert._id || cert.id} className={isSubmitted ? 'bg-emerald-50/20' : ''}>
                        <td>
                          <div className="name-cell">
                            <div className="avatar-sm">{initials}</div>
                            <span className="cell-primary font-bold text-slate-900">{studentName}</span>
                          </div>
                        </td>
                        <td className="mono-text font-bold text-blue-700">{usn}</td>
                        <td className="text-slate-600 text-xs font-medium">{branch}</td>
                        <td>
                          <div className="flex items-center gap-1.5">
                            <span className="mono-text font-bold text-xs text-slate-800">{cert.certificateNumber}</span>
                            <button
                              type="button"
                              onClick={() => setPreviewCert(cert)}
                              className="text-slate-400 hover:text-blue-600 p-0.5 rounded transition-colors"
                              title="Preview Certificate"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                        <td className="text-xs text-slate-500">
                          {new Date(cert.issuedAt).toLocaleDateString('en-GB', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric'
                          })}
                        </td>
                        <td>
                          {isSubmitted ? (
                            <div className="flex flex-col">
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full w-fit">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                <span>Submitted</span>
                              </span>
                              {cert.submittedAt && (
                                <span className="text-[10px] text-slate-400 mt-0.5 font-mono">
                                  {new Date(cert.submittedAt).toLocaleDateString('en-GB', {
                                    day: '2-digit',
                                    month: 'short'
                                  })}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full w-fit">
                              <Clock className="w-3 h-3 text-amber-600" />
                              <span>Not Submitted</span>
                            </span>
                          )}
                        </td>
                        <td className="text-right">
                          {isSubmitted ? (
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                                <Check className="w-3.5 h-3.5" /> Received
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRevertSubmission(cert)}
                                className="text-[10px] text-slate-400 hover:text-slate-700 hover:underline transition-colors"
                                title="Revert physical submission mark"
                              >
                                Revert
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setSelectedForSubmission(cert)}
                              className="py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Mark Submitted</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
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
                  <option value={25}>25 per page</option>
                  <option value={50}>50 per page</option>
                  <option value={100}>100 per page</option>
                </select>

                <span className="mono-text font-semibold text-slate-600 ml-2">
                  {pagination.total > 0
                    ? `${(page - 1) * limit + 1}–${Math.min(page * limit, pagination.total)} of ${pagination.total} certificates`
                    : '0 of 0 certificates'}
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
                  if (pagination.totalPages <= 5) pageNum = i + 1;
                  else if (page <= 3) pageNum = i + 1;
                  else if (page >= pagination.totalPages - 2) pageNum = pagination.totalPages - 4 + i;
                  else pageNum = page - 2 + i;

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

      {/* Record Physical Certificate Submission Modal */}
      {selectedForSubmission && (
        <>
          <div className="drawer-scrim" onClick={() => setSelectedForSubmission(null)} />
          <div className="modal open max-w-md rounded-2xl p-0 overflow-hidden border border-slate-200/80 shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-white">
              <div>
                <h3 className="text-base font-bold text-slate-900">Record Physical Certificate Submission</h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  {selectedForSubmission.student?.fullName || selectedForSubmission.studentName} ·{' '}
                  <span className="font-mono text-blue-600 font-bold">
                    {selectedForSubmission.student?.usn || selectedForSubmission.studentUsn}
                  </span>
                </p>
              </div>
              <button
                onClick={() => setSelectedForSubmission(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleMarkSubmitted}>
              <div className="p-5 space-y-4 bg-white text-xs">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 font-medium leading-relaxed">
                  Confirm receipt of the physical, signed No Due Certificate for certificate ref:{' '}
                  <strong className="font-mono">{selectedForSubmission.certificateNumber}</strong>.
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1.5 uppercase tracking-wider text-[11px]">
                    Receipt Remarks (Optional)
                  </label>
                  <input
                    type="text"
                    value={submissionRemarks}
                    onChange={(e) => setSubmissionRemarks(e.target.value)}
                    placeholder="e.g. Physical hard copy verified & received at Counter 2"
                    className="input text-xs w-full"
                  />
                </div>
              </div>

              <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedForSubmission(null)}
                  className="flex-1 py-2.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold rounded-xl text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAction}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{submittingAction ? 'Saving...' : 'Confirm Submission'}</span>
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* Certificate Preview Modal */}
      {previewCert && (
        <CertificatePreviewModal certificate={previewCert} onClose={() => setPreviewCert(null)} />
      )}
    </div>
  );
};
