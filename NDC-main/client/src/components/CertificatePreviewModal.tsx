import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { Download, X, CheckCircle2, ShieldCheck, Award } from 'lucide-react';

interface CertificatePreviewModalProps {
  certificate: any;
  onClose: () => void;
}

export const CertificatePreviewModal: React.FC<CertificatePreviewModalProps> = ({ certificate, onClose }) => {
  if (!certificate) return null;

  const [clearances, setClearances] = useState<any[]>([]);
  const [loadingClearances, setLoadingClearances] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    fetchClearanceDetails();
  }, [certificate]);

  const fetchClearanceDetails = async () => {
    const reqId = certificate.ndcRequestId?._id || certificate.ndcRequestId?.id || certificate.ndcRequestId || certificate.requestId;
    if (!reqId) return;

    setLoadingClearances(true);
    try {
      const res = await api.get(`/ndc/requests/${reqId}`);
      if (res.data.data?.clearances) {
        setClearances(res.data.data.clearances);
      }
    } catch (err) {
      console.error('Error loading clearance tasks for certificate preview:', err);
    } finally {
      setLoadingClearances(false);
    }
  };

  const token = localStorage.getItem('ndc_token') || '';
  const downloadUrl = `/api/v1/certificates/${certificate._id}/download?token=${token}`;

  const studentName = certificate.studentId?.fullName || certificate.studentName || 'Student Name';
  const usn = certificate.studentId?.usn || certificate.studentUsn || 'N/A';
  const deptName = certificate.studentId?.departmentId?.name || certificate.departmentName || 'Department';
  const batch = certificate.studentId?.batch || '2022-2026';
  const acadYear = certificate.studentId?.academicYear || '2025-2026';

  const defaultDesks = [
    { code: 'LIB', name: 'Central Library', status: 'PENDING' },
    { code: 'LAB', name: 'Laboratory In-charges', status: 'PENDING' },
    { code: 'HST', name: 'Hostel Warden / Administration', status: 'PENDING' },
    { code: 'SPT', name: 'Physical Education / Sports Section', status: 'PENDING' },
    { code: 'ACC', name: 'Cash/Fee Section', status: 'PENDING' },
    { code: 'ACAD', name: `Academic Department (${deptName})`, status: 'PENDING' }
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[90vh] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Toolbar Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-blue-600" />
            <h3 className="font-bold text-sm text-slate-800">
              No Due Certificate Preview — <span className="font-mono text-blue-700">{certificate.certificateNumber || 'Preview'}</span>
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={downloadUrl}
              download={`NDC_${certificate.certificateNumber || 'Certificate'}.pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-xs transition-colors shadow-2xs"
            >
              <Download className="w-3.5 h-3.5" />
              Download PDF
            </a>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Certificate Paper Canvas */}
        <div className="overflow-y-auto p-6 bg-slate-100 flex justify-center">
          <div className="w-full bg-white border-2 border-slate-300 rounded-xl p-8 shadow-sm space-y-6 relative">
            {/* Header with College Emblem / Typography */}
            <div className="text-center border-b-2 border-slate-900 pb-5 space-y-1">
              <span className="caption-text font-bold tracking-widest text-slate-500 uppercase">Government of Karnataka · Autonomous Institution</span>
              <h1 className="text-lg font-black tracking-tight text-slate-900 uppercase">
                Malnad College of Engineering
              </h1>
              <p className="caption-text text-slate-600 font-medium">Hassan - 573202, Karnataka, India · Affiliated to VTU, Belagavi</p>
              <div className="pt-2">
                <span className="inline-block px-4 py-1 rounded bg-blue-900 text-white font-bold text-xs uppercase tracking-wider">
                  No Due Certificate (Clearance Record)
                </span>
              </div>
            </div>

            {/* Certificate Meta Details */}
            <div className="flex items-center justify-between text-xs px-1">
              <span className="mono-text text-slate-600">
                <strong className="text-slate-900">Certificate Ref:</strong> {certificate.certificateNumber || 'PENDING'}
              </span>
              <span className="mono-text text-slate-600">
                <strong className="text-slate-900">Date of Verification:</strong> {new Date(certificate.issuedAt || new Date()).toLocaleDateString('en-GB')}
              </span>
            </div>

            {/* Student Credential Grid */}
            <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs">
              <div className="space-y-1">
                <span className="caption-text font-semibold uppercase text-slate-500">Candidate Full Name</span>
                <p className="font-bold text-slate-900 text-sm">{studentName}</p>
              </div>

              <div className="space-y-1">
                <span className="caption-text font-semibold uppercase text-slate-500">University Seat No (USN)</span>
                <p className="mono-text font-bold text-blue-700 text-sm">{usn}</p>
              </div>

              <div className="space-y-1">
                <span className="caption-text font-semibold uppercase text-slate-500">Department / Major</span>
                <p className="font-semibold text-slate-800">{deptName}</p>
              </div>

              <div className="space-y-1">
                <span className="caption-text font-semibold uppercase text-slate-500">Batch / Academic Year</span>
                <p className="mono-text font-semibold text-slate-800">{batch} ({acadYear})</p>
              </div>
            </div>

            {/* Itemized Clearance Table */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-800 px-1">
                <span>Department Clearance Approvals</span>
                <span className="text-[11px] text-blue-700 font-semibold flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" /> Departmental Verification Breakdown
                </span>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
                <table className="w-full text-left">
                  <thead className="bg-blue-950 text-white font-semibold text-[11px]">
                    <tr>
                      <th className="py-2 px-3 w-8">#</th>
                      <th className="py-2 px-3">Clearance Department</th>
                      <th className="py-2 px-3 w-16">Code</th>
                      <th className="py-2 px-3 w-28">Status</th>
                      <th className="py-2 px-3 text-right">Approval Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-800">
                    {(clearances.length > 0 ? clearances : defaultDesks)
                      .filter((desk: any) => {
                        if (desk.departmentId && desk.departmentId.requiresClearance === false) return false;
                        if (desk.requiresClearance === false) return false;
                        if (desk.departmentId?.code === 'ADM' || desk.code === 'ADM') return false;
                        return true;
                      })
                      .map((desk: any, idx: number) => {
                      const deptTitle = desk.departmentId?.name || desk.name;
                      const deptCode = desk.departmentId?.code || desk.code;
                      const deskStatus = String(desk.status || 'PENDING').toUpperCase();
                      const isCleared = deskStatus === 'CLEARED' || deskStatus === 'NOT_APPLICABLE' || deskStatus === 'APPROVED';
                      const isDue = deskStatus === 'DUE' || deskStatus === 'BLOCKED';
                      const ts = desk.reviewedAt || desk.updatedAt || certificate.issuedAt || new Date();
                      const formattedTs = desk.reviewedAt || isCleared ? new Date(ts).toLocaleString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                      }) : 'Pending Review';

                      return (
                        <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                          <td className="py-2 px-3 text-slate-400 font-mono">{idx + 1}</td>
                          <td className="py-2 px-3 font-semibold text-slate-900">{deptTitle}</td>
                          <td className="py-2 px-3 mono-text font-bold text-blue-700">{deptCode}</td>
                          <td className="py-2 px-3">
                            {isCleared ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" /> NO DUES
                              </span>
                            ) : isDue ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[11px] font-bold">
                                DUE
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[11px] font-bold">
                                PENDING
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right mono-text text-slate-600 text-[11px] font-medium">
                            {formattedTs}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Signature Block */}
            <div className="pt-6 border-t border-slate-200 flex items-center justify-end text-xs">
              <div className="text-center space-y-1">
                <div className="w-44 border-b border-slate-400 mx-auto mb-1"></div>
                <p className="font-bold text-slate-900 text-sm">
                  {certificate.studentId?.departmentId?.hodName || 'Head of the Department'}
                </p>
                <p className="text-[11px] font-semibold text-slate-700">
                  Head of the Department
                </p>
                <p className="text-[10px] text-slate-500">
                  Dept. of {deptName}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
