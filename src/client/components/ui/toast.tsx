import { createPortal } from 'react-dom';
import { useSyncExternalStore } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { clearToasts, dismissToast, getToasts, pushToast, subscribe, type ToastVariant } from './toast-store.js';

type ToastPlacement = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

function getToastIcon(variant: ToastVariant) {
  switch (variant) {
    case 'success':
      return <CheckCircle2 aria-hidden="true" />;
    case 'error':
      return <AlertCircle aria-hidden="true" />;
    default:
      return <Info aria-hidden="true" />;
  }
}

function getToastRole(variant: ToastVariant): 'status' | 'alert' {
  return variant === 'error' ? 'alert' : 'status';
}

export interface ToastHandle {
  message: (message: string, options?: { duration?: number }) => string;
  success: (message: string, options?: { duration?: number }) => string;
  error: (message: string, options?: { duration?: number }) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const toast: ToastHandle = {
  message(message, options) {
    return pushToast({ message, variant: 'default', duration: options?.duration });
  },
  success(message, options) {
    return pushToast({ message, variant: 'success', duration: options?.duration });
  },
  error(message, options) {
    return pushToast({ message, variant: 'error', duration: options?.duration });
  },
  dismiss(id) {
    dismissToast(id);
  },
  clear() {
    clearToasts();
  },
};

export function Toaster({ position = 'top-right', closeButton = true }: { position?: ToastPlacement; closeButton?: boolean }) {
  const toasts = useSyncExternalStore(subscribe, getToasts, getToasts);

  if (typeof document === 'undefined' || toasts.length === 0) {
    return null;
  }

  return createPortal(
    <div className={`toast-viewport is-${position}`} aria-live="polite" aria-atomic="true">
      {toasts.map((entry) => (
        <article key={entry.id} className={`toast-card is-${entry.variant}`} role={getToastRole(entry.variant)}>
          <div className={`toast-icon is-${entry.variant}`}>{getToastIcon(entry.variant)}</div>
          <div className="toast-content">
            <p className="toast-message">{entry.message}</p>
          </div>
          {closeButton ? (
            <button type="button" className="toast-close" aria-label="Dismiss notification" onClick={() => dismissToast(entry.id)}>
              <X aria-hidden="true" />
            </button>
          ) : null}
        </article>
      ))}
    </div>,
    document.body,
  );
}
