import React from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { FileQuestion, ArrowLeft, Home, Compass } from 'lucide-react';
import { useAuthStore, getAuthorizedDashboardPath } from '../store/useAuthStore';

export const NotFoundPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuthStore();

  const homePath = isAuthenticated && user ? getAuthorizedDashboardPath(user) : '/login';

  return (
    <div className="min-h-[75vh] flex flex-col items-center justify-center p-6 text-center">
      <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-xl p-8 sm:p-10 space-y-6">
        {/* 404 Icon Badge */}
        <div className="w-16 h-16 mx-auto rounded-2xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 shadow-xs">
          <Compass className="w-8 h-8 animate-pulse" />
        </div>

        <div className="space-y-2">
          <span className="inline-block text-[11px] font-bold tracking-wider uppercase px-2.5 py-1 rounded-full bg-indigo-100/70 text-indigo-700">
            404 • Route Not Found
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            Page Does Not Exist
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 font-medium">
            The requested application route could not be found or has been moved:
          </p>
          <div className="py-2 px-3 bg-slate-50 border border-slate-200/80 rounded-xl text-xs font-mono text-slate-700 break-all select-all">
            {location.pathname}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-2.5 pt-2">
          <Link
            to={homePath}
            className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-md shadow-blue-500/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Home className="w-4 h-4" />
            <span>{isAuthenticated ? 'Go to My Dashboard' : 'Go to Sign In'}</span>
          </Link>

          <button
            onClick={() => navigate(-1)}
            className="w-full py-2 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Go Back</span>
          </button>
        </div>
      </div>

      <p className="text-[11px] text-slate-400 font-medium mt-6">
        Malnad College of Engineering • Digital No Due Certificate System
      </p>
    </div>
  );
};
