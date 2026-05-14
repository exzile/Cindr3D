import type { ComponentProps } from 'react';
import { CameraDashboardTopbar } from './CameraDashboardTopbar';
import { CameraViewer } from './CameraViewer';
import { ClipEditorPanel } from './ClipEditorPanel';
import { RecentCapturesStrip } from './RecentCapturesStrip';
import { RecordStrip } from './RecordStrip';

/**
 * The left-hand workspace column: topbar (camera switcher + reconnect),
 * the live viewer, the recording status strip, and (in non-compact mode)
 * the recent captures strip + collapsible clip editor.
 *
 * Like CameraDashboardControls, this is pure routing — every prop bag
 * flows through unchanged. Bundling them at the call site lets the host
 * stay close to the orchestration of state without 150 lines of
 * sub-component wiring in its return.
 */
export interface CameraDashboardWorkspaceProps {
  compact: boolean;
  topbarProps: ComponentProps<typeof CameraDashboardTopbar>;
  viewerProps: ComponentProps<typeof CameraViewer>;
  recordStripProps: ComponentProps<typeof RecordStrip>;
  recentCapturesProps: ComponentProps<typeof RecentCapturesStrip>;
  clipEditorProps: ComponentProps<typeof ClipEditorPanel>;
}

export function CameraDashboardWorkspace(props: CameraDashboardWorkspaceProps) {
  const { compact, topbarProps, viewerProps, recordStripProps, recentCapturesProps, clipEditorProps } = props;

  return (
    <div className="cam-panel__workspace">
      <CameraDashboardTopbar {...topbarProps} />
      <CameraViewer {...viewerProps} />
      <RecordStrip {...recordStripProps} />
      {!compact && <RecentCapturesStrip {...recentCapturesProps} />}
      {!compact && <ClipEditorPanel {...clipEditorProps} />}
    </div>
  );
}
