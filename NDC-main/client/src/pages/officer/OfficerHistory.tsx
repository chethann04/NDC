import React, { useEffect, useState, useRef, useMemo } from 'react';
import api from '../../services/api';
import { ClearanceStatusBadge } from '../../components/ClearanceStatusBadge';
import { showErrorModal } from '../../store/useErrorModalStore';
import { Search, ChevronDown, RefreshCw, X, Check, FileDown, Building2, UserCheck, Layers } from 'lucide-react';

export type SectionType = 'ALL' | 'CLEARED' | 'DUE' | 'PENDING';

export const OfficerHistory: React.FC = () => {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedSection, setSelectedSection] = useState<SectionType>('ALL');
  const [selectedDeptFilter, setSelectedDeptFilter] = useState<string>('ALL');
  const [exportingPdf, setExportingPdf] = useState(false);

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const res = await api.get('/ndc/officer/clearances', {
        params: { limit: 1000 }
      });
      setHistory(res.data.data || []);
    } catch (err) {
      console.error('Error fetching clearance history:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExportPdf = async () => {
    try {
      setExportingPdf(true);
      const res = await api.get('/ndc/officer/cleared-report/pdf', {
        responseType: 'blob'
      });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Cleared_Students_Report_${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Error exporting cleared PDF report:', err);
      showErrorModal(err, { title: 'PDF Export Failed' });
    } finally {
      setExportingPdf(false);
    }
  };

  const dueCount = history.filter((c) => c.status === 'DUE').length;
  const clearedCount = history.filter((c) => c.status === 'CLEARED' || c.status === 'NOT_APPLICABLE').length;
  const pendingCount = history.filter((c) => c.status === 'PENDING' || c.status === 'ON_HOLD').length;

  const sections: { key: SectionType; label: string; count: number }[] = [
    { key: 'ALL', label: 'All', count: history.length },
    { key: 'CLEARED', label: 'Cleared', count: clearedCount },
    { key: 'DUE', label: 'Due', count: dueCount },
    { key: 'PENDING', label: 'Pending', count: pendingCount }
  ];

  // Extract distinct academic departments from history
  const academicDepartments = useMemo(() => {
    const map = new Map<string, { id: string; name: string; code: string; count: number }>();
    history.forEach((c) => {
      const dept = c.studentId?.departmentId;
      if (dept) {
        const id = dept.id || dept._id || dept.code;
        const existing = map.get(id);
        if (existing) {
          existing.count += 1;
        } else {
          map.set(id, {
            id,
            name: dept.name || 'Academic Department',
            code: dept.code || 'GEN',
            count: 1
          });
        }
      }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [history]);

  // Filter list by selected section, academic department, and search term
  const displayedItems = history
    .filter((c) => {
      if (selectedSection === 'DUE') return c.status === 'DUE';
      if (selectedSection === 'CLEARED') return c.status === 'CLEARED' || c.status === 'NOT_APPLICABLE';
      if (selectedSection === 'PENDING') return c.status === 'PENDING' || c.status === 'ON_HOLD';
      return true;
    })
    .filter((c) => {
      if (selectedDeptFilter === 'ALL') return true;
      const dept = c.studentId?.departmentId;
      return (
        dept?.id === selectedDeptFilter ||
        dept?._id === selectedDeptFilter ||
        dept?.code === selectedDeptFilter ||
        dept?.name === selectedDeptFilter
      );
    })
    .filter((c) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      const name = c.studentId?.fullName?.toLowerCase() || '';
      const usn = c.studentId?.usn?.toLowerCase() || '';
      const remarks = (c.remarks || '').toLowerCase();
      const dueDetails = (c.dueDetails || '').toLowerCase();
      return name.includes(q) || usn.includes(q) || remarks.includes(q) || dueDetails.includes(q);
    });

  if (loading) {
    return (
      <div className="p-16 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
        <RefreshCw className="w-4 h-4 animate-spin text-slate-400" />
        <span>Loading clearances...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between pb-1">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Clearance History</h2>
          <p className="text-xs text-slate-500">Department clearance records and review audit</p>
        </div>
        <div className="flex items-center gap-2">
          {clearedCount > 0 && (
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={exportingPdf}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
              title="Export official PDF report of cleared students"
            >
              {exportingPdf ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileDown className="w-3.5 h-3.5" />
              )}
              <span>{exportingPdf ? 'Exporting...' : 'Export PDF'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={fetchHistory}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Controls Bar with Pill Tabs & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200/80 shadow-2xs">
        {/* Status Pill Tabs */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {sections.map((sec) => (
            <button
              key={sec.key}
              type="button"
              onClick={() => setSelectedSection(sec.key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                selectedSection === sec.key
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
              }`}
            >
              <span>{sec.label}</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                  selectedSection === sec.key ? 'bg-white/20 text-white' : 'bg-white text-slate-600 border border-slate-200/60'
                }`}
              >
                {sec.count}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* Department Filter (if applicable) */}
          {academicDepartments.length > 1 && (
            <select
              value={selectedDeptFilter}
              onChange={(e) => setSelectedDeptFilter(e.target.value)}
              className="text-xs"
              title="Filter by Branch"
            >
              <option value="ALL">All Branches ({history.length})</option>
              {academicDepartments.map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {dept.code} — {dept.name} ({dept.count})
                </option>
              ))}
            </select>
          )}

          {/* Search Input */}
          <div className="relative w-full sm:w-60">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search student, USN, remarks..."
              className="w-full pl-8 pr-7 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-slate-400 transition-colors"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Clean, Simple Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        {displayedItems.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400">
            {search ? 'No records match your search.' : `No ${selectedSection.toLowerCase()} clearance records found.`}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/70 border-b border-slate-100 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3 px-4">Student</th>
                  <th className="py-3 px-4">USN</th>
                  <th className="py-3 px-4">Clearance Section</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Reviewed By</th>
                  <th className="py-3 px-4">Reviewed Date</th>
                  <th className="py-3 px-4">Details / Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {displayedItems.map((c) => {
                  const dept = c.studentId?.departmentId;
                  const sectionName = c.lab?.name || c.lab?.code || c.departmentId?.name || 'Department Desk';
                  const reviewerName = c.reviewedBy?.name || 'Department Officer';
                  const isDue = c.status === 'DUE';

                  return (
                    <tr key={c._id || c.id} className={`hover:bg-slate-50/60 transition-colors ${isDue ? 'bg-rose-50/20' : ''}`}>
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {c.studentId?.fullName}
                        {c.studentId?.batch && (
                          <span className="block text-[10px] font-normal text-slate-400">
                            {c.studentId.batch}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-blue-700">
                        {c.studentId?.usn}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-indigo-50 text-indigo-700 border border-indigo-200/60 font-mono">
                            {c.lab?.code || dept?.code || 'DEPT'}
                          </span>
                          <span className="text-xs text-slate-700 font-medium">
                            {sectionName}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <ClearanceStatusBadge status={c.status} />
                      </td>
                      <td className="py-3 px-4 text-slate-600 text-xs">
                        <div className="flex items-center gap-1">
                          <UserCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="truncate">{reviewerName}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-500 text-[11px] whitespace-nowrap">
                        {c.reviewedAt ? new Date(c.reviewedAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        }) : '—'}
                      </td>
                      <td className="py-3 px-4 max-w-xs text-xs">
                        {isDue ? (
                          <div className="space-y-0.5">
                            {c.dueAmount > 0 && (
                              <span className="font-bold text-rose-700 block">
                                Due: ₹{c.dueAmount.toLocaleString()}
                              </span>
                            )}
                            {c.dueDetails && (
                              <span className="text-slate-600 text-[11px] block truncate">
                                {c.dueDetails}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-500 text-[11px] truncate block">
                            {c.remarks || 'Cleared — No Due'}
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

      {/* Footer item counter */}
      <div className="text-[11px] text-slate-400 px-1">
        Showing {displayedItems.length} of {history.length} total records
      </div>
    </div>
  );
};
