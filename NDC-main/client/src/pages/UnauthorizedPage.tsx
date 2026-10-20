import React from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { ShieldAlert, ArrowLeft, Home, LogOut, KeyRound } from 'lucide-react';
import { useAuthStore, getAuthorizedDashboardPath } from '../store/useAuthStore';

interface UnauthorizedPageProps {
  userRole?: string;
  userName?: string;
  requiredRole?: string;
}

export const UnauthorizedPage: React.FC<UnauthorizedPageProps> = ({
  userRole: propRole,
  userName: propName,
  requiredRole
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const role = propRole || user?.role || 'GUEST';
  const name = propName || user?.name || 'User';
  const homePath = getAuthorizedDashboardPath(user);

  const formatRole = (r: string) => {
    switch (r) {
      case 'SUPER_ADMIN':
        return 'Super Administrator';
      case 'ADMIN':
        return 'Administrator';
      case 'DEPARTMENT_OFFICER':
        return 'Clearance Desk Officer';
      case 'HOD':
        return 'Head of Department (HOD)';
      case 'STUDENT':
        return 'Student';
      default:
        return r;
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-[75vh] flex flex-col items-center justify-center p-6 text-center">
      <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-xl p-8 sm:p-10 space-y-6">
        {/* Shield Icon Badge */}
        <div className="w-16 h-16 mx-auto rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 shadow-xs">
          <ShieldAlert className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <span className="inline-block text-[11px] font-bold tracking-wider uppercase px-2.5 py-1 rounded-full bg-rose-100/70 text-rose-700">
            403 • Access Restricted
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            Restricted Clearance Area
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 font-medium">
            Your current account <span className="font-bold text-slate-900">{name}</span> ({formatRole(role)}) does not have permission to access:
          </p>
          <div className="py-2 px-3 bg-slate-50 border border-slate-200/80 rounded-xl text-xs font-mono text-slate-700 break-all select-all">
            {location.pathname}
          </div>
          {requiredRole && (
            <p className="text-[11px] text-amber-700 font-medium bg-amber-50 py-1.5 px-3 rounded-lg border border-amber-200">
              Required Clearance Level: <span className="font-bold">{requiredRole}</span>
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-2.5 pt-2">
          <Link
            to={homePath}
            className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-md shadow-blue-500/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Home className="w-4 h-4" />
            <span>Go to My Authorized Dashboard</span>
          </Link>

          <button
            onClick={() => navigate(-1)}
            className="w-full py-2 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to Previous Page</span>
          </button>

          <button
            onClick={handleLogout}
            className="w-full py-2 px-4 rounded-xl border border-rose-200 hover:bg-rose-50 text-rose-700 font-semibold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer mt-1"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign in as Different User</span>
          </button>
        </div>
      </div>

      <p className="text-[11px] text-slate-400 font-medium mt-6">
        Malnad College of Engineering • Digital No Due Certificate System
      </p>
    </div>
  );
};
