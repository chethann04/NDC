import React, { useState, useEffect } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import { useUiStore } from '../store/useUiStore';
import { usePortalContext } from '../context/PortalContext';
import {
  LayoutDashboard,
  Users2,
  UploadCloud,
  Building,
  UserCheck2,
  FileCheck,
  Award,
  BarChart3,
  History,
  Settings,
  ShieldAlert,
  GraduationCap,
  PanelLeftClose,
  PanelLeft,
  LogOut,
  Atom,
  FlaskConical,
  Laptop,
  KeyRound,
  Sparkles,
  ScanLine,
  BookOpen,
  X
} from 'lucide-react';


export const Sidebar: React.FC = () => {
  const { user, logout } = useAuthStore();
  const { mobileMenuOpen, closeMobileMenu } = useUiStore();
  const { context } = usePortalContext();
  const location = useLocation();

  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem('ndc_sidebar_collapsed');
    return saved === 'true';
  });

  // Automatically close mobile menu whenever route changes
  useEffect(() => {
    closeMobileMenu();
  }, [location.pathname, closeMobileMenu]);

  // Handle ESC key to dismiss mobile drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileMenuOpen) {
        closeMobileMenu();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen, closeMobileMenu]);

  const role = user?.role;
  const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const isOfficer = role === 'DEPARTMENT_OFFICER' || role === 'HOD';
  const isStudent = role === 'STUDENT';

  const deptObj = user?.departmentId as any;
  const officerDeptObj = user?.officerProfile?.departmentIds?.[0] as any;

  const isCashFeeOfficer =
    role === 'DEPARTMENT_OFFICER' &&
    (user?.email?.startsWith('cashfee') ||
      user?.email === 'accounts@mce.ac.in' ||
      officerDeptObj?.code === 'ACC' ||
      officerDeptObj?.name === 'Cash/Fee Section' ||
      deptObj?.code === 'ACC' ||
      deptObj?.name === 'Cash/Fee Section' ||
      officerDeptObj?.name?.includes('Fee') ||
      officerDeptObj?.name?.includes('Cash') ||
      (typeof deptObj === 'object' && (deptObj?.name?.includes('Fee') || deptObj?.name?.includes('Cash'))));

  const isCollegeOffice =
    role === 'DEPARTMENT_OFFICER' &&
    (user?.email === 'office@mce.ac.in' ||
      officerDeptObj?.code === 'ADM' ||
      officerDeptObj?.name?.toLowerCase().includes('college office') ||
      officerDeptObj?.name?.toLowerCase().includes('administrative') ||
      deptObj?.code === 'ADM' ||
      (typeof deptObj === 'object' &&
        (deptObj?.code === 'ADM' ||
          deptObj?.name?.toLowerCase().includes('college office') ||
          deptObj?.name?.toLowerCase().includes('administrative'))));

  const deptCode = (officerDeptObj?.code || (typeof deptObj === 'object' ? deptObj?.code : undefined) || '').toUpperCase();
  const deptName = officerDeptObj?.name || (typeof deptObj === 'object' ? deptObj?.name : '') || '';

  const isPhysicsOfficer =
    (role === 'DEPARTMENT_OFFICER' || role === 'HOD') &&
    (deptCode === 'PHY' ||
      deptCode === 'PHY_LAB' ||
      user?.loginId?.toUpperCase() === 'PHY001' ||
      user?.email?.toLowerCase().includes('physics') ||
      deptName.toLowerCase().includes('physics'));

  const isChemistryOfficer =
    role === 'DEPARTMENT_OFFICER' &&
    (deptCode === 'CHEM' || user?.loginId === 'CHEM001' || user?.email?.includes('chemistry') || deptName.toLowerCase().includes('chemistry'));

  const isLibraryOfficer =
    role === 'DEPARTMENT_OFFICER' &&
    (deptCode === 'LIB' || user?.loginId === 'LIB001' || user?.email?.includes('library') || deptName.toLowerCase().includes('library'));

  const isAcademicBranchOfficer =
    role === 'DEPARTMENT_OFFICER' &&
    !isPhysicsOfficer &&
    !isChemistryOfficer &&
    !isCollegeOffice &&
    !isCashFeeOfficer &&
    (officerDeptObj?.isAcademicBranch || (typeof deptObj === 'object' && deptObj?.isAcademicBranch) ||
      officerDeptObj?.category === 'ACADEMIC_BRANCH' || (typeof deptObj === 'object' && deptObj?.category === 'ACADEMIC_BRANCH') ||
      ['IS', 'CS', 'EC', 'ME', 'CV', 'EE', 'AIML', 'BT', 'CB', 'VL', 'ET', 'AI', 'RA', 'ST'].includes(deptCode));

  const deptLabel = isPhysicsOfficer
    ? 'Physics Lab'
    : isChemistryOfficer
    ? 'Chemistry Lab'
    : isLibraryOfficer
    ? 'Central Library'
    : isAcademicBranchOfficer
    ? `${deptCode || 'Academic'} Department`
    : isCashFeeOfficer
    ? 'Cash/Fee Section'
    : isCollegeOffice
    ? 'College Office (ADM)'
    : officerDeptObj?.name ||
      (typeof deptObj === 'object' ? deptObj?.name : undefined) ||
      (role === 'HOD' ? 'Academic Department' : 'Clearance Desk');

  const isStaff =
    isPhysicsOfficer ||
    isLibraryOfficer ||
    isChemistryOfficer ||
    role === 'HOD' ||
    isAdmin ||
    role === 'DEPARTMENT_OFFICER';

  const toggleCollapse = () => {

    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('ndc_sidebar_collapsed', String(next));
  };

  const userInitials = user?.name
    ? user.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
    : 'U';

  // Render Navigation Link Blocks
  const renderNavLinks = (isMobile = false) => {
    const isCollapsed = isMobile ? false : collapsed;
    const onItemClick = isMobile ? closeMobileMenu : undefined;

    return (
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-4">
        {/* STUDENT LINKS */}
        {isStudent && (
          <div>
            {!isCollapsed && (
              <div className="px-2 mb-1.5 text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                Student Portal
              </div>
            )}
            <div className="space-y-1">
              <NavItem
                to="/student/dashboard"
                icon={<LayoutDashboard className="w-4 h-4" />}
                label="Clearance Status"
                collapsed={isCollapsed}
                onClick={onItemClick}
              />
              <NavItem
                to="/student/certificates"
                icon={<Award className="w-4 h-4" />}
                label="My Certificates"
                collapsed={isCollapsed}
                onClick={onItemClick}
              />
            </div>
          </div>
        )}

        {/* OFFICER / HOD LINKS */}
        {isOfficer && (
          <div>
            {!isCollapsed && (
              <div className="px-2 mb-1.5 text-[10px] font-bold tracking-wider text-zinc-400 uppercase truncate" title={deptLabel}>
                {role === 'HOD' ? 'Academic Department' : 'Clearance Desk'}
              </div>
            )}
            <div className="space-y-1">
              {role === 'HOD' ? (
                <>
                  <NavItem
                    to="/teaching-departments"
                    icon={<GraduationCap className="w-4 h-4" />}
                    label="Academic Dept"
                    collapsed={isCollapsed}
                    onClick={onItemClick}
                  />
                  <NavItem
                    to="/officer/history"
                    icon={<History className="w-4 h-4" />}
                    label="Clearance History"
                    collapsed={isCollapsed}
                    onClick={onItemClick}
                  />
                </>
              ) : isPhysicsOfficer ? (
                <>
                  <NavItem
                    to="/officer/dashboard"
                    icon={<LayoutDashboard className="w-4 h-4" />}
                    label="Dashboard"
                    collapsed={isCollapsed}
                    onClick={onItemClick}
                  />
                  <NavItem
                    to="/officer/physics-lab"
                    icon={<Atom className="w-4 h-4 text-cyan-600" />}
                    label="Physics Lab Clearance"
                    collapsed={isCollapsed}
                    onClick={onItemClick}
                  />
                  <NavItem
                    to="/officer/history"
                    icon={<History className="w-4 h-4" />}
                    label="Clearance History"
                    collapsed={isCollapsed}
                    onClick={onItemClick}
                  />
                </>
              ) : isChemistryOfficer ? (
                <>
                  <NavItem
                    to="/officer/dashboard"
                    icon={<LayoutDashboard className="w-4 h-4" />}
                    label="Dashboard"
                    collapsed={isCollapsed}
                    onClick={onItemClick}
                  />
                  <NavItem
                    to="/officer/chemistry-lab"
                    icon={<FlaskConical className="w-4 h-4 text-emerald-600" />}
                    label="Chemistry Lab Clearance"
                    collapsed={isCollapsed}
                    onClick={onItemClick}
                  />
                  <NavItem
                    to="/officer/history"
                    icon={<History className="w-4 h-4" />}
                    label="Clearance History"
                    collapsed={isCollapsed}
                    onClick={onItemClick}
                  />
                </>
              ) : isLibraryOfficer ? (
                <>
                  <NavItem
                    to="/officer/dashboard"
                    icon={<LayoutDashboard className="w-4 h-4" />}
                    label="Dashboard"
                    collapsed={isCollapsed}
                    onClick={onItemClick}
                  />
                  <NavItem
                    to="/officer/central-library"
                    icon={<BookOpen className="w-4 h-4 text-amber-600" />}
                    label="Library Clearance"
                    collapsed={isCollapsed}
                    onClick={onItemClick}
                  />
                  <NavItem
                    to="/officer/history"
                    icon={<History className="w-4 h-4" />}
                    label="Clearance History"
                    collapsed={isCollapsed}
                    onClick={onItemClick}
                  />
                </>
              ) : isAcademicBranchOfficer ? (
                <>
                  <NavItem
                    to="/officer/dashboard"
                    icon={<LayoutDashboard className="w-4 h-4" />}
                    label="Dashboard"
                    collapsed={isCollapsed}
                    onClick={onItemClick}
                  />
                  <NavItem
                    to="/officer/department-lab"
                    icon={<Laptop className="w-4 h-4 text-indigo-600" />}
                    label="Department Lab"
                    collapsed={isCollapsed}
                    onClick={onItemClick}
                  />
                  <NavItem
                    to="/officer/history"
                    icon={<History className="w-4 h-4" />}
                    label="Department History"
                    collapsed={isCollapsed}
                    onClick={onItemClick}
                  />
                </>
              ) : (
                <>
                  <NavItem
                    to="/officer/dashboard"
                    icon={<LayoutDashboard className="w-4 h-4" />}
                    label="Dashboard"
                    collapsed={isCollapsed}
                    onClick={onItemClick}
                  />

                  <NavItem
                    to="/officer/clearances"
                    icon={<FileCheck className="w-4 h-4" />}
                    label={isCollegeOffice ? 'Certificate Collection' : 'Clearance Queue'}
                    collapsed={isCollapsed}
                    onClick={onItemClick}
                  />
                  <NavItem
                    to="/officer/history"
                    icon={<History className="w-4 h-4" />}
                    label="Department History"
                    collapsed={isCollapsed}
                    onClick={onItemClick}
                  />
                  {isCashFeeOfficer && (
                    <>
                      <NavItem
                        to="/officer/students"
                        icon={<Users2 className="w-4 h-4" />}
                        label="Manage Students"
                        collapsed={isCollapsed}
                        onClick={onItemClick}
                      />
                      <NavItem
                        to="/officer/import"
                        icon={<UploadCloud className="w-4 h-4" />}
                        label="Import Students"
                        collapsed={isCollapsed}
                        onClick={onItemClick}
                      />
                      <NavItem
                        to="/officer/audit-logs"
                        icon={<ShieldAlert className="w-4 h-4" />}
                        label="Audit Logs"
                        collapsed={isCollapsed}
                        onClick={onItemClick}
                      />
                    </>
                  )}
                  <NavItem
                    to="/account/settings"
                    icon={<KeyRound className="w-4 h-4 text-zinc-500" />}
                    label="Account Settings"
                    collapsed={isCollapsed}
                    onClick={onItemClick}
                  />
                </>
              )}
            </div>
          </div>
        )}
        {/* AI & REGISTER SCANNING SECTION IN LEFT NAVIGATION BAR */}
        {isStaff && (
          <div>
            {!isCollapsed && (
              <div className="px-2 mb-1.5 text-[10px] font-bold tracking-wider text-indigo-500 uppercase flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-amber-500" />
                  <span>AI & Automation</span>
                </span>
                <span className="text-[9px] font-bold bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded border border-indigo-200">
                  NEW
                </span>
              </div>
            )}
            <div className="space-y-1">
              <NavItem
                to={isAdmin ? '/officer/ai-assistant/ADM' : `/officer/ai-assistant/${context?.department?.code || deptCode || 'PHY'}`}
                icon={<Sparkles className="w-4 h-4 text-indigo-600" />}
                label={
                  isAdmin
                    ? 'Administration AI Assistant'
                    : context?.assistantConfig?.title ||
                      (isLibraryOfficer
                        ? 'Central Library AI Assistant'
                        : isChemistryOfficer
                        ? 'Chemistry Department AI Assistant'
                        : isPhysicsOfficer
                        ? 'Physics Department AI Assistant'
                        : 'Department AI Assistant')
                }
                collapsed={isCollapsed}
                onClick={onItemClick}
              />
              <NavItem
                to="/officer/logbook-scanner"
                icon={<ScanLine className="w-4 h-4 text-cyan-600" />}
                label={
                  isAdmin
                    ? 'Document & Logbook Scanner'
                    : context?.scannerConfig?.title ||
                      (isLibraryOfficer
                        ? 'Scan Library Register'
                        : isChemistryOfficer || isPhysicsOfficer
                        ? 'Scan Lab Register'
                        : 'Scan Register')
                }
                collapsed={isCollapsed}
                onClick={onItemClick}
              />
            </div>
          </div>
        )}

        {/* ADMIN LINKS */}

        {isAdmin && (
          <div>
            {!isCollapsed && (
              <div className="px-2 mb-1.5 text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                General
              </div>
            )}
            <div className="space-y-1">
              <NavItem
                to="/admin/dashboard"
                icon={<LayoutDashboard className="w-4 h-4" />}
                label="Dashboard"
                collapsed={isCollapsed}
                onClick={onItemClick}
              />
              <NavItem
                to="/admin/students"
                icon={<Users2 className="w-4 h-4" />}
                label="Students"
                collapsed={isCollapsed}
                onClick={onItemClick}
              />
              {role === 'ADMIN' && (
                <NavItem
                  to="/admin/import"
                  icon={<UploadCloud className="w-4 h-4" />}
                  label="Import Students"
                  collapsed={isCollapsed}
                  onClick={onItemClick}
                />
              )}
              <NavItem
                to="/admin/departments"
                icon={<Building className="w-4 h-4" />}
                label="Departments"
                collapsed={isCollapsed}
                onClick={onItemClick}
              />
              <NavItem
                to="/admin/officers"
                icon={<UserCheck2 className="w-4 h-4" />}
                label="Officers"
                collapsed={isCollapsed}
                onClick={onItemClick}
              />
            </div>

            {!isCollapsed && (
              <div className="px-2 mt-4 mb-1.5 text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                Management
              </div>
            )}
            <div className="space-y-1">
              <NavItem
                to="/admin/ndc"
                icon={<FileCheck className="w-4 h-4" />}
                label="NDC Requests"
                collapsed={isCollapsed}
                onClick={onItemClick}
              />
              <NavItem
                to="/admin/certificates"
                icon={<Award className="w-4 h-4" />}
                label="Certificates"
                collapsed={isCollapsed}
                onClick={onItemClick}
              />
              <NavItem
                to="/admin/reports"
                icon={<BarChart3 className="w-4 h-4" />}
                label="Reports & Analytics"
                collapsed={isCollapsed}
                onClick={onItemClick}
              />
              <NavItem
                to="/admin/audit-logs"
                icon={<ShieldAlert className="w-4 h-4" />}
                label="Audit Logs"
                collapsed={isCollapsed}
                onClick={onItemClick}
              />
              {role === 'SUPER_ADMIN' && (
                <>
                  <NavItem
                    to="/admin/section-logins"
                    icon={<KeyRound className="w-4 h-4 text-amber-500" />}
                    label="Section Logins"
                    collapsed={isCollapsed}
                    onClick={onItemClick}
                  />
                  <NavItem
                    to="/admin/settings"
                    icon={<Settings className="w-4 h-4" />}
                    label="Settings"
                    collapsed={isCollapsed}
                    onClick={onItemClick}
                  />
                </>
              )}
              <NavItem
                to="/account/settings"
                icon={<KeyRound className="w-4 h-4 text-zinc-500" />}
                label="Account Settings"
                collapsed={isCollapsed}
                onClick={onItemClick}
              />
            </div>
          </div>
        )}
      </div>
    );
  };

  // Render User Card at Bottom
  const renderUserCard = (isMobile = false) => {
    if (!user) return null;
    const isCollapsed = isMobile ? false : collapsed;

    return (
      <div className="p-2 border-t border-zinc-100 bg-zinc-50/50">
        <div
          className={`flex items-center rounded-lg bg-white border border-zinc-200/70 ${
            isCollapsed ? 'justify-center p-1 w-9 h-9 mx-auto' : 'gap-2 p-1.5'
          }`}
        >
          <div className="w-6 h-6 rounded-md bg-zinc-900 text-white font-semibold text-[11px] flex items-center justify-center flex-shrink-0">
            {userInitials}
          </div>

          {!isCollapsed && (
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-zinc-900 truncate leading-tight">
                {user.name}
              </div>
              <div className="text-[10px] text-zinc-400 font-medium truncate capitalize">
                {user.role.replace(/_/g, ' ').toLowerCase()}
              </div>
            </div>
          )}

          {!isCollapsed && (
            <div className="flex items-center gap-1">
              <Link
                to="/account/settings"
                onClick={isMobile ? closeMobileMenu : undefined}
                className="text-zinc-400 hover:text-zinc-700 p-1 rounded hover:bg-zinc-100 transition-colors"
                title="Account Settings"
              >
                <KeyRound className="w-3.5 h-3.5" />
              </Link>
              <button
                onClick={() => {
                  logout();
                  window.location.href = '/login';
                }}
                className="text-zinc-400 hover:text-rose-600 p-1 rounded hover:bg-zinc-100 transition-colors"
                title="Sign Out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* ============================================================== */}
      {/* 1. MOBILE DRAWER OVERLAY BACKDROP (< 1024px)                     */}
      {/* ============================================================== */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs z-40 lg:hidden transition-opacity"
          onClick={closeMobileMenu}
          aria-hidden="true"
        />
      )}

      {/* ============================================================== */}
      {/* 2. MOBILE DRAWER SLIDE-IN ASIDE (< 1024px)                     */}
      {/* ============================================================== */}
      <aside
        className={`fixed top-0 bottom-0 left-0 w-72 max-w-[85vw] bg-white z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out lg:hidden select-none ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Mobile Navigation"
      >
        {/* Mobile Header with Close X Button */}
        <div className="h-14 flex items-center justify-between px-4 border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-zinc-900 text-white flex items-center justify-center font-bold text-xs flex-shrink-0">
              <img
                src="/mce_logo.png"
                alt="MCE"
                className="w-6 h-6 object-contain rounded"
                onError={(e) => {
                  (e.target as any).style.display = 'none';
                }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-zinc-900 text-[13px] tracking-tight truncate">
                MCE Clearance
              </div>
              <p className="text-[10px] text-zinc-400 font-medium truncate">
                No Due Portal
              </p>
            </div>
          </div>

          <button
            onClick={closeMobileMenu}
            className="p-1.5 text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100 rounded-lg transition-colors"
            title="Close navigation"
            aria-label="Close navigation"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mobile Nav Links */}
        {renderNavLinks(true)}

        {/* Mobile User Card */}
        {renderUserCard(true)}
      </aside>

      {/* ============================================================== */}
      {/* 3. DESKTOP DOCKED SIDEBAR (>= 1024px)                          */}
      {/* ============================================================== */}
      <aside
        className={`hidden lg:flex sticky top-0 h-screen self-start flex-shrink-0 flex-col bg-white border-r border-zinc-200/70 select-none transition-all duration-200 ease-in-out z-30 ${
          collapsed ? 'w-[64px]' : 'w-[240px]'
        }`}
        aria-label="Desktop Navigation"
      >
        {/* Desktop Brand Header */}
        <div
          className={`h-14 flex items-center border-b border-zinc-100 flex-shrink-0 ${
            collapsed ? 'justify-center px-0' : 'justify-between px-3.5'
          }`}
        >
          {collapsed ? (
            <button
              onClick={toggleCollapse}
              className="w-9 h-9 rounded-lg bg-zinc-900 text-white flex items-center justify-center transition-all hover:bg-zinc-800 cursor-pointer shadow-xs group relative"
              title="Expand sidebar"
            >
              <img
                src="/mce_logo.png"
                alt="MCE"
                className="w-5 h-5 object-contain rounded group-hover:hidden"
                onError={(e) => {
                  (e.target as any).style.display = 'none';
                }}
              />
              <PanelLeft className="w-4 h-4 hidden group-hover:block text-white" />
            </button>
          ) : (
            <>
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-zinc-900 text-white flex items-center justify-center font-bold text-xs flex-shrink-0">
                  <img
                    src="/mce_logo.png"
                    alt="MCE"
                    className="w-6 h-6 object-contain rounded"
                    onError={(e) => {
                      (e.target as any).style.display = 'none';
                    }}
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span className="font-bold text-zinc-900 text-[13px] tracking-tight truncate">
                      MCE Clearance
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-400 font-medium truncate">
                    No Due Portal
                  </p>
                </div>
              </div>

              <button
                onClick={toggleCollapse}
                className="text-zinc-400 hover:text-zinc-700 p-1 rounded-md hover:bg-zinc-100 transition-colors"
                title="Collapse sidebar"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </>
          )}
        </div>

        {/* Desktop Navigation Links */}
        {renderNavLinks(false)}

        {/* Desktop Bottom User Card */}
        {renderUserCard(false)}
      </aside>
    </>
  );
};

// Minimalist Clean Nav Item
const NavItem: React.FC<{
  to: string;
  icon: React.ReactNode;
  label: string;
  collapsed: boolean;
  onClick?: () => void;
}> = ({ to, icon, label, collapsed, onClick }) => {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `group relative flex items-center transition-all duration-150 ease-out active:scale-[0.98] ${
          collapsed
            ? 'w-9 h-9 mx-auto justify-center rounded-lg text-xs'
            : 'gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium hover:translate-x-0.5'
        } ${
          isActive
            ? 'bg-zinc-100 text-zinc-950 font-semibold shadow-2xs'
            : 'text-zinc-500 hover:text-zinc-950 hover:bg-zinc-50'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={`flex-shrink-0 transition-colors ${
              isActive ? 'text-zinc-950' : 'text-zinc-400 group-hover:text-zinc-600'
            }`}
          >
            {icon}
          </span>

          {!collapsed && <span className="truncate">{label}</span>}

          {/* Floating Tooltip in Collapsed Mode */}
          {collapsed && (
            <div className="absolute left-full ml-3 px-2.5 py-1 bg-zinc-900 text-white text-[11px] font-medium rounded-lg whitespace-nowrap shadow-lg opacity-0 -translate-x-1 pointer-events-none group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 z-50">
              {label}
            </div>
          )}
        </>
      )}
    </NavLink>
  );
};
