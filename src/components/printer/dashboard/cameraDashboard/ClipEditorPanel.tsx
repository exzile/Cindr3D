import {
  Archive, ChevronDown, ChevronUp, Copy, Crop, Download, FlipHorizontal, Flag,
  FolderOpen, Image, Play, RotateCw, Save, Scissors, Star, Trash2, Video, X,
} from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { formatBytes } from '../helpers';
import {
  CLIP_RATINGS, INSPECTION_ITEMS, ISSUE_TAGS,
  clipIssueTags, clipKind, clipLabel, formatClipDuration,
  type CameraClip, type CameraClipKind, type ClipRating, type IssueTag, type SnapshotCrop,
} from './clipStore';

/**
 * Bottom "Media Editor" panel — driven by the currently-selected clip:
 *
 *   • Header strip + collapse toggle
 *   • Preview (image or video) with optional A/B compare slider for snapshots
 *   • Edit tools: download / favorite / reload / save / bundle / delete
 *   • Detail form: name, kind, job, album, tags, rating, notes
 *   • Inspection checklist + issue bookmark
 *   • Snapshot editor (flip/rotate, crop/brightness/contrast/sharpen, annotation)
 *     OR video editor (trim, marker trim, timelapse copy, marker draft)
 *   • Marker list + saved-at metadata
 *
 * If no clip is selected, renders the empty-state CTA with quick capture
 * shortcuts.
 *
 * Wide prop surface because the host owns every draft field; this component
 * is purely presentational layout + wiring.
 */
