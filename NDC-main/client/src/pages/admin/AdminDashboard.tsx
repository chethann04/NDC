import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import { Users, CheckCircle2, Clock, AlertTriangle, RefreshCw, Activity, ArrowUpRight } from 'lucide-react';
import { StatCard } from '../../components/StatCard';
import { clientCache } from '../../utils/clientCache';

const getActionMeta = (action: string) => {
  const act = action || '';
  if (act.includes('LOGIN')) {
    return {
      label: 'User Login',
      dot: 'bg-blue-600 ring-blue-100',
      badge: 'bg-blue-50 text-blue-700'
    };
  }
  if (act.includes('CERTIFICATE')) {
    return {
      label: act.includes('EXPORT') ? 'Certificates Exported' : 'Certificate Updated',
      dot: 'bg-emerald-600 ring-emerald-100',
      badge: 'bg-emerald-50 text-emerald-700'
    };
  }
  if (act.includes('CLEARANCE') || act.includes('NDC')) {
    return {
      label: 'Clearance Status',
      dot: 'bg-violet-600 ring-violet-100',
      badge: 'bg-violet-50 text-violet-700'
    };
  }
  if (act.includes('STUDENT') || act.includes('IMPORT')) {
    return {
      label: 'Student Record',
      dot: 'bg-amber-600 ring-amber-100',
      badge: 'bg-amber-50 text-amber-700'
    };
  }
  if (act.includes('DELETE') || act.includes('REVOKE')) {
    return {
      label: 'Security Alert',
      dot: 'bg-rose-600 ring-rose-100',
      badge: 'bg-rose-50 text-rose-700'
    };
  }
  return {
    label: action ? action.toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : 'System Activity',
    dot: 'bg-indigo-600 ring-indigo-100',
    badge: 'bg-slate-50 text-slate-700'
  };
};

const getActorName = (act: any) => {
  if (act.userName && act.userName !== 'SYSTEM') {
    return act.userName;
  }
  const match = act.description?.match(/User \[(.*?)\]/i);
  if (match && match[1]) {
    const id = match[1].trim();
    if (id === 'admin@mce.ac.in') return 'Administration Block';
    if (id === 'superadmin@mce.ac.in') return 'Super Administrator';
    if (id === 'accounts@mce.ac.in' || id.startsWith('cashfee')) return 'Cash/Fee Section';
    if (id === 'library@mce.ac.in') return 'Central Library';
    if (id === 'office@mce.ac.in') return 'Administrative Office';
    if (id === 'lab@mce.ac.in') return 'Laboratory Section';
    if (id === 'hostel@mce.ac.in') return 'Hostel Warden';
    if (id === 'sports@mce.ac.in') return 'Sports Officer';
    if (id.startsWith('hod.')) {
      const code = id.split('@')[0].replace('hod.', '').toUpperCase();
      return `${code} HOD`;
    }
    return id;
  }
  return act.userName || 'User';
};

const getActionTitle = (act: any) => {
  if (act.action?.includes('LOGIN')) {
    return getActorName(act);
  }
  return getActionMeta(act.action).label;
};

const formatActivityTime = (dateStr?: string) => {
  if (!dateStr) return 'Just now';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return 'Just now';

  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 45) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

