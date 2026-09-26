import React from 'react';
import { NdcStatus, ClearanceStatus, CertificateStatus } from '../types';

interface Props {
  status: NdcStatus | ClearanceStatus | CertificateStatus | string;
  size?: 'sm' | 'md' | 'lg';
}

export const ClearanceStatusBadge: React.FC<Props> = ({ status }) => {
  const normalized = String(status).toUpperCase();

  const getBadgeClassAndLabel = () => {
    switch (normalized) {
      case 'APPROVED':
      case 'CLEARED':
      case 'VALID':
        return {
          variantClass: 'b-cleared',
          label: normalized === 'APPROVED' ? 'Approved' : normalized === 'CLEARED' ? 'Cleared' : 'Valid'
        };
      case 'BLOCKED':
      case 'DUE':
        return {
          variantClass: 'b-due',
          label: normalized === 'BLOCKED' ? 'Due' : 'Due'
        };
      case 'ACTION_REQUIRED':
      case 'ACTION REQUIRED':
        return {
          variantClass: 'b-due',
          label: 'Action Required'
        };
      case 'IN_PROGRESS':
      case 'PENDING':
        return {
          variantClass: 'b-pending',
          label: normalized === 'IN_PROGRESS' ? 'Pending' : 'Pending'
        };
      case 'ON_HOLD':
        return {
          variantClass: 'b-pending',
          label: 'On Hold'
        };
      case 'NOT_APPLICABLE':
        return {
          variantClass: 'b-notEligible',
          label: 'Not Applicable'
        };
      case 'REVOKED':
      case 'REJECTED':
        return {
          variantClass: 'b-revoked',
          label: normalized === 'REVOKED' ? 'Revoked' : 'Rejected'
        };
      default:
        return {
          variantClass: 'b-notEligible',
          label: normalized
        };
    }
  };

  const { variantClass, label } = getBadgeClassAndLabel();

  return (
    <span className={`badge-hybrid ${variantClass}`} aria-label={label}>
      <span>{label}</span>
    </span>
  );
};
