import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
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
  description?: string;
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
  const requestIdRef = useRef<number>(0);

  const refreshContext = useCallback(
    async (overrideDeptCode?: string) => {
      const currentRequestId = ++requestIdRef.current;

      if (!token || !user || user.role === 'STUDENT') {
        setContext(null);
        setStats(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        let targetCode: string | undefined;
        if (overrideDeptCode !== undefined) {
          targetCode = overrideDeptCode === '' ? undefined : overrideDeptCode;
        } else {
          targetCode = activeDepartmentCode || undefined;
        }

        const res = await aiService.getAiContext(targetCode);

        // Ignore response if a newer request was dispatched
        if (currentRequestId !== requestIdRef.current) {
          return;
        }

        if (res && res.context) {
          setContext(res.context);
          setStats(res.stats || null);
          setActiveDepartmentCodeState(res.context.department.code);
        }
      } catch (err: any) {
        // Ignore error if a newer request was dispatched
        if (currentRequestId !== requestIdRef.current) {
          return;
        }

        console.error('[PortalContext] Failed to load role-aware AI context:', err);
        setError(err.response?.data?.message || err.message || 'Failed to load context');
      } finally {
        if (currentRequestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [token, user, activeDepartmentCode]
  );

  // Re-fetch context when user authentication changes or user account switches
  useEffect(() => {
    // Immediately clear previous account's context and stats so stale data is never shown
    setContext(null);
    setStats(null);
    setActiveDepartmentCodeState('');

    if (!token || !user || user.role === 'STUDENT') {
      setLoading(false);
      return;
    }

    // Call with explicit '' to indicate no department override, rather than falling back to old activeDepartmentCode
    refreshContext('');
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
