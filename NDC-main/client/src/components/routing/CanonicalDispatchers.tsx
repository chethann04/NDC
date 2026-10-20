import React from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import { UnauthorizedPage } from '../../pages/UnauthorizedPage';

// Lazy loaded page components
const StudentDashboard = React.lazy(() => import('../../pages/student/StudentDashboard').then((m) => ({ default: m.StudentDashboard })));
const TeachingDepartmentView = React.lazy(() => import('../../pages/teaching/TeachingDepartmentView').then((m) => ({ default: m.TeachingDepartmentView })));
const StudentManagement = React.lazy(() => import('../../pages/admin/StudentManagement').then((m) => ({ default: m.StudentManagement })));
const OfficerClearanceQueue = React.lazy(() => import('../../pages/officer/OfficerClearanceQueue').then((m) => ({ default: m.OfficerClearanceQueue })));
const DepartmentManagement = React.lazy(() => import('../../pages/admin/DepartmentManagement').then((m) => ({ default: m.DepartmentManagement })));
const OfficerDashboard = React.lazy(() => import('../../pages/officer/OfficerDashboard').then((m) => ({ default: m.OfficerDashboard })));
const AdminDashboard = React.lazy(() => import('../../pages/admin/AdminDashboard').then((m) => ({ default: m.AdminDashboard })));
const OfficerManagement = React.lazy(() => import('../../pages/admin/OfficerManagement').then((m) => ({ default: m.OfficerManagement })));
const PhysicsLabClearance = React.lazy(() => import('../../pages/officer/PhysicsLabClearance').then((m) => ({ default: m.PhysicsLabClearance })));
const ChemistryLabClearance = React.lazy(() => import('../../pages/officer/ChemistryLabClearance').then((m) => ({ default: m.ChemistryLabClearance })));
const CentralLibraryClearance = React.lazy(() => import('../../pages/officer/CentralLibraryClearance').then((m) => ({ default: m.CentralLibraryClearance })));
const DepartmentLabClearance = React.lazy(() => import('../../pages/officer/DepartmentLabClearance').then((m) => ({ default: m.DepartmentLabClearance })));
const NdcMonitor = React.lazy(() => import('../../pages/admin/NdcMonitor').then((m) => ({ default: m.NdcMonitor })));

const isCashFeeOfficer = (user: any): boolean => {
  if (user?.role !== 'DEPARTMENT_OFFICER') return false;
  const officerDeptObj = user?.officerProfile?.departmentIds?.[0] as any;
  const deptObj = user?.departmentId as any;
  return Boolean(
    user?.email?.startsWith('cashfee') ||
    user?.email === 'accounts@mce.ac.in' ||
    officerDeptObj?.code === 'ACC' ||
    officerDeptObj?.name === 'Cash/Fee Section' ||
    deptObj?.code === 'ACC' ||
    deptObj?.name === 'Cash/Fee Section' ||
    officerDeptObj?.name?.includes('Fee') ||
    officerDeptObj?.name?.includes('Cash') ||
    (typeof deptObj === 'object' && (deptObj?.name?.includes('Fee') || deptObj?.name?.includes('Cash')))
  );
};

const getOfficerDeskComponent = (user: any): React.ReactElement => {
  const code = (
    user?.department?.code ||
    user?.officerProfile?.departmentIds?.[0]?.code ||
    (typeof user?.departmentId === 'object' ? (user?.departmentId as any)?.code : undefined) ||
    ''
  ).toUpperCase();

  const isAcademic =
    user?.department?.isAcademicBranch ||
    user?.department?.category === 'ACADEMIC_BRANCH' ||
    user?.officerProfile?.departmentIds?.[0]?.isAcademicBranch;

  if (user?.loginId === 'PHY001' || user?.email?.includes('physics') || code === 'PHY') {
    return <PhysicsLabClearance />;
  }
  if (user?.loginId === 'CHEM001' || user?.email?.includes('chemistry') || code === 'CHEM') {
    return <ChemistryLabClearance />;
  }
  if (user?.loginId === 'LIB001' || user?.email?.includes('library') || code === 'LIB') {
    return <CentralLibraryClearance />;
  }
  if (isAcademic) {
    return <DepartmentLabClearance />;
  }
  return <OfficerClearanceQueue />;
};

