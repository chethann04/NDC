import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { ProgressRing } from '../../components/ProgressRing';
import { ClearanceStatusBadge } from '../../components/ClearanceStatusBadge';
import {
  FileCheck2,
  Award,
  BookOpen,
  Building,
  CheckCircle2,
  AlertCircle,
  Send,
  Library,
  FlaskConical,
  Home,
  Trophy,
  Wallet,
  GraduationCap,
  Clock,
  X,
  ChevronDown,
  ChevronUp,
  Mail
} from 'lucide-react';
import { clientCache } from '../../utils/clientCache';

const getDepartmentIcon = (code?: string, name?: string) => {
  const c = (code || '').toUpperCase();
  const n = (name || '').toLowerCase();
  if (c.includes('LIB') || n.includes('library')) return Library;
  if (c.includes('LAB') || c === 'PHY' || c === 'CHEM' || n.includes('lab') || n.includes('physics') || n.includes('chemistry')) return FlaskConical;
  if (c.includes('HST') || n.includes('hostel')) return Home;
  if (c.includes('SPT') || c.includes('PE') || n.includes('sport') || n.includes('physical')) return Trophy;
  if (c.includes('ACC') || n.includes('cash') || n.includes('fee')) return Wallet;
  return GraduationCap;
};

const DEFAULT_TARGET_DEPARTMENTS = [
  { name: 'Central Library', code: 'LIB', icon: Library },
  { name: 'Laboratory / Workshop', code: 'LAB', icon: FlaskConical },
  { name: 'Student Hostel', code: 'HSTL', icon: Home },
  { name: 'Physical Education / Sports', code: 'PE', icon: Trophy },
  { name: 'Cash & Fees Counter', code: 'ACC', icon: Wallet },
  { name: 'Academic Dept (HOD)', code: 'DEPT', icon: GraduationCap }
];

