import React, { useEffect, useState, useRef } from 'react';
import api from '../../services/api';
import { ClearanceStatusBadge } from '../../components/ClearanceStatusBadge';
import { Search, ChevronDown, RefreshCw, X, Check, FileDown } from 'lucide-react';

export type SectionType = 'DUE' | 'CLEARED' | 'PENDING' | 'ALL';

export const OfficerHistory: React.FC = () => {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedSection, setSelectedSection] = useState<SectionType>('DUE');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchHistory();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
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
      alert('Failed to export PDF report. Please try again.');
    } finally {
      setExportingPdf(false);
    }
  };

  const dueCount = history.filter((c) => c.status === 'DUE').length;
  const clearedCount = history.filter((c) => c.status === 'CLEARED' || c.status === 'NOT_APPLICABLE').length;
  const pendingCount = history.filter((c) => c.status === 'PENDING' || c.status === 'ON_HOLD').length;

  const sections: { key: SectionType; label: string; count: number }[] = [
    { key: 'DUE', label: 'Due', count: dueCount },
    { key: 'CLEARED', label: 'Cleared', count: clearedCount },
    { key: 'PENDING', label: 'Pending', count: pendingCount },
    { key: 'ALL', label: 'All', count: history.length }
  ];

  const currentSection = sections.find((s) => s.key === selectedSection)!;

  // Filter list by selected section and search term
  const displayedItems = history
    .filter((c) => {
      if (selectedSection === 'DUE') return c.status === 'DUE';
      if (selectedSection === 'CLEARED') return c.status === 'CLEARED' || c.status === 'NOT_APPLICABLE';
      if (selectedSection === 'PENDING') return c.status === 'PENDING' || c.status === 'ON_HOLD';
      return true;
    })
    .filter((c) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      const name = c.studentId?.fullName?.toLowerCase() || '';
      const usn = c.studentId?.usn?.toLowerCase() || '';
      return name.includes(q) || usn.includes(q);
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
        <button
          type="button"
          onClick={fetchHistory}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Minimal Controls Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Simple Minimal Dropdown + Export PDF button */}
        <div className="flex items-center gap-2">
          <div className="relative inline-block" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsDropdownOpen((v) => !v)}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-slate-200 hover:border-slate-300 text-xs font-semibold text-slate-800 shadow-2xs transition-colors"
            >
              <span className="text-slate-400 font-normal">Section:</span>
              <span>{currentSection.label}</span>
              <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold">
                {currentSection.count}
              </span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                  isDropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {isDropdownOpen && (
              <div className="absolute left-0 mt-1.5 w-48 bg-white rounded-xl border border-slate-200 shadow-lg py-1 z-30">
                {sections.map((sec) => (
                  <button
                    key={sec.key}
                    type="button"
                    onClick={() => {
                      setSelectedSection(sec.key);
                      setIsDropdownOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-xs flex items-center justify-between text-left hover:bg-slate-50 transition-colors ${
                      selectedSection === sec.key ? 'text-blue-600 font-bold bg-blue-50/40' : 'text-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span>{sec.label}</span>
                      <span className="text-[10px] text-slate-400 font-normal">({sec.count})</span>
                    </div>
                    {selectedSection === sec.key && <Check className="w-3.5 h-3.5 text-blue-600" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedSection === 'CLEARED' && (
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={exportingPdf || clearedCount === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-2xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Export official PDF report of cleared students with officer signature"
            >
              {exportingPdf ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileDown className="w-3.5 h-3.5" />
              )}
              <span>{exportingPdf ? 'Exporting...' : 'Export PDF'}</span>
            </button>
          )}
        </div>

        {/* Minimal Search Input */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search student or USN..."
            className="w-full pl-8 pr-7 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-400 shadow-2xs"
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

      {/* Clean, Simple Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        {displayedItems.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400">
            {search ? 'No records match your search.' : `No ${currentSection.label.toLowerCase()} clearances found.`}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/60 border-b border-slate-100 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3 px-4">Student</th>
                  <th className="py-3 px-4">USN</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Reviewed Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {displayedItems.map((c) => (
                  <tr key={c._id || c.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      {c.studentId?.fullName}
                      {c.studentId?.batch && (
                        <span className="block text-[10px] font-normal text-slate-400">
                          {c.studentId.batch}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono font-medium text-blue-700">
                      {c.studentId?.usn}
                    </td>
                    <td className="py-3 px-4">
                      <ClearanceStatusBadge status={c.status} />
                    </td>
                    <td className="py-3 px-4 text-slate-400 text-[11px] whitespace-nowrap">
                      {c.reviewedAt ? new Date(c.reviewedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      }) : '—'}
                    </td>
                  </tr>
                ))}
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
