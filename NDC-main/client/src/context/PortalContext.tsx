import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { aiService } from '../services/aiService';

export interface DepartmentSummary {
  id: string;
  code: string;
  name: string;
  category: 'ADMINISTRATION' | 'CENTRAL_DESK' | 'LABORATORY' | 'ACADEMIC_BRANCH';
  isAcademicBranch?: boolean;
}

export interface AssistantConfig {
  title: string;
  badge: string;
  greeting: string;
  systemPrompt: string;
  suggestedQueries: string[];
  presets: Array<{ label: string; amount?: number; reason?: string }>;
  supportedOperations: string[];
  category: string;
}

export interface ScannerConfig {
  title: string;
  documentType: string;
  scannerInstructions: string;
}

export interface ResolvedAiContext {
  userId: string;
  userName: string;
  userEmail: string;
  role: string;
  scope: 'INSTITUTION_WIDE' | 'DEPARTMENT' | 'ACADEMIC_BRANCH';
  department: DepartmentSummary;
  assistantConfig: AssistantConfig;
  scannerConfig: ScannerConfig;
  permissions: {
    canMutateDues: boolean;
    canApproveClearance: boolean;
    canViewAllDepartments: boolean;
    canViewAuditLogs: boolean;
    isSuperAdmin: boolean;
  };
  availableDepartments?: Array<{ id: string; code: string; name: string }>;
}

export interface PortalStats {
  scope: 'INSTITUTION_WIDE' | 'DEPARTMENT';
  totalStudents?: number;
  fullyCleared?: number;
  pending?: number;
  blocked?: number;
  clearancesByStatus?: Record<string, number>;
  total?: number;
  due?: number;
  cleared?: number;
}

interface PortalContextValue {
  context: ResolvedAiContext | null;
  stats: PortalStats | null;
  loading: boolean;
  error: string | null;
  activeDepartmentCode: string;
  setActiveDepartmentCode: (code: string) => void;
  refreshContext: (overrideDeptCode?: string) => Promise<void>;
  availableDepartments: Array<{ id: string; code: string; name: string }>;
}

const PortalContext = createContext<PortalContextValue | undefined>(undefined);

export const PortalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, token } = useAuthStore();
  const [context, setContext] = useState<ResolvedAiContext | null>(null);
  const [stats, setStats] = useState<PortalStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeDepartmentCode, setActiveDepartmentCodeState] = useState<string>('');

  const refreshContext = useCallback(
    async (overrideDeptCode?: string) => {
      if (!token || !user) {
        setContext(null);
        setStats(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const targetCode = overrideDeptCode || activeDepartmentCode || undefined;
        const res = await aiService.getAiContext(targetCode);
        if (res && res.context) {
          setContext(res.context);
          setStats(res.stats || null);
          setActiveDepartmentCodeState(res.context.department.code);
        }
      } catch (err: any) {
        console.error('[PortalContext] Failed to load role-aware AI context:', err);
        setError(err.response?.data?.message || err.message || 'Failed to load context');
      } finally {
        setLoading(false);
      }
    },
    [token, user, activeDepartmentCode]
  );

  // Re-fetch context when user authentication changes or active department changes
  useEffect(() => {
    if (!token || !user) {
      setContext(null);
      setStats(null);
      setLoading(false);
      return;
    }

    refreshContext();
  }, [token, user?.id, user?.role]);

  const handleSetActiveDepartmentCode = (code: string) => {
    setActiveDepartmentCodeState(code);
    refreshContext(code);
  };

  const availableDepartments = context?.availableDepartments || [];

  return (
    <PortalContext.Provider
      value={{
        context,
        stats,
        loading,
        error,
        activeDepartmentCode: context?.department.code || activeDepartmentCode,
        setActiveDepartmentCode: handleSetActiveDepartmentCode,
        refreshContext,
        availableDepartments
      }}
    >
      {children}
    </PortalContext.Provider>
  );
};

export const usePortalContext = (): PortalContextValue => {
  const ctx = useContext(PortalContext);
  if (!ctx) {
    throw new Error('usePortalContext must be used within a <PortalProvider>');
  }
  return ctx;
};
