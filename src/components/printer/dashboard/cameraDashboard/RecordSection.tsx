import { Flag, Image, Square, Timer, Video } from 'lucide-react';
import { formatClipDuration, type CameraClipKind } from './clipStore';

/**
 * "Current Record" sidebar section: start/stop buttons for ad-hoc captures
 * (clip, snapshot, timelapse) plus a marker button while a recording is
 * active. The live elapsed timer is rendered in the header.
 */
export function RecordSection(props: {
  recording: boolean;
  elapsedMs: number;
  hasCamera: boolean;
  busy: boolean;
  stopRecording: () => void;
  startRecording: (kind: Exclude<CameraClipKind, 'snapshot'>) => Promise<void> | void;
  captureSnapshot: (label?: string) => Promise<void> | void;
  addMarker: () => void;
}) {
  const { recording, elapsedMs, hasCamera, busy, stopRecording, startRecording, captureSnapshot, addMarker } = props;
  return (
    <section className="cam-panel__control-section cam-panel__control-section--record" aria-label="Current record controls">
      <div className="cam-panel__section-head">
        <span><Video size={14} /> Current Record</span>
        <small>{recording ? formatClipDuration(elapsedMs) : 'Ready'}</small>
      </div>
      <div className="cam-panel__toolbar">
        {recording ? (
          <button className="cam-panel__button cam-panel__button--stop" type="button" onClick={stopRecording}>
            <Square size={13} /> Stop
          </button>
        ) : (
          <button className="cam-panel__button cam-panel__button--record" type="button" disabled={!hasCamera || busy} onClick={() => { void startRecording('clip'); }}>
            <Video size={13} /> Record Clip
          </button>
        )}
        <button className="cam-panel__button" type="button" disabled={!hasCamera || busy || recording} onClick={() => { void captureSnapshot(); }}>
          <Image size={13} /> Snapshot
        </button>
        <button className="cam-panel__button" type="button" disabled={!hasCamera || busy || recording} onClick={() => { void startRecording('timelapse'); }}>
          <Timer size={13} /> Timelapse
        </button>
        <button className="cam-panel__button" type="button" disabled={!hasCamera || !recording} onClick={addMarker}>
          <Flag size={13} /> Marker
        </button>
      </div>
    </section>
  );
}
