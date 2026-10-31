import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useSessionStore } from '../../store/session';

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warn: AlertTriangle,
  danger: XCircle,
};

export function Toasts() {
  const toasts = useSessionStore((s) => s.toasts);
  const dismiss = useSessionStore((s) => s.dismissToast);
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.tone];
        return (
          <div key={toast.id} className={`toast toast--${toast.tone}`}>
            <Icon size={17} className="toast__icon" />
            <div className="toast__body">
              <div className="toast__title">{toast.title}</div>
              {toast.message ? <div className="toast__message">{toast.message}</div> : null}
            </div>
            <button type="button" className="toast__close" onClick={() => dismiss(toast.id)}>
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
