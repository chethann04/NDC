import { create } from 'zustand';
import api from '../services/api';

export interface BackgroundJob {
  id: string;
  type: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'FAILED' | 'CANCELLED';
  totalRecords: number;
  processedRecords: number;
  insertedRecords: number;
  updatedRecords: number;
  skippedRecords: number;
  failedRecords: number;
  currentStage: string;
  currentBatch: number;
  totalBatches: number;
  lastError: string | null;
  resultSummary: any;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface JobState {
  activeJob: BackgroundJob | null;
  isDismissed: boolean;
  pollInterval: any;
  setActiveJob: (job: BackgroundJob | null) => void;
  dismissJob: () => void;
  fetchLatestJob: () => Promise<BackgroundJob | null>;
  startGlobalPolling: () => void;
  stopGlobalPolling: () => void;
  cancelJob: (jobId: string) => Promise<boolean>;
}

export const useJobStore = create<JobState>((set, get) => ({
  activeJob: null,
  isDismissed: false,
  pollInterval: null,

  setActiveJob: (job) => {
    if (!job) {
      set({ activeJob: null, isDismissed: false });
      return;
    }
    const isDismissed = localStorage.getItem(`ndc_dismissed_bulk_job_${job.id}`) === 'true';
    set({ activeJob: job, isDismissed });
  },

  dismissJob: () => {
    const job = get().activeJob;
    if (job?.id) {
      try {
        localStorage.setItem(`ndc_dismissed_bulk_job_${job.id}`, 'true');
      } catch {}
    }
    set({ isDismissed: true });
  },

  fetchLatestJob: async () => {
    try {
      const res = await api.get('/jobs/latest');
      const job = res.data?.data;
      if (job) {
        let isDismissed = localStorage.getItem(`ndc_dismissed_bulk_job_${job.id}`) === 'true';

        // Stale job protection: If job completed more than 90 seconds ago, do not display on refresh
        if (job.completedAt && ['COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) {
          const completedTime = new Date(job.completedAt).getTime();
          if (Date.now() - completedTime > 90 * 1000) {
            isDismissed = true;
            try {
              localStorage.setItem(`ndc_dismissed_bulk_job_${job.id}`, 'true');
            } catch {}
          }
        }

        set({ activeJob: job, isDismissed });
        return job;
      }
      return null;
    } catch {
      return null;
    }
  },

  startGlobalPolling: () => {
    const existing = get().pollInterval;
    if (existing) return;

    // Immediately fetch once
    get().fetchLatestJob();

    const interval = setInterval(async () => {
      const job = await get().fetchLatestJob();
      // If no active job or job has finished, we can throttle or stop
      if (!job || ['COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) {
        // Keep finished job visible until dismissed, but poll slower
      }
    }, 2500);

    set({ pollInterval: interval });
  },

  stopGlobalPolling: () => {
    const interval = get().pollInterval;
    if (interval) {
      clearInterval(interval);
      set({ pollInterval: null });
    }
  },

  cancelJob: async (jobId: string) => {
    try {
      await api.post(`/jobs/${jobId}/cancel`);
      await get().fetchLatestJob();
      return true;
    } catch {
      return false;
    }
  }
}));
