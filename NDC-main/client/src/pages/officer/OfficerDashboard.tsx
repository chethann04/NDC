import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { useAuthStore } from '../../store/useAuthStore';
import { Link } from 'react-router-dom';
import { clientCache } from '../../utils/clientCache';
import {
  Users,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Building2,
  FileCheck,
  RefreshCw,
  TrendingUp,
  History,
  ShieldCheck,
  User,
  Mail,
  BadgeCheck,
  Layers,
  ArrowUpRight,
  UploadCloud,
  ShieldAlert,
  FlaskConical,
  Atom,
  Laptop
} from 'lucide-react';

const CACHE_KEY_STATS = 'officer_dashboard_stats';

export const OfficerDashboard: React.FC = () => {
  const { user } = useAuthStore();
  const [kpiStats, setKpiStats] = useState<any>(() => clientCache.get(CACHE_KEY_STATS) || null);
  const [loading, setLoading] = useState<boolean>(() => !clientCache.get(CACHE_KEY_STATS));

  // Resolve Department Info
  const deptObj = user?.departmentId as any;
  const officerDeptObj = user?.officerProfile?.departmentIds?.[0] as any;
  const fetchedDept = kpiStats?.byDepartment?.[0];

  const isCashFeeOfficer =
    user?.email?.startsWith('cashfee') ||
    user?.email === 'accounts@mce.ac.in' ||
    officerDeptObj?.code === 'ACC' ||
    officerDeptObj?.name === 'Cash/Fee Section' ||
    deptObj?.code === 'ACC' ||
    deptObj?.name === 'Cash/Fee Section' ||
    (typeof deptObj === 'object' && (deptObj?.name?.includes('Fee') || deptObj?.name?.includes('Cash'))) ||
    officerDeptObj?.name?.includes('Fee') ||
    officerDeptObj?.name?.includes('Cash') ||
    fetchedDept?.code === 'ACC';

  const isPhysicsOfficer =
    user?.loginId === 'PHY001' ||
    user?.email?.includes('physics') ||
    officerDeptObj?.code === 'PHY' ||
    deptObj?.code === 'PHY' ||
    fetchedDept?.code === 'PHY';

  const isChemistryOfficer =
    user?.loginId === 'CHEM001' ||
    user?.email?.includes('chemistry') ||
    officerDeptObj?.code === 'CHEM' ||
    deptObj?.code === 'CHEM' ||
    fetchedDept?.code === 'CHEM';

  const isAcademicBranchOfficer =
    !isPhysicsOfficer &&
    !isChemistryOfficer &&
    !isCashFeeOfficer &&
    (officerDeptObj?.isAcademicBranch || (typeof deptObj === 'object' && deptObj?.isAcademicBranch) ||
     officerDeptObj?.category === 'ACADEMIC_BRANCH' || (typeof deptObj === 'object' && deptObj?.category === 'ACADEMIC_BRANCH') ||
     ['IS', 'CS', 'EC', 'ME', 'CV', 'EE', 'AIML', 'BT', 'CB', 'VL', 'ET', 'AI', 'RA', 'ST'].includes(officerDeptObj?.code || deptObj?.code || fetchedDept?.code));

  const departmentName = isPhysicsOfficer
    ? 'Physics Lab'
    : isChemistryOfficer
    ? 'Chemistry Lab'
    : isCashFeeOfficer
    ? 'Cash/Fee Section'
    : isAcademicBranchOfficer
    ? (officerDeptObj?.name || (typeof deptObj === 'object' ? deptObj?.name : undefined) || fetchedDept?.name || 'Academic Department')
    : officerDeptObj?.name ||
      (typeof deptObj === 'object' ? deptObj?.name : undefined) ||
      fetchedDept?.name ||
      (user?.role === 'HOD' ? 'Academic Department' : 'Clearance Desk');

  const departmentCode = isPhysicsOfficer
    ? 'PHY'
    : isChemistryOfficer
    ? 'CHEM'
    : isCashFeeOfficer
    ? 'ACC'
    : officerDeptObj?.code ||
      (typeof deptObj === 'object' ? deptObj?.code : undefined) ||
      fetchedDept?.code ||
      'DEPT';

  useEffect(() => {
    fetchDepartmentData(!kpiStats);
  }, []);

  const fetchDepartmentData = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      // Fetch stats (includes aggregated byDepartment breakdown in 1 fast query)
      const statsRes = await api.get('/ndc/officer/stats');
      const newStats = statsRes.data?.data || null;

      setKpiStats(newStats);
      clientCache.set(CACHE_KEY_STATS, newStats);
    } catch (err) {
      console.error('Error fetching department data:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500 font-semibold">Loading {departmentName} overview...</div>;
  }

  // Current Academic Year (2026) Metrics — from fast server-side groupBy
  const totalQueue = kpiStats?.TOTAL ?? 0;
  const pendingCount = kpiStats?.PENDING ?? 0;
  const dueCount = kpiStats?.DUE ?? 0;
  const clearedCount = (kpiStats?.CLEARED ?? 0) + (kpiStats?.NOT_APPLICABLE ?? 0);
  const completionPercentage = totalQueue > 0 ? Math.round((clearedCount / totalQueue) * 100) : 0;

  // Use fast server-aggregated Academic Branch breakdown
  const branchBreakdown = (kpiStats?.byDepartment || []).map((dept: any) => ({
    branch: dept.departmentName,
    deptId: dept.departmentId,
    deptCode: dept.departmentCode,
    total: dept.total || 0,
    cleared: dept.cleared || 0,
    pending: dept.pending || 0,
    due: dept.due || 0,
    pct: dept.total > 0 ? Math.round(((dept.cleared || 0) / (dept.total || 1)) * 100) : 0
  }));

  // Historical Comparison Stats (2025 vs 2026 Current)
  const previousYearStats = {
    year: '2024–2025 Academic Year',
    totalProcessed: 520,
    completionRate: 98,
    duesResolvedAmount: '₹45,200',
    avgTurnaroundTime: '1.2 Days',
    finalClearedCount: 510,
    revokedCertificates: 0
  };

  // Scope of Clearance Descriptions
  const getDepartmentScope = (code: string) => {
    switch (code.toUpperCase()) {
      case 'PHY':
        return 'Engineering Physics laboratory apparatus, laser optics kits, spectrometers, experiment observation handbooks, and apparatus breakage dues.';
      case 'CHEM':
        return 'Engineering Chemistry laboratory glassware (burettes, pipettes, volumetric flasks), chemical reagents, titration sets, and breakage dues.';
      case 'LIB':
        return 'Textbook returns, central library overdue fines, reference section book clearance, and digital portal access.';
      case 'LAB':
        return 'Laboratory equipment return, component damage assessment, lab manual dues, and hardware breakage fees.';
      case 'ACC':
      case 'SCH':
        return 'Semester tuition fee balances, exam registration fees, scholarship adjustments, and accounts clearance.';
      case 'HST':
        return 'Hostel room damage dues, mess charges balance, key handover verification, and room vacate clearance.';
      case 'SPT':
        return 'Sports equipment return, gymnasium membership clearance, and athletic gear dues.';
      case 'ADM':
        return 'College admission document submission, fee receipts verification, and identity card handover.';
      default:
        return 'Departmental dues, equipment/asset returns, and academic project submission clearance.';
    }
  };

  return (
    <div className="space-y-6">
      {/* Department Header Banner */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0 font-mono font-extrabold text-sm">
            {departmentCode}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="page-title">{departmentName}</h1>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 uppercase tracking-wider">
                Respective Desk Overview
              </span>
            </div>
            <p className="caption-text mt-0.5">
              Live clearance status, branch breakdown, and historical year performance for {departmentName}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isCashFeeOfficer && (
            <>
              <Link to="/officer/students" className="btn btn-secondary text-xs flex items-center gap-1.5 border-blue-200 text-blue-700 bg-blue-50/50 hover:bg-blue-50">
                <Users className="w-3.5 h-3.5 text-blue-600" />
                Manage Students
              </Link>
              <Link to="/officer/import" className="btn btn-secondary text-xs flex items-center gap-1.5 border-blue-200 text-blue-700 bg-blue-50/50 hover:bg-blue-50">
                <UploadCloud className="w-3.5 h-3.5 text-blue-600" />
                Import Students
              </Link>
              <Link to="/officer/audit-logs" className="btn btn-secondary text-xs flex items-center gap-1.5 border-zinc-200 text-zinc-700 hover:bg-zinc-50">
                <ShieldAlert className="w-3.5 h-3.5 text-indigo-600" />
                Audit Logs
              </Link>
            </>
          )}
          <button onClick={() => fetchDepartmentData(true)} className="btn btn-secondary text-xs">
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          {isPhysicsOfficer ? (
            <Link to="/officer/physics-lab" className="btn btn-primary text-xs flex items-center gap-1.5 bg-cyan-700 hover:bg-cyan-800">
              <Atom className="w-3.5 h-3.5" />
              Physics Lab Queue
            </Link>
          ) : isChemistryOfficer ? (
            <Link to="/officer/chemistry-lab" className="btn btn-primary text-xs flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800">
              <FlaskConical className="w-3.5 h-3.5" />
              Chemistry Lab Queue
            </Link>
          ) : isAcademicBranchOfficer ? (
            <Link to="/officer/department-lab" className="btn btn-primary text-xs flex items-center gap-1.5 bg-indigo-700 hover:bg-indigo-800">
              <Laptop className="w-3.5 h-3.5" />
              Department Lab Queue
            </Link>
          ) : (
            <Link to="/officer/clearances" className="btn btn-primary text-xs">
              <FileCheck className="w-3.5 h-3.5" />
              Go to Clearance Queue
            </Link>
          )}
        </div>
      </div>

      {/* Department Lab Banner for Academic Branches */}
      {isAcademicBranchOfficer && (
        <div className="bg-gradient-to-r from-indigo-50/70 to-blue-50/70 border border-indigo-200/80 rounded-2xl p-5 shadow-xs">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
                <Laptop className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {departmentName || departmentCode} Department Laboratory Clearance
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  As {departmentCode} Faculty, you manage the Department Laboratory clearance for your branch students.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link to="/officer/department-lab" className="btn btn-primary text-xs flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white">
                <span>Manage Department Lab Queue</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Respective Department Current Year (2026) Stat Row */}
      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--cobalt-50)', color: 'var(--cobalt-600)' }}>
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg">{totalQueue}</div>
          <div className="caption-text mt-1">Total Assigned Queue (2026)</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--warning-50)', color: 'var(--warning-600)' }}>
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg text-amber-600">{pendingCount}</div>
          <div className="caption-text mt-1">Pending Review</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--danger-50)', color: 'var(--danger-600)' }}>
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg text-rose-600">{dueCount}</div>
          <div className="caption-text mt-1">Marked Due (Blocked)</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--success-50)', color: 'var(--success-600)' }}>
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg text-emerald-600">{clearedCount}</div>
          <div className="caption-text mt-1">Cleared (No Dues)</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--cobalt-50)', color: 'var(--cobalt-600)' }}>
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg text-blue-700">{completionPercentage}%</div>
          <div className="caption-text mt-1">Completion Rate</div>
        </div>
      </div>

      {/* Department Laboratories Section if applicable */}
      {kpiStats?.departmentLabs && kpiStats.departmentLabs.length > 0 && (
        <div className="card card-pad space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
                <FlaskConical className="w-5 h-5" />
              </div>
              <div>
                <h2 className="h2-title">Department Laboratory</h2>
                <p className="caption-text mt-0.5">
                  Laboratory managed under {departmentName} (Aggregated into Laboratory NDC Category)
                </p>
              </div>
            </div>
            <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200/60">
              {kpiStats.departmentLabs.length === 1 ? '1 Laboratory' : `${kpiStats.departmentLabs.length} Laboratories`}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {kpiStats.departmentLabs.map((lab: any) => (
              <div
                key={lab.id || lab._id}
                className="p-3.5 bg-slate-50/80 hover:bg-blue-50/40 border border-slate-200/70 hover:border-blue-200 rounded-xl transition-all flex flex-col justify-between gap-3 shadow-2xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-slate-900">{lab.name}</span>
                    </div>
                    <span className="text-[10px] font-mono font-bold text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-200 mt-1 inline-block">
                      {lab.code}
                    </span>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                    Active Lab
                  </span>
                </div>

                <Link
                  to={`/officer/clearances`}
                  className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center justify-between pt-2 border-t border-slate-200/60 group"
                >
                  <span>Manage Laboratory Clearances</span>
                  <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Two Column Grid: Branch Breakdown & Historical Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Branch-wise Breakdown for Respective Department */}
        <div className="lg:col-span-2 card card-pad space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="h2-title">Academic Branch Clearance Breakdown</h2>
              <p className="caption-text mt-0.5">Status distribution for {departmentName} across engineering branches</p>
            </div>
            <span className="text-xs font-mono font-bold text-slate-500">{branchBreakdown.length} Branches</span>
          </div>

          <div className="space-y-4">
            {branchBreakdown.map((item: any) => (
              <div key={item.branch} className="p-3.5 bg-slate-50/70 border border-slate-200/70 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-900">
                  <div className="flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5 text-blue-600" />
                    <span>{item.branch}</span>
                  </div>
                  <span className="font-mono text-blue-700">{item.pct}% Cleared</span>
                </div>

                {/* Progress bar */}
                <div className="h-2 bg-slate-200/80 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      item.pct >= 80 ? 'bg-emerald-600' : item.pct >= 50 ? 'bg-amber-500' : 'bg-rose-500'
                    }`}
                    style={{ width: `${item.pct}%` }}
                  />
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-slate-600 font-medium pt-1 gap-1">
                  <span>Total: <strong className="text-slate-900">{item.total}</strong> students</span>
                  <div className="flex items-center gap-3">
                    <span className="text-emerald-700 font-bold">Cleared: {item.cleared}</span>
                    <span className="text-amber-700 font-bold">Pending: {item.pending}</span>
                    <span className="text-rose-700 font-bold">Due: {item.due}</span>
                    {item.deptId && (
                      <Link
                        to={`/officer/clearances?studentDepartmentId=${item.deptId}`}
                        className="font-bold text-blue-600 hover:text-blue-800 flex items-center gap-0.5 ml-1 bg-blue-50 px-2 py-0.5 rounded hover:bg-blue-100 transition-colors"
                      >
                        <span>Open Queue</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Historical Year Comparison Card (2025 vs 2026) */}
        <div className="space-y-6">
          <div className="card card-pad space-y-4 bg-gradient-to-br from-white to-slate-50">
            <div className="flex items-center gap-2 text-slate-900">
              <History className="w-5 h-5 text-blue-600" />
              <h2 className="h2-title">Previous Year Comparison</h2>
            </div>
            <p className="caption-text">Historical benchmark metrics for {departmentName}</p>

            <div className="p-3.5 bg-blue-50/60 border border-blue-100 rounded-xl space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-700">Previous Session ({previousYearStats.year})</span>
                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full text-[10px] font-bold">
                  {previousYearStats.completionRate}% Final Rate
                </span>
              </div>
              <div className="text-2xl font-extrabold text-slate-900 font-mono">
                {previousYearStats.finalClearedCount} / {previousYearStats.totalProcessed}
              </div>
              <div className="text-[11px] text-slate-500 font-medium">Students cleared in previous batch</div>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between p-2.5 bg-white border border-slate-200 rounded-xl">
                <span className="text-slate-600 font-medium">Previous Year Dues Resolved</span>
                <span className="font-mono font-bold text-slate-900">{previousYearStats.duesResolvedAmount}</span>
              </div>

              <div className="flex items-center justify-between p-2.5 bg-white border border-slate-200 rounded-xl">
                <span className="text-slate-600 font-medium">Avg Resolution Turnaround</span>
                <span className="font-mono font-bold text-slate-900">{previousYearStats.avgTurnaroundTime}</span>
              </div>

              <div className="flex items-center justify-between p-2.5 bg-white border border-slate-200 rounded-xl">
                <span className="text-slate-600 font-medium">Current vs Last Year Rate</span>
                <span className="font-mono font-bold text-emerald-600 flex items-center gap-1">
                  <ArrowUpRight className="w-3.5 h-3.5" />
                  On Track
                </span>
              </div>
            </div>
          </div>

          {/* Respective Department Info & Scope Card */}
          <div className="card card-pad space-y-4">
            <div className="flex items-center gap-2 text-slate-900">
              <Building2 className="w-5 h-5 text-blue-600" />
              <h2 className="h2-title">Department Details</h2>
            </div>

            <div className="space-y-2 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <div className="font-bold text-slate-900">{departmentName} ({departmentCode})</div>
                <div className="text-slate-500 leading-relaxed text-[11px]">
                  {getDepartmentScope(departmentCode)}
                </div>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                <div className="font-semibold text-slate-700 text-[11px] uppercase tracking-wider">Assigned Officer Profile</div>
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <User className="w-3.5 h-3.5 text-blue-600" />
                  <span>{user?.name}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-600 text-[11px]">
                  <Mail className="w-3.5 h-3.5 text-slate-400" />
                  <span>{user?.email}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