export function ClipEditorPanel(props: {
  editorCollapsed: boolean;
  setEditorCollapsed: (updater: (value: boolean) => boolean) => void;

  selectedClip: CameraClip | null;
  selectedClipUrl: string;
  selectedKind: string | null;

  // Compare slider
  compareClip: CameraClip | null;
  compareClipUrl: string;
  setCompareClipId: (id: string) => void;
  snapshotClips: CameraClip[];

  // Detail draft
  clipDraftName: string;
  setClipDraftName: (v: string) => void;
  clipDraftKind: CameraClipKind;
  setClipDraftKind: (v: CameraClipKind) => void;
  clipDraftJobName: string;
  setClipDraftJobName: (v: string) => void;
  clipDraftAlbum: string;
  setClipDraftAlbum: (v: string) => void;
  clipDraftTags: string;
  setClipDraftTags: (v: string) => void;
  clipDraftRating: ClipRating;
  setClipDraftRating: (v: ClipRating) => void;
  clipDraftNotes: string;
  setClipDraftNotes: (v: string) => void;
  clipDraftChecklist: string[];
  toggleInspectionItem: (item: string) => void;

  issueDraft: IssueTag;
  setIssueDraft: (v: IssueTag) => void;

  // Snapshot editor
  snapshotEditFlip: boolean;
  setSnapshotEditFlip: (updater: (value: boolean) => boolean) => void;
  snapshotEditRotation: number;
  setSnapshotEditRotation: (updater: (value: number) => number) => void;
  snapshotCrop: SnapshotCrop;
  setSnapshotCrop: (updater: (crop: SnapshotCrop) => SnapshotCrop) => void;
  snapshotBrightness: number;
  setSnapshotBrightness: (v: number) => void;
  snapshotContrast: number;
  setSnapshotContrast: (v: number) => void;
  snapshotSharpen: number;
  setSnapshotSharpen: (v: number) => void;
  snapshotAnnotation: string;
  setSnapshotAnnotation: (v: string) => void;
  saveSnapshotAsCopy: boolean;
  setSaveSnapshotAsCopy: (v: boolean) => void;

  // Marker / trim
  trimStart: string;
  setTrimStart: (v: string) => void;
  trimEnd: string;
  setTrimEnd: (v: string) => void;
  markerDraftLabel: string;
  setMarkerDraftLabel: (v: string) => void;
  markerDraftTime: string;
  setMarkerDraftTime: (v: string) => void;

  // Empty-state quick captures
  hasCamera: boolean;
  recording: boolean;
  busy: boolean;
  startRecording: (kind: Exclude<CameraClipKind, 'snapshot'>) => Promise<void> | void;
  captureSnapshot: () => Promise<void> | void;
  setActiveControlSection: (section: 'library') => void;

  // Actions
  downloadClip: (clip: CameraClip) => void;
  toggleSelectedClipFavorite: () => Promise<void> | void;
  selectClip: (clip: CameraClip) => void;
  saveSelectedClipDetails: () => Promise<void> | void;
  exportClipBundle: (clips: CameraClip[]) => Promise<void> | void;
  removeClip: (clip: CameraClip) => Promise<void> | void;
  applySelectedIssue: () => Promise<void> | void;
  saveSnapshotEdits: () => Promise<void> | void;
  saveTrimmedVideoCopy: () => Promise<void> | void;
  trimBetweenFirstTwoMarkers: () => Promise<void> | void;
  makeTimelapseCopy: () => Promise<void> | void;
  addSelectedClipMarker: () => Promise<void> | void;
  removeSelectedClipMarker: (markerId: string) => Promise<void> | void;
}) {
  const {
    editorCollapsed, setEditorCollapsed,
    selectedClip, selectedClipUrl, selectedKind,
    compareClip, compareClipUrl, setCompareClipId, snapshotClips,
    clipDraftName, setClipDraftName, clipDraftKind, setClipDraftKind,
    clipDraftJobName, setClipDraftJobName, clipDraftAlbum, setClipDraftAlbum,
    clipDraftTags, setClipDraftTags, clipDraftRating, setClipDraftRating,
    clipDraftNotes, setClipDraftNotes, clipDraftChecklist, toggleInspectionItem,
    issueDraft, setIssueDraft,
    snapshotEditFlip, setSnapshotEditFlip, snapshotEditRotation, setSnapshotEditRotation,
    snapshotCrop, setSnapshotCrop, snapshotBrightness, setSnapshotBrightness,
    snapshotContrast, setSnapshotContrast, snapshotSharpen, setSnapshotSharpen,
    snapshotAnnotation, setSnapshotAnnotation, saveSnapshotAsCopy, setSaveSnapshotAsCopy,
    trimStart, setTrimStart, trimEnd, setTrimEnd,
    markerDraftLabel, setMarkerDraftLabel, markerDraftTime, setMarkerDraftTime,
    hasCamera, recording, busy, startRecording, captureSnapshot, setActiveControlSection,
    downloadClip, toggleSelectedClipFavorite, selectClip, saveSelectedClipDetails,
    exportClipBundle, removeClip, applySelectedIssue, saveSnapshotEdits,
    saveTrimmedVideoCopy, trimBetweenFirstTwoMarkers, makeTimelapseCopy,
    addSelectedClipMarker, removeSelectedClipMarker,
  } = props;

  // Local — A/B compare slider position. Only the inline scrubber reads it.
  const [compareBlend, setCompareBlend] = useState(50);

  return (
    <div className={`cam-panel__bottom-panel${editorCollapsed ? ' is-collapsed' : ''}`} aria-label="Selected saved camera media">
      <div className="cam-panel__bottom-head">
        <div>
          <strong>{selectedClip ? clipLabel(selectedClip) : 'Media Editor'}</strong>
          <span>{selectedClip ? `${new Date(selectedClip.createdAt).toLocaleString()} - ${formatBytes(selectedClip.size)}` : 'Select a saved item or create a new recording.'}</span>
        </div>
        <button className="cam-panel__button cam-panel__button--compact" type="button" onClick={() => setEditorCollapsed((value) => !value)}>
          {editorCollapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {editorCollapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>
      {!editorCollapsed && (
        <>
          {selectedClip && selectedClipUrl ? (
            <>
              <div className="cam-panel__selected-meta">
                {selectedKind && <span>{selectedKind}</span>}
                {selectedClip.favorite && <span>Favorite</span>}
                {selectedClip.album && <span>{selectedClip.album}</span>}
                {selectedClip.jobName && <span>{selectedClip.jobName}</span>}
              </div>
              <div className="cam-panel__bottom-preview">
                {clipKind(selectedClip) === 'snapshot' ? (
                  <img
                    className="cam-panel__clip-player"
                    src={selectedClipUrl}
                    alt="Saved camera snapshot"
                    style={{
                      filter: `brightness(${snapshotBrightness}%) contrast(${snapshotContrast}%)`,
                      transform: `scaleX(${snapshotEditFlip ? -1 : 1}) rotate(${snapshotEditRotation}deg)`,
                    }}
                  />
                ) : (
                  <video className="cam-panel__clip-player" src={selectedClipUrl} controls />
                )}
                {clipKind(selectedClip) === 'snapshot' && compareClip && compareClipUrl && (
                  <div className="cam-panel__compare">
                    <div>
                      <span>Selected</span>
                      <img src={selectedClipUrl} alt="Selected snapshot comparison" />
                    </div>
                    <div>
                      <span>Compare</span>
                      <img src={compareClipUrl} alt="Comparison snapshot" />
                    </div>
                    <select className="cam-panel__input" value={compareClip?.id ?? ''} onChange={(event) => setCompareClipId(event.target.value)}>
                      {snapshotClips.filter((clip) => clip.id !== selectedClip.id).map((clip) => (
                        <option key={clip.id} value={clip.id}>{clipLabel(clip)} - {new Date(clip.createdAt).toLocaleDateString()}</option>
                      ))}
                    </select>
                    <div className="cam-panel__compare-scrub" style={{ '--compare-blend': `${compareBlend}%` } as CSSProperties}>
                      <img src={compareClipUrl} alt="Comparison base" />
                      <img src={selectedClipUrl} alt="Selected overlay" />
                    </div>
                    <label className="cam-panel__compare-slider">
                      Swipe compare
                      <input type="range" min={0} max={100} value={compareBlend} onChange={(event) => setCompareBlend(Number(event.target.value))} />
                    </label>
                  </div>
                )}
              </div>

              <div className="cam-panel__bottom-edit">
                <div className="cam-panel__section-head">
                  <span><Crop size={14} /> Edit Selected</span>
                  <small>{clipKind(selectedClip)} - {formatBytes(selectedClip.size)}</small>
                </div>
                <div className="cam-panel__clip-actions">
                  <button className="cam-panel__button" type="button" onClick={() => downloadClip(selectedClip)}>
                    <Download size={13} /> Download
                  </button>
                  <button className={`cam-panel__button ${selectedClip.favorite ? 'is-active' : ''}`} type="button" onClick={() => { void toggleSelectedClipFavorite(); }}>
                    <Star size={13} /> {selectedClip.favorite ? 'Favorited' : 'Favorite'}
                  </button>
                  <button className="cam-panel__button" type="button" onClick={() => selectClip(selectedClip)}>
                    <Play size={13} /> Reload
                  </button>
                  <button className="cam-panel__button" type="button" onClick={() => { void saveSelectedClipDetails(); }}>
                    <Save size={13} /> Save Details
                  </button>
                  <button className="cam-panel__button" type="button" disabled={busy} onClick={() => { void exportClipBundle([selectedClip]); }}>
                    <Archive size={13} /> Bundle
                  </button>
                  <button className="cam-panel__button cam-panel__button--danger" type="button" onClick={() => { void removeClip(selectedClip); }}>
                    <Trash2 size={13} /> Delete
                  </button>
                </div>
                <div className="cam-panel__detail">
                  <input className="cam-panel__input" value={clipDraftName} placeholder="Clip name" onChange={(event) => setClipDraftName(event.target.value)} />
                  <select className="cam-panel__input" value={clipDraftKind} onChange={(event) => setClipDraftKind(event.target.value as CameraClipKind)}>
                    <option value="clip">Video clip</option>
                    <option value="snapshot">Snapshot</option>
                    <option value="timelapse">Timelapse</option>
                    <option value="auto">Auto recording</option>
                  </select>
                  <input className="cam-panel__input" value={clipDraftJobName} placeholder="Job name" onChange={(event) => setClipDraftJobName(event.target.value)} />
                  <input className="cam-panel__input" value={clipDraftAlbum} placeholder="Album" list="camera-albums" onChange={(event) => setClipDraftAlbum(event.target.value)} />
                  <input className="cam-panel__input" value={clipDraftTags} placeholder="Tags, comma separated" onChange={(event) => setClipDraftTags(event.target.value)} />
                  <select className="cam-panel__input" value={clipDraftRating} onChange={(event) => setClipDraftRating(event.target.value as ClipRating)}>
                    {CLIP_RATINGS.map((rating) => <option key={rating} value={rating}>{rating}</option>)}
                  </select>
                  <textarea className="cam-panel__input" value={clipDraftNotes} placeholder="Notes" onChange={(event) => setClipDraftNotes(event.target.value)} />
                </div>
                <div className="cam-panel__checklist">
                  {INSPECTION_ITEMS.map((item) => (
                    <label key={item} className="cam-panel__toggle">
                      <input
                        type="checkbox"
                        checked={clipDraftChecklist.includes(item)}
                        onChange={() => toggleInspectionItem(item)}
                      />
                      <span>{item}</span>
                    </label>
                  ))}
                </div>
                <div className="cam-panel__issue-tools">
                  <select className="cam-panel__input" value={issueDraft} onChange={(event) => setIssueDraft(event.target.value as IssueTag)}>
                    {ISSUE_TAGS.map((issue) => <option key={issue} value={issue}>{issue}</option>)}
                  </select>
                  <button className="cam-panel__button" type="button" disabled={busy} onClick={() => { void applySelectedIssue(); }}>
                    <Flag size={13} /> Bookmark Issue
                  </button>
                  {clipIssueTags(selectedClip).map((issue) => <span key={issue}>{issue}</span>)}
                </div>
                {clipKind(selectedClip) === 'snapshot' ? (
                  <div className="cam-panel__snapshot-editor">
                    <div className="cam-panel__edit-tools">
                      <button className={`cam-panel__button ${snapshotEditFlip ? 'is-active' : ''}`} type="button" onClick={() => setSnapshotEditFlip((value) => !value)}>
                        <FlipHorizontal size={13} /> Flip
                      </button>
                      <button className="cam-panel__button" type="button" onClick={() => setSnapshotEditRotation((value) => (value + 90) % 360)}>
                        <RotateCw size={13} /> Rotate
                      </button>
                      <label className="cam-panel__toggle">
                        <input type="checkbox" checked={saveSnapshotAsCopy} onChange={(event) => setSaveSnapshotAsCopy(event.target.checked)} />
                        <span>Save as copy</span>
                      </label>
                    </div>
                    <div className="cam-panel__slider-grid">
                      <label>Crop X<input type="range" min={0} max={80} value={Math.round(snapshotCrop.x * 100)} onChange={(event) => setSnapshotCrop((crop) => ({ ...crop, x: Number(event.target.value) / 100 }))} /></label>
                      <label>Crop Y<input type="range" min={0} max={80} value={Math.round(snapshotCrop.y * 100)} onChange={(event) => setSnapshotCrop((crop) => ({ ...crop, y: Number(event.target.value) / 100 }))} /></label>
                      <label>Crop W<input type="range" min={20} max={100} value={Math.round(snapshotCrop.width * 100)} onChange={(event) => setSnapshotCrop((crop) => ({ ...crop, width: Number(event.target.value) / 100 }))} /></label>
                      <label>Crop H<input type="range" min={20} max={100} value={Math.round(snapshotCrop.height * 100)} onChange={(event) => setSnapshotCrop((crop) => ({ ...crop, height: Number(event.target.value) / 100 }))} /></label>
                      <label>Brightness<input type="range" min={50} max={160} value={snapshotBrightness} onChange={(event) => setSnapshotBrightness(Number(event.target.value))} /></label>
                      <label>Contrast<input type="range" min={50} max={180} value={snapshotContrast} onChange={(event) => setSnapshotContrast(Number(event.target.value))} /></label>
                      <label>Sharpen<input type="range" min={0} max={100} value={snapshotSharpen} onChange={(event) => setSnapshotSharpen(Number(event.target.value))} /></label>
                    </div>
                    <input className="cam-panel__input" value={snapshotAnnotation} placeholder="Annotation label / arrow note" onChange={(event) => setSnapshotAnnotation(event.target.value)} />
                    <button className="cam-panel__button" type="button" disabled={busy} onClick={() => { void saveSnapshotEdits(); }}>
                      <Crop size={13} /> Save Snapshot Edit
                    </button>
                  </div>
                ) : (
                  <div className="cam-panel__marker-editor">
                    <div className="cam-panel__settings-row">
                      <label>
                        Trim start
                        <input className="cam-panel__input" value={trimStart} placeholder="0:00" onChange={(event) => setTrimStart(event.target.value)} />
                      </label>
                      <label>
                        Trim end
                        <input className="cam-panel__input" value={trimEnd} placeholder={formatClipDuration(selectedClip.durationMs)} onChange={(event) => setTrimEnd(event.target.value)} />
                      </label>
                    </div>
                    <div className="cam-panel__edit-tools">
                      <button className="cam-panel__button" type="button" disabled={busy} onClick={() => { void saveTrimmedVideoCopy(); }}>
                        <Scissors size={13} /> Save Trim
                      </button>
                      <button className="cam-panel__button" type="button" disabled={busy} onClick={trimBetweenFirstTwoMarkers}>
                        <Flag size={13} /> Marker Trim
                      </button>
                      <button className="cam-panel__button" type="button" disabled={busy} onClick={() => { void makeTimelapseCopy(); }}>
                        <Copy size={13} /> Timelapse Copy
                      </button>
                    </div>
                    <div className="cam-panel__settings-row">
                      <label>
                        Marker
                        <input className="cam-panel__input" value={markerDraftLabel} placeholder="Label" onChange={(event) => setMarkerDraftLabel(event.target.value)} />
                      </label>
                      <label>
                        Time
                        <input className="cam-panel__input" value={markerDraftTime} placeholder="0:12" onChange={(event) => setMarkerDraftTime(event.target.value)} />
                      </label>
                    </div>
                    <button className="cam-panel__button" type="button" disabled={busy} onClick={() => { void addSelectedClipMarker(); }}>
                      <Flag size={13} /> Add Video Marker
                    </button>
                  </div>
                )}
                {(selectedClip.markers?.length ?? 0) > 0 && (
                  <div className="cam-panel__markers">
                    {selectedClip.markers?.map((marker) => (
                      <span key={marker.id}>
                        <Flag size={11} /> {marker.label} {formatClipDuration(marker.atMs)}
                        <button type="button" onClick={() => { void removeSelectedClipMarker(marker.id); }}>
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="cam-panel__meta">
                  saved {new Date(selectedClip.createdAt).toLocaleString()}
                  {selectedClip.editedAt ? ` - edited ${new Date(selectedClip.editedAt).toLocaleString()}` : ''}
                </div>
              </div>
            </>
          ) : (
            <div className="cam-panel__bottom-empty">
              <div>
                <FolderOpen size={18} />
                <span>Select saved media to edit it, or create a new capture from the live stream.</span>
              </div>
              <div className="cam-panel__empty-actions">
                <button className="cam-panel__button cam-panel__button--record" type="button" disabled={!hasCamera || busy} onClick={() => { void startRecording('clip'); }}>
                  <Video size={13} /> Record Clip
                </button>
                <button className="cam-panel__button" type="button" disabled={!hasCamera || busy || recording} onClick={() => { void captureSnapshot(); }}>
                  <Image size={13} /> Snapshot
                </button>
                <button className="cam-panel__button" type="button" onClick={() => setActiveControlSection('library')}>
                  <FolderOpen size={13} /> Open Library
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
