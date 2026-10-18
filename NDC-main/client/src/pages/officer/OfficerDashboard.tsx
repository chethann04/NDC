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
  ShieldAlert,
  FlaskConical,
  Atom,
  Laptop,
  BookOpen,
  Library,
  UploadCloud
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

  const isLibraryOfficer =
    user?.loginId === 'LIB001' ||
    user?.email?.includes('library') ||
    officerDeptObj?.code === 'LIB' ||
    deptObj?.code === 'LIB' ||
    fetchedDept?.code === 'LIB';

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
    !isLibraryOfficer &&
    !isPhysicsOfficer &&
    !isChemistryOfficer &&
    !isCashFeeOfficer &&
    (officerDeptObj?.isAcademicBranch || (typeof deptObj === 'object' && deptObj?.isAcademicBranch) ||
     officerDeptObj?.category === 'ACADEMIC_BRANCH' || (typeof deptObj === 'object' && deptObj?.category === 'ACADEMIC_BRANCH') ||
     ['IS', 'CS', 'EC', 'ME', 'CV', 'EE', 'AIML', 'BT', 'CB', 'VL', 'ET', 'AI', 'RA', 'ST'].includes(officerDeptObj?.code || deptObj?.code || fetchedDept?.code));

  const departmentName = isLibraryOfficer
    ? 'Central Library'
    : isPhysicsOfficer
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

  const departmentCode = isLibraryOfficer
    ? 'LIB'
    : isPhysicsOfficer
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
    // SWR pattern: if we have cached stats, show immediately and refresh in background
    fetchDepartmentData(!kpiStats);
    if (kpiStats) {
      fetchDepartmentData(false);
    }
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
      if (showLoading) setLoading(false);
    }
  };

  if (loading && !kpiStats) {
    return <div className="p-8 text-center text-slate-500 font-semibold">Loading {departmentName} overview...</div>;
  }

  // Current Academic Year (2026) Metrics — from fast server-side groupBy
  const totalQueue = kpiStats?.TOTAL ?? 0;
  const pendingCount = kpiStats?.PENDING ?? 0;
  const dueCount = kpiStats?.DUE ?? 0;
  const clearedCount = (kpiStats?.CLEARED ?? 0) + (kpiStats?.NOT_APPLICABLE ?? 0);
  const rawCompletion = totalQueue > 0 ? (clearedCount / totalQueue) * 100 : 0;
  const completionPercentage = rawCompletion > 0 && rawCompletion < 1
    ? rawCompletion.toFixed(1)
    : Math.min(100, Math.max(0, Math.round(rawCompletion)));

  // Use fast server-aggregated Academic Branch breakdown
  const branchBreakdown = (kpiStats?.byDepartment || []).map((dept: any) => {
    const total = dept.total || 0;
    const cleared = dept.cleared || 0;
    const rawPct = total > 0 ? (cleared / total) * 100 : 0;
    const pctDisplay = rawPct > 0 && rawPct < 1 ? `${rawPct.toFixed(1)}%` : `${Math.round(rawPct)}%`;
    return {
      branch: dept.departmentName,
      deptId: dept.departmentId,
      deptCode: dept.departmentCode,
      total,
      cleared,
      pending: dept.pending || 0,
      due: dept.due || 0,
      pct: rawPct,
      pctDisplay
    };
  });

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
      {/* Rich Department Hero Banner (Design from 2nd Image - Displayed on Dashboard) */}
      <div
        className={`relative overflow-hidden rounded-2xl p-6 text-white shadow-xl border ${
          isLibraryOfficer
            ? 'bg-gradient-to-r from-amber-950 via-amber-900 to-stone-900 border-amber-800/40'
            : isPhysicsOfficer
            ? 'bg-gradient-to-r from-cyan-950 via-slate-900 to-indigo-950 border-cyan-800/40'
            : isChemistryOfficer
            ? 'bg-gradient-to-r from-emerald-950 via-teal-900 to-slate-900 border-emerald-800/40'
            : isAcademicBranchOfficer
            ? 'bg-gradient-to-r from-indigo-950 via-slate-900 to-blue-950 border-indigo-800/40'
            : isCashFeeOfficer
            ? 'bg-gradient-to-r from-blue-950 via-slate-900 to-indigo-950 border-blue-800/40'
            : 'bg-gradient-to-r from-slate-950 via-slate-900 to-zinc-900 border-slate-800/40'
        }`}
      >
        <div
          className={`absolute right-0 top-0 translate-x-8 -translate-y-8 w-64 h-64 rounded-full blur-3xl pointer-events-none ${
            isLibraryOfficer
              ? 'bg-amber-500/10'
              : isPhysicsOfficer
              ? 'bg-cyan-500/10'
              : isChemistryOfficer
              ? 'bg-emerald-500/10'
              : 'bg-indigo-500/10'
          }`}
        />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <div
              className={`w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center shrink-0 shadow-inner ${
                isLibraryOfficer
                  ? 'text-amber-300'
                  : isPhysicsOfficer
                  ? 'text-cyan-300'
                  : isChemistryOfficer
                  ? 'text-emerald-300'
                  : 'text-indigo-300'
              }`}
            >
              {isLibraryOfficer ? (
                <Library className="w-8 h-8" />
              ) : isPhysicsOfficer ? (
                <Atom className="w-8 h-8" />
              ) : isChemistryOfficer ? (
                <FlaskConical className="w-8 h-8" />
              ) : isAcademicBranchOfficer ? (
                <Laptop className="w-8 h-8" />
              ) : (
                <FileCheck className="w-8 h-8" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider ${
                    isLibraryOfficer
                      ? 'bg-amber-400/20 text-amber-200 border border-amber-300/30'
                      : isPhysicsOfficer
                      ? 'bg-cyan-400/20 text-cyan-200 border border-cyan-300/30'
                      : isChemistryOfficer
                      ? 'bg-emerald-400/20 text-emerald-200 border border-emerald-300/30'
                      : 'bg-indigo-400/20 text-indigo-200 border border-indigo-300/30'
                  }`}
                >
                  {isLibraryOfficer
                    ? 'Central Desk'
                    : isPhysicsOfficer
                    ? 'Physics Lab Desk'
                    : isChemistryOfficer
                    ? 'Chemistry Lab Desk'
                    : isAcademicBranchOfficer
                    ? `${departmentCode}-LAB Desk`
                    : `${departmentCode} Desk`}
                </span>
                <span className="text-xs text-white/70 font-mono">
                  Scope: {departmentCode}001 • {departmentName}
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white mt-1">
                {isLibraryOfficer
                  ? 'Central Library Book Clearance & Circulation Desk'
                  : isPhysicsOfficer
                  ? 'Engineering Physics Laboratory Clearance'
                  : isChemistryOfficer
                  ? 'Engineering Chemistry Laboratory Clearance'
                  : `${departmentName} Clearance Desk`}
              </h1>
              <p className="text-xs sm:text-sm text-white/80 mt-1 max-w-2xl leading-relaxed">
                {isLibraryOfficer
                  ? 'Review textbook returns, circulation book dues, overdue fines, lost book replacements, and issue official Central Library clearance.'
                  : isPhysicsOfficer
                  ? 'Review student laboratory dues, check equipment breakages, and issue clearance for Engineering Physics.'
                  : isChemistryOfficer
                  ? 'Independent clearance portal for Chemistry laboratory glassware, chemical reagents, titration assemblies, and breakage assessment.'
                  : `Live clearance status, branch breakdown, and student verification for ${departmentName}.`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0 self-start md:self-center">


            {/* Go to Clearance Queue Link */}
            {isLibraryOfficer ? (
              <Link
                to="/officer/central-library"
                className="px-3.5 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-white text-xs font-bold backdrop-blur-sm border border-amber-300/30 transition-all flex items-center gap-1.5 cursor-pointer shadow-xs hover:scale-102"
              >
                <BookOpen className="w-3.5 h-3.5 text-amber-200" />
                <span>Clearance Queue</span>
              </Link>
            ) : isPhysicsOfficer ? (
              <Link
                to="/officer/physics-lab"
                className="px-3.5 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-white text-xs font-bold backdrop-blur-sm border border-cyan-300/30 transition-all flex items-center gap-1.5 cursor-pointer shadow-xs hover:scale-102"
              >
                <Atom className="w-3.5 h-3.5 text-cyan-200" />
                <span>Physics Lab Queue</span>
              </Link>
            ) : isChemistryOfficer ? (
              <Link
                to="/officer/chemistry-lab"
                className="px-3.5 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-white text-xs font-bold backdrop-blur-sm border border-emerald-300/30 transition-all flex items-center gap-1.5 cursor-pointer shadow-xs hover:scale-102"
              >
                <FlaskConical className="w-3.5 h-3.5 text-emerald-200" />
                <span>Chemistry Lab Queue</span>
              </Link>
            ) : isAcademicBranchOfficer ? (
              <Link
                to="/officer/department-lab"
                className="px-3.5 py-2 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 text-white text-xs font-bold backdrop-blur-sm border border-indigo-300/30 transition-all flex items-center gap-1.5 cursor-pointer shadow-xs hover:scale-102"
              >
                <Laptop className="w-3.5 h-3.5 text-indigo-200" />
                <span>Department Lab Queue</span>
              </Link>
            ) : (
              <Link
                to="/officer/clearances"
                className="px-3.5 py-2 rounded-xl bg-white/20 hover:bg-white/30 text-white text-xs font-bold backdrop-blur-sm border border-white/20 transition-all flex items-center gap-1.5 cursor-pointer shadow-xs hover:scale-102"
              >
                <FileCheck className="w-3.5 h-3.5" />
                <span>Clearance Queue</span>
              </Link>
            )}

            {/* Refresh Button */}
            <button
              onClick={() => fetchDepartmentData(true)}
              disabled={loading}
              className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold backdrop-blur-sm border border-white/15 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Refresh Dashboard data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </div>

      {/* Cash/Fee Action Links */}
      {isCashFeeOfficer && (
        <div className="flex flex-wrap items-center gap-2">
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
          <div className="display-lg text-slate-900 font-extrabold">{totalQueue}</div>
          <div className="caption-text mt-1 text-slate-500 font-medium">Total Assigned Queue (2026)</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--warning-50)', color: 'var(--warning-600)' }}>
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg text-amber-600 font-extrabold">{pendingCount}</div>
          <div className="caption-text mt-1 text-slate-500 font-medium">Pending Review</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--danger-50)', color: 'var(--danger-600)' }}>
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg text-rose-600 font-extrabold">{dueCount}</div>
          <div className="caption-text mt-1 text-slate-500 font-medium">Marked Due (Blocked)</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--success-50)', color: 'var(--success-600)' }}>
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg text-emerald-600 font-extrabold">{clearedCount}</div>
          <div className="caption-text mt-1 text-slate-500 font-medium">Cleared (No Dues)</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--cobalt-50)', color: 'var(--cobalt-600)' }}>
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg text-blue-700 font-extrabold">{completionPercentage}%</div>
          <div className="caption-text mt-1 text-slate-500 font-medium">Completion Rate</div>
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
                  <span className="font-mono text-blue-700">{item.pctDisplay} Cleared</span>
                </div>

                {/* Progress bar */}
                <div className="h-2 bg-slate-200/80 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      item.pct >= 80 ? 'bg-emerald-600' : item.pct >= 50 ? 'bg-amber-500' : 'bg-blue-600'
                    }`}
                    style={{ width: `${item.cleared > 0 ? Math.max(2, item.pct) : 0}%` }}
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
