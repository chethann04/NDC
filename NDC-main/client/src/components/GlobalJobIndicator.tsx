import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useJobStore } from '../store/useJobStore';
import { useAuthStore } from '../store/useAuthStore';
import { CheckCircle2, AlertCircle, Loader2, X, ArrowRight } from 'lucide-react';

export const GlobalJobIndicator: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthStore();
  const { activeJob, isDismissed, dismissJob, startGlobalPolling, stopGlobalPolling } = useJobStore();

  useEffect(() => {
    // Only poll for staff/admins who have access to bulk import
    if (user && ['SUPER_ADMIN', 'ADMIN', 'DEPARTMENT_OFFICER'].includes(user.role)) {
      startGlobalPolling();
    }
    return () => {
      stopGlobalPolling();
    };
  }, [user, startGlobalPolling, stopGlobalPolling]);

  if (!activeJob || isDismissed) return null;

  const isRunning = activeJob.status === 'RUNNING' || activeJob.status === 'QUEUED';
  const isCompleted = activeJob.status === 'COMPLETED' || activeJob.status === 'PARTIALLY_COMPLETED';
  const isFailed = activeJob.status === 'FAILED' || activeJob.status === 'CANCELLED';

  // If already on the bulk import page, don't obstruct the main view while running
  const isOnImportPage = location.pathname.includes('/import');
  if (isOnImportPage && isRunning) return null;

  const percent = activeJob.totalRecords > 0
    ? Math.min(100, Math.round((activeJob.processedRecords / activeJob.totalRecords) * 100))
    : 0;

  return (
    <div className="fixed bottom-5 right-5 z-50 max-w-md w-full shadow-2xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md p-4 transition-all duration-300 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {isRunning && (
            <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          )}
          {isCompleted && (
            <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          )}
          {isFailed && (
            <div className="w-8 h-8 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0">
              <AlertCircle className="w-4 h-4" />
            </div>
          )}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {isRunning && 'Background Bulk Import'}
              {isCompleted && 'Import Finished'}
              {isFailed && 'Import Terminated'}
            </h4>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              {isRunning && `${activeJob.processedRecords.toLocaleString()} of ${activeJob.totalRecords.toLocaleString()} processed (${percent}%)`}
              {isCompleted && `${activeJob.insertedRecords.toLocaleString()} students imported successfully`}
              {isFailed && (activeJob.lastError || 'Import process encountered an issue')}
            </p>
          </div>
        </div>

        <button
          onClick={dismissJob}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors"
          title="Dismiss banner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {isRunning && (
        <div className="mt-3">
          <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
            <div
              className="bg-gradient-to-r from-blue-600 to-indigo-600 h-full transition-all duration-300 rounded-full"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="flex justify-between items-center text-[11px] text-slate-500 dark:text-slate-400 mt-2">
            <span>
              {activeJob.insertedRecords} added • {activeJob.skippedRecords} skipped
            </span>
            <button
              onClick={() => navigate('/admin/import')}
              className="inline-flex items-center gap-1 font-semibold text-blue-600 dark:text-blue-400 hover:underline"
            >
              Open Import Page <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {isCompleted && (
        <div className="mt-2.5 flex justify-end">
          <button
            onClick={() => {
              navigate('/admin/import');
              dismissJob();
            }}
            className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1"
          >
            View Summary & Report <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
};
