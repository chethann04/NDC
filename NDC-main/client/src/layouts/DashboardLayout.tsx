import React from 'react';
import { Outlet } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { Sidebar } from '../components/Sidebar';
import { GlobalJobIndicator } from '../components/GlobalJobIndicator';

export const DashboardLayout: React.FC = () => {
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
