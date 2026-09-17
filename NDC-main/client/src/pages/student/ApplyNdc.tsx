import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { ClearanceStatusBadge } from '../../components/ClearanceStatusBadge';
import { ProgressRing } from '../../components/ProgressRing';
import { FileCheck2, Award, AlertCircle, CheckCircle2, Clock, Ban, DollarSign } from 'lucide-react';

export const ApplyNdc: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    try {
      const response = await api.get('/ndc/student-status');
      setData(response.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    setError('');
    try {
      await api.post('/ndc/apply');
      await fetchStatus();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to submit NDC application.');
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500 font-semibold">Loading clearance details...</div>;
  }

  const { student, ndcRequest, clearances, progress, hasActiveRequest } = data || {};

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900">No Due Certificate Application</h2>
          <p className="text-xs text-slate-500">Track real-time institutional clearances and download certificate</p>
        </div>

        {hasActiveRequest && ndcRequest?.status === 'APPROVED' && ndcRequest?.certificateId && (
          <a
            href={`/api/v1/certificates/${ndcRequest.certificateId._id || ndcRequest.certificateId}/download`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-md transition-all flex items-center gap-2"
          >
            <Award className="w-4 h-4" />
            Download PDF Certificate
          </a>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
          {error}
        </div>
      )}

      {!hasActiveRequest ? (
        <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm text-center max-w-xl mx-auto space-y-6">
          <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto">
            <FileCheck2 className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Ready to Apply?</h3>
            <p className="text-xs text-slate-500 mt-1">
              Submitting an NDC request will automatically dispatch clearance tasks to Library, Finance, Department, Hostel, Stores, and required sections.
            </p>
          </div>

          <button
            onClick={handleApply}
            disabled={applying}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-md transition-all disabled:opacity-50"
          >
            {applying ? 'Creating Application Tasks...' : 'Confirm & Apply Now'}
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Header Card */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="space-y-1 text-center md:text-left">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Application Reference</span>
              <h3 className="text-xl font-bold font-mono text-slate-900">{ndcRequest.requestNumber}</h3>
              <p className="text-xs text-slate-500">
                Submitted on {new Date(ndcRequest.submittedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>

            <div className="flex items-center gap-6">
              <ProgressRing percentage={progress.percentage} size={100} strokeWidth={9} />
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Overall Status</p>
                <div className="mt-1">
                  <ClearanceStatusBadge status={ndcRequest.status} size="lg" />
                </div>
              </div>
            </div>
          </div>

          {/* Department Tasks List */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-slate-900">Clearance Departments Status</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {clearances?.map((task: any) => (
                <div
                  key={task._id}
                  className={`p-5 rounded-2xl border transition-all ${
                    task.status === 'CLEARED'
                      ? 'border-emerald-200 bg-emerald-50/40'
                      : task.status === 'DUE'
                      ? 'border-rose-200 bg-rose-50/40'
                      : task.status === 'ON_HOLD'
                      ? 'border-indigo-200 bg-indigo-50/40'
                      : 'border-slate-200 bg-slate-50/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">
                        {task.departmentId?.name || task.departmentName || 'Clearance Section'}
                      </h4>
                      {task.departmentId?.code && (
                        <p className="text-xs text-slate-500 font-mono mt-0.5">Code: {task.departmentId.code}</p>
                      )}
                    </div>
                    <ClearanceStatusBadge status={task.status} />
                  </div>

                  {task.status === 'DUE' && (
                    <div className="p-3 bg-rose-100/90 rounded-xl border border-rose-200 text-xs text-rose-900 space-y-1 mt-2">
                      <div className="flex items-center gap-1.5 font-bold text-rose-800">
                        <DollarSign className="w-4 h-4" />
                        Pending Dues Amount: ₹{task.dueAmount}
                      </div>
                    </div>
                  )}

                  {task.reviewedAt && (
                    <p className="text-[10px] text-slate-400 mt-3 pt-2 border-t border-slate-200/60">
                      Reviewed on {new Date(task.reviewedAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
