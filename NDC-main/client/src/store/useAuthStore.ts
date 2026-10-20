import { create } from 'zustand';
import { User } from '../types';
import { clientCache } from '../utils/clientCache';

export const getAuthorizedDashboardPath = (user: User | null): string => {
  if (!user) return '/login';
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
    clientCache.invalidate();
    set({ user, token, isAuthenticated: true, isLoading: false });
  },

  logout: () => {
    localStorage.removeItem('ndc_token');
    localStorage.removeItem('ndc_user');
    clientCache.invalidate();
    set({ user: null, token: null, isAuthenticated: false, isLoading: false });
  },

  initAuth: () => {
    const initial = getInitialAuth();
    set(initial);
  }
}));
