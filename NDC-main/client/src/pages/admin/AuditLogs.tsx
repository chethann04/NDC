import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { useAuthStore } from '../../store/useAuthStore';
import { Search, ShieldAlert, History, ShieldCheck } from 'lucide-react';

export const AuditLogs: React.FC = () => {
  const { user } = useAuthStore();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const officerDeptObj = user?.officerProfile?.departmentIds?.[0] as any;
  const deptObj = user?.departmentId as any;

  const isCashFee =
    user?.role === 'DEPARTMENT_OFFICER' &&
    (user?.email?.startsWith('cashfee') ||
      user?.email === 'accounts@mce.ac.in' ||
      officerDeptObj?.code === 'ACC' ||
      officerDeptObj?.name === 'Cash/Fee Section' ||
      deptObj?.code === 'ACC' ||
      deptObj?.name === 'Cash/Fee Section');

  useEffect(() => {
    fetchLogs();
  }, [search]);

  const fetchLogs = async () => {
    try {
      const res = await api.get('/audit-logs', {
        params: {
          search,
          scope: isCashFee ? 'cashfee' : undefined
        }
      });
      setLogs(res.data.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-extrabold text-slate-900">
              {isCashFee ? 'Cash/Fee Section Audit Trail' : 'System Audit Trail'}
            </h2>
            {isCashFee && (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 uppercase tracking-wider">
                Cash/Fee Section Only
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {isCashFee
              ? 'Immutable record of clearance reviews, dues marked, student imports, and activities performed in Cash/Fee Section'
              : 'Immutable record of all student imports, clearance updates, overrides, and revocations'}
          </p>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by action, user name, or description..."
          className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
        />
      </div>

      {loading ? (
        <div className="p-8 text-center text-slate-500 font-semibold">
          {isCashFee ? 'Loading Cash/Fee Section audit trail...' : 'Loading audit trail...'}
        </div>
      ) : logs.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 border border-slate-200 text-center shadow-sm">
          <p className="text-sm font-bold text-slate-600">
            {isCashFee ? 'No audit activity recorded for Cash/Fee Section.' : 'No audit activity recorded.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                <tr>
                  <th className="p-4">Timestamp</th>
                  <th className="p-4">User</th>
                  <th className="p-4">Role</th>
                  <th className="p-4">Action</th>
                  <th className="p-4">Description</th>
                  <th className="p-4">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((log) => (
                  <tr key={log.id || log._id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-mono text-slate-500 whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="p-4 font-bold text-slate-900">{log.userName || 'SYSTEM'}</td>
                    <td className="p-4 font-semibold text-blue-700">{log.role}</td>
                    <td className="p-4 font-mono font-bold text-slate-800">{log.action}</td>
                    <td className="p-4 text-slate-700 max-w-md">{log.description}</td>
                    <td className="p-4 font-mono text-slate-400">{log.ipAddress || '127.0.0.1'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
