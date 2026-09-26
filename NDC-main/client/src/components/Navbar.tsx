import React, { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import {
  LogOut,
  Search,
  ChevronRight,
  ShieldCheck,
  ChevronDown,
  Sparkles,
  Command,
  Database
} from 'lucide-react';
import { useNavigate, useLocation, Link } from 'react-router-dom';

export const Navbar: React.FC = () => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getBreadcrumbs = () => {
    const path = location.pathname;
    if (path.includes('/admin/dashboard')) return ['Admin', 'Dashboard'];
    if (path.includes('/admin/students')) return ['Admin', 'Students'];
    if (path.includes('/admin/import')) return ['Admin', 'Bulk Import'];
    if (path.includes('/admin/departments')) return ['Admin', 'Departments'];
    if (path.includes('/admin/officers')) return ['Admin', 'Clearance Officers'];
    if (path.includes('/admin/ndc')) return ['Admin', 'NDC Monitor'];
    if (path.includes('/admin/certificates')) return ['Admin', 'Certificates'];
    if (path.includes('/admin/reports')) return ['Admin', 'Reports'];
    if (path.includes('/admin/audit-logs')) return ['Admin', 'Audit Logs'];
    if (path.includes('/admin/settings')) return ['Admin', 'Settings'];
    if (path.includes('/officer/students')) return ['Cash/Fee Section', 'Manage Students'];
    if (path.includes('/officer/import')) return ['Cash/Fee Section', 'Import Students'];
    if (path.includes('/officer/audit-logs')) return ['Cash/Fee Section', 'Audit Logs'];
    if (path.includes('/officer/physics-lab')) return ['Physics Lab', 'Clearance Queue'];
    if (path.includes('/officer/chemistry-lab')) return ['Chemistry Lab', 'Clearance Queue'];
    if (path.includes('/officer/department-lab')) return ['Department Lab', 'Clearance Queue'];
    if (path.includes('/officer/dashboard')) return ['Officer', 'Overview'];
    if (path.includes('/officer/clearances')) return ['Officer', 'Clearance Queue'];
    if (path.includes('/officer/history')) return ['Officer', 'History'];
    if (path.includes('/teaching-departments')) return ['Faculty', 'Academic Dept'];
    if (path.includes('/student/dashboard')) return ['Student', 'Clearance Status'];
    if (path.includes('/student/certificates')) return ['Student', 'My Certificates'];
    if (path.includes('/verify')) return ['Verify', 'QR Verification'];
    return ['NDC', 'Overview'];
  };

  const [section, page] = getBreadcrumbs();

  const userInitials = user?.name
    ? user.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
    : 'U';

  return (
    <header className="h-14 px-6 bg-white border-b border-zinc-200/70 sticky top-0 z-20 flex items-center justify-between">
      {/* Breadcrumb path */}
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium text-zinc-400">{section}</span>
        <ChevronRight className="w-3.5 h-3.5 text-zinc-300" />
        <span className="font-semibold text-zinc-900">{page}</span>
      </div>

      {/* Action Controls & Profile */}
      <div className="flex items-center gap-3">
        {/* Verification Link for Staff */}
        {(user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'HOD' || user?.role === 'DEPARTMENT_OFFICER') && (
          <Link
            to="/verify"
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-700 hover:text-zinc-950 bg-zinc-50 hover:bg-zinc-100 border border-zinc-200/80 transition-colors"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-zinc-600" />
            <span>Verify QR</span>
          </Link>
        )}

        {/* User Profile */}
        {user && (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex items-center gap-2 py-1 px-1.5 rounded-lg hover:bg-zinc-100 transition-colors cursor-pointer focus:outline-none"
            >
              <div className="w-7 h-7 rounded-md bg-zinc-900 text-white font-semibold text-xs flex items-center justify-center">
                {userInitials}
              </div>
              <div className="hidden lg:block text-left leading-tight">
                <div className="text-xs font-semibold text-zinc-900 max-w-[120px] truncate">
                  {user.name}
                </div>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
            </button>

            {userMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-52 bg-white border border-zinc-200 rounded-xl shadow-lg p-1.5 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="px-3 py-2 border-b border-zinc-100">
                  <p className="text-xs font-semibold text-zinc-900 truncate">{user.name}</p>
                  <p className="text-[11px] text-zinc-400 truncate">{user.email}</p>
                  <span className="inline-block mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-700">
                    {user.role.replace(/_/g, ' ')}
                  </span>
                </div>

                <div className="pt-1">
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 rounded-lg transition-colors text-left"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
