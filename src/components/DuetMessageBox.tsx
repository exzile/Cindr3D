import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Info, AlertTriangle, X, Check, ChevronUp, ChevronDown } from 'lucide-react';
import { usePrinterStore } from '../store/printerStore';
import { colors as COLORS } from '../utils/theme';

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: COLORS.overlay,
    zIndex: 2000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
  },
  modal: {
    background: COLORS.panel,
    border: `2px solid ${COLORS.warning}`,
    borderRadius: 12,
    boxShadow: `0 0 40px rgba(245, 158, 11, 0.25), 0 8px 32px rgba(0, 0, 0, 0.6)`,
    width: 420,
    maxWidth: '90vw',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '14px 18px',
    background: 'rgba(245, 158, 11, 0.1)',
    borderBottom: `1px solid ${COLORS.panelBorder}`,
  },
  headerIcon: {
    color: COLORS.warning,
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: COLORS.warning,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  body: {
    padding: '16px 18px',
    fontSize: 13,
    color: COLORS.text,
    lineHeight: 1.6,
    overflowY: 'auto',
    whiteSpace: 'pre-wrap',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    padding: '12px 18px',
    borderTop: `1px solid ${COLORS.panelBorder}`,
  },
  btnOk: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '8px 24px',
    background: COLORS.warning,
    color: '#000',
    border: 'none',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'background 0.15s',
  },
  btnCancel: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '8px 20px',
    background: COLORS.surface,
    color: COLORS.text,
    border: `1px solid ${COLORS.inputBorder}`,
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'background 0.15s',
  },
  btnClose: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '8px 24px',
    background: COLORS.accent,
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'background 0.15s',
  },
  jogSection: {
    padding: '12px 18px',
    borderTop: `1px solid ${COLORS.panelBorder}`,
    background: 'rgba(80, 120, 255, 0.04)',
  },
  jogLabel: {
    fontSize: 11,
    color: COLORS.textDim,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: 8,
    fontWeight: 600,
  },
  jogRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  jogAxisLabel: {
    width: 24,
    fontWeight: 600,
    fontSize: 13,
    color: COLORS.text,
    textAlign: 'center' as const,
  },
  jogBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    padding: '4px 10px',
    border: 'none',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 500,
    fontFamily: 'monospace',
    cursor: 'pointer',
    minWidth: 42,
    transition: 'background 0.15s',
  },
  jogStepSelector: {
    display: 'flex',
    gap: 4,
    marginBottom: 10,
    flexWrap: 'wrap' as const,
  },
  jogStepBtn: {
    padding: '3px 8px',
    border: 'none',
    borderRadius: 4,
    fontSize: 11,
    fontFamily: 'monospace',
    cursor: 'pointer',
    fontWeight: 500,
    transition: 'background 0.15s',
  },
  autoCloseBar: {
    height: 3,
    background: COLORS.warning,
    borderRadius: 2,
    transition: 'width 0.1s linear',
    marginTop: 8,
  },
};

// Axis letters indexed by bit position in axisControls bitmask
const AXIS_LETTERS = ['X', 'Y', 'Z', 'U', 'V', 'W', 'A', 'B', 'C'];

const JOG_STEPS = [0.05, 0.1, 0.5, 1, 5, 10];
const JOG_AMOUNTS = [-10, -1, -0.1, 0.1, 1, 10];

// ---------------------------------------------------------------------------
// Axis Jog Controls sub-component (for mode 3)
// ---------------------------------------------------------------------------

