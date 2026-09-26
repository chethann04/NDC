import React, { useEffect, useState } from 'react';
import { useSearchParams, Navigate, Link } from 'react-router-dom';
import api from '../../services/api';
import { useAuthStore } from '../../store/useAuthStore';
import { ClearanceStatusBadge } from '../../components/ClearanceStatusBadge';
import { showErrorModal } from '../../store/useErrorModalStore';
import {
  Search,
  CheckCircle2,
  AlertTriangle,
  Ban,
  Users,
  Clock,
  X,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  Building2,
  CheckCheck,
  Layers,
  LayoutList,
  ChevronDown,
  ChevronUp,
  MinusCircle,
  FlaskConical,
  Building,
  Laptop
} from 'lucide-react';

import { CollegeOfficeSubmissionDesk } from './CollegeOfficeSubmissionDesk';
import { clientCache } from '../../utils/clientCache';

export const OfficerClearanceQueue: React.FC = () => {
  const { user } = useAuthStore();
  const [searchParams, setSearchParams] = useSearchParams();

  const deptObj = user?.departmentId as any;
  const officerDeptObj = user?.officerProfile?.departmentIds?.[0] as any;

  // Check if current user is from College Office (ADM) or Admin Block
  const isAdmOrAdmin =
    user?.role === 'ADMIN' ||
    user?.email === 'office@mce.ac.in' ||
    officerDeptObj?.code === 'ADM' ||
    officerDeptObj?.name?.toLowerCase().includes('college office') ||
    officerDeptObj?.name?.toLowerCase().includes('administrative') ||
    deptObj?.code === 'ADM' ||
    (typeof deptObj === 'object' && (deptObj?.code === 'ADM' || deptObj?.name?.toLowerCase().includes('college office') || deptObj?.name?.toLowerCase().includes('administrative')));

  // Check if current officer is Physics Lab Officer
  const isPhysicsOfficer =
    user?.loginId === 'PHY001' ||
    user?.email?.includes('physics') ||
    officerDeptObj?.code === 'PHY' ||
    deptObj?.code === 'PHY';

  if (isPhysicsOfficer) {
    return <Navigate to="/officer/physics-lab" replace />;
  }

  // Check if current officer is Chemistry Lab Officer
  const isChemistryOfficer =
    user?.loginId === 'CHEM001' ||
    user?.email?.includes('chemistry') ||
    officerDeptObj?.code === 'CHEM' ||
    deptObj?.code === 'CHEM';

  if (isChemistryOfficer) {
    return <Navigate to="/officer/chemistry-lab" replace />;
  }

  // Check if current officer is Academic Department Faculty
  const isAcademicBranchOfficer =
    !isAdmOrAdmin &&
    (officerDeptObj?.isAcademicBranch || (typeof deptObj === 'object' && deptObj?.isAcademicBranch) ||
     officerDeptObj?.category === 'ACADEMIC_BRANCH' || (typeof deptObj === 'object' && deptObj?.category === 'ACADEMIC_BRANCH') ||
     ['IS', 'CS', 'EC', 'ME', 'CV', 'EE', 'AIML', 'BT', 'CB', 'VL', 'ET', 'AI', 'RA', 'ST'].includes(officerDeptObj?.code || deptObj?.code));

  if (user?.role === 'HOD') {
    return <Navigate to="/teaching-departments" replace />;
  }

  if (isAcademicBranchOfficer) {
    return <Navigate to="/officer/department-lab" replace />;
  }

  // For College Office (ADM): There is no clearance queue. They collect physical certificates & generate date-range reports.
  if (isAdmOrAdmin) {
    return <CollegeOfficeSubmissionDesk />;
  }

  // Designated Clearance Officers have full review capability
  const canReviewClearance = true;

  // Department Filter & View Mode
  const initialDept = searchParams.get('studentDepartmentId') || 'ALL';
  const [selectedDepartment, setSelectedDepartment] = useState<string>(initialDept);
  const [byDepartment, setByDepartment] = useState<any[]>(() => {
    const cachedStats = clientCache.get<any>('officer_queue_stats');
    return cachedStats?.byDepartment || [];
  });
  const [selectedLabId, setSelectedLabId] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<'table' | 'grouped'>('table');
  const [expandedDepts, setExpandedDepts] = useState<Record<string, boolean>>({});

  const [activeTab, setActiveTab] = useState('PENDING');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  // Debounce search by 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const initialQueueKey = `officer_queue_${activeTab}_${initialDept}_ALL_1_`;
  const cachedInitialQueue = clientCache.get<any>(initialQueueKey);

  const [clearances, setClearances] = useState<any[]>(() => cachedInitialQueue?.data || []);
  const [stats, setStats] = useState(() => {
    const cachedStats = clientCache.get<any>('officer_queue_stats');
    return cachedStats || {
      TOTAL: 0,
      PENDING: 0,
      DUE: 0,
      CLEARED: 0,
      ON_HOLD: 0,
      NOT_APPLICABLE: 0
    };
  });
  const [loading, setLoading] = useState(!cachedInitialQueue);
  const [pagination, setPagination] = useState(() => cachedInitialQueue?.pagination || { total: 0, totalPages: 1 });
  const [selectedTask, setSelectedTask] = useState<any>(null);

  // Multi-Select & Bulk Clear State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkClearing, setBulkClearing] = useState(false);
  const [bulkResult, setBulkResult] = useState<{
    cleared: number;
    skipped: number;
    rejected: number;
    message?: string;
  } | null>(null);

  // Review Modal State
  const [actionStatus, setActionStatus] = useState<'CLEARED' | 'DUE' | 'NOT_APPLICABLE'>('CLEARED');
  const [remarks, setRemarks] = useState('');
  const [dueAmount, setDueAmount] = useState('0');
  const [dueDetails, setDueDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');

  // Batch Department Clear Modal State
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchTargetDept, setBatchTargetDept] = useState<any>(null);
  const [batchRemarks, setBatchRemarks] = useState('');
  const [batchSubmitting, setBatchSubmitting] = useState(false);

  // Resolve Department Name dynamically from user profile or clearance data
  const fetchedDeptName = (clearances.find((c) => c.departmentId?.name) as any)?.departmentId?.name;

  const departmentName =
    officerDeptObj?.name ||
    (typeof deptObj === 'object' ? deptObj?.name : undefined) ||
    fetchedDeptName ||
    'Central Clearance Desk';

  // Check if current desk or officer represents Hostel
  const isHostelOfficer =
    officerDeptObj?.code === 'HST' ||
    deptObj?.code === 'HST' ||
    (typeof deptObj === 'object' && deptObj?.code === 'HST') ||
    departmentName.toLowerCase().includes('hostel') ||
    clearances.some((c) => c.department?.code === 'HST' || c.departmentId?.code === 'HST');

  const isTaskHostel = (task: any) => {
    if (!task) return isHostelOfficer;
    const code = task.department?.code || task.departmentId?.code;
    const name = task.department?.name || task.departmentId?.name;
    return code === 'HST' || name?.toLowerCase().includes('hostel') || isHostelOfficer;
  };

  // Clear selections whenever tab, department filter, or page changes
  useEffect(() => {
    setSelectedIds(new Set());
    setBulkResult(null);
  }, [activeTab, selectedDepartment, page]);

  useEffect(() => {
    // On initial mount, fetch both stats and clearances in parallel
    const fetchInitial = async () => {
      try {
        setLoading(true);
        const [statsRes, clearancesRes] = await Promise.all([
          api.get('/ndc/officer/stats'),
          api.get('/ndc/officer/clearances', {
            params: {
              status: activeTab,
              search,
              page,
              limit,
              studentDepartmentId: selectedDepartment === 'ALL' ? undefined : selectedDepartment,
              labId: selectedLabId === 'ALL' ? undefined : selectedLabId
            }
          })
        ]);

        if (statsRes.data?.data) {
          setStats(statsRes.data.data);
          if (statsRes.data.data.byDepartment) {
            setByDepartment(statsRes.data.data.byDepartment);
          }
        }
        setClearances(clearancesRes.data.data || []);
        if (clearancesRes.data.pagination) {
          setPagination({
            total: clearancesRes.data.pagination.total,
            totalPages: clearancesRes.data.pagination.totalPages || 1
          });
        } else {
          setPagination({ total: clearancesRes.data.data?.length || 0, totalPages: 1 });
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchInitial();
  }, []);

  // Re-fetch only clearances when filters change
  const isInitialMount = React.useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    fetchClearances();
  }, [activeTab, debouncedSearch, page, limit, selectedDepartment, selectedLabId]);

  const fetchStats = async () => {
    try {
      const response = await api.get('/ndc/officer/stats');
      if (response.data?.data) {
        setStats(response.data.data);
        clientCache.set('officer_queue_stats', response.data.data);
        if (response.data.data.byDepartment) {
          setByDepartment(response.data.data.byDepartment);
        }
      }
    } catch (err) {
      console.error('Error fetching officer department stats:', err);
    }
  };

  const fetchClearances = async (forceLoading = false) => {
    const queueKey = `officer_queue_${activeTab}_${selectedDepartment}_${selectedLabId}_${page}_${debouncedSearch}`;
    const cached = clientCache.get<any>(queueKey);
    if (cached && !forceLoading) {
      setClearances(cached.data || []);
      setPagination(cached.pagination || { total: cached.data?.length || 0, totalPages: 1 });
      setLoading(false);
    } else if (forceLoading || !cached) {
      setLoading(true);
    }

    try {
      const response = await api.get('/ndc/officer/clearances', {
        params: {
          status: activeTab,
          search: debouncedSearch,
          page,
          limit,
          studentDepartmentId: selectedDepartment === 'ALL' ? undefined : selectedDepartment,
          labId: selectedLabId === 'ALL' ? undefined : selectedLabId
        }
      });
      const data = response.data.data || [];
      const pag = response.data.pagination
        ? { total: response.data.pagination.total, totalPages: response.data.pagination.totalPages || 1 }
        : { total: data.length, totalPages: 1 };

      setClearances(data);
      setPagination(pag);
      clientCache.set(queueKey, { data, pagination: pag });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenReviewModal = (task: any) => {
    if (!canReviewClearance) return;
    setSelectedTask(task);
    if (task.status === 'NOT_APPLICABLE') {
      setActionStatus('NOT_APPLICABLE');
    } else if (task.status === 'DUE') {
      setActionStatus('DUE');
    } else {
      setActionStatus('CLEARED');
    }
    setRemarks(task.remarks || '');
    setDueAmount(task.dueAmount ? String(task.dueAmount) : '0');
    setDueDetails(task.dueDetails || '');
    setModalError('');
  };

  const handleProcessClearance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canReviewClearance) {
      setModalError('Clearance review is strictly restricted to designated clearance officers.');
      return;
    }
    setModalError('');

    setSubmitting(true);
    try {
      await api.put(`/ndc/clearance/${selectedTask.id || selectedTask._id}`, {
        status: actionStatus,
        remarks: remarks.trim() || (actionStatus === 'NOT_APPLICABLE' ? 'Hostel clearance not applicable for this student' : ''),
        dueAmount: actionStatus === 'DUE' ? (Number(dueAmount) || 0) : 0,
        dueDetails: actionStatus === 'DUE' ? dueDetails : ''
      });

      setSelectedTask(null);
      clientCache.invalidate('officer_queue');
      clientCache.invalidate('student_ndc_status');
      clientCache.invalidate('admin_dashboard');
      await Promise.all([fetchStats(), fetchClearances(true)]);
    } catch (err: any) {
      setModalError(err.response?.data?.message || 'Failed to update clearance status.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenBatchClear = (dept: any) => {
    setBatchTargetDept(dept);
    setBatchRemarks('');
    setBatchModalOpen(true);
  };

  const handleExecuteBatchClear = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batchTargetDept) return;
    try {
      setBatchSubmitting(true);
      await api.post('/ndc/officer/batch-clear', {
        studentDepartmentId: batchTargetDept.departmentId || batchTargetDept.departmentCode,
        remarks: batchRemarks.trim() || `Departmental batch cleared for ${batchTargetDept.departmentName}`
      });
      setBatchModalOpen(false);
      setBatchTargetDept(null);
      clientCache.invalidate('officer_queue');
      clientCache.invalidate('student_ndc_status');
      clientCache.invalidate('admin_dashboard');
      await Promise.all([fetchStats(), fetchClearances(true)]);
    } catch (err: any) {
      showErrorModal(err, { title: 'Batch Clearance Failed' });
    } finally {
      setBatchSubmitting(false);
    }
  };

  const toggleDeptExpanded = (deptKey: string) => {
    setExpandedDepts((prev) => ({
      ...prev,
      [deptKey]: prev[deptKey] === undefined ? false : !prev[deptKey]
    }));
  };

  // Live department statistics from fast stats endpoint
  const totalQueue = stats.TOTAL || 0;
  const pendingCount = stats.PENDING || 0;
  const dueCount = stats.DUE || 0;
  const clearedCount = (stats.CLEARED || 0) + (stats.NOT_APPLICABLE || 0);
  const onHoldCount = stats.ON_HOLD || 0;

  // Selected Department Info
  const selectedDeptObj = byDepartment.find(
    (d) => d.departmentId === selectedDepartment || d.departmentCode === selectedDepartment
  );

  // Natural USN sorting helper: sorts older series (e.g. 2021 before 2022) and roll numbers in ascending order
  const sortedClearances = React.useMemo(() => {
    return [...clearances].sort((a, b) => {
      const usnA = (a.studentId?.usn || a.student?.usn || '').trim().toUpperCase();
      const usnB = (b.studentId?.usn || b.student?.usn || '').trim().toUpperCase();
      return usnA.localeCompare(usnB, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [clearances]);

  // Group clearances by Academic Department for Grouped View (preserves USN order)
  const groupedClearances: Record<string, { deptName: string; deptCode: string; deptId: string; items: any[] }> = {};
  sortedClearances.forEach((task) => {
    const deptInfo = task.studentId?.departmentId;
    const dId = deptInfo?.id || deptInfo?._id || 'other';
    const dName = deptInfo?.name || task.studentId?.batch || 'General / Unassigned';
    const dCode = deptInfo?.code || 'GEN';
    if (!groupedClearances[dId]) {
      groupedClearances[dId] = { deptName: dName, deptCode: dCode, deptId: dId, items: [] };
    }
    groupedClearances[dId].items.push(task);
  });

  // Multi-select helpers for current view
  const displayedIds = React.useMemo(
    () => sortedClearances.map((c) => c.id || c._id),
    [sortedClearances]
  );
  const allSelected = displayedIds.length > 0 && displayedIds.every((id) => selectedIds.has(id));
  const isSomeSelected = displayedIds.some((id) => selectedIds.has(id));

  const handleToggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        displayedIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        displayedIds.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  const handleToggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkClear = async () => {
    if (selectedIds.size === 0) return;
    try {
      setBulkClearing(true);
      const res = await api.post('/ndc/clearances/bulk-clear', {
        clearanceIds: Array.from(selectedIds)
      });
      setBulkResult({
        cleared: res.data.cleared ?? 0,
        skipped: res.data.skipped ?? 0,
        rejected: res.data.rejected ?? 0,
        message: res.data.message
      });
      setSelectedIds(new Set());
      clientCache.invalidate('officer_queue');
      clientCache.invalidate('student_ndc_status');
      clientCache.invalidate('admin_dashboard');
      await Promise.all([fetchStats(), fetchClearances(true)]);
    } catch (err: any) {
      console.error('Bulk clearance failed:', err);
      setBulkResult({
        cleared: 0,
        skipped: 0,
        rejected: selectedIds.size,
        message: err.response?.data?.message || 'Bulk clearance failed.'
      });
    } finally {
      setBulkClearing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Administrative View Banner for ADM / Admin Block */}
      {isAdmOrAdmin && (
        <div className="p-4 bg-blue-50/80 border border-blue-200 rounded-2xl flex items-start sm:items-center gap-3 text-xs text-blue-900 shadow-xs">
          <ShieldAlert className="w-5 h-5 text-blue-600 shrink-0 mt-0.5 sm:mt-0" />
          <div className="leading-relaxed">
            <span className="font-bold">Administrative View (Read-Only):</span> Clearance status review, verification, and status modification is strictly restricted to designated Clearance Officers. Officers in College Office (ADM) and Administration Block have oversight view only.
          </div>
        </div>
      )}

      {/* Academic Branch Dual Scope Switcher */}
      {isAcademicBranchOfficer && (
        <div className="flex items-center justify-between bg-zinc-100 p-1.5 rounded-2xl border border-zinc-200/80">
          <div className="flex items-center gap-2">
            <div className="px-4 py-2 rounded-xl text-xs font-bold bg-white text-blue-950 shadow-xs border border-zinc-200/60 flex items-center gap-1.5">
              <Building className="w-3.5 h-3.5 text-blue-600" />
              <span>Academic Desk Clearance (Active)</span>
            </div>
            <Link
              to="/officer/department-lab"
              className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-600 hover:text-zinc-950 hover:bg-white/60 transition-all flex items-center gap-1.5"
            >
              <Laptop className="w-3.5 h-3.5 text-indigo-600" />
              <span>Department Lab Clearance →</span>
            </Link>
          </div>
          <span className="text-[11px] font-mono text-zinc-500 hidden sm:inline mr-2">
            Department Scope: {departmentName}
          </span>
        </div>
      )}

      {/* Section Header */}
      <div className="section-head">
        <div>
          <h1 className="page-title">{departmentName} — {isAdmOrAdmin ? 'Clearance Records' : 'Clearance Queue'}</h1>
          <p className="caption-text mt-1">
            {isAdmOrAdmin
              ? 'View institutional clearance records — Status verification is conducted by designated clearance officers'
              : 'Review student records partitioned by academic department, verify clearances, and update departmental status'}
          </p>
        </div>
      </div>

      {/* 5 Fraunces Display Stat Cards in Single Line */}
      <div className="stat-row-5">
        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--cobalt-50)', color: 'var(--cobalt-600)' }}>
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg">{totalQueue}</div>
          <div className="caption-text mt-1">Total queue</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--warning-50)', color: 'var(--warning-600)' }}>
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg">{pendingCount}</div>
          <div className="caption-text mt-1">Pending review</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--danger-50)', color: 'var(--danger-600)' }}>
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg">{dueCount}</div>
          <div className="caption-text mt-1">Marked due</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--success-50)', color: 'var(--success-600)' }}>
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg">{stats.CLEARED || 0}</div>
          <div className="caption-text mt-1">No Dues (Cleared)</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--surface-3)', color: isHostelOfficer ? 'var(--ink-700)' : 'var(--ink-500)' }}>
              {isHostelOfficer ? <MinusCircle className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
            </div>
          </div>
          <div className="display-lg">{isHostelOfficer ? (stats.NOT_APPLICABLE || 0) : onHoldCount}</div>
          <div className="caption-text mt-1">{isHostelOfficer ? 'Not Applicable' : 'On hold'}</div>
        </div>
      </div>

      {/* Department Separation & Organization Control Bar */}
      <div className="card p-4 bg-white border border-slate-200/90 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-50 text-blue-600 shrink-0">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Academic Department Separation
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100/70 text-blue-700">
                  {byDepartment.length} Branches
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Students are organized and separated according to their departments upon import
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            {/* View Mode Toggle */}
            <div className="inline-flex rounded-xl border border-slate-200 p-0.5 bg-slate-50 text-xs">
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all ${
                  viewMode === 'table' ? 'bg-white text-blue-700 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <LayoutList className="w-3.5 h-3.5" />
                <span>List View</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('grouped')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all ${
                  viewMode === 'grouped' ? 'bg-white text-blue-700 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Grouped View</span>
              </button>
            </div>

            {/* Quick Department Dropdown */}
            <select
              value={selectedDepartment}
              onChange={(e) => {
                setSelectedDepartment(e.target.value);
                setSearchParams(e.target.value === 'ALL' ? {} : { studentDepartmentId: e.target.value });
                setPage(1);
              }}
              className="input !w-auto h-9 text-xs font-semibold py-0 pr-8"
            >
              <option value="ALL">All Departments ({totalQueue})</option>
              {byDepartment.map((d) => (
                <option key={d.departmentId} value={d.departmentId}>
                  {d.departmentCode} — {d.departmentName} ({d.total})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Scrollable Department Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-0.5 scrollbar-thin">
          <button
            type="button"
            onClick={() => {
              setSelectedDepartment('ALL');
              setSearchParams({});
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition-all flex items-center gap-1.5 cursor-pointer ${
              selectedDepartment === 'ALL'
                ? 'bg-blue-600 text-white shadow-xs font-bold'
                : 'bg-slate-100 hover:bg-slate-200/80 text-slate-700'
            }`}
          >
            <span>All Departments</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              selectedDepartment === 'ALL' ? 'bg-blue-700 text-blue-100' : 'bg-slate-200 text-slate-700'
            }`}>
              {totalQueue}
            </span>
          </button>

          {byDepartment.map((dept) => {
            const isSelected = selectedDepartment === dept.departmentId || selectedDepartment === dept.departmentCode;
            return (
              <button
                key={dept.departmentId}
                type="button"
                onClick={() => {
                  setSelectedDepartment(dept.departmentId);
                  setSearchParams({ studentDepartmentId: dept.departmentId });
                  setPage(1);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition-all flex items-center gap-2 cursor-pointer ${
                  isSelected
                    ? 'bg-blue-600 text-white shadow-xs font-bold'
                    : 'bg-slate-100 hover:bg-slate-200/80 text-slate-700'
                }`}
              >
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wide ${
                  isSelected ? 'bg-blue-700 text-blue-100' : 'bg-white text-slate-700 border border-slate-200'
                }`}>
                  {dept.departmentCode}
                </span>
                <span className="truncate max-w-[150px]">{dept.departmentName}</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                  isSelected ? 'bg-blue-700 text-blue-100' : 'bg-slate-200 text-slate-700'
                }`}>
                  {dept.total}
                </span>
              </button>
            );
          })}
        </div>

        {/* Selected Department Context & Batch Clearance Action */}
        {selectedDeptObj && (
          <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5">
              <span className="px-2 py-0.5 rounded-md font-black text-xs bg-blue-600 text-white uppercase">
                {selectedDeptObj.departmentCode}
              </span>
              <div>
                <span className="font-bold text-blue-950">{selectedDeptObj.departmentName}</span>
                <div className="text-[11px] text-blue-800 flex items-center gap-2 mt-0.5">
                  <span>{selectedDeptObj.total} Students Total</span>
                  <span>·</span>
                  <span className="text-amber-700 font-semibold">{selectedDeptObj.pending} Pending</span>
                  <span>·</span>
                  <span className="text-emerald-700 font-semibold">{selectedDeptObj.cleared} Cleared</span>
                  {selectedDeptObj.due > 0 && (
                    <>
                      <span>·</span>
                      <span className="text-rose-700 font-semibold">{selectedDeptObj.due} Due</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {canReviewClearance && selectedDeptObj.pending > 0 && (
              <button
                type="button"
                onClick={() => handleOpenBatchClear(selectedDeptObj)}
                className="btn btn-secondary text-xs bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50 shrink-0 font-bold flex items-center gap-1.5 shadow-2xs"
              >
                <CheckCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>Batch Clear {selectedDeptObj.pending} Pending in {selectedDeptObj.departmentCode}</span>
              </button>
            )}
          </div>
        )}

        {/* Department Laboratories & Clearances Scope Filter */}
        {stats?.departmentLabs && stats.departmentLabs.length > 0 && (
          <div className="bg-slate-50/90 border border-slate-200/80 rounded-2xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-slate-800">Clearance Scope: Laboratories & Department Desk</span>
              </div>
              <span className="text-[11px] text-slate-500 font-medium">
                {stats.departmentLabs.length === 1 ? '1 Laboratory' : `${stats.departmentLabs.length} Laboratories`} configured for {departmentName}
              </span>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
              <button
                type="button"
                onClick={() => {
                  setSelectedLabId('ALL');
                  setPage(1);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                  selectedLabId === 'ALL'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                <span>All Clearances & Labs</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedLabId('desk');
                  setPage(1);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                  selectedLabId === 'desk'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>Department Clearance Desk</span>
              </button>

              {stats.departmentLabs.map((lab: any) => {
                const labKey = lab.id || lab._id;
                const isSelected = selectedLabId === labKey;
                return (
                  <button
                    key={labKey}
                    type="button"
                    onClick={() => {
                      setSelectedLabId(labKey);
                      setPage(1);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                      isSelected
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <FlaskConical className="w-3.5 h-3.5 text-blue-500" />
                    <span>{lab.name}</span>
                    <span className={`text-[9px] px-1 py-0.2 rounded font-mono ${
                      isSelected ? 'bg-blue-700 text-blue-100' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {lab.code}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Main Table / Grouped Container with Pill Filters */}
      <div className="table-wrap">
        <div className="filter-bar">
          {[
            { id: 'PENDING', label: 'Pending', count: pendingCount },
            { id: 'DUE', label: 'Due', count: dueCount },
            { id: 'CLEARED', label: 'No Due', count: stats.CLEARED || 0 },
            ...(isHostelOfficer || (stats.NOT_APPLICABLE || 0) > 0
              ? [{ id: 'NOT_APPLICABLE', label: 'Not Applicable', count: stats.NOT_APPLICABLE || 0 }]
              : [])
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pill-filter ${activeTab === tab.id ? 'active' : ''}`}
            >
              <span>{tab.label}</span>
              <span className="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] opacity-80 bg-black/10">
                {tab.count}
              </span>
            </button>
          ))}

          <div className="filter-spacer"></div>

          <div className="relative max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search USN or student name…"
              className="input text-xs"
              style={{ paddingLeft: '34px' }}
            />
          </div>
        </div>

        {/* Bulk Action Result Notification */}
        {bulkResult && (
          <div className="mx-4 mt-3 p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-3 text-xs shadow-2xs">
            <div className="flex items-center gap-2.5">
              <CheckCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <div className="flex flex-wrap items-center gap-2 font-medium">
                <span className="font-bold text-slate-800">Bulk Clearance Result:</span>
                <span className="text-emerald-700 bg-emerald-100/60 px-2 py-0.5 rounded font-bold">
                  ✓ {bulkResult.cleared} student{bulkResult.cleared !== 1 ? 's' : ''} cleared
                </span>
                {bulkResult.skipped > 0 && (
                  <span className="text-amber-700 bg-amber-100/60 px-2 py-0.5 rounded font-semibold">
                    ⚠ {bulkResult.skipped} already cleared
                  </span>
                )}
                {bulkResult.rejected > 0 && (
                  <span className="text-rose-700 bg-rose-100/60 px-2 py-0.5 rounded font-semibold">
                    ✗ {bulkResult.rejected} could not be modified
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setBulkResult(null)}
              className="p-1 text-slate-400 hover:text-slate-600 rounded"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Prominent Multi-Select Action Bar */}
        {selectedIds.size > 0 && (
          <div className="mx-4 mt-3 p-3 bg-blue-50 border border-blue-200 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs shadow-2xs">
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs">
                {selectedIds.size}
              </div>
              <div>
                <span className="font-bold text-blue-950">
                  {selectedIds.size} student{selectedIds.size > 1 ? 's' : ''} selected
                </span>
                <span className="text-blue-700 ml-2">Ready for bulk clearance</span>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                disabled={bulkClearing}
                className="btn btn-secondary text-xs py-1.5 px-3 bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              >
                Deselect All
              </button>
              <button
                type="button"
                onClick={handleBulkClear}
                disabled={bulkClearing}
                className="btn btn-primary text-xs py-1.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1.5 shadow-2xs disabled:opacity-50"
              >
                {bulkClearing ? (
                  <>
                    <span className="inline-block animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />
                    <span>Processing Bulk Clearance...</span>
                  </>
                ) : (
                  <>
                    <CheckCheck className="w-4 h-4" />
                    <span>Clear Selected ({selectedIds.size})</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="p-12 text-center text-slate-500 font-semibold">Loading clearance queue...</div>
        ) : clearances.length === 0 ? (
          <div className="p-12 text-center text-slate-500 font-semibold">
            No student clearance tasks found matching "{activeTab.replace('_', ' ')}"{' '}
            {selectedDepartment !== 'ALL' ? `for ${selectedDeptObj?.departmentName || selectedDepartment}` : ''}.
          </div>
        ) : viewMode === 'grouped' ? (
          /* Grouped by Department View */
          <div className="p-4 space-y-4">
            {Object.entries(groupedClearances).map(([deptKey, group]) => {
              const isCollapsed = expandedDepts[deptKey] === false;
              const deptPending = group.items.filter((i) => i.status === 'PENDING').length;
              const deptDue = group.items.filter((i) => i.status === 'DUE').length;
              const deptCleared = group.items.filter((i) => i.status === 'CLEARED' || i.status === 'NOT_APPLICABLE').length;

              return (
                <div key={deptKey} className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-2xs">
                  {/* Department Group Header */}
                  <div
                    onClick={() => toggleDeptExpanded(deptKey)}
                    className="p-3.5 bg-slate-50/80 hover:bg-slate-100/70 cursor-pointer border-b border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="px-2 py-1 rounded-lg text-xs font-black uppercase bg-blue-600 text-white tracking-wide shadow-2xs">
                        {group.deptCode}
                      </span>
                      <div>
                        <h3 className="font-bold text-xs text-slate-900 flex items-center gap-2">
                          <span>{group.deptName}</span>
                          <span className="text-slate-400 font-normal">({group.items.length} in view)</span>
                        </h3>
                        <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                          <span className="text-amber-600 font-semibold">{deptPending} Pending</span>
                          <span>·</span>
                          <span className="text-emerald-600 font-semibold">{deptCleared} Cleared</span>
                          {deptDue > 0 && (
                            <>
                              <span>·</span>
                              <span className="text-rose-600 font-semibold">{deptDue} Due</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      {canReviewClearance && deptPending > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            handleOpenBatchClear({
                              departmentId: group.deptId,
                              departmentName: group.deptName,
                              departmentCode: group.deptCode
                            })
                          }
                          className="btn btn-secondary text-xs py-1 px-2.5 bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-50 font-bold"
                        >
                          <CheckCheck className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Clear {deptPending} Pending</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleDeptExpanded(deptKey)}
                        className="p-1 rounded-lg text-slate-400 hover:text-slate-700"
                      >
                        {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Department Group Student Table */}
                  {!isCollapsed && (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr>
                            <th className="w-10 text-center">
                              <input
                                type="checkbox"
                                checked={group.items.length > 0 && group.items.every((i: any) => selectedIds.has(i.id || i._id))}
                                onChange={() => {
                                  const groupIds = group.items.map((i: any) => i.id || i._id);
                                  const allGroupSelected = groupIds.every((id: string) => selectedIds.has(id));
                                  setSelectedIds((prev) => {
                                    const next = new Set(prev);
                                    if (allGroupSelected) {
                                      groupIds.forEach((id: string) => next.delete(id));
                                    } else {
                                      groupIds.forEach((id: string) => next.add(id));
                                    }
                                    return next;
                                  });
                                }}
                                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer w-4 h-4"
                                title="Select All in Group"
                              />
                            </th>
                            <th>Student</th>
                            <th>USN</th>
                            <th>Clearance Item</th>
                            <th>Clearance Status</th>
                            <th className="text-right">{canReviewClearance ? 'Action' : 'Clearance Review'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.items.map((task: any) => {
                            const taskId = task.id || task._id;
                            const isSelected = selectedIds.has(taskId);
                            const studentName = task.studentId?.fullName || 'Student';
                            const initials = studentName.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase();
                            const isDue = task.status === 'DUE';
                            return (
                              <tr key={taskId} className={`${isDue ? 'due-row-accent' : ''} ${isSelected ? 'bg-blue-50/50' : ''}`}>
                                <td className="text-center">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => handleToggleOne(taskId)}
                                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer w-4 h-4"
                                  />
                                </td>
                                <td>
                                  <div className="name-cell">
                                    <div className="avatar-sm">{initials}</div>
                                    <span className="cell-primary">{studentName}</span>
                                  </div>
                                </td>
                                <td className="mono-text font-bold text-blue-700">{task.studentId?.usn}</td>
                                <td>
                                  {task.lab ? (
                                    <div className="flex items-center gap-1.5">
                                      <FlaskConical className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                                      <span className="font-bold text-xs text-blue-900">{task.lab.name}</span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5">
                                      <Building2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                      <span className="text-xs text-slate-700 font-medium">
                                        {task.department?.name || task.departmentId?.name || 'Department Desk'}
                                      </span>
                                    </div>
                                  )}
                                </td>
                                <td>
                                  <ClearanceStatusBadge status={task.status} />
                                </td>
                                <td className="text-right">
                                  {canReviewClearance ? (
                                    <button
                                      onClick={() => handleOpenReviewModal(task)}
                                      className="btn btn-secondary btn-compact"
                                    >
                                      Review
                                    </button>
                                  ) : (
                                    <span className="inline-flex items-center text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-1 rounded-md border border-slate-200/60">
                                      Designated Desks Only
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* Standard Table View */
          <>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th className="w-10 text-center">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = isSomeSelected && !allSelected;
                        }}
                        onChange={handleToggleSelectAll}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer w-4 h-4"
                        title="Select All Displayed Students"
                      />
                    </th>
                    <th>Student</th>
                    <th>USN</th>
                    <th>Academic Department</th>
                    <th>Clearance Item</th>
                    <th>Clearance Status</th>
                    <th className="text-right">{canReviewClearance ? 'Action' : 'Clearance Review'}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedClearances.map((task) => {
                    const taskId = task.id || task._id;
                    const isSelected = selectedIds.has(taskId);
                    const studentName = task.studentId?.fullName || 'Student';
                    const initials = studentName.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase();
                    const isDue = task.status === 'DUE';
                    const dept = task.studentId?.departmentId;
                    return (
                      <tr key={taskId} className={`${isDue ? 'due-row-accent' : ''} ${isSelected ? 'bg-blue-50/50' : ''}`}>
                        <td className="text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleOne(taskId)}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer w-4 h-4"
                          />
                        </td>
                        <td>
                          <div className="name-cell">
                            <div className="avatar-sm">{initials}</div>
                            <span className="cell-primary">{studentName}</span>
                          </div>
                        </td>
                        <td className="mono-text font-bold text-blue-700">{task.studentId?.usn}</td>
                        <td>
                          <div className="flex items-center gap-1.5">
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-black uppercase bg-blue-50 text-blue-700 border border-blue-200/70">
                              {dept?.code || 'GEN'}
                            </span>
                            <span className="text-xs text-slate-700 font-medium">
                              {dept?.name || task.studentId?.batch || 'N/A'}
                            </span>
                          </div>
                        </td>
                        <td>
                          {task.lab ? (
                            <div className="flex items-center gap-1.5">
                              <FlaskConical className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                              <span className="font-bold text-xs text-blue-900">{task.lab.name}</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <Building2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                              <span className="text-xs text-slate-700 font-medium">
                                {task.department?.name || task.departmentId?.name || 'Department Desk'}
                              </span>
                            </div>
                          )}
                        </td>
                        <td>
                          <ClearanceStatusBadge status={task.status} />
                        </td>
                        <td className="text-right">
                          {canReviewClearance ? (
                            <button
                              onClick={() => handleOpenReviewModal(task)}
                              className="btn btn-secondary btn-compact"
                            >
                              Review
                            </button>
                          ) : (
                            <span className="inline-flex items-center text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-1 rounded-md border border-slate-200/60">
                              Designated Desks Only
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
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
                </select>

                <span className="mono-text font-semibold text-slate-600 ml-2">
                  {pagination.total > 0
                    ? `${(page - 1) * limit + 1}–${Math.min(page * limit, pagination.total)} of ${pagination.total} records`
                    : '0 of 0 records'}
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
          </>
        )}
      </div>

      {/* Review Clearance Modal */}
      {selectedTask && canReviewClearance && (
        <>
          <div className="drawer-scrim" onClick={() => setSelectedTask(null)} />
          <div className="modal open !max-w-[500px] w-full rounded-2xl p-0 overflow-hidden border border-slate-200/90 shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-white">
              <div>
                <h3 className="text-base font-bold text-slate-900">Process Clearance</h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  {selectedTask.studentId?.fullName} · <span className="font-mono text-blue-600 font-bold">{selectedTask.studentId?.usn}</span>
                </p>
              </div>
              <button onClick={() => setSelectedTask(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalError && (
              <div className="px-5 pt-3">
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium rounded-xl">
                  {modalError}
                </div>
              </div>
            )}

            <form onSubmit={handleProcessClearance}>
              <div className="p-5 space-y-4 bg-white">
                <div className="p-3 bg-blue-50/70 border border-blue-200/80 rounded-xl text-xs flex items-center justify-between">
                  <span className="text-slate-600 font-medium">Clearance Item:</span>
                  <span className="font-bold text-blue-950 flex items-center gap-1.5">
                    {selectedTask.lab ? <FlaskConical className="w-3.5 h-3.5 text-blue-600" /> : <Building2 className="w-3.5 h-3.5 text-slate-600" />}
                    {selectedTask.lab?.name || selectedTask.department?.name || selectedTask.departmentId?.name || 'Department Clearance'}
                    {selectedTask.lab ? ' (Laboratory Category)' : ' (Academic Department)'}
                  </span>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-2">Select Clearance Status</label>
                  <div className={`grid ${isTaskHostel(selectedTask) ? 'grid-cols-3' : 'grid-cols-2'} gap-2.5`}>
                    <button
                      type="button"
                      onClick={() => setActionStatus('CLEARED')}
                      className={`h-12 px-3 rounded-xl border-2 transition-all flex items-center justify-center gap-2 cursor-pointer font-bold text-xs whitespace-nowrap ${
                        actionStatus === 'CLEARED'
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100 hover:border-slate-300'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>No Due</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActionStatus('DUE')}
                      className={`h-12 px-3 rounded-xl border-2 transition-all flex items-center justify-center gap-2 cursor-pointer font-bold text-xs whitespace-nowrap ${
                        actionStatus === 'DUE'
                          ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100 hover:border-slate-300'
                      }`}
                    >
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>Due</span>
                    </button>

                    {isTaskHostel(selectedTask) && (
                      <button
                        type="button"
                        onClick={() => setActionStatus('NOT_APPLICABLE')}
                        className={`h-12 px-2.5 rounded-xl border-2 transition-all flex items-center justify-center gap-1.5 cursor-pointer font-bold text-xs whitespace-nowrap ${
                          actionStatus === 'NOT_APPLICABLE'
                            ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                            : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100 hover:border-slate-300'
                        }`}
                      >
                        <MinusCircle className="w-4 h-4 shrink-0" />
                        <span>Not Applicable</span>
                      </button>
                    )}
                  </div>

                  {/* Dynamic Minimal Banner */}
                  <div className="mt-3">
                    {actionStatus === 'CLEARED' ? (
                      <div className="p-3 bg-emerald-50/80 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center gap-2.5 font-medium">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>Student is cleared (No Dues). Eligible for certificate once all departments clear.</span>
                      </div>
                    ) : actionStatus === 'DUE' ? (
                      <div className="p-3 bg-rose-50/80 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2.5 font-medium">
                        <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                        <span>Student has pending dues. Certificate download will be blocked.</span>
                      </div>
                    ) : (
                      <div className="p-3 bg-slate-100 border border-slate-200 text-slate-800 rounded-xl text-xs flex items-center gap-2.5 font-medium">
                        <MinusCircle className="w-4 h-4 text-slate-600 shrink-0" />
                        <span>Student does not require Hostel clearance. Satisfies NDC approval and omitted from certificate.</span>
                      </div>
                    )}
                  </div>

                  {/* Due details inputs when DUE is selected */}
                  {actionStatus === 'DUE' && (
                    <div className="mt-3 space-y-3 pt-2 border-t border-slate-100">
                      <div>
                        <label className="text-xs font-semibold text-slate-600 block mb-1">
                          Due Amount (₹)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={dueAmount}
                          onChange={(e) => setDueAmount(e.target.value)}
                          placeholder="e.g. 500"
                          className="input text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-600 block mb-1">
                          Due Details / Reason
                        </label>
                        <input
                          type="text"
                          value={dueDetails}
                          onChange={(e) => setDueDetails(e.target.value)}
                          placeholder="e.g. Unreturned hostel keys or mess dues"
                          className="input text-xs"
                        />
                      </div>
                    </div>
                  )}

                  {/* Remarks input */}
                  {actionStatus !== 'DUE' && (
                    <div className="mt-3 pt-2 border-t border-slate-100">
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                        Remarks (Optional)
                      </label>
                      <input
                        type="text"
                        value={remarks}
                        onChange={(e) => setRemarks(e.target.value)}
                        placeholder={
                          actionStatus === 'NOT_APPLICABLE'
                            ? 'e.g. Day scholar student - Hostel not applicable'
                            : 'e.g. Verified and approved'
                        }
                        className="input text-xs"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedTask(null)}
                  className="flex-1 py-2.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold rounded-xl text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-sm transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* Batch Clear Confirmation Modal */}
      {batchModalOpen && batchTargetDept && (
        <>
          <div className="drawer-scrim" onClick={() => setBatchModalOpen(false)} />
          <div className="modal open max-w-md rounded-2xl p-0 overflow-hidden border border-slate-200/80 shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-white">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
                  <CheckCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Batch Clear Department</h3>
                  <p className="text-xs text-slate-500 font-medium">
                    {batchTargetDept.departmentName} ({batchTargetDept.departmentCode})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setBatchModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleExecuteBatchClear}>
              <div className="p-5 space-y-4 bg-white">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 space-y-1">
                  <div className="font-bold">Clear All Pending Students in this Branch</div>
                  <p>
                    This will mark all pending students of{' '}
                    <span className="font-bold">{batchTargetDept.departmentName}</span> as{' '}
                    <strong>No Dues (Cleared)</strong> for {departmentName}.
                  </p>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">
                    Clearance Remarks (Optional)
                  </label>
                  <input
                    type="text"
                    value={batchRemarks}
                    onChange={(e) => setBatchRemarks(e.target.value)}
                    placeholder="e.g. All department books returned & lab dues verified"
                    className="input text-xs"
                  />
                </div>
              </div>

              <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-2">
                <button
                  type="button"
                  onClick={() => setBatchModalOpen(false)}
                  className="flex-1 py-2.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold rounded-xl text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={batchSubmitting}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {batchSubmitting ? 'Clearing...' : 'Confirm Batch Clear'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
};