export const StudentDashboard: React.FC = () => {
  const [data, setData] = useState<any>(() => clientCache.get('student_ndc_status'));
  const [loading, setLoading] = useState<boolean>(() => !clientCache.get('student_ndc_status'));
  const [showAllLabs, setShowAllLabs] = useState<boolean>(false);

  useEffect(() => {
    fetchStatus(!data);

    // Live sync: immediately refresh whenever student switches to this tab
    const handleSync = () => {
      if (document.visibilityState === 'visible') {
        fetchStatus(false);
      }
    };

    window.addEventListener('focus', handleSync);
    document.addEventListener('visibilitychange', handleSync);

    // Periodic live sync polling every 4 seconds while dashboard is open
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchStatus(false);
      }
    }, 4000);

    return () => {
      window.removeEventListener('focus', handleSync);
      document.removeEventListener('visibilitychange', handleSync);
      clearInterval(interval);
    };
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
      if (showLoading) setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-16 text-center text-slate-400 font-semibold flex flex-col items-center gap-3 animate-pulse">
        <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs">Loading student dashboard...</span>
      </div>
    );
  }

  const { student, ndcRequest, clearances, progress, hasActiveRequest } = data || {};

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Student Welcome Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-zinc-900 rounded-3xl p-6 sm:p-8 text-white shadow-soft-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full blur-3xl pointer-events-none" />

        <div className="space-y-2.5 relative z-10">
          <span className="px-3 py-1 bg-white/10 backdrop-blur-md text-white rounded-full text-[11px] font-bold uppercase tracking-wider border border-white/20">
            Student Clearance Portal
          </span>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight">{student?.fullName}</h2>
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300 font-medium">
            <span className="flex items-center gap-1.5 font-mono font-bold bg-white/10 px-2.5 py-1 rounded-lg">
              <BookOpen className="w-3.5 h-3.5" /> USN: {student?.usn}
            </span>
            <span className="flex items-center gap-1.5 font-semibold">
              <Building className="w-3.5 h-3.5" /> {student?.departmentId?.name || student?.department?.name || 'Department'}
            </span>
            {student?.email && (
              <span className="flex items-center gap-1.5 font-medium bg-white/10 px-2.5 py-1 rounded-lg">
                <Mail className="w-3.5 h-3.5 text-blue-300" /> {student.email}
              </span>
            )}
            <span className="bg-white/20 px-2.5 py-1 rounded-lg font-bold">
              Batch {student?.batch}
            </span>
          </div>
        </div>

        {/* Action Button on Welcome Banner */}
        {hasActiveRequest && ndcRequest?.status === 'APPROVED' && ndcRequest?.certificateId ? (
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
        ) : hasActiveRequest ? (
          <div className="flex items-center gap-2.5 bg-white/10 backdrop-blur-md px-4 py-2.5 rounded-2xl border border-white/20 text-xs font-bold relative z-10">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>NDC Clearance In Progress ({progress?.cleared || 0} / {progress?.total || 0} Cleared)</span>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 bg-white/10 backdrop-blur-md px-4 py-2.5 rounded-2xl border border-white/20 text-xs font-bold relative z-10">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Automatic Institutional Clearance ({progress?.cleared || 0} / {progress?.total || 0} Cleared)</span>
          </div>
        )}
      </div>

      {/* Live Status & Department Progress */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Status & Progress Summary Card */}
          <div className="bg-white rounded-3xl p-6 sm:p-7 border border-slate-200/80 shadow-soft-sm space-y-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-5">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">NDC Status</span>
                  <div className="text-xs font-bold text-emerald-600 mt-0.5 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {ndcRequest.status === 'APPROVED' ? 'Approved & Ready' : 'NDC Requested ✓'}
                  </div>
                </div>
                <ClearanceStatusBadge status={ndcRequest.status} size="lg" />
              </div>

              <div className="space-y-3 text-xs">
                <div className="flex justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Record Number</span>
                  <span className="font-mono font-bold text-slate-900">{ndcRequest.requestNumber}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500 font-medium">Submitted On</span>
                  <span className="font-semibold text-slate-700">{new Date(ndcRequest.submittedAt).toLocaleDateString()}</span>
                </div>
                {ndcRequest.remarks && (
                  <div className="py-2 border-b border-slate-100">
                    <span className="text-slate-400 text-[10px] font-bold uppercase block">Purpose</span>
                    <span className="text-slate-700 italic font-medium">{ndcRequest.remarks}</span>
                  </div>
                )}
                {ndcRequest.certificateId && (
                  <div className="flex justify-between py-2 border-b border-slate-100">
                    <span className="text-slate-500 font-medium">Certificate Ref</span>
                    <span className="font-mono font-bold text-emerald-600">{ndcRequest.certificateId.certificateNumber}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="text-center pt-5 border-t border-slate-100 flex flex-col items-center">
              <ProgressRing percentage={progress?.percentage || 0} size={130} strokeWidth={12} />
              <p className="text-xs font-bold text-slate-700 mt-4">
                {progress?.cleared || 0} of {progress?.total || 0} Departments Cleared
              </p>
              <div className="w-full bg-slate-100 rounded-full h-2.5 mt-3 overflow-hidden">
                <div
                  className="bg-blue-600 h-2.5 rounded-full transition-all duration-500"
                  style={{ width: `${progress?.percentage || 0}%` }}
                />
              </div>
              <span className="text-[11px] font-bold text-blue-600 mt-1">{progress?.percentage || 0}% Complete</span>
            </div>
          </div>

          {/* Quick Clearance Department Breakdown List */}
          <div className="lg:col-span-2 bg-white rounded-3xl p-6 sm:p-7 border border-slate-200/80 shadow-soft-sm space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 tracking-tight">Departmental Clearance Evaluation</h3>
                <p className="text-xs text-slate-500">Real-time status across all clearance sections</p>
              </div>
              <span className="text-xs text-slate-400 font-medium bg-slate-50 px-3 py-1 rounded-full border border-slate-200/60">
                Live Status
              </span>
            </div>

            <div className="space-y-3 max-h-[440px] overflow-y-auto pr-1">
              {clearances?.filter((task: any) => {
                if (task.departmentId?.requiresClearance === false) return false;
                if (task.department?.requiresClearance === false) return false;
                if (task.departmentId?.isActive === false) return false;
                if (task.department?.isActive === false) return false;
                return true;
              }).map((task: any) => {
                const isLab = task.isAggregatedLab || (task.departmentId?.code || task.department?.code) === 'LAB';
                const isOverallLabNoDue = isLab && (task.labSummary?.overallLaboratoryStatus === 'NO DUE' || task.status === 'CLEARED');
                const isCleared = isLab ? isOverallLabNoDue : (task.status === 'CLEARED' || task.status === 'NOT_APPLICABLE');
                const isDue = isLab ? !isOverallLabNoDue : (task.status === 'DUE');
                const isOnHold = !isLab && task.status === 'ON_HOLD';

                // Display badge for laboratory: "Due" when Due, "Cleared" when No Due
                const badgeStatus = isLab
                  ? isOverallLabNoDue
                    ? 'CLEARED'
                    : 'DUE'
                  : task.status;

                return (
                  <div
                    key={task._id || task.id}
                    className={`p-4 rounded-2xl border transition-all ${
                      isCleared
                        ? 'border-emerald-200/80 bg-emerald-50/40'
                        : isDue
                        ? 'border-rose-200 bg-rose-50/50'
                        : isOnHold
                        ? 'border-indigo-200 bg-indigo-50/40'
                        : 'border-slate-200/70 bg-slate-50/70'
                    } flex flex-col gap-3`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {isLab ? (
                            <FlaskConical className="w-4 h-4 text-blue-600 shrink-0" />
                          ) : null}
                          <h4 className="text-sm font-bold text-slate-900 truncate">
                            {task.departmentId?.name || task.department?.name || 'Department'}
                          </h4>
                          {(task.departmentId?.code || task.department?.code) && (
                            <span className="text-[10px] font-mono font-bold text-slate-400 bg-white px-2 py-0.5 rounded border border-slate-200/60">
                              {task.departmentId?.code || task.department?.code}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">
                          {task.departmentId?.description || 'Institutional clearance review requirement'}
                        </p>
                      </div>

                      <div className="shrink-0">
                        <ClearanceStatusBadge status={badgeStatus} />
                      </div>
                    </div>

                    {/* SPECIAL AGGREGATED LABORATORY PRESENTATION */}
                    {isLab ? (
                      <div className="space-y-2">
                        {isOverallLabNoDue ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-semibold">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                              <span>✓ No Due</span>
                            </div>
                          </div>
                        ) : (
                          /* When one or more are due: display Laboratory ⚠ Due and which of the three is due */
                          <div className="p-3.5 bg-rose-50/90 border border-rose-200/80 rounded-xl space-y-2.5">
                            <div className="flex items-center gap-2 text-rose-900 text-xs font-bold">
                              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                              <span>⚠ Due</span>
                            </div>

                            <div className="space-y-1.5 pt-0.5">
                              {(task.labSummary?.dueLabs && task.labSummary.dueLabs.length > 0
                                ? task.labSummary.dueLabs
                                : [
                                    {
                                      id: 'lab-dept',
                                      name: 'Department Lab',
                                      code: 'DEPT_LAB',
                                      status: 'DUE'
                                    }
                                  ]
                              ).map((lab: any, lIdx: number) => {
                                // Strictly ensure display name is one of:
                                // "Physics Lab", "Chemistry Lab", "Department Lab"
                                let displayName = 'Department Lab';
                                const code = (lab.code || '').toUpperCase();
                                const rawName = (lab.name || '').toLowerCase();
                                if (code === 'PHY' || rawName.includes('physics')) {
                                  displayName = 'Physics Lab';
                                } else if (code === 'CHEM' || rawName.includes('chemistry')) {
                                  displayName = 'Chemistry Lab';
                                } else {
                                  displayName = 'Department Lab';
                                }

                                return (
                                  <div
                                    key={lab.id || lIdx}
                                    className="bg-white/95 px-3 py-2 rounded-lg border border-rose-200 text-xs flex items-center justify-between gap-2 shadow-soft-2xs"
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-bold text-slate-900">{displayName}</span>
                                      <span className="text-rose-700 font-semibold">— Due</span>
                                      {lab.dueDetails && (
                                        <span className="text-[11px] text-slate-500 font-normal">({lab.dueDetails})</span>
                                      )}
                                    </div>
                                    {lab.dueAmount > 0 && (
                                      <span className="font-mono font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded text-[11px] shrink-0">
                                        ₹{lab.dueAmount}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* STANDARD NON-LABORATORY CLEARANCE PRESENTATION */
                      <div>
                        {isDue && (
                          <div className="p-3 bg-rose-100/90 border border-rose-200 rounded-xl text-xs text-rose-900 font-medium space-y-1">
                            <p className="font-bold">Outstanding Due: ₹{task.dueAmount || 0}</p>
                            {task.dueDetails && <p className="text-rose-700 text-[11px]">{task.dueDetails}</p>}
                            {task.remarks && <p className="text-rose-600 text-[11px] italic">Officer Note: {task.remarks}</p>}
                          </div>
                        )}

                        {isOnHold && task.remarks && (
                          <div className="p-2.5 bg-indigo-100/80 border border-indigo-200 rounded-xl text-xs text-indigo-900 font-medium">
                            <span className="font-bold">Hold Reason:</span> {task.remarks}
                          </div>
                        )}

                        {isCleared && task.remarks && (
                          <p className="text-[11px] text-emerald-700 italic font-medium">
                            ✓ {task.remarks}
                          </p>
                        )}

                        {task.status === 'PENDING' && (
                          <p className="text-[11px] text-slate-400 flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Awaiting review by section officer
                          </p>
                        )}

                        {task.reviewedAt && (
                          <div className="text-[10px] text-slate-400 mt-2 flex items-center gap-2">
                            <span>Reviewed on {new Date(task.reviewedAt).toLocaleDateString()}</span>
                            {task.reviewedBy?.name && <span>• By {task.reviewedBy.name}</span>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
  );
};
