import { FolderOpen, Image, Video } from 'lucide-react';
import { clipKind, clipLabel, type CameraClip } from './clipStore';

/**
 * Horizontal strip of the six most-recent captures, rendered between the
 * viewer's record-strip and the bottom editor. Clicking a thumbnail selects
 * the clip and forces the editor open.
 */
export function RecentCapturesStrip(props: {
  recentClips: CameraClip[];
  selectedClipId: string | null | undefined;
  thumbUrls: Record<string, string>;
  selectClip: (clip: CameraClip) => void;
  setEditorCollapsed: (next: boolean) => void;
}) {
  const { recentClips, selectedClipId, thumbUrls, selectClip, setEditorCollapsed } = props;
  return (
    <div className="cam-panel__recent-strip" aria-label="Recent camera captures">
      <div className="cam-panel__recent-title">
        <FolderOpen size={13} />
        <span>Recent Captures</span>
      </div>
      {recentClips.length === 0 ? (
        <span className="cam-panel__recent-empty">No captures yet</span>
      ) : recentClips.map((clip) => (
        <button
          key={clip.id}
          className={`cam-panel__recent-item${selectedClipId === clip.id ? ' is-selected' : ''}`}
          type="button"
          onClick={() => {
            selectClip(clip);
            setEditorCollapsed(false);
          }}
        >
          <span className="cam-panel__recent-thumb">
            {thumbUrls[clip.id] ? <img src={thumbUrls[clip.id]} alt="" /> : clipKind(clip) === 'snapshot' ? <Image size={13} /> : <Video size={13} />}
          </span>
          <span>{clipLabel(clip)}</span>
        </button>
      ))}
    </div>
  );
}
