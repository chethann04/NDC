import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { useAuthStore } from '../../store/useAuthStore';
import { Link } from 'react-router-dom';
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
  ShieldAlert
} from 'lucide-react';

export const OfficerDashboard: React.FC = () => {
  const { user } = useAuthStore();
  const [clearances, setClearances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Resolve Department Info
  const deptObj = user?.departmentId as any;
  const officerDeptObj = user?.officerProfile?.departmentIds?.[0] as any;
  const fetchedDept = clearances.find((c) => c.departmentId?.name)?.departmentId;

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

  const departmentName = isCashFeeOfficer
    ? 'Cash/Fee Section'
    : officerDeptObj?.name ||
      (typeof deptObj === 'object' ? deptObj?.name : undefined) ||
      fetchedDept?.name ||
      (user?.role === 'HOD' ? 'Academic Department' : 'Clearance Desk');

  const departmentCode = isCashFeeOfficer
    ? 'ACC'
    : officerDeptObj?.code ||
      (typeof deptObj === 'object' ? deptObj?.code : undefined) ||
      fetchedDept?.code ||
      'DEPT';

  useEffect(() => {
    fetchDepartmentClearances();
  }, []);

  const fetchDepartmentClearances = async () => {
    try {
      const res = await api.get('/ndc/officer/clearances', { params: { status: '' } });
      setClearances(res.data.data || []);
    } catch (err) {
      console.error('Error fetching department clearances:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500 font-semibold">Loading {departmentName} overview...</div>;
  }

  // Current Academic Year (2026) Metrics
  const totalQueue = clearances.length;
  const pendingCount = clearances.filter((c) => c.status === 'PENDING').length;
  const dueCount = clearances.filter((c) => c.status === 'DUE').length;
  const clearedCount = clearances.filter((c) => c.status === 'CLEARED' || c.status === 'NOT_APPLICABLE').length;
  const completionPercentage = totalQueue > 0 ? Math.round((clearedCount / totalQueue) * 100) : 0;

  // Group clearances by Academic Branch for this specific department
  const branchBreakdownMap: Record<string, { total: number; cleared: number; pending: number; due: number }> = {};

  clearances.forEach((c) => {
    const branchName = c.studentId?.departmentId?.name || 'General / Unassigned';
    if (!branchBreakdownMap[branchName]) {
      branchBreakdownMap[branchName] = { total: 0, cleared: 0, pending: 0, due: 0 };
    }
    branchBreakdownMap[branchName].total += 1;
    if (c.status === 'CLEARED' || c.status === 'NOT_APPLICABLE') branchBreakdownMap[branchName].cleared += 1;
    else if (c.status === 'DUE') branchBreakdownMap[branchName].due += 1;
    else branchBreakdownMap[branchName].pending += 1;
  });

  const branchBreakdown = Object.entries(branchBreakdownMap).map(([branch, counts]) => ({
    branch,
    ...counts,
    pct: counts.total > 0 ? Math.round((counts.cleared / counts.total) * 100) : 0
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
          <button onClick={fetchDepartmentClearances} className="btn btn-secondary text-xs">
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          <Link to="/officer/clearances" className="btn btn-primary text-xs">
            <FileCheck className="w-3.5 h-3.5" />
            Go to Clearance Queue
          </Link>
        </div>
      </div>

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
            {branchBreakdown.map((item) => (
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

                <div className="flex items-center justify-between text-[11px] text-slate-600 font-medium pt-1">
                  <span>Total: <strong className="text-slate-900">{item.total}</strong></span>
                  <div className="flex items-center gap-3">
                    <span className="text-emerald-700 font-bold">Cleared: {item.cleared}</span>
                    <span className="text-amber-700 font-bold">Pending: {item.pending}</span>
                    <span className="text-rose-700 font-bold">Due: {item.due}</span>
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
