import React, { useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
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
  ChevronRight,
  LogOut,
  FileCheck2,
  Atom,
  FlaskConical,
  Laptop,
  KeyRound
} from 'lucide-react';

export const Sidebar: React.FC = () => {
  const { user, logout } = useAuthStore();
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem('ndc_sidebar_collapsed');
    return saved === 'true';
  });

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
    role === 'DEPARTMENT_OFFICER' &&
    (deptCode === 'PHY' || user?.loginId === 'PHY001' || user?.email?.includes('physics') || deptName.toLowerCase().includes('physics'));

  const isChemistryOfficer =
    role === 'DEPARTMENT_OFFICER' &&
    (deptCode === 'CHEM' || user?.loginId === 'CHEM001' || user?.email?.includes('chemistry') || deptName.toLowerCase().includes('chemistry'));

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
    : isAcademicBranchOfficer
    ? `${deptCode || 'Academic'} Department`
    : isCashFeeOfficer
    ? 'Cash/Fee Section'
    : isCollegeOffice
    ? 'College Office (ADM)'
    : officerDeptObj?.name ||
      (typeof deptObj === 'object' ? deptObj?.name : undefined) ||
      (role === 'HOD' ? 'Academic Department' : 'Clearance Desk');

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('ndc_sidebar_collapsed', String(next));
  };

  const userInitials = user?.name
    ? user.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
    : 'U';

  return (
    <aside
      className={`sticky top-0 h-screen self-start flex-shrink-0 flex flex-col bg-white border-r border-zinc-200/70 select-none transition-all duration-200 ease-in-out z-30 ${
        collapsed ? 'w-[64px]' : 'w-[240px]'
      }`}
    >
      {/* Brand Header */}
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

      {/* Navigation Links */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-4">
        {/* STUDENT LINKS */}
        {isStudent && (
          <div>
            {!collapsed && (
              <div className="px-2 mb-1.5 text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                Student Portal
              </div>
            )}
            <div className="space-y-1">
              <NavItem
                to="/student/dashboard"
                icon={<LayoutDashboard className="w-4 h-4" />}
                label="Clearance Status"
                collapsed={collapsed}
              />
              <NavItem
                to="/student/certificates"
                icon={<Award className="w-4 h-4" />}
                label="My Certificates"
                collapsed={collapsed}
              />
            </div>
          </div>
        )}

        {/* OFFICER / HOD LINKS */}
        {isOfficer && (
          <div>
            {!collapsed && (
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
                    collapsed={collapsed}
                  />
                  <NavItem
                    to="/officer/history"
                    icon={<History className="w-4 h-4" />}
                    label="Clearance History"
                    collapsed={collapsed}
                  />
                </>
              ) : isPhysicsOfficer ? (
                <>
                  <NavItem
                    to="/officer/dashboard"
                    icon={<LayoutDashboard className="w-4 h-4" />}
                    label="Overview"
                    collapsed={collapsed}
                  />
                  <NavItem
                    to="/officer/physics-lab"
                    icon={<Atom className="w-4 h-4 text-cyan-600" />}
                    label="Physics Lab Clearance"
                    collapsed={collapsed}
                  />
                  <NavItem
                    to="/officer/history"
                    icon={<History className="w-4 h-4" />}
                    label="Clearance History"
                    collapsed={collapsed}
                  />
                </>
              ) : isChemistryOfficer ? (
                <>
                  <NavItem
                    to="/officer/dashboard"
                    icon={<LayoutDashboard className="w-4 h-4" />}
                    label="Overview"
                    collapsed={collapsed}
                  />
                  <NavItem
                    to="/officer/chemistry-lab"
                    icon={<FlaskConical className="w-4 h-4 text-emerald-600" />}
                    label="Chemistry Lab Clearance"
                    collapsed={collapsed}
                  />
                  <NavItem
                    to="/officer/history"
                    icon={<History className="w-4 h-4" />}
                    label="Clearance History"
                    collapsed={collapsed}
                  />
                </>
              ) : isAcademicBranchOfficer ? (
                <>
                  <NavItem
                    to="/officer/dashboard"
                    icon={<LayoutDashboard className="w-4 h-4" />}
                    label="Overview"
                    collapsed={collapsed}
                  />
                  <NavItem
                    to="/officer/department-lab"
                    icon={<Laptop className="w-4 h-4 text-indigo-600" />}
                    label="Department Lab"
                    collapsed={collapsed}
                  />
                  <NavItem
                    to="/officer/history"
                    icon={<History className="w-4 h-4" />}
                    label="Department History"
                    collapsed={collapsed}
                  />
                </>
              ) : (
                <>
                  <NavItem
                    to="/officer/dashboard"
                    icon={<LayoutDashboard className="w-4 h-4" />}
                    label="Overview"
                    collapsed={collapsed}
                  />
                  <NavItem
                    to="/officer/clearances"
                    icon={<FileCheck className="w-4 h-4" />}
                    label={isCollegeOffice ? 'Certificate Collection' : 'Clearance Queue'}
                    collapsed={collapsed}
                  />
                  <NavItem
                    to="/officer/history"
                    icon={<History className="w-4 h-4" />}
                    label="Department History"
                    collapsed={collapsed}
                  />
                  {isCashFeeOfficer && (
                    <>
                      <NavItem
                        to="/officer/students"
                        icon={<Users2 className="w-4 h-4" />}
                        label="Manage Students"
                        collapsed={collapsed}
                      />
                      <NavItem
                        to="/officer/import"
                        icon={<UploadCloud className="w-4 h-4" />}
                        label="Import Students"
                        collapsed={collapsed}
                      />
                      <NavItem
                        to="/officer/audit-logs"
                        icon={<ShieldAlert className="w-4 h-4" />}
                        label="Audit Logs"
                        collapsed={collapsed}
                      />
                    </>
                  )}
                  <NavItem
                    to="/account/settings"
                    icon={<KeyRound className="w-4 h-4 text-zinc-500" />}
                    label="Account Settings"
                    collapsed={collapsed}
                  />
                </>
              )}
            </div>
          </div>
        )}

        {/* ADMIN LINKS */}
        {isAdmin && (
          <div>
            {!collapsed && (
              <div className="px-2 mb-1.5 text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                General
              </div>
            )}
            <div className="space-y-1">
              <NavItem
                to="/admin/dashboard"
                icon={<LayoutDashboard className="w-4 h-4" />}
                label="Dashboard"
                collapsed={collapsed}
              />
              <NavItem
                to="/admin/students"
                icon={<Users2 className="w-4 h-4" />}
                label="Students"
                collapsed={collapsed}
              />
              {role === 'ADMIN' && (
                <NavItem
                  to="/admin/import"
                  icon={<UploadCloud className="w-4 h-4" />}
                  label="Import Students"
                  collapsed={collapsed}
                />
              )}
              <NavItem
                to="/admin/departments"
                icon={<Building className="w-4 h-4" />}
                label="Departments"
                collapsed={collapsed}
              />
              <NavItem
                to="/admin/officers"
                icon={<UserCheck2 className="w-4 h-4" />}
                label="Officers"
                collapsed={collapsed}
              />
            </div>

            {!collapsed && (
              <div className="px-2 mt-4 mb-1.5 text-[10px] font-bold tracking-wider text-zinc-400 uppercase">
                Management
              </div>
            )}
            <div className="space-y-1">
              <NavItem
                to="/admin/ndc"
                icon={<FileCheck className="w-4 h-4" />}
                label="NDC Requests"
                collapsed={collapsed}
              />
              <NavItem
                to="/admin/certificates"
                icon={<Award className="w-4 h-4" />}
                label="Certificates"
                collapsed={collapsed}
              />
              <NavItem
                to="/admin/reports"
                icon={<BarChart3 className="w-4 h-4" />}
                label="Reports & Analytics"
                collapsed={collapsed}
              />
              <NavItem
                to="/admin/audit-logs"
                icon={<ShieldAlert className="w-4 h-4" />}
                label="Audit Logs"
                collapsed={collapsed}
              />
              {role === 'SUPER_ADMIN' && (
                <>
                  <NavItem
                    to="/admin/section-logins"
                    icon={<KeyRound className="w-4 h-4 text-amber-500" />}
                    label="Section Logins"
                    collapsed={collapsed}
                  />
                  <NavItem
                    to="/admin/settings"
                    icon={<Settings className="w-4 h-4" />}
                    label="Settings"
                    collapsed={collapsed}
                  />
                </>
              )}
              <NavItem
                to="/account/settings"
                icon={<KeyRound className="w-4 h-4 text-zinc-500" />}
                label="Account Settings"
                collapsed={collapsed}
              />
            </div>
          </div>
        )}
      </div>

      {/* Bottom User Card */}
      {user && (
        <div className="p-2 border-t border-zinc-100 bg-zinc-50/50">
          <div
            className={`flex items-center rounded-lg bg-white border border-zinc-200/70 ${
              collapsed ? 'justify-center p-1 w-9 h-9 mx-auto' : 'gap-2 p-1.5'
            }`}
          >
            <div className="w-6 h-6 rounded-md bg-zinc-900 text-white font-semibold text-[11px] flex items-center justify-center flex-shrink-0">
              {userInitials}
            </div>

            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-zinc-900 truncate leading-tight">
                  {user.name}
                </div>
                <div className="text-[10px] text-zinc-400 font-medium truncate capitalize">
                  {user.role.replace(/_/g, ' ').toLowerCase()}
                </div>
              </div>
            )}

            {!collapsed && (
              <div className="flex items-center gap-1">
                <Link
                  to="/account/settings"
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
      )}
    </aside>
  );
};

// Minimalist Clean Nav Item
const NavItem: React.FC<{
  to: string;
  icon: React.ReactNode;
  label: string;
  collapsed: boolean;
}> = ({ to, icon, label, collapsed }) => {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `group relative flex items-center transition-all duration-120 ${
          collapsed
            ? 'w-9 h-9 mx-auto justify-center rounded-lg text-xs'
            : 'gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] font-medium'
        } ${
          isActive
            ? 'bg-zinc-100 text-zinc-950 font-semibold'
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
            <div className="absolute left-full ml-3 px-2 py-1 bg-zinc-900 text-white text-[11px] font-medium rounded-md whitespace-nowrap shadow-md opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
              {label}
            </div>
          )}
        </>
      )}
    </NavLink>
  );
};
