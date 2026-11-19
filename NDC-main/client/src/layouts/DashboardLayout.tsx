import React, { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { Sidebar } from '../components/Sidebar';
import { GlobalJobIndicator } from '../components/GlobalJobIndicator';
import { clientCache } from '../utils/clientCache';

const getRouteNamespace = (pathname: string): string => {
  if (pathname.startsWith('/admin')) return 'admin';
  if (pathname.startsWith('/officer')) return 'officer';
  if (pathname.startsWith('/student')) return 'student';
  if (pathname.startsWith('/teaching-department')) return 'teaching';
  return 'general';
};

export const DashboardLayout: React.FC = () => {
  const location = useLocation();
  const currentNamespace = getRouteNamespace(location.pathname);
  const prevNamespaceRef = useRef<string>(currentNamespace);

  useEffect(() => {
    if (prevNamespaceRef.current !== currentNamespace) {
      // Invalidate both previous and target domain keys to ensure fresh data load on domain switch
      clientCache.invalidate(prevNamespaceRef.current);
      clientCache.invalidate(currentNamespace);
      prevNamespaceRef.current = currentNamespace;
    }
  }, [currentNamespace, location.pathname]);

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Navbar />
        <div className="content">
          <Outlet />
        </div>
      </div>
      <GlobalJobIndicator />
    </div>
  );
};
