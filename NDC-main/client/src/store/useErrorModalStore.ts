import { create } from 'zustand';
import { UserFriendlyError, ErrorPayload } from '../types/error';
import { normalizeError } from '../utils/errorHandler';

export interface ErrorModalOptions {
  title?: string;
  actionLabel?: string;
  onAction?: () => void;
  fallback?: Partial<UserFriendlyError>;
}

interface ErrorModalState {
  isOpen: boolean;
  error: UserFriendlyError | null;
  openErrorModal: (error: ErrorPayload, options?: ErrorModalOptions) => void;
  closeErrorModal: () => void;
}

export const useErrorModalStore = create<ErrorModalState>((set) => ({
  isOpen: false,
  error: null,

  openErrorModal: (error: ErrorPayload, options?: ErrorModalOptions) => {
    const normalized = normalizeError(error, options?.fallback);
    if (options?.title) {
      normalized.title = options.title;
    }
    if (options?.actionLabel) {
      normalized.actionLabel = options.actionLabel;
    }
    if (options?.onAction) {
      normalized.onAction = options.onAction;
    }

    set({
      isOpen: true,
      error: normalized
    });
  },

  closeErrorModal: () => {
    set({
      isOpen: false,
      error: null
    });
  }
}));

export const showErrorModal = (error: ErrorPayload, options?: ErrorModalOptions) => {
  useErrorModalStore.getState().openErrorModal(error, options);
};
