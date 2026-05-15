/**
 * useClipLibrary — owns the saved-clip list + every derived view of it:
 *
 *   • The raw `clips[]` + the async `refreshClips()` action
 *   • Filter / sort / search state (clipFilter, clipSort, clipQuery)
 *   • Bulk selection state (selectedClipIds, selectionMode)
 *   • Compare-mode state (compareClipId)
 *   • The currently-selected clip + its Blob URL + a stable URL ref
 *   • All 10 derived memos: total/per-kind/per-job storage rollups,
 *     albums, snapshotClips, compareClip, visibleClips (filter+sort+
 *     search applied), recentClips, timelineClips, selectedBulkClips
 *
 * The component still owns drafts + UI state; this hook centralises the
 * "what clips exist + how are they being viewed" concern so the host
 * stops being a 17-state god component for the clip library alone.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  loadClips,
  type CameraClip,
  type ClipFilter,
  type ClipSort,
} from './clipStore';
import {
  clipAlbums,
  filterVisibleClips,
  selectCompareClip,
  sortedSnapshotClips,
  summarizeClipStorageByJob,
  summarizeClipStorageByKind,
  timelineClipsForJob,
  totalClipStorageBytes,
} from './clipLibrary';

export interface UseClipLibraryDeps {
  printerId: string;
  /** Resolved on each call; nullable when no job is active. */
  jobFileName: string | undefined;
  /** Host-owned UI plumbing — busy / message updates propagate up. */
  setBusy: (busy: boolean) => void;
  setMessage: (msg: string) => void;
}

export function useClipLibrary(deps: UseClipLibraryDeps) {
  const { printerId, jobFileName, setBusy, setMessage } = deps;

  const [clips, setClips] = useState<CameraClip[]>([]);
  const [selectedClip, setSelectedClip] = useState<CameraClip | null>(null);
  const [selectedClipUrl, setSelectedClipUrl] = useState<string>('');
  const selectedClipUrlRef = useRef<string | null>(null);

  const [clipFilter, setClipFilter] = useState<ClipFilter>('all');
  const [clipSort, setClipSort] = useState<ClipSort>('newest');
  const [clipQuery, setClipQuery] = useState('');

  const [compareClipId, setCompareClipId] = useState('');
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);

  // Storage rollups
  const totalStorageBytes = useMemo(() => totalClipStorageBytes(clips), [clips]);
  const storageByKind = useMemo(() => summarizeClipStorageByKind(clips), [clips]);
  const storageByJob = useMemo(() => summarizeClipStorageByJob(clips), [clips]);

  // Curated views
  const albums = useMemo(() => clipAlbums(clips), [clips]);
  const snapshotClips = useMemo(() => sortedSnapshotClips(clips), [clips]);
  const compareClip = useMemo(
    () => selectCompareClip(snapshotClips, compareClipId, selectedClip?.id),
    [compareClipId, selectedClip?.id, snapshotClips],
  );
  const selectedBulkClips = useMemo(
    () => clips.filter((clip) => selectedClipIds.includes(clip.id)),
    [clips, selectedClipIds],
  );
  const visibleClips = useMemo(
    () => filterVisibleClips(clips, clipFilter, clipSort, clipQuery),
    [clipFilter, clipQuery, clipSort, clips],
  );
  const recentClips = useMemo(() => clips.slice(0, 6), [clips]);

  // Per-job timeline (current job, falls back to the selected clip's job).
  const timelineJobName = jobFileName || selectedClip?.jobName || '';
  const timelineClips = useMemo(
    () => timelineClipsForJob(clips, timelineJobName),
    [clips, timelineJobName],
  );

  const refreshClips = useCallback(async () => {
    setBusy(true);
    try {
      setClips(await loadClips(printerId));
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load saved clips.');
    } finally {
      setBusy(false);
    }
  }, [printerId, setBusy, setMessage]);

  // Initial load — fetches whenever the printer changes (refreshClips
  // captures printerId in its closure).
  useEffect(() => {
    void refreshClips();
  }, [refreshClips]);

  // Final cleanup — drop any in-flight selected-clip blob URL when the
  // component unmounts so the browser can collect the underlying Blob.
  useEffect(() => () => {
    if (selectedClipUrlRef.current) {
      URL.revokeObjectURL(selectedClipUrlRef.current);
      selectedClipUrlRef.current = null;
    }
  }, []);

  return {
    // State + setters
    clips, setClips,
    selectedClip, setSelectedClip,
    selectedClipUrl, setSelectedClipUrl,
    selectedClipUrlRef,
    clipFilter, setClipFilter,
    clipSort, setClipSort,
    clipQuery, setClipQuery,
    compareClipId, setCompareClipId,
    selectedClipIds, setSelectedClipIds,
    selectionMode, setSelectionMode,
    // Derived
    totalStorageBytes, storageByKind, storageByJob,
    albums, snapshotClips, compareClip,
    selectedBulkClips, visibleClips, recentClips,
    timelineJobName, timelineClips,
    // Actions
    refreshClips,
  };
}
