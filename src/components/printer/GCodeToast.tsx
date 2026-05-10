import { createPortal } from 'react-dom';
import { Terminal, Play, Info, AlertTriangle, AlertCircle, X } from 'lucide-react';
import { useToastStore } from '../../store/toastStore';
import type { ToastKind } from '../../store/toastStore';
import './GCodeToast.css';

const DURATION_MS        = 2800;
const ACTION_DURATION_MS = 10_000;

function kindIcon(kind: ToastKind) {
  switch (kind) {
    case 'gcode':   return <Terminal size={13} />;
    case 'macro':   return <Play size={13} />;
    case 'warning': return <AlertTriangle size={13} />;
    case 'error':   return <AlertCircle size={13} />;
    case 'info':
    default:        return <Info size={13} />;
  }
}

export default function GCodeToast() {
  const toasts       = useToastStore((s) => s.toasts);
  const dismissToast = useToastStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return createPortal(
    <div className="gct-stack" role="region" aria-label="Command notifications" aria-live="polite">
      {toasts.map((toast) => {
        const hasActions = !!toast.actions?.length;
        const duration   = hasActions ? ACTION_DURATION_MS : DURATION_MS;

        return (
          <div
            key={toast.id}
            className={`gct-pill${toast.exiting ? ' is-exiting' : ''}${hasActions ? ' has-actions' : ''}`}
            data-kind={toast.kind}
            onClick={hasActions ? undefined : () => dismissToast(toast.id)}
            title={hasActions ? undefined : 'Click to dismiss'}
          >
            <div className="gct-main">
              <span className="gct-icon">{kindIcon(toast.kind)}</span>
              <span className="gct-body">
                <span className="gct-label">{toast.label}</span>
                {toast.sub && <span className="gct-sub">{toast.sub}</span>}
              </span>
              <button
                className="gct-close"
                onClick={(e) => { e.stopPropagation(); dismissToast(toast.id); }}
                title="Dismiss"
                aria-label="Dismiss notification"
              >
                <X size={11} />
              </button>
            </div>

            {hasActions && (
              <div className="gct-actions">
                {toast.actions!.map((action, i) => (
                  <button
                    key={i}
                    className={`gct-action-btn${i === toast.actions!.length - 1 ? ' gct-action-btn--primary' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      action.onClick();
                      dismissToast(toast.id);
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}

            {/* Shrinking progress bar */}
            <div
              className="gct-progress"
              style={{
                animation: toast.exiting ? 'none' : `gct-progress ${duration}ms linear forwards`,
              }}
            />
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
