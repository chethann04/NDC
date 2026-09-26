import React from 'react';
import { Navigate } from 'react-router-dom';

/**
 * Certificate clearance is managed automatically by departments.
 * Students no longer need to submit manual requests; this route forwards to the Clearance Status Dashboard.
 */
export const ApplyNdc: React.FC = () => {
  return <Navigate to="/student/dashboard" replace />;
};

export default ApplyNdc;
