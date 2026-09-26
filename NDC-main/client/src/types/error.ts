export interface UserFriendlyError {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  code?: string;
}

// Backwards-compatible alias if imported elsewhere
export type StructuredError = UserFriendlyError;
export type ErrorPayload = UserFriendlyError | string | Error | any;
