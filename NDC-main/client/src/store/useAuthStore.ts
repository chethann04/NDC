import { create } from 'zustand';
import { User } from '../types';
import { clientCache } from '../utils/clientCache';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setAuth: (user: User, token: string) => void;
  logout: () => void;
  initAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,

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
    const token = localStorage.getItem('ndc_token');
    const userStr = localStorage.getItem('ndc_user');
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr);
        set({ user, token, isAuthenticated: true, isLoading: false });
      } catch {
        localStorage.removeItem('ndc_token');
        localStorage.removeItem('ndc_user');
        set({ user: null, token: null, isAuthenticated: false, isLoading: false });
      }
    } else {
      set({ isLoading: false });
    }
  }
}));
