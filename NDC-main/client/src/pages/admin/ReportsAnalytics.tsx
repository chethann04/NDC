import React, { useState } from 'react';
import { BarChart3, Download, FileSpreadsheet, Filter } from 'lucide-react';

export const ReportsAnalytics: React.FC = () => {
  const [reportType, setReportType] = useState('StudentNdcStatus');
  const [format, setFormat] = useState('xlsx');
  const [status, setStatus] = useState('');

  const handleExport = () => {
    const url = `/api/v1/reports/export?type=${reportType}&format=${format}${status ? `&status=${status}` : ''}`;
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold text-slate-900">Reports & Export Center</h2>
        <p className="text-xs text-slate-500">Generate and download institutional clearance reports in Excel or CSV formats</p>
      </div>

      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm max-w-xl space-y-5">
        <div className="space-y-4 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1.5">Report Type *</label>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="StudentNdcStatus">Student NDC Request Status Report</option>
              <option value="DepartmentClearance">Department Clearance Breakdown Report</option>
              <option value="CertificateReport">Issued & Revoked Certificates Report</option>
            </select>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1.5">Export File Format *</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer border p-3 rounded-xl flex-1 bg-slate-50 hover:bg-slate-100 transition-colors">
                <input
                  type="radio"
                  name="fileFormat"
                  value="xlsx"
                  checked={format === 'xlsx'}
                  onChange={() => setFormat('xlsx')}
                  className="text-blue-600 focus:ring-blue-500"
                />
                <span className="font-bold text-slate-900">Excel (.xlsx)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer border p-3 rounded-xl flex-1 bg-slate-50 hover:bg-slate-100 transition-colors">
                <input
                  type="radio"
                  name="fileFormat"
                  value="csv"
                  checked={format === 'csv'}
                  onChange={() => setFormat('csv')}
                  className="text-blue-600 focus:ring-blue-500"
                />
                <span className="font-bold text-slate-900">CSV (.csv)</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1.5">Filter by Status (Optional)</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="">All Statuses</option>
              <option value="APPROVED">Approved / Cleared</option>
              <option value="BLOCKED">Blocked / Due</option>
              <option value="IN_PROGRESS">In Progress / Pending</option>
            </select>
          </div>
        </div>

        <button
          onClick={handleExport}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
        >
          <Download className="w-4 h-4" />
          Generate & Download Report
        </button>
      </div>
    </div>
  );
};
