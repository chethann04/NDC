import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { useAuthStore } from '../../store/useAuthStore';
import {
  FlaskConical,
  CheckCircle2,
  Clock,
  AlertCircle,
  Search,
  RefreshCw,
  Building,
  CheckCheck,
  X
} from 'lucide-react';
import { ErrorAlert } from '../../components/ErrorAlert';

interface ClearanceItem {
  id: string;
  ndcRequestId: any;
  studentId: any;
  departmentId: any;
  status: 'PENDING' | 'CLEARED' | 'DUE' | 'NOT_APPLICABLE';
  dueAmount: number;
  dueDetails?: string;
  remarks?: string;
  reviewedBy?: any;
  reviewedAt?: string;
  createdAt: string;
  student?: {
    id: string;
    usn: string;
    fullName: string;
    email: string;
    department?: { id: string; name: string; code: string };
  };
}

export const ChemistryLabClearance: React.FC = () => {
  const { user } = useAuthStore();
  const [clearances, setClearances] = useState<ClearanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>({ TOTAL: 0, PENDING: 0, DUE: 0, CLEARED: 0, byDepartment: [] });
  const [activeTab, setActiveTab] = useState<'PENDING' | 'DUE' | 'CLEARED' | 'ALL'>('PENDING');
  const [selectedBranch, setSelectedBranch] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkClearing, setBulkClearing] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ cleared: number; message?: string } | null>(null);

  // Review modal state
  const [selectedItem, setSelectedItem] = useState<ClearanceItem | null>(null);
  const [actionStatus, setActionStatus] = useState<'CLEARED' | 'DUE'>('CLEARED');
  const [dueAmount, setDueAmount] = useState('0');
  const [dueDetails, setDueDetails] = useState('');
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');

  // Chemistry Lab Glassware Presets
  const chemistryPresets = [
    { label: 'Burette / Pipette Breakage', amount: 250 },
    { label: 'Standard Volumetric Flask 250ml Broken', amount: 300 },
    { label: 'Analytical Balance / Crucible Damage', amount: 600 },
    { label: 'Chemistry Observation Manual Incomplete', amount: 0 },
    { label: 'Conical Flask & Reagent Bottle Damage', amount: 200 },
    { label: 'Digital Conductivity Cell Electrode Damaged', amount: 500 }
  ];

  const fetchClearances = async () => {
    try {
      setLoading(true);
      const [statsRes, listRes] = await Promise.all([
        api.get('/ndc/officer/stats'),
        api.get('/ndc/officer/clearances', {
          params: {
            status: activeTab === 'ALL' ? undefined : activeTab,
            search: search.trim() || undefined,
            studentDepartmentId: selectedBranch === 'ALL' ? undefined : selectedBranch,
            limit: 200
          }
        })
      ]);

      if (statsRes.data?.data) {
        setStats(statsRes.data.data);
      }
      setClearances(listRes.data?.data || []);
    } catch (err: any) {
      console.error('[ChemistryLab] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClearances();
  }, [activeTab, selectedBranch]);

  // Debounced search
  useEffect(() => {
    const handler = setTimeout(() => {
      fetchClearances();
    }, 350);
    return () => clearTimeout(handler);
  }, [search]);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const pendingIds = clearances.filter((c) => c.status === 'PENDING').map((c) => c.id);
      setSelectedIds(new Set(pendingIds));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleBulkClear = async () => {
    if (selectedIds.size === 0) return;
    try {
      setBulkClearing(true);
      setBulkResult(null);
      const res = await api.post('/ndc/clearances/bulk-clear', {
        clearanceIds: Array.from(selectedIds),
        remarks: 'Chemistry Lab glassware & reagent verified - NO DUE'
      });
      setBulkResult({
        cleared: res.data?.cleared || selectedIds.size,
        message: `Successfully cleared Chemistry Lab for ${res.data?.cleared || selectedIds.size} students.`
      });
      setSelectedIds(new Set());
      await fetchClearances();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Bulk clear failed');
    } finally {
      setBulkClearing(false);
    }
  };

  const openReviewModal = (item: ClearanceItem) => {
    setSelectedItem(item);
    setActionStatus(item.status === 'DUE' ? 'DUE' : 'CLEARED');
    setDueAmount(String(item.dueAmount || 0));
    setDueDetails(item.dueDetails || '');
    setRemarks(item.remarks || '');
    setModalError('');
  };

  const submitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;
    setSubmitting(true);
    setModalError('');

    try {
      await api.put(`/ndc/clearance/${selectedItem.id}`, {
        status: actionStatus,
        dueAmount: actionStatus === 'DUE' ? parseFloat(dueAmount) || 0 : 0,
        dueDetails: actionStatus === 'DUE' ? dueDetails : undefined,
        remarks: remarks || (actionStatus === 'CLEARED' ? 'Chemistry Lab No Due Verified' : 'Chemistry Lab dues recorded')
      });

      setSelectedItem(null);
      await fetchClearances();
    } catch (err: any) {
      setModalError(err.response?.data?.message || 'Failed to update clearance status.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-emerald-950 via-teal-900 to-cyan-950 rounded-2xl p-6 text-white shadow-md relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-8 -translate-y-8 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center shrink-0 text-emerald-300 shadow-inner">
              <FlaskConical className="w-8 h-8 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-emerald-400/20 text-emerald-200 border border-emerald-300/30 uppercase tracking-wider">
                  Chemistry Lab Desk
                </span>
                <span className="text-xs text-emerald-200/80 font-mono">Scope: CHEM001</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white mt-1">
                Engineering Chemistry Laboratory Clearance
              </h1>
              <p className="text-xs sm:text-sm text-emerald-100/90 mt-1 max-w-2xl">
                Independent clearance portal for Chemistry laboratory glassware, chemical reagents, titration assemblies, lab manuals, and breakage assessment.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => fetchClearances()}
              disabled={loading}
              className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold backdrop-blur-sm border border-white/15 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh Queue</span>
            </button>
          </div>
        </div>
      </div>

      {/* KPI Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="bg-white p-4 rounded-xl border border-zinc-200 shadow-xs">
          <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Chemistry Assigned</p>
          <div className="text-2xl font-black text-zinc-900 mt-1">{stats.TOTAL || clearances.length}</div>
          <p className="text-[11px] text-zinc-400 mt-0.5">Total registered students</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-amber-200/80 shadow-xs bg-amber-50/20">
          <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">Pending Review</p>
          <div className="text-2xl font-black text-amber-600 mt-1">{stats.PENDING || 0}</div>
          <p className="text-[11px] text-amber-700/80 mt-0.5">Awaiting glassware check</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-rose-200/80 shadow-xs bg-rose-50/20">
          <p className="text-[11px] font-bold text-rose-700 uppercase tracking-wider">Glassware Dues</p>
          <div className="text-2xl font-black text-rose-600 mt-1">{stats.DUE || 0}</div>
          <p className="text-[11px] text-rose-700/80 mt-0.5">Outstanding breakages</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-emerald-200/80 shadow-xs bg-emerald-50/20">
          <p className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">No Due Cleared</p>
          <div className="text-2xl font-black text-emerald-600 mt-1">{stats.CLEARED || 0}</div>
          <p className="text-[11px] text-emerald-700/80 mt-0.5">Chemistry lab approved</p>
        </div>
      </div>

      {/* Bulk Result Banner */}
      {bulkResult && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold">{bulkResult.message}</span>
          </div>
          <button onClick={() => setBulkResult(null)} className="text-emerald-700 hover:text-emerald-900">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Controls & Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-xs space-y-3.5">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Status Tabs */}
          <div className="inline-flex rounded-xl bg-zinc-100 p-1 text-xs font-semibold">
            {(['PENDING', 'DUE', 'CLEARED', 'ALL'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 rounded-lg transition-all capitalize ${
                  activeTab === tab ? 'bg-white text-zinc-900 shadow-xs font-bold' : 'text-zinc-500 hover:text-zinc-900'
                }`}
              >
                {tab === 'ALL' ? 'All Records' : tab === 'PENDING' ? 'Pending' : tab === 'DUE' ? 'Dues' : 'Cleared'}
              </button>
            ))}
          </div>

          {/* Search Input */}
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search student USN or Name..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
            />
          </div>
        </div>

        {/* Branch Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-1 text-xs">
          <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider mr-1 shrink-0 flex items-center gap-1">
            <Building className="w-3 h-3" /> Branch:
          </span>
          <button
            onClick={() => setSelectedBranch('ALL')}
            className={`px-2.5 py-1 rounded-lg font-semibold shrink-0 transition-colors ${
              selectedBranch === 'ALL' ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
            }`}
          >
            All Branches
          </button>
          {(stats.byDepartment || []).map((b: any) => (
            <button
              key={b.departmentId}
              onClick={() => setSelectedBranch(b.departmentId)}
              className={`px-2.5 py-1 rounded-lg font-semibold shrink-0 transition-colors ${
                selectedBranch === b.departmentId
                  ? 'bg-emerald-900 text-emerald-100 font-bold'
                  : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
              }`}
            >
              {b.departmentCode} ({b.total})
            </button>
          ))}
        </div>

        {/* Multi-Select Bulk Actions Bar */}
        {selectedIds.size > 0 && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-emerald-950 font-bold">
              <CheckCheck className="w-4 h-4 text-emerald-700" />
              <span>{selectedIds.size} students selected for Chemistry Lab Clearance</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedIds(new Set())}
                className="px-2.5 py-1.5 rounded-lg text-zinc-600 hover:bg-white text-xs font-semibold"
              >
                Clear Selection
              </button>
              <button
                onClick={handleBulkClear}
                disabled={bulkClearing}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                <span>{bulkClearing ? 'Clearing...' : 'Approve & Mark No Due'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Clearances Table */}
      <div className="bg-white rounded-2xl border border-zinc-200/80 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-zinc-400 font-semibold text-xs">
            <FlaskConical className="w-6 h-6 text-emerald-600 animate-spin mx-auto mb-2" />
            Loading Chemistry Lab clearance queue...
          </div>
        ) : clearances.length === 0 ? (
          <div className="p-12 text-center text-zinc-500 text-xs">
            <p className="font-bold text-sm text-zinc-800 mb-1">No Chemistry Lab clearance records found</p>
            <p className="text-zinc-400">Try adjusting your status tab or branch filter.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-zinc-50/80 border-b border-zinc-200 text-zinc-600 font-bold">
                  <th className="py-3 px-3.5 w-10">
                    <input
                      type="checkbox"
                      onChange={handleSelectAll}
                      checked={
                        clearances.filter((c) => c.status === 'PENDING').length > 0 &&
                        clearances.filter((c) => c.status === 'PENDING').every((c) => selectedIds.has(c.id))
                      }
                      className="rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                    />
                  </th>
                  <th className="py-3 px-3.5 font-bold uppercase tracking-wider text-[10px] text-zinc-500">Student USN</th>
                  <th className="py-3 px-3.5 font-bold uppercase tracking-wider text-[10px] text-zinc-500">Name & Branch</th>
                  <th className="py-3 px-3.5 font-bold uppercase tracking-wider text-[10px] text-zinc-500">Chemistry Lab Status</th>
                  <th className="py-3 px-3.5 font-bold uppercase tracking-wider text-[10px] text-zinc-500">Glassware Dues</th>
                  <th className="py-3 px-3.5 font-bold uppercase tracking-wider text-[10px] text-zinc-500">Remarks / Inspection</th>
                  <th className="py-3 px-3.5 text-right font-bold uppercase tracking-wider text-[10px] text-zinc-500">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {clearances.map((c) => {
                  const student = c.studentId || c.student;
                  const dept = student?.departmentId || student?.department;
                  const isPending = c.status === 'PENDING';
                  const isDue = c.status === 'DUE';
                  const isCleared = c.status === 'CLEARED';

                  return (
                    <tr
                      key={c.id}
                      className={`hover:bg-zinc-50/70 transition-colors ${
                        selectedIds.has(c.id) ? 'bg-emerald-50/40' : ''
                      }`}
                    >
                      <td className="py-3 px-3.5">
                        {isPending && (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(c.id)}
                            onChange={() => handleToggleSelect(c.id)}
                            className="rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                          />
                        )}
                      </td>
                      <td className="py-3 px-3.5 font-mono font-bold text-zinc-900">
                        {student?.usn || 'N/A'}
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="font-semibold text-zinc-900">{student?.fullName || 'Student'}</div>
                        <div className="text-[11px] text-zinc-500">
                          {dept?.code ? `${dept.code} — ${dept.name}` : dept?.name || 'Department'}
                        </div>
                      </td>
                      <td className="py-3 px-3.5">
                        {isCleared && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3.5 h-3.5" /> No Due
                          </span>
                        )}
                        {isDue && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            <AlertCircle className="w-3.5 h-3.5" /> Glassware Due
                          </span>
                        )}
                        {isPending && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            <Clock className="w-3.5 h-3.5" /> Awaiting Review
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3.5">
                        {c.dueAmount > 0 ? (
                          <div>
                            <span className="font-mono font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded text-[11px] border border-rose-100">
                              ₹{c.dueAmount}
                            </span>
                            {c.dueDetails && (
                              <p className="text-[10px] text-zinc-500 mt-0.5 truncate max-w-xs">{c.dueDetails}</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-zinc-400 font-mono text-[11px]">₹0</span>
                        )}
                      </td>
                      <td className="py-3 px-3.5 text-zinc-600 max-w-xs">
                        <p className="truncate text-[11px]">{c.remarks || '—'}</p>
                        {c.reviewedBy && (
                          <span className="text-[10px] text-zinc-400 block">By: {c.reviewedBy.name || 'Officer'}</span>
                        )}
                      </td>
                      <td className="py-3 px-3.5 text-right">
                        <button
                          onClick={() => openReviewModal(c)}
                          className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white font-bold text-[11px] transition-colors cursor-pointer"
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Review Modal */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-zinc-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <FlaskConical className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-zinc-900 text-sm">Chemistry Lab Clearance Review</h3>
              </div>
              <button
                onClick={() => setSelectedItem(null)}
                className="text-zinc-400 hover:text-zinc-700 rounded-lg p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalError && (
              <ErrorAlert error={modalError} onDismiss={() => setModalError('')} className="mb-4" />
            )}

            {/* Student Info Box */}
            <div className="p-3 bg-zinc-50 rounded-xl mb-4 border border-zinc-200/80 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-zinc-500 font-medium">Student Name:</span>
                <span className="font-bold text-zinc-900">
                  {selectedItem.studentId?.fullName || selectedItem.student?.fullName || 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500 font-medium">USN:</span>
                <span className="font-mono font-bold text-emerald-900">
                  {selectedItem.studentId?.usn || selectedItem.student?.usn || 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500 font-medium">Department:</span>
                <span className="font-medium text-zinc-800">
                  {selectedItem.studentId?.department?.name || selectedItem.student?.department?.name || 'Department'}
                </span>
              </div>
            </div>

            <form onSubmit={submitReview} className="space-y-4 text-xs">
              {/* Status Toggle */}
              <div>
                <label className="block font-semibold text-zinc-700 mb-1.5">Inspection Status</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActionStatus('CLEARED');
                      setDueAmount('0');
                      setDueDetails('');
                    }}
                    className={`p-3 rounded-xl border flex items-center justify-center gap-2 font-bold cursor-pointer transition-all ${
                      actionStatus === 'CLEARED'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500/20'
                        : 'border-zinc-200 hover:bg-zinc-50 text-zinc-700'
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>✓ Clear (No Due)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActionStatus('DUE')}
                    className={`p-3 rounded-xl border flex items-center justify-center gap-2 font-bold cursor-pointer transition-all ${
                      actionStatus === 'DUE'
                        ? 'border-rose-500 bg-rose-50 text-rose-900 ring-2 ring-rose-500/20'
                        : 'border-zinc-200 hover:bg-zinc-50 text-zinc-700'
                    }`}
                  >
                    <AlertCircle className="w-4 h-4 text-rose-600" />
                    <span>⚠ Record Due</span>
                  </button>
                </div>
              </div>

              {/* If DUE is selected, show glassware presets and amount */}
              {actionStatus === 'DUE' && (
                <div className="space-y-3 p-3.5 bg-rose-50/60 border border-rose-200 rounded-xl animate-in fade-in duration-100">
                  <div>
                    <label className="block font-semibold text-rose-950 mb-1.5">
                      Quick Preset: Chemistry Glassware & Apparatus
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {chemistryPresets.map((p) => (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => {
                            setDueDetails(p.label);
                            setDueAmount(String(p.amount));
                            setRemarks(`Glassware Due: ${p.label}`);
                          }}
                          className="px-2.5 py-1 bg-white hover:bg-rose-100/60 border border-rose-200 rounded-lg text-[11px] font-medium text-rose-900 transition-colors"
                        >
                          {p.label} (₹{p.amount})
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-zinc-700 mb-1">Due Amount (₹)</label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={dueAmount}
                        onChange={(e) => setDueAmount(e.target.value)}
                        required
                        className="w-full px-3 py-2 rounded-lg border border-zinc-300 font-mono font-bold text-zinc-900 focus:outline-none focus:border-rose-500"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-zinc-700 mb-1">Glassware / Reagent Detail</label>
                      <input
                        type="text"
                        value={dueDetails}
                        onChange={(e) => setDueDetails(e.target.value)}
                        placeholder="e.g. Standard flask 250ml broken"
                        className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-zinc-900 focus:outline-none focus:border-rose-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Remarks */}
              <div>
                <label className="block font-semibold text-zinc-700 mb-1">Officer Remarks / Notes</label>
                <input
                  type="text"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="e.g. All titration sets and lab records verified complete"
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-zinc-900 focus:outline-none focus:border-zinc-900"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-100">
                <button
                  type="button"
                  onClick={() => setSelectedItem(null)}
                  className="px-4 py-2 rounded-lg border border-zinc-200 hover:bg-zinc-50 text-zinc-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white font-bold disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  {submitting ? 'Saving...' : 'Confirm Clearance Status'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
