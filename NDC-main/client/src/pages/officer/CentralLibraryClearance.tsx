import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { useAuthStore } from '../../store/useAuthStore';
import {
  BookOpen,
  Library,
  CheckCircle2,
  Clock,
  AlertCircle,
  Search,
  RefreshCw,
  Building,
  CheckCheck,
  X,
  Sparkles,
  UploadCloud,
  FileCheck2,
  ChevronRight,
  ShieldCheck,
  Layers,
  AlertTriangle,
  BookX,
  BookmarkCheck
} from 'lucide-react';
import { ErrorAlert } from '../../components/ErrorAlert';
import { clientCache } from '../../utils/clientCache';
import { PhysicsAiAssistantModal } from '../../components/ai/PhysicsAiAssistantModal';
import { LogbookScannerModal } from '../../components/ai/LogbookScannerModal';

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

export const CentralLibraryClearance: React.FC = () => {
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
  const [isAiAssistantOpen, setIsAiAssistantOpen] = useState(false);
  const [isLogbookScannerOpen, setIsLogbookScannerOpen] = useState(false);
  const [libraryDepartmentId, setLibraryDepartmentId] = useState<string>('b30d4500-6374-4fb3-a9b3-f395b8db9657');

  // Review modal state
  const [selectedItem, setSelectedItem] = useState<ClearanceItem | null>(null);
  const [actionStatus, setActionStatus] = useState<'CLEARED' | 'DUE'>('CLEARED');
  const [dueAmount, setDueAmount] = useState('0');
  const [dueDetails, setDueDetails] = useState('');
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');

  // Central Library Due Presets
  const libraryPresets = [
    { label: 'Overdue Textbook Circulation Fine', amount: 50 },
    { label: 'Reference Section Book Overdue (30+ Days)', amount: 150 },
    { label: 'Lost Textbook Replacement Charge', amount: 500 },
    { label: 'Damaged Book Spine / Barcode Defacement', amount: 200 },
    { label: 'Digital Library RFID Smart ID Card Replacement', amount: 100 },
    { label: 'Book Bank Scheme Manual Overdue', amount: 0 }
  ];

  // Resolve library department ID dynamically if needed
  useEffect(() => {
    const resolveLibraryDept = async () => {
      try {
        const res = await api.get('/departments');
        const depts = res.data?.data || [];
        const lib = depts.find((d: any) => d.code === 'LIB' || d.name?.toLowerCase().includes('library'));
        if (lib) {
          setLibraryDepartmentId(lib.id);
        }
      } catch {
        // Fallback to pre-seeded ID
      }
    };
    resolveLibraryDept();
  }, []);

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
      console.error('[CentralLibrary] Fetch error:', err);
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

  // Listen for clearance mutations triggered globally (e.g. from Navbar AI or Scanner modal)
  useEffect(() => {
    const onClearanceUpdated = () => {
      fetchClearances();
    };
    window.addEventListener('ndc_clearance_updated', onClearanceUpdated);
    return () => window.removeEventListener('ndc_clearance_updated', onClearanceUpdated);
  }, []);


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
        remarks: 'Central Library books returned & circulation dues verified - NO DUE'
      });
      setBulkResult({
        cleared: res.data?.cleared || selectedIds.size,
        message: `Successfully cleared Central Library for ${res.data?.cleared || selectedIds.size} students.`
      });
      setSelectedIds(new Set());
      clientCache.invalidate('officer');
      clientCache.invalidate('student_ndc_status');
      clientCache.invalidate('admin_dashboard');
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
        remarks: remarks || (actionStatus === 'CLEARED' ? 'Central Library No Due Verified' : 'Central Library circulation due recorded')
      });

      setSelectedItem(null);
      clientCache.invalidate('officer');
      clientCache.invalidate('student_ndc_status');
      clientCache.invalidate('admin_dashboard');
      await fetchClearances();
    } catch (err: any) {
      setModalError(err.response?.data?.message || 'Failed to update clearance status.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Simple Clean Header for Clearance Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-200">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-zinc-900">Central Library Clearance</h1>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
              LIB001 • Central Desk
            </span>
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            Review textbook returns, circulation dues, overdue fines, and issue library clearances.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => fetchClearances()}
            disabled={loading}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-zinc-50 text-zinc-700 text-xs font-semibold border border-zinc-200 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-2xs"
            title="Refresh clearance records"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>


      {/* Stats Counter Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl p-4 border border-zinc-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold tracking-wider text-zinc-500 uppercase">Total Students</p>
            <p className="text-2xl font-black text-zinc-900 mt-1">{stats.TOTAL || 0}</p>
            <p className="text-[11px] text-zinc-400 mt-0.5">Assigned to Central Library</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-zinc-100 flex items-center justify-center text-zinc-600">
            <Layers className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-amber-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold tracking-wider text-amber-700 uppercase">Pending Review</p>
            <p className="text-2xl font-black text-amber-600 mt-1">{stats.PENDING || 0}</p>
            <p className="text-[11px] text-amber-600/80 mt-0.5">Awaiting book verification</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-rose-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold tracking-wider text-rose-700 uppercase">With Overdue Dues</p>
            <p className="text-2xl font-black text-rose-600 mt-1">{stats.DUE || 0}</p>
            <p className="text-[11px] text-rose-600/80 mt-0.5">Unreturned books or fines</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-rose-50 flex items-center justify-center text-rose-600">
            <BookX className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-emerald-200/80 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold tracking-wider text-emerald-700 uppercase">Cleared (No Due)</p>
            <p className="text-2xl font-black text-emerald-600 mt-1">{stats.CLEARED || 0}</p>
            <p className="text-[11px] text-emerald-600/80 mt-0.5">Approved library status</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
            <BookmarkCheck className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Bulk Result Banner */}
      {bulkResult && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-center justify-between animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span className="font-semibold text-sm">{bulkResult.message}</span>
          </div>
          <button
            onClick={() => setBulkResult(null)}
            className="text-emerald-600 hover:text-emerald-800 font-bold text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Content Card */}
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
        {/* Controls Toolbar */}
        <div className="p-4 border-b border-zinc-100 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-zinc-50/50">
          {/* Tabs */}
          <div className="flex items-center gap-1 bg-zinc-200/70 p-1 rounded-xl overflow-x-auto text-xs font-bold text-zinc-600">
            {(['PENDING', 'DUE', 'CLEARED', 'ALL'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  setActiveTab(tab);
                  setSelectedIds(new Set());
                }}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                  activeTab === tab
                    ? 'bg-white text-zinc-900 shadow-xs'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                {tab === 'PENDING' && 'Pending Verification'}
                {tab === 'DUE' && 'With Dues'}
                {tab === 'CLEARED' && 'No Due (Cleared)'}
                {tab === 'ALL' && 'All Records'}
              </button>
            ))}
          </div>

          {/* Search & Academic Branch Filter */}
          <div className="flex flex-wrap items-center gap-2">
            {stats.byDepartment && stats.byDepartment.length > 0 && (
              <select
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
                className="bg-white border border-zinc-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-zinc-700 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
              >
                <option value="ALL">All Academic Branches</option>
                {stats.byDepartment.map((b: any) => (
                  <option key={b.departmentId} value={b.departmentId}>
                    {b.departmentCode} ({b.total})
                  </option>
                ))}
              </select>
            )}

            <div className="relative min-w-[200px]">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search USN or Name..."
                className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-zinc-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/20"
              />
            </div>

            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={handleBulkClear}
                disabled={bulkClearing}
                className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Clear {selectedIds.size} Selected (No Due)</span>
              </button>
            )}
          </div>
        </div>

        {/* Clearances Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200/80 text-[11px] font-bold text-zinc-500 uppercase tracking-wider">
                <th className="py-3 px-4 w-10">
                  <input
                    type="checkbox"
                    onChange={handleSelectAll}
                    checked={
                      clearances.length > 0 &&
                      clearances.filter((c) => c.status === 'PENDING').length > 0 &&
                      clearances
                        .filter((c) => c.status === 'PENDING')
                        .every((c) => selectedIds.has(c.id))
                    }
                    className="rounded border-zinc-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                  />
                </th>
                <th className="py-3 px-4">Student Details</th>
                <th className="py-3 px-4">Academic Branch</th>
                <th className="py-3 px-4">Clearance Status</th>
                <th className="py-3 px-4">Library Due (₹)</th>
                <th className="py-3 px-4">Remarks / Overdue Books</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-zinc-400">
                    <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200/80 flex items-center justify-center mx-auto mb-2">
                      <RefreshCw className="w-5 h-5 animate-spin text-amber-600" />
                    </div>
                    <span>Loading Central Library clearances...</span>
                  </td>
                </tr>
              ) : clearances.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-zinc-400">
                    <BookOpen className="w-8 h-8 mx-auto mb-2 text-zinc-300" />
                    <span className="font-semibold text-zinc-500">No clearance records found for this filter.</span>
                  </td>
                </tr>
              ) : (
                clearances.map((item) => {
                  const isSelected = selectedIds.has(item.id);
                  const isPending = item.status === 'PENDING';
                  const isDue = item.status === 'DUE';
                  const isCleared = item.status === 'CLEARED';

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-zinc-50/70 transition-colors ${
                        isSelected ? 'bg-amber-50/40' : ''
                      }`}
                    >
                      <td className="py-3 px-4">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!isPending}
                          onChange={() => handleToggleSelect(item.id)}
                          className="rounded border-zinc-300 text-amber-600 focus:ring-amber-500 cursor-pointer disabled:opacity-40"
                        />
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-zinc-900">{item.student?.fullName || 'N/A'}</div>
                        <div className="text-[11px] font-mono text-zinc-500">{item.student?.usn || 'N/A'}</div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-block px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-700 font-semibold text-[11px]">
                          {item.student?.department?.code || 'N/A'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {isPending && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            <Clock className="w-3 h-3" /> Pending
                          </span>
                        )}
                        {isDue && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            <AlertCircle className="w-3 h-3" /> Due Recorded
                          </span>
                        )}
                        {isCleared && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3" /> No Due
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-bold text-zinc-900">
                        {item.dueAmount > 0 ? (
                          <span className="text-rose-600 font-extrabold">₹{item.dueAmount}</span>
                        ) : (
                          <span className="text-zinc-400">₹0</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-zinc-600 max-w-xs truncate" title={item.dueDetails || item.remarks}>
                        {item.dueDetails || item.remarks || <span className="text-zinc-300 italic">None</span>}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => openReviewModal(item)}
                          className="px-3 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-800 font-bold text-xs transition-colors cursor-pointer"
                        >
                          Review / Edit
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Review Clearance Modal */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-zinc-200 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-100">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center font-bold">
                  <Library className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-zinc-900 text-base">Central Library Clearance Review</h3>
                  <p className="text-xs text-zinc-500 font-mono">
                    {selectedItem.student?.fullName} ({selectedItem.student?.usn})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedItem(null)}
                className="text-zinc-400 hover:text-zinc-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="mt-3 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={submitReview} className="space-y-4 mt-4">
              {/* Action Toggle */}
              <div>
                <label className="text-xs font-bold text-zinc-700 block mb-1.5">Action to Take</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActionStatus('CLEARED');
                      setDueAmount('0');
                    }}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      actionStatus === 'CLEARED'
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-800'
                        : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Approve No Due</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setActionStatus('DUE');
                      if (dueAmount === '0') setDueAmount('50');
                    }}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      actionStatus === 'DUE'
                        ? 'bg-rose-50 border-rose-500 text-rose-800'
                        : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'
                    }`}
                  >
                    <AlertCircle className="w-4 h-4 text-rose-600" />
                    <span>Record Overdue Fine</span>
                  </button>
                </div>
              </div>

              {/* Amount & Presets (Visible only when actionStatus === 'DUE') */}
              {actionStatus === 'DUE' && (
                <div className="space-y-3 bg-rose-50/50 p-3 rounded-xl border border-rose-100">
                  <div>
                    <label className="text-xs font-bold text-zinc-700 block mb-1">Fine / Due Amount (₹)</label>
                    <input
                      type="number"
                      min="0"
                      value={dueAmount}
                      onChange={(e) => setDueAmount(e.target.value)}
                      placeholder="e.g. 50"
                      className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                    />
                  </div>

                  {/* Library Presets */}
                  <div>
                    <label className="text-[11px] font-bold text-zinc-500 block mb-1.5 uppercase">
                      Quick Library Fine Presets
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {libraryPresets.map((p) => (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => {
                            setDueAmount(String(p.amount));
                            setDueDetails(p.label);
                          }}
                          className="text-left px-2 py-1.5 rounded-lg bg-white border border-rose-200/60 hover:border-rose-400 text-[11px] font-medium text-zinc-700 hover:text-rose-900 transition-colors"
                        >
                          <div className="font-bold text-rose-700">₹{p.amount}</div>
                          <div className="truncate text-zinc-500 text-[10px]">{p.label}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-zinc-700 block mb-1">Book Title / Circulation Due Details</label>
                    <input
                      type="text"
                      value={dueDetails}
                      onChange={(e) => setDueDetails(e.target.value)}
                      placeholder="e.g. Higher Engineering Mathematics - Overdue 45 days"
                      className="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                    />
                  </div>
                </div>
              )}

              {/* Remarks */}
              <div>
                <label className="text-xs font-bold text-zinc-700 block mb-1">Officer Verification Remarks</label>
                <textarea
                  rows={2}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="e.g. All books returned in good condition. Clearance approved."
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                />
              </div>

              {/* Modal Actions */}
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
                  {submitting ? 'Saving...' : 'Save Clearance Status'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Central Library Conversational AI Assistant Modal */}
      <PhysicsAiAssistantModal
        isOpen={isAiAssistantOpen}
        onClose={() => setIsAiAssistantOpen(false)}
        onActionApplied={() => {
          fetchClearances();
        }}
        departmentCode="LIB"
        departmentName="Central Library"
      />

      {/* AI Library Register Scanner Modal */}
      <LogbookScannerModal
        isOpen={isLogbookScannerOpen}
        onClose={() => setIsLogbookScannerOpen(false)}
        onDuesApplied={() => {
          fetchClearances();
        }}
        departmentId={libraryDepartmentId}
        departmentName="Central Library"
      />
    </div>
  );
};
