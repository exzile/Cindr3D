import { Archive, Image, Save, Timer } from 'lucide-react';
import { clipIssueTags, clipKind, clipLabel, type CameraClip } from './clipStore';

/**
 * "Print Timeline" sidebar section: chronological list of captures tied to
 * the current print job, with one-click export / report / contact-sheet
 * shortcuts scoped to the timeline subset.
 */
export function TimelineSection(props: {
  timelineJobName: string;
  timelineClips: CameraClip[];
  busy: boolean;
  selectClip: (clip: CameraClip) => void;
  setEditorCollapsed: (next: boolean) => void;
  exportClipBundle: (clips: CameraClip[]) => Promise<void> | void;
  generateJobReport: (clips: CameraClip[]) => void;
  generateContactSheet: (clips: CameraClip[]) => Promise<void> | void;
}) {
  const {
    timelineJobName, timelineClips, busy, selectClip, setEditorCollapsed,
    exportClipBundle, generateJobReport, generateContactSheet,
  } = props;
  return (
    <section className="cam-panel__control-section" aria-label="Print event timeline">
      <div className="cam-panel__section-head">
        <span><Timer size={14} /> Print Timeline</span>
        <small>{timelineJobName || 'Recent media'}</small>
      </div>
      <div className="cam-panel__timeline">
        {timelineClips.length === 0 ? (
          <div className="cam-panel__note">No saved captures are tied to the current print yet.</div>
        ) : timelineClips.map((clip) => (
          <button key={clip.id} type="button" onClick={() => { selectClip(clip); setEditorCollapsed(false); }}>
            <span>{new Date(clip.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
            <strong>{clipLabel(clip)}</strong>
            <em>{clipIssueTags(clip).join(', ') || clipKind(clip)}</em>
          </button>
        ))}
      </div>
      <button className="cam-panel__button" type="button" disabled={timelineClips.length === 0 || busy} onClick={() => { void exportClipBundle(timelineClips); }}>
        <Archive size={13} /> Export Timeline Bundle
      </button>
      <button className="cam-panel__button" type="button" disabled={timelineClips.length === 0} onClick={() => generateJobReport(timelineClips)}>
        <Save size={13} /> Generate Report
      </button>
      <button className="cam-panel__button" type="button" disabled={timelineClips.length === 0 || busy} onClick={() => { void generateContactSheet(timelineClips); }}>
        <Image size={13} /> Contact Sheet
      </button>
    </section>
  );
}
