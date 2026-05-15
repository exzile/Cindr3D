import {
  AlertTriangle, Archive, ChevronDown, ChevronUp, Eraser, FolderOpen,
  HardDrive, Image, RefreshCcw, Save, Search, Star, Tags, Trash2, Video, X,
} from 'lucide-react';
import { useState } from 'react';
import { formatBytes } from '../helpers';
import {
  clipKind, clipLabel,
  type CameraClip, type CameraClipKind, type ClipFilter, type ClipSort,
} from './clipStore';

interface StorageSummaryEntry { count: number; size: number }
interface StorageByJobEntry { name: string; count: number; size: number }

/**
 * Saved-clip library: filters, storage usage rollups, bulk-tag editor,
 * scrollable clip list with selection mode + favorites, and the collapsible
 * "Danger Zone" with cleanup / delete actions.
 *
 * Extracted from CameraDashboardPanel so the host can stay focused on
 * orchestrating state + the live viewer; this view is purely presentational
 * on top of state the host passes in.
 */
export function LibrarySection(props: {
  busy: boolean;
  refreshClips: () => Promise<void> | void;

  // Selection
  selectionMode: boolean;
  setSelectionMode: (updater: (value: boolean) => boolean) => void;
  selectedClipIds: string[];
  setSelectedClipIds: (next: string[]) => void;
  selectedBulkClips: CameraClip[];

  // Filter / sort / search
  clipQuery: string;
  setClipQuery: (next: string) => void;
  clipFilter: ClipFilter;
  setClipFilter: (next: ClipFilter) => void;
  clipSort: ClipSort;
  setClipSort: (next: ClipSort) => void;

  // Storage rollups
  totalStorageBytes: number;
  storageByKind: Record<CameraClipKind, StorageSummaryEntry>;
  storageByJob: StorageByJobEntry[];

  // Album autocomplete options (sourced from existing clips)
  albums: string[];

  // List sources
  clips: CameraClip[];
  visibleClips: CameraClip[];
  selectedClip: CameraClip | null;
  thumbUrls: Record<string, string>;

  // Actions
  applyBulkTags: (bulkTags: string, bulkAlbum: string) => Promise<void> | void;
  exportVisibleClips: () => void;
  exportClipBundle: (clips: CameraClip[]) => Promise<void> | void;
  generateContactSheet: (clips: CameraClip[]) => Promise<void> | void;
  generateJobReport: (clips: CameraClip[]) => void;
  selectClip: (clip: CameraClip) => void;
  toggleBulkSelection: (clipId: string) => void;
  removeClip: (clip: CameraClip) => Promise<void> | void;
  removeVisibleClips: () => Promise<void> | void;
  cleanupOldClips: (cleanupDays: number) => Promise<void> | void;
}) {
  const {
    busy, refreshClips,
    selectionMode, setSelectionMode, selectedClipIds, setSelectedClipIds, selectedBulkClips,
    clipQuery, setClipQuery, clipFilter, setClipFilter, clipSort, setClipSort,
    totalStorageBytes, storageByKind, storageByJob,
    albums,
    clips, visibleClips, selectedClip, thumbUrls,
    applyBulkTags, exportVisibleClips, exportClipBundle, generateContactSheet, generateJobReport,
    selectClip, toggleBulkSelection, removeClip, removeVisibleClips, cleanupOldClips,
  } = props;

  // Locally-owned input state — drafts for the bulk-tag editor + the
  // collapsible Danger Zone. Nothing else in the dashboard reads these.
  const [bulkTags, setBulkTags] = useState('');
  const [bulkAlbum, setBulkAlbum] = useState('');
  const [cleanupDays, setCleanupDays] = useState(30);
  const [dangerOpen, setDangerOpen] = useState(false);

  return (
    <section className="cam-panel__control-section cam-panel__control-section--library" aria-label="Saved camera library">
      <div className="cam-panel__library-head">
        <div className="cam-panel__library-title">
          <FolderOpen size={14} /> Saved Clips
        </div>
        <button className="cam-panel__button cam-panel__button--load" type="button" disabled={busy} onClick={() => { void refreshClips(); }}>
          <RefreshCcw size={12} /> Load
        </button>
      </div>

      <div className="cam-panel__selection-tools">
        <button className={`cam-panel__button ${selectionMode ? 'is-active' : ''}`} type="button" onClick={() => setSelectionMode((value) => !value)}>
          <Tags size={13} /> Select Media
        </button>
        <button className="cam-panel__button" type="button" disabled={!selectionMode || visibleClips.length === 0} onClick={() => setSelectedClipIds(visibleClips.map((clip) => clip.id))}>
          <Tags size={13} /> Select Visible
        </button>
        <button className="cam-panel__button" type="button" disabled={selectedClipIds.length === 0} onClick={() => setSelectedClipIds([])}>
          <X size={13} /> Clear {selectedClipIds.length}
        </button>
      </div>

      <div className="cam-panel__filter-row">
        <label className="cam-panel__search">
          <Search size={12} />
          <input
            type="search"
            value={clipQuery}
            placeholder="Search clips"
            onChange={(event) => setClipQuery(event.target.value)}
          />
        </label>
        <select className="cam-panel__select" value={clipFilter} onChange={(event) => setClipFilter(event.target.value as ClipFilter)}>
          <option value="all">All</option>
          <option value="clip">Clips</option>
          <option value="snapshot">Snapshots</option>
          <option value="timelapse">Timelapse</option>
          <option value="auto">Auto</option>
          <option value="job">With job</option>
          <option value="favorite">Favorites</option>
          <option value="album">Albums</option>
          <option value="issue">Issues</option>
        </select>
        <select className="cam-panel__select" value={clipSort} onChange={(event) => setClipSort(event.target.value as ClipSort)}>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="largest">Largest</option>
        </select>
      </div>

      <div className="cam-panel__storage" aria-label="Camera clip storage">
        <div>
          <HardDrive size={13} />
          <span>{formatBytes(totalStorageBytes)} local</span>
        </div>
        <div className="cam-panel__storage-bar"><span style={{ width: `${Math.min(100, totalStorageBytes / 5_000_000)}%` }} /></div>
      </div>

      <div className="cam-panel__storage-manager" aria-label="Camera storage manager">
        {(Object.keys(storageByKind) as CameraClipKind[]).map((kind) => (
          <div key={kind}>
            <span>{kind}</span>
            <strong>{storageByKind[kind].count}</strong>
            <em>{formatBytes(storageByKind[kind].size)}</em>
            <div><span style={{ width: `${totalStorageBytes ? Math.max(4, (storageByKind[kind].size / totalStorageBytes) * 100) : 0}%` }} /></div>
          </div>
        ))}
        {storageByJob.map((job) => (
          <div key={job.name}>
            <span>{job.name}</span>
            <strong>{job.count}</strong>
            <em>{formatBytes(job.size)}</em>
            <div><span style={{ width: `${totalStorageBytes ? Math.max(4, (job.size / totalStorageBytes) * 100) : 0}%` }} /></div>
          </div>
        ))}
      </div>

      <div className="cam-panel__bulk-tools">
        <input className="cam-panel__input" value={bulkAlbum} placeholder="Album for visible items" list="camera-albums" onChange={(event) => setBulkAlbum(event.target.value)} />
        <input className="cam-panel__input" value={bulkTags} placeholder="Bulk tags" onChange={(event) => setBulkTags(event.target.value)} />
        <button className="cam-panel__button" type="button" disabled={visibleClips.length === 0 || busy} onClick={() => { void applyBulkTags(bulkTags, bulkAlbum); }}>
          <Tags size={13} /> Apply to Visible
        </button>
        <button className="cam-panel__button" type="button" disabled={visibleClips.length === 0} onClick={exportVisibleClips}>
          <Archive size={13} /> Export Visible
        </button>
        <button className="cam-panel__button" type="button" disabled={visibleClips.length === 0 || busy} onClick={() => { void exportClipBundle(visibleClips); }}>
          <Archive size={13} /> Export Bundle
        </button>
        <button className="cam-panel__button" type="button" disabled={selectedBulkClips.length === 0 || busy} onClick={() => { void exportClipBundle(selectedBulkClips); }}>
          <Archive size={13} /> Export Selected
        </button>
        <button className="cam-panel__button" type="button" disabled={selectedBulkClips.length === 0 || busy} onClick={() => { void generateContactSheet(selectedBulkClips); }}>
          <Image size={13} /> Contact Sheet
        </button>
        <button className="cam-panel__button" type="button" disabled={selectedBulkClips.length === 0} onClick={() => generateJobReport(selectedBulkClips)}>
          <Save size={13} /> Report
        </button>
      </div>

      <datalist id="camera-albums">
        {albums.map((album) => <option key={album} value={album} />)}
      </datalist>

      <div className="cam-panel__clip-list" aria-label="Saved camera clips">
        {clips.length === 0 ? (
          <div className="cam-panel__note">Recorded clips save in this browser for the selected printer. Use Download to keep a file outside the app.</div>
        ) : visibleClips.length === 0 ? (
          <div className="cam-panel__note">No saved camera items match the current filter.</div>
        ) : visibleClips.map((clip) => (
          <button
            key={clip.id}
            className={`cam-panel__clip${selectedClip?.id === clip.id ? ' is-selected' : ''}`}
            type="button"
            onClick={() => {
              if (selectionMode) {
                toggleBulkSelection(clip.id);
                return;
              }
              selectClip(clip);
            }}
          >
            {selectionMode && (
              <input
                className="cam-panel__clip-check"
                type="checkbox"
                checked={selectedClipIds.includes(clip.id)}
                onChange={(event) => {
                  event.stopPropagation();
                  toggleBulkSelection(clip.id);
                }}
                onClick={(event) => event.stopPropagation()}
              />
            )}
            <span className="cam-panel__thumb">
              {thumbUrls[clip.id] ? <img src={thumbUrls[clip.id]} alt="" /> : clipKind(clip) === 'snapshot' ? <Image size={15} /> : <Video size={15} />}
            </span>
            <span className="cam-panel__clip-main">
              <span className="cam-panel__clip-name">
                {clip.favorite && <Star size={11} />}
                {clipLabel(clip)}
              </span>
              <span className="cam-panel__clip-size">{clip.jobName ? clip.jobName : formatBytes(clip.size)}</span>
            </span>
            <span className="cam-panel__clip-date">{new Date(clip.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
            <span className="cam-panel__clip-date">{new Date(clip.createdAt).toLocaleDateString()}</span>
          </button>
        ))}
      </div>

      <div className={`cam-panel__danger-zone${dangerOpen ? ' is-open' : ''}`}>
        <button className="cam-panel__danger-toggle" type="button" onClick={() => setDangerOpen((value) => !value)}>
          <AlertTriangle size={13} />
          <span>Danger Zone</span>
          {dangerOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {dangerOpen && (
          <div className="cam-panel__danger-actions">
            <label>
              Cleanup days
              <input className="cam-panel__input" type="number" min={1} value={cleanupDays} onChange={(event) => setCleanupDays(Math.max(1, Number(event.target.value) || 1))} />
            </label>
            <button className="cam-panel__button cam-panel__button--danger" type="button" disabled={busy} onClick={() => { void cleanupOldClips(cleanupDays); }}>
              <Eraser size={13} /> Cleanup Old
            </button>
            <button className="cam-panel__button cam-panel__button--danger" type="button" disabled={visibleClips.length === 0 || busy} onClick={() => { void removeVisibleClips(); }}>
              <Trash2 size={13} /> Delete Visible
            </button>
            <button className="cam-panel__button cam-panel__button--danger" type="button" disabled={selectedBulkClips.length === 0 || busy} onClick={() => { void Promise.all(selectedBulkClips.map((clip) => removeClip(clip))); }}>
              <Trash2 size={13} /> Delete Selected
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
