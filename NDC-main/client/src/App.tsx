import React, { useEffect, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/useAuthStore';
import { AuthLayout } from './layouts/AuthLayout';
import { DashboardLayout } from './layouts/DashboardLayout';

const PageLoadingFallback = () => (
  <div className="flex items-center justify-center p-12 min-h-[40vh]">
    <div className="flex flex-col items-center gap-3">
      <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
      <span className="text-xs font-semibold text-slate-500">Loading module...</span>
    </div>
  </div>
);

// Route-level Code Splitting for optimal bundle size and instant navigation
const Login = React.lazy(() => import('./pages/Login').then((m) => ({ default: m.Login })));
const StudentLogin = React.lazy(() => import('./pages/StudentLogin').then((m) => ({ default: m.StudentLogin })));
const PublicVerify = React.lazy(() => import('./pages/PublicVerify').then((m) => ({ default: m.PublicVerify })));
const StudentDashboard = React.lazy(() => import('./pages/student/StudentDashboard').then((m) => ({ default: m.StudentDashboard })));
const ApplyNdc = React.lazy(() => import('./pages/student/ApplyNdc').then((m) => ({ default: m.ApplyNdc })));
const StudentCertificates = React.lazy(() => import('./pages/student/StudentCertificates').then((m) => ({ default: m.StudentCertificates })));
const OfficerDashboard = React.lazy(() => import('./pages/officer/OfficerDashboard').then((m) => ({ default: m.OfficerDashboard })));
const OfficerClearanceQueue = React.lazy(() => import('./pages/officer/OfficerClearanceQueue').then((m) => ({ default: m.OfficerClearanceQueue })));
const OfficerHistory = React.lazy(() => import('./pages/officer/OfficerHistory').then((m) => ({ default: m.OfficerHistory })));
const AdminDashboard = React.lazy(() => import('./pages/admin/AdminDashboard').then((m) => ({ default: m.AdminDashboard })));
const StudentManagement = React.lazy(() => import('./pages/admin/StudentManagement').then((m) => ({ default: m.StudentManagement })));
const BulkImport = React.lazy(() => import('./pages/admin/BulkImport').then((m) => ({ default: m.BulkImport })));
const DepartmentManagement = React.lazy(() => import('./pages/admin/DepartmentManagement').then((m) => ({ default: m.DepartmentManagement })));
const OfficerManagement = React.lazy(() => import('./pages/admin/OfficerManagement').then((m) => ({ default: m.OfficerManagement })));
const NdcMonitor = React.lazy(() => import('./pages/admin/NdcMonitor').then((m) => ({ default: m.NdcMonitor })));
const CertificateManagement = React.lazy(() => import('./pages/admin/CertificateManagement').then((m) => ({ default: m.CertificateManagement })));
const ReportsAnalytics = React.lazy(() => import('./pages/admin/ReportsAnalytics').then((m) => ({ default: m.ReportsAnalytics })));
const AuditLogs = React.lazy(() => import('./pages/admin/AuditLogs').then((m) => ({ default: m.AuditLogs })));
const Settings = React.lazy(() => import('./pages/admin/Settings').then((m) => ({ default: m.Settings })));
const TeachingDepartmentView = React.lazy(() => import('./pages/teaching/TeachingDepartmentView').then((m) => ({ default: m.TeachingDepartmentView })));

// Protected Route Guard
const ProtectedRoute = ({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) => {
  const { isAuthenticated, user, isLoading } = useAuthStore();

  if (isLoading) {
    return <div className="p-8 text-center text-slate-500 font-semibold">Authenticating session...</div>;
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    // Redirect to respective dashboard if role not allowed
    if (user.role === 'STUDENT') return <Navigate to="/student/dashboard" replace />;
    if (user.role === 'DEPARTMENT_OFFICER' || user.role === 'HOD') return <Navigate to="/officer/dashboard" replace />;
    return <Navigate to="/admin/dashboard" replace />;
  }

  return <>{children}</>;
};

export const App: React.FC = () => {
  const initAuth = useAuthStore((state) => state.initAuth);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Suspense fallback={<PageLoadingFallback />}>
        <Routes>
          {/* Auth Layout */}
          <Route element={<AuthLayout />}>
            <Route path="/login" element={<Login />} />
            <Route path="/student-login" element={<StudentLogin />} />
            <Route path="/login/student" element={<Navigate to="/student-login" replace />} />
          </Route>

        {/* Protected Dashboard Routes */}
        <Route element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
          {/* Default Redirect */}
          <Route path="/" element={<Navigate to="/login" replace />} />

          {/* Certificate Verification Route (Faculty, HOD, Admin, Super Admin Only) */}
          <Route
            path="/verify"
            element={
              <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HOD', 'DEPARTMENT_OFFICER']}>
                <PublicVerify />
              </ProtectedRoute>
            }
          />

          {/* Student Routes */}
          <Route
            path="/student/dashboard"
            element={
              <ProtectedRoute allowedRoles={['STUDENT']}>
                <StudentDashboard />
              </ProtectedRoute>
            }
          />
          <Route path="/student/no-due" element={<Navigate to="/student/dashboard" replace />} />
          <Route
            path="/student/certificates"
            element={
              <ProtectedRoute allowedRoles={['STUDENT']}>
                <StudentCertificates />
              </ProtectedRoute>
            }
          />

          {/* Officer & HOD Routes */}
          <Route
            path="/officer/dashboard"
            element={
              <ProtectedRoute allowedRoles={['DEPARTMENT_OFFICER', 'HOD']}>
                <OfficerDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/officer/clearances"
            element={
              <ProtectedRoute allowedRoles={['DEPARTMENT_OFFICER', 'HOD']}>
                <OfficerClearanceQueue />
              </ProtectedRoute>
            }
          />
          <Route
            path="/officer/history"
            element={
              <ProtectedRoute allowedRoles={['DEPARTMENT_OFFICER', 'HOD']}>
                <OfficerHistory />
              </ProtectedRoute>
            }
          />
          <Route
            path="/officer/import"
            element={
              <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'DEPARTMENT_OFFICER']}>
                <BulkImport />
              </ProtectedRoute>
            }
          />
          <Route
            path="/officer/audit-logs"
            element={
              <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'DEPARTMENT_OFFICER']}>
                <AuditLogs />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teaching-departments"
            element={
              <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HOD', 'DEPARTMENT_OFFICER']}>
                <TeachingDepartmentView />
              </ProtectedRoute>
            }
          />

          {/* Admin Routes */}
          <Route
            path="/admin/dashboard"
            element={
              <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN']}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/students"
            element={
              <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN']}>
                <StudentManagement />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/import"
            element={
              <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'DEPARTMENT_OFFICER']}>
                <BulkImport />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/departments"
            element={
              <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN']}>
                <DepartmentManagement />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/officers"
            element={
              <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN']}>
                <OfficerManagement />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/ndc"
            element={
              <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HOD']}>
                <NdcMonitor />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/certificates"
            element={
              <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HOD']}>
                <CertificateManagement />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/reports"
            element={
              <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'HOD']}>
                <ReportsAnalytics />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/audit-logs"
            element={
              <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'DEPARTMENT_OFFICER']}>
                <AuditLogs />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/settings"
            element={
              <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                <Settings />
              </ProtectedRoute>
            }
          />
        </Route>

        {/* Catch-all Fallback */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
      </Suspense>
    </Router>
  );
};
