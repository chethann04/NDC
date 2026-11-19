import axios from 'axios';

const rawBaseUrl = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
// Strip trailing /api/v1 from rawBaseUrl so API_BASE_URL is always the origin root
export const API_BASE_URL = rawBaseUrl.replace(/\/api\/v1$/, '');

export const getApiUrl = (path: string): string => {
  let cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (!cleanPath.startsWith('/api/v1')) {
    cleanPath = `/api/v1${cleanPath}`;
  }
  return API_BASE_URL ? `${API_BASE_URL}${cleanPath}` : cleanPath;
};

const api = axios.create({
  baseURL: API_BASE_URL ? `${API_BASE_URL}/api/v1` : '/api/v1',
  headers: {
    'Content-Type': 'application/json'
  }
});

// Request Interceptor to attach Authorization Token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('ndc_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

let isHandling401 = false;

// Response Interceptor for global authentication handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // AUTH PAGES: never force-redirect — they handle 401 themselves
      const authPaths = ['/login', '/student-login', '/verify'];
      const isAuthPage = authPaths.some((p) => window.location.pathname === p || window.location.pathname.startsWith(p));

      // STUDENT-LOGIN / AUTH API: any call to auth endpoints is handled by the page
      const isAuthEndpoint = error.config?.url?.includes('/auth/');

      if (!isAuthPage && !isAuthEndpoint && !isHandling401) {
        // Genuine session expiry — clear token and redirect cleanly once without cascading race loops
        isHandling401 = true;
        localStorage.removeItem('ndc_token');
        localStorage.removeItem('ndc_user');
        setTimeout(() => {
          window.location.replace('/login');
          isHandling401 = false;
        }, 100);
      }
    }
    return Promise.reject(error);
  }
);

export default api;