function AxisJogControls({ axisControls }: { axisControls: number }) {
  const moveAxis = usePrinterStore((s) => s.moveAxis);
  const [jogStep, setJogStep] = useState(1);

  // Determine which axes are enabled via bitmask
  const enabledAxes = AXIS_LETTERS.filter((_, i) => (axisControls >> i) & 1);

  if (enabledAxes.length === 0) return null;

  return (
    <div style={styles.jogSection}>
      <div style={styles.jogLabel}>Axis Jog Controls</div>

      {/* Step size selector */}
      <div style={{ fontSize: 10, color: COLORS.textDim, marginBottom: 4 }}>Step (mm)</div>
      <div style={styles.jogStepSelector}>
        {JOG_STEPS.map((step) => (
          <button
            key={step}
            style={{
              ...styles.jogStepBtn,
              background: step === jogStep ? COLORS.accent : COLORS.surface,
              color: step === jogStep ? '#fff' : COLORS.text,
            }}
            onClick={() => setJogStep(step)}
          >
            {step}
          </button>
        ))}
      </div>

      {/* Jog buttons per enabled axis */}
      {enabledAxes.map((axis) => (
        <div key={axis} style={styles.jogRow}>
          <span style={styles.jogAxisLabel}>{axis}</span>
          {JOG_AMOUNTS.map((amount) => (
            <button
              key={amount}
              style={{
                ...styles.jogBtn,
                background: amount < 0 ? '#1a1a3a' : '#1a2a1a',
                color: amount < 0 ? '#8888cc' : '#88cc88',
              }}
              onClick={() => moveAxis(axis, amount * jogStep)}
              title={`Move ${axis} ${amount > 0 ? '+' : ''}${(amount * jogStep).toFixed(3)} mm`}
            >
              {amount < 0 ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
              {amount > 0 ? `+${Math.abs(amount)}` : Math.abs(amount)}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main DuetMessageBox Component
// ---------------------------------------------------------------------------

const AUTO_DISMISS_TIMEOUT = 10000; // 10 seconds for mode 0

export default function DuetMessageBox() {
  const model = usePrinterStore((s) => s.model);
  const sendGCode = usePrinterStore((s) => s.sendGCode);

  const messageBox = model.state?.messageBox;
  const [lastAckedSeq, setLastAckedSeq] = useState<number | null>(null);
  const [autoCloseProgress, setAutoCloseProgress] = useState(100);
  const autoCloseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoCloseStartRef = useRef<number>(0);

  // Determine if we should show the dialog
  const shouldShow =
    messageBox != null &&
    messageBox.message != null &&
    (lastAckedSeq === null || messageBox.seq !== lastAckedSeq);

  // Handle auto-close for mode 0
  useEffect(() => {
    if (!shouldShow || !messageBox || messageBox.mode !== 0) {
      if (autoCloseTimerRef.current) {
        clearInterval(autoCloseTimerRef.current);
        autoCloseTimerRef.current = null;
      }
      return;
    }

    autoCloseStartRef.current = Date.now();
    setAutoCloseProgress(100);

    autoCloseTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - autoCloseStartRef.current;
      const remaining = Math.max(0, 100 - (elapsed / AUTO_DISMISS_TIMEOUT) * 100);
      setAutoCloseProgress(remaining);

      if (remaining <= 0) {
        if (autoCloseTimerRef.current) {
          clearInterval(autoCloseTimerRef.current);
          autoCloseTimerRef.current = null;
        }
        setLastAckedSeq(messageBox.seq);
      }
    }, 100);

    return () => {
      if (autoCloseTimerRef.current) {
        clearInterval(autoCloseTimerRef.current);
        autoCloseTimerRef.current = null;
      }
    };
  }, [shouldShow, messageBox?.seq, messageBox?.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOk = useCallback(() => {
    if (!messageBox) return;
    sendGCode('M292');
    setLastAckedSeq(messageBox.seq);
  }, [messageBox, sendGCode]);

  const handleCancel = useCallback(() => {
    if (!messageBox) return;
    sendGCode('M292 P1');
    setLastAckedSeq(messageBox.seq);
  }, [messageBox, sendGCode]);

  const handleClose = useCallback(() => {
    if (!messageBox) return;
    // Mode 1 close is just an acknowledgement
    sendGCode('M292');
    setLastAckedSeq(messageBox.seq);
  }, [messageBox, sendGCode]);

  if (!shouldShow || !messageBox) return null;

  const { mode, title, message, axisControls } = messageBox;

  return (
    <div style={styles.overlay} onClick={(e) => {
      // Allow clicking overlay to dismiss mode 0 and 1
      if (e.target === e.currentTarget && mode <= 1) {
        if (mode === 0) {
          setLastAckedSeq(messageBox.seq);
        } else {
          handleClose();
        }
      }
    }}>
      <div style={styles.modal}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerIcon}>
            {mode <= 1 ? <Info size={20} /> : <AlertTriangle size={20} />}
          </div>
          <div style={styles.headerTitle}>
            {title || (mode <= 1 ? 'Information' : 'Action Required')}
          </div>
          {mode <= 1 && (
            <button
              style={{
                background: 'none',
                border: 'none',
                color: COLORS.textDim,
                cursor: 'pointer',
                padding: 4,
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
              }}
              onClick={() => {
                if (mode === 0) {
                  setLastAckedSeq(messageBox.seq);
                } else {
                  handleClose();
                }
              }}
              title="Close"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Body */}
        <div style={styles.body}>
          {message}

          {/* Auto-close progress bar for mode 0 */}
          {mode === 0 && (
            <div style={{
              ...styles.autoCloseBar,
              width: `${autoCloseProgress}%`,
            }} />
          )}
        </div>

        {/* Axis jog controls for mode 3 */}
        {mode === 3 && axisControls > 0 && (
          <AxisJogControls axisControls={axisControls} />
        )}

        {/* Footer buttons */}
        <div style={styles.footer}>
          {mode === 0 && (
            <span style={{ fontSize: 11, color: COLORS.textDim, marginRight: 'auto' }}>
              Auto-closing...
            </span>
          )}

          {mode === 1 && (
            <button style={styles.btnClose} onClick={handleClose}>
              <Check size={14} /> Close
            </button>
          )}

          {(mode === 2 || mode === 3) && (
            <>
              <button style={styles.btnCancel} onClick={handleCancel}>
                <X size={14} /> Cancel
              </button>
              <button style={styles.btnOk} onClick={handleOk}>
                <Check size={14} /> OK
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
