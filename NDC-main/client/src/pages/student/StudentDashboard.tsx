import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import { ProgressRing } from '../../components/ProgressRing';
import { ClearanceStatusBadge } from '../../components/ClearanceStatusBadge';
import { FileCheck2, Award, ArrowRight, User, BookOpen, Building, CheckCircle2, AlertCircle } from 'lucide-react';
import { clientCache } from '../../utils/clientCache';

export const StudentDashboard: React.FC = () => {
  const [data, setData] = useState<any>(() => clientCache.get('student_ndc_status'));
  const [loading, setLoading] = useState<boolean>(() => !clientCache.get('student_ndc_status'));

  useEffect(() => {
    fetchStatus(!data);
  }, []);

  const fetchStatus = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const response = await api.get('/ndc/student-status');
      setData(response.data);
      clientCache.set('student_ndc_status', response.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-12 text-center text-slate-400 font-semibold animate-pulse">Loading student dashboard...</div>;
  }

  const { student, ndcRequest, clearances, progress, hasActiveRequest } = data || {};

  return (
    <div className="space-y-6">
      {/* Student Welcome Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-zinc-900 rounded-3xl p-6 sm:p-8 text-white shadow-soft-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full blur-3xl pointer-events-none" />

        <div className="space-y-2.5 relative z-10">
          <span className="px-3 py-1 bg-white/10 backdrop-blur-md text-white rounded-full text-[11px] font-bold uppercase tracking-wider border border-white/20">
            Student Portal
          </span>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight">{student?.fullName}</h2>
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300 font-medium">
            <span className="flex items-center gap-1.5 font-mono font-bold bg-white/10 px-2.5 py-1 rounded-lg"><BookOpen className="w-3.5 h-3.5" /> USN: {student?.usn}</span>
            <span className="flex items-center gap-1.5 font-semibold"><Building className="w-3.5 h-3.5" /> {student?.departmentId?.name || 'Department'}</span>
            <span className="bg-white/20 px-2.5 py-1 rounded-lg font-bold">{student?.batch}</span>
          </div>
        </div>

        {hasActiveRequest && ndcRequest?.status === 'APPROVED' && ndcRequest?.certificateId && (
          <a
            href={`/api/v1/certificates/${ndcRequest.certificateId._id || ndcRequest.certificateId}/download?token=${localStorage.getItem('ndc_token') || ''}`}
            download={`NDC_${ndcRequest.certificateId?.certificateNumber || 'Certificate'}.pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-2xl text-xs sm:text-sm shadow-soft-md hover:shadow-soft-lg transition-all flex items-center gap-2 cursor-pointer relative z-10 shrink-0"
          >
            <Award className="w-5 h-5" />
            Download Official Certificate
          </a>
        )}
      </div>

      {/* NDC Request Overview Card */}
      {!hasActiveRequest ? (
        <div className="bg-white/90 backdrop-blur-sm rounded-3xl p-8 sm:p-12 border border-slate-200/80 text-center shadow-soft-sm space-y-4">
          <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto shadow-soft-xs border border-indigo-100">
            <FileCheck2 className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-black text-slate-900 tracking-tight">Institutional Clearance Status</h3>
          <p className="text-xs sm:text-sm text-slate-500 max-w-lg mx-auto font-medium">
            Your clearance evaluation is active across college departments. As soon as all required departments complete their verification, your No Due Certificate will be issued.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Status & Progress Summary */}
          <div className="bg-white/90 backdrop-blur-sm rounded-3xl p-6 sm:p-7 border border-slate-200/80 shadow-soft-sm space-y-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-5">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Institutional Status</span>
                <ClearanceStatusBadge status={ndcRequest.status} size="lg" />
              </div>

              <div className="space-y-3 text-xs">
                <div className="flex justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Record Number</span>
                  <span className="font-mono font-bold text-slate-900">{ndcRequest.requestNumber}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Initialized On</span>
                  <span className="font-semibold text-slate-700">{new Date(ndcRequest.submittedAt).toLocaleDateString()}</span>
                </div>
                {ndcRequest.certificateId && (
                  <div className="flex justify-between py-2 border-b border-slate-100">
                    <span className="text-slate-500 font-medium">Certificate Ref</span>
                    <span className="font-mono font-bold text-emerald-600">{ndcRequest.certificateId.certificateNumber}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="text-center pt-5 border-t border-slate-100 flex flex-col items-center">
              <ProgressRing percentage={progress.percentage} size={140} strokeWidth={12} />
              <p className="text-xs font-bold text-slate-600 mt-4">
                {progress.cleared} of {progress.total} Departments Cleared
              </p>
            </div>
          </div>

          {/* Quick Clearance Department Breakdown List */}
          <div className="lg:col-span-2 bg-white/90 backdrop-blur-sm rounded-3xl p-6 sm:p-7 border border-slate-200/80 shadow-soft-sm space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 tracking-tight">Departmental Clearance Evaluation</h3>
              <span className="text-xs text-slate-400 font-medium">Real-time status updates</span>
            </div>

            <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
              {clearances?.map((task: any) => (
                <div key={task._id} className="p-4 rounded-2xl border border-slate-200/70 bg-slate-50/70 hover:bg-slate-100/60 transition-colors flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">{task.departmentId?.name}</h4>
                    <p className="text-xs text-slate-500 font-medium mt-0.5">{task.departmentId?.description || 'Departmental clearance requirement'}</p>
                    {task.status === 'DUE' && (
                      <div className="mt-2.5 p-3 bg-rose-50 border border-rose-200/80 rounded-xl text-xs text-rose-800 font-medium space-y-1">
                        <p><span className="font-bold">Outstanding Due:</span> ₹{task.dueAmount}</p>
                      </div>
                    )}
                  </div>
                  <ClearanceStatusBadge status={task.status} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
