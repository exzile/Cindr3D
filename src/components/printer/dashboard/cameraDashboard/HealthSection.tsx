import { Gauge } from 'lucide-react';
import type { MutableRefObject } from 'react';
import { clipDurationLabel } from './clipStore';
import { formatLastFrame } from './snapshotEdit';

/**
 * "Health" sidebar section: live frame rate + reconnect / dropped-frame
 * diagnostics. The host owns the running tallies and decides whether the
 * detail card is open.
 */
export function HealthSection(props: {
  estimatedFps: number;
  healthPanelOpen: boolean;
  setHealthPanelOpen: (updater: (value: boolean) => boolean) => void;
  droppedFrameWarning: boolean;
  frameAgeMs: number | null;
  lastFrameAt: number | null;
  nowTick: number;
  frameCount: number;
  reconnectCount: number;
  reconnectHistoryRef: MutableRefObject<number[]>;
}) {
  const {
    estimatedFps, healthPanelOpen, setHealthPanelOpen, droppedFrameWarning,
    frameAgeMs, lastFrameAt, nowTick, frameCount, reconnectCount, reconnectHistoryRef,
  } = props;
  return (
    <section className="cam-panel__control-section" aria-label="Camera health diagnostics controls">
      <div className="cam-panel__section-head">
        <span><Gauge size={14} /> Health</span>
        <small>{estimatedFps ? `${estimatedFps.toFixed(1)} FPS` : 'Waiting'}</small>
      </div>
      {healthPanelOpen && (
        <div className={`cam-panel__health-card${droppedFrameWarning ? ' is-warning' : ''}`} aria-label="Camera health diagnostics">
          <span>Frames {frameCount}</span>
          <span>Reconnects {reconnectCount}</span>
          <span>{droppedFrameWarning ? `Frame stale: ${clipDurationLabel(frameAgeMs ?? 0)}` : formatLastFrame(lastFrameAt, nowTick)}</span>
          {reconnectHistoryRef.current.length > 0 && (
            <span>Last reconnect {new Date(reconnectHistoryRef.current[reconnectHistoryRef.current.length - 1]).toLocaleTimeString()}</span>
          )}
        </div>
      )}
      <button className="cam-panel__button" type="button" onClick={() => setHealthPanelOpen((value) => !value)}>
        <Gauge size={13} /> {healthPanelOpen ? 'Hide Health' : 'Show Health'}
      </button>
    </section>
  );
}
