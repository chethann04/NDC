import React, { useEffect } from 'react';
import { AlertCircle, X, ArrowRight } from 'lucide-react';
import { useErrorModalStore } from '../store/useErrorModalStore';

export const ErrorModal: React.FC = () => {
  const { isOpen, error, closeErrorModal } = useErrorModalStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        closeErrorModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeErrorModal]);

  if (!isOpen || !error) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="error-modal-title"
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-5 overflow-hidden animate-in zoom-in-95 duration-150 text-left"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: Icon + Title + Close */}
        <div className="flex items-start justify-between gap-3 mb-2.5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-100">
              <AlertCircle className="w-4 h-4" />
            </div>
            <h3 id="error-modal-title" className="text-sm sm:text-base font-bold text-slate-900">
              {error.title}
            </h3>
          </div>

          <button
            type="button"
            onClick={closeErrorModal}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            aria-label="Close error modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Concise natural message */}
        <p className="text-xs text-slate-600 leading-relaxed mb-4">
          {error.message}
        </p>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          {error.onAction && error.actionLabel && (
            <button
              type="button"
              onClick={() => {
                error.onAction?.();
                closeErrorModal();
              }}
              className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <span>{error.actionLabel}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={closeErrorModal}
            className="px-4 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
