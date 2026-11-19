import { create } from 'zustand';
import { User } from '../types';
import { clientCache } from '../utils/clientCache';

export const getAuthorizedDashboardPath = (user: User | null): string => {
  if (!user) return '/login';
  // Super Admin & Admin MUST ALWAYS resolve to the institution-wide Admin Dashboard
  if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') {
    return '/admin/dashboard';
  }
  if (user.role === 'STUDENT') return '/student/dashboard';
  if (user.role === 'HOD') return '/teaching-departments';
  if (user.role === 'DEPARTMENT_OFFICER') {
    const deptObj = user?.department as any;
    const officerDeptObj = (user?.officerProfile as any)?.departmentIds?.[0] as any;
    const code = (
      officerDeptObj?.code ||
      deptObj?.code ||
      (typeof user?.departmentId === 'object' ? (user?.departmentId as any)?.code : undefined) ||
      ''
    ).toUpperCase();
    const isAcademic =
      deptObj?.isAcademicBranch ||
      deptObj?.category === 'ACADEMIC_BRANCH' ||
      officerDeptObj?.isAcademicBranch ||
      officerDeptObj?.category === 'ACADEMIC_BRANCH';

    if (user.loginId === 'PHY001' || user.email?.includes('physics') || code === 'PHY') {
      return '/officer/physics-lab';
    }
    if (user.loginId === 'CHEM001' || user.email?.includes('chemistry') || code === 'CHEM') {
      return '/officer/chemistry-lab';
    }
    if (user.loginId === 'LIB001' || user.email?.includes('library') || code === 'LIB') {
      return '/officer/central-library';
    }
    if (isAcademic) {
      return '/officer/department-lab';
    }
    return '/officer/dashboard';
  }
  return '/admin/dashboard';
};

/**
 * Validates whether a requested destination path is permissible for the given user role.
 * If invalid, disallowed, or cross-scope, returns false.
 */
export const isPathAllowedForRole = (path: string, user: User | null): boolean => {
  if (!user || !path) return false;
  const normalized = path.split('?')[0].split('#')[0];

  // Disallow login/auth paths as redirect targets
  if (normalized === '/login' || normalized === '/student-login' || normalized === '/login/student') {
    return false;
  }

  // Canonical paths allowed for all authenticated users
  if (['/', '/dashboard', '/students', '/departments', '/clearance', '/clearances', '/account/settings', '/verify'].includes(normalized)) {
    return true;
  }

  const role = user.role;

  if (role === 'SUPER_ADMIN') {
    // Super Admin can access all administrative and staff routes
    return true;
  }

  if (role === 'ADMIN') {
    // Admin must NOT be redirected into department officer lab desks or academic-only views via stale redirect parameters
    if (
      normalized.startsWith('/teaching-departments') ||
      normalized === '/officer/department-lab' ||
      normalized === '/officer/physics-lab' ||
      normalized === '/officer/chemistry-lab' ||
      normalized === '/officer/central-library' ||
      normalized.startsWith('/student/')
    ) {
      return false;
    }
    return normalized.startsWith('/admin/') || normalized.startsWith('/officer/') || normalized === '/admin';
  }

  if (role === 'HOD') {
    if (normalized.startsWith('/admin/') || normalized.startsWith('/student/')) {
      return false;
    }
    return normalized.startsWith('/teaching-departments') || normalized.startsWith('/officer/');
  }

  if (role === 'DEPARTMENT_OFFICER') {
    if (normalized.startsWith('/admin/') || normalized.startsWith('/student/') || normalized.startsWith('/teaching-departments')) {
      return false;
    }
    return normalized.startsWith('/officer/');
  }

  if (role === 'STUDENT') {
    return normalized.startsWith('/student/');
  }

  return false;
};

/**
 * Prevent a stale deep link from overriding the institution-wide landing page
 * for administrators. Other roles retain their requested in-app destination.
 */
export const getPostLoginPath = (user: User | null, requestedPath?: string | null): string => {
  const dashboardPath = getAuthorizedDashboardPath(user);
  if (!user || user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
    return dashboardPath;
  }
  if (
    requestedPath &&
    requestedPath.startsWith('/') &&
    !requestedPath.startsWith('//') &&
    isPathAllowedForRole(requestedPath, user)
  ) {
    return requestedPath;
  }
  return dashboardPath;
};

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setAuth: (user: User, token: string) => void;
  logout: () => void;
  initAuth: () => void;
}

const getInitialAuth = (): { user: User | null; token: string | null; isAuthenticated: boolean; isLoading: boolean } => {
  if (typeof window === 'undefined') {
    return { user: null, token: null, isAuthenticated: false, isLoading: false };
  }
  try {
    const token = localStorage.getItem('ndc_token');
    const userStr = localStorage.getItem('ndc_user');
    if (token && userStr) {
      const user = JSON.parse(userStr);
      return { user, token, isAuthenticated: true, isLoading: false };
    }
  } catch (err) {
    console.warn('[useAuthStore] Failed to parse initial session from localStorage:', err);
    try {
      localStorage.removeItem('ndc_token');
      localStorage.removeItem('ndc_user');
    } catch {
      // ignore
    }
  }
  return { user: null, token: null, isAuthenticated: false, isLoading: false };
};

export const useAuthStore = create<AuthState>((set) => ({
  ...getInitialAuth(),

  setAuth: (user: User, token: string) => {
    localStorage.setItem('ndc_token', token);
    localStorage.setItem('ndc_user', JSON.stringify(user));
    // Clear in-memory client cache across all namespaces to prevent cross-account stale department data
    clientCache.invalidate();
    set({ user, token, isAuthenticated: true, isLoading: false });
  },

  logout: () => {
    localStorage.removeItem('ndc_token');
    localStorage.removeItem('ndc_user');
    // Invalidate client cache on logout
    clientCache.invalidate();
    set({ user: null, token: null, isAuthenticated: false, isLoading: false });
  },

  initAuth: () => {
    const initial = getInitialAuth();
    set(initial);
  }
}));
