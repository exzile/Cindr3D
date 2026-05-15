import { formatBytes } from '../helpers';

/**
 * Thin status strip between the live viewer and the recent-captures row:
 * recording chip + active job + marker count + local storage usage.
 */
export function RecordStrip(props: {
  recording: boolean;
  recordingStatusLabel: string;
  jobFileName: string | undefined;
  recordingMarkerCount: number;
  totalStorageBytes: number;
}) {
  const { recording, recordingStatusLabel, jobFileName, recordingMarkerCount, totalStorageBytes } = props;
  return (
    <div className="cam-panel__record-strip" aria-label="Current camera capture status">
      <span className={`cam-panel__record-chip${recording ? ' is-recording' : ''}`}>
        {recordingStatusLabel}
      </span>
      <span>{jobFileName || 'No active job'}</span>
      <span>{recordingMarkerCount} marker{recordingMarkerCount === 1 ? '' : 's'}</span>
      <span>{formatBytes(totalStorageBytes)} saved locally</span>
    </div>
  );
}
