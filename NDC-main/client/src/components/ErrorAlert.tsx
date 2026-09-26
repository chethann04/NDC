import React from 'react';
import { AlertCircle, X, ArrowRight } from 'lucide-react';
import { UserFriendlyError, ErrorPayload } from '../types/error';
import { normalizeError } from '../utils/errorHandler';

interface ErrorAlertProps {
  error: ErrorPayload;
  onDismiss?: () => void;
  className?: string;
  title?: string;
  fallback?: Partial<UserFriendlyError>;
  actionButton?: {
    label: string;
    onClick: () => void;
  };
}

export const ErrorAlert: React.FC<ErrorAlertProps> = ({
  error,
  onDismiss,
  className = '',
  title,
  fallback,
  actionButton
}) => {
  if (!error) return null;

  const errorObj = normalizeError(error, fallback);
  const displayTitle = title || errorObj.title;
  const action = actionButton || (errorObj.actionLabel && errorObj.onAction ? { label: errorObj.actionLabel, onClick: errorObj.onAction } : undefined);

  return (
    <div
      role="alert"
      className={`rounded-xl border border-rose-200 bg-rose-50/90 p-3.5 text-left transition-all ${className}`}
    >
      {/* Header: Icon + Title + Dismiss */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <h4 className="text-xs sm:text-sm font-bold text-rose-950">
            {displayTitle}
          </h4>
        </div>

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss error"
            className="p-1 rounded-md text-rose-400 hover:text-rose-700 hover:bg-rose-100 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Single concise message paragraph */}
      <p className="text-xs text-rose-900/90 leading-relaxed mt-1">
        {errorObj.message}
      </p>

      {/* Optional action button */}
      {action && (
        <div className="mt-2.5 flex justify-end">
          <button
            type="button"
            onClick={action.onClick}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <span>{action.label}</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
};