/**
 * Top-Level Canonical Dispatcher: /students
 * Stable, directly accessible URL for student management & records.
 */
export const StudentsCanonicalRoute: React.FC = () => {
  const { user } = useAuthStore();
  if (!user) return <UnauthorizedPage requiredRole="Authenticated User" />;

  if (user.role === 'STUDENT') {
    return <StudentDashboard />;
  }
  if (user.role === 'HOD') {
    return <TeachingDepartmentView />;
  }
  if (user.role === 'DEPARTMENT_OFFICER') {
    if (isCashFeeOfficer(user)) {
      return <StudentManagement />;
    }
    return <OfficerClearanceQueue />;
  }
  if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') {
    return <StudentManagement />;
  }

  return <UnauthorizedPage requiredRole="Student, Officer, or Admin" />;
};

/**
 * Top-Level Canonical Dispatcher: /departments
 * Stable, directly accessible URL for departmental overview & management.
 */
export const DepartmentsCanonicalRoute: React.FC = () => {
  const { user } = useAuthStore();
  if (!user) return <UnauthorizedPage requiredRole="Authenticated User" />;

  if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') {
    return <DepartmentManagement />;
  }
  if (user.role === 'HOD') {
    return <TeachingDepartmentView />;
  }
  if (user.role === 'DEPARTMENT_OFFICER') {
    return <OfficerDashboard />;
  }
  if (user.role === 'STUDENT') {
    return <StudentDashboard />;
  }

  return <UnauthorizedPage requiredRole="Department Staff or Administrator" />;
};

/**
 * Top-Level Canonical Dispatcher: /admin
 * Stable, directly accessible URL for institutional administration.
 */
export const AdminCanonicalRoute: React.FC = () => {
  const { user } = useAuthStore();
  if (!user) return <UnauthorizedPage requiredRole="Administrator" />;

  if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') {
    return <AdminDashboard />;
  }

  return <UnauthorizedPage requiredRole="Administrator" />;
};

/**
 * Top-Level Canonical Dispatcher: /officers
 * Stable, directly accessible URL for officer management & directory.
 */
export const OfficersCanonicalRoute: React.FC = () => {
  const { user } = useAuthStore();
  if (!user) return <UnauthorizedPage requiredRole="Staff or Administrator" />;

  if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') {
    return <OfficerManagement />;
  }
  if (user.role === 'DEPARTMENT_OFFICER' || user.role === 'HOD') {
    return <OfficerDashboard />;
  }

  return <UnauthorizedPage requiredRole="Staff or Administrator" />;
};

/**
 * Top-Level Canonical Dispatcher: /clearance and /clearances
 * Stable, directly accessible URL for clearance workflows across all roles.
 */
export const ClearanceCanonicalRoute: React.FC = () => {
  const { user } = useAuthStore();
  if (!user) return <UnauthorizedPage requiredRole="Authenticated User" />;

  if (user.role === 'STUDENT') {
    return <StudentDashboard />;
  }
  if (user.role === 'DEPARTMENT_OFFICER') {
    return getOfficerDeskComponent(user);
  }
  if (user.role === 'HOD') {
    return <TeachingDepartmentView />;
  }
  if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') {
    return <NdcMonitor />;
  }

  return <UnauthorizedPage requiredRole="Clearance Staff or Student" />;
};

/**
 * Top-Level Canonical Dispatcher: /dashboard
 * Stable, directly accessible URL for the user's primary dashboard.
 */
export const DashboardCanonicalRoute: React.FC = () => {
  const { user } = useAuthStore();
  if (!user) return <UnauthorizedPage requiredRole="Authenticated User" />;

  if (user.role === 'STUDENT') {
    return <StudentDashboard />;
  }
  if (user.role === 'HOD') {
    return <TeachingDepartmentView />;
  }
  if (user.role === 'DEPARTMENT_OFFICER') {
    return <OfficerDashboard />;
  }
  if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') {
    return <AdminDashboard />;
  }

  return <UnauthorizedPage requiredRole="Authenticated User" />;
};