export const AdminDashboard: React.FC = () => {
  const [stats, setStats] = useState<any>(() => clientCache.get<any>('admin_dashboard_stats'));
  const [activities, setActivities] = useState<any[]>(() => clientCache.get<any[]>('admin_dashboard_activities') || []);
  const [loading, setLoading] = useState<boolean>(() => !clientCache.get('admin_dashboard_stats'));

  useEffect(() => {
    fetchStats(!stats);
  }, []);

  const fetchStats = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const statsRes = await api.get('/reports/dashboard');
      const newStats = statsRes.data.stats;
      let newActivities = statsRes.data.recentActivity;

      // Fallback if recentActivity wasn't included
      if (!newActivities) {
        const auditRes = await api.get('/audit-logs?limit=6');
        newActivities = auditRes.data.logs || auditRes.data.data || [];
      }

      setStats(newStats);
      setActivities(newActivities);
      clientCache.set('admin_dashboard_stats', newStats);
      clientCache.set('admin_dashboard_activities', newActivities);
    } catch (err) {
      console.error('Error fetching admin dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-12 text-center text-slate-400 font-semibold animate-pulse">
        Loading dashboard metrics...
      </div>
    );
  }

  const { students, requests, departmentStats } = stats || {};

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Dashboard Overview</h1>
          <p className="text-xs font-semibold text-slate-500 mt-1">Institution-wide clearance metrics, updated in real-time</p>
        </div>
        <button
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-200/80 text-xs font-bold text-slate-700 hover:text-slate-900 hover:bg-slate-50 shadow-soft-xs hover:shadow-soft-sm transition-all cursor-pointer w-fit"
          onClick={() => fetchStats(true)}
        >
          <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
          <span>Refresh Data</span>
        </button>
      </div>

      {/* 4 Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Students"
          value={students?.total || 0}
          subtitle="Enrolled candidates"
          icon={<Users className="w-5 h-5" />}
          color="blue"
        />
        <StatCard
          title="Fully Cleared"
          value={requests?.approved || 0}
          subtitle="Certificate ready"
          icon={<CheckCircle2 className="w-5 h-5" />}
          color="emerald"
        />
        <StatCard
          title="Pending Queue"
          value={requests?.inProgress || 0}
          subtitle="Pending in ≥1 dept"
          icon={<Clock className="w-5 h-5" />}
          color="amber"
        />
        <StatCard
          title="Dues Blocked"
          value={requests?.blocked || 0}
          subtitle="Outstanding dues"
          icon={<AlertTriangle className="w-5 h-5" />}
          color="rose"
        />
      </div>

      {/* Two Column Section: Department Bars & Live Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Clearance by Department */}
        <div className="lg:col-span-2 bg-white/90 backdrop-blur-sm rounded-2xl p-6 border border-slate-200/80 shadow-soft-sm space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 tracking-tight">Clearance Progress by Department</h2>
            <span className="text-xs font-semibold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">
              {departmentStats?.length || 0} Departments
            </span>
          </div>

          <div className="space-y-4">
            {departmentStats?.map((dept: any) => {
              const pct = dept.completionPercentage || 0;
              const barColor = pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-rose-500';
              return (
                <div key={dept.departmentId} className="space-y-1.5">
                  <div className="flex justify-between text-xs font-bold">
                    <span className="text-slate-800">{dept.name}</span>
                    <span className="font-mono text-slate-600">{pct}%</span>
                  </div>
                  <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-200/40">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Activity Stream */}
        <div className="bg-white/90 backdrop-blur-sm rounded-2xl p-6 border border-slate-200/80 shadow-soft-sm space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900 tracking-tight">Recent Activity</h2>
              <Activity className="w-4 h-4 text-indigo-600" />
            </div>
            <Link
              to="/admin/audit-logs"
              className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
            >
              <span>View All</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="space-y-3.5">
            {activities.length === 0 ? (
              <p className="text-xs font-semibold text-slate-400">No recent activity logs.</p>
            ) : (
              activities.map((act: any, idx: number) => {
                const meta = getActionMeta(act.action);
                const logMessage = act.description || act.details || act.action || 'System action executed.';
                const timestamp = act.timestamp || act.createdAt;
                const timeAgo = formatActivityTime(timestamp);
                const fullTime = timestamp ? new Date(timestamp).toLocaleString() : '';

                return (
                  <div
                    key={act.id || act._id || idx}
                    className="flex gap-3 items-start text-xs pb-3 border-b border-slate-100 last:border-0 last:pb-0"
                  >
                    <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${meta.dot} ring-4`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-bold text-slate-900 text-xs truncate">
                            {getActionTitle(act)}
                          </span>
                          {act.action?.includes('LOGIN') && (
                            <span className="px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200/60 text-blue-700 text-[10px] font-semibold shrink-0">
                              Logged in
                            </span>
                          )}
                        </div>
                        <span
                          className="text-[11px] font-medium text-slate-400 shrink-0"
                          title={fullTime}
                        >
                          {timeAgo}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 font-normal leading-snug break-words">
                        {logMessage}
                      </p>
                      {!act.action?.includes('LOGIN') && act.userName && act.userName !== 'SYSTEM' && (
                        <div className="text-[10px] font-medium text-slate-400 mt-1 flex items-center gap-1.5">
                          <span className="text-slate-500 font-semibold">{act.userName}</span>
                          {act.role && (
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[9px] font-semibold">
                              {act.role}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
