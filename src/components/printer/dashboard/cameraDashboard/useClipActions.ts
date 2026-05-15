/**
 * useClipActions — composer for every saved-clip operation the dashboard
 * exposes. The action surface is intentionally split into focused
 * sub-hooks so each call-site below maps to one concern:
 *
 *   • selection + URL lifecycle (selectClip)
 *   • destructive (removeClip, removeVisibleClips)
 *   • metadata mutations on `selectedClip` (details / favorite / issue /
 *     inspection / markers)
 *   • bulk-edit (applyBulkTags, cleanupOldClips, toggleBulkSelection)
 *   • video-only edits (useClipVideoActions: trim / timelapse copy /
 *     marker-to-marker trim)
 *   • snapshot editor (useSnapshotEditActions: rotate / flip / crop /
 *     adjust / annotate)
 *   • export & reporting (useClipExportActions: per-clip download,
 *     visible export, contact sheets, job reports, bundles)
 *
 * Re-exports the union as a single object so existing call sites in the
 * camera dashboard don't need to change.
 */
import { useCallback, type MutableRefObject } from 'react';
import {
  clipKind, deleteClip, formatClipDuration, saveClip,
  type CameraClip, type CameraClipKind, type ClipRating,
  type IssueTag, type SnapshotCrop,
} from './clipStore';
import {
  buildBulkClipUpdate, buildClipDetailsUpdate, buildClipMarker, buildClipWithMarker,
  buildClipWithoutMarker, buildFavoriteToggle, buildIssueTagUpdate,
} from './clipMutations';
import { useClipExportActions } from './useClipExportActions';
import { useClipVideoActions } from './useClipVideoActions';
import { useSnapshotEditActions } from './useSnapshotEditActions';

export interface UseClipActionsDeps {
  // Selected clip + its blob URL
  selectedClip: CameraClip | null;
  setSelectedClip: (clip: CameraClip | null) => void;
  setSelectedClipUrl: (url: string) => void;
  selectedClipUrlRef: MutableRefObject<string | null>;

  // Draft state for inline editor
  clipDraftName: string;
  clipDraftNotes: string;
  clipDraftKind: CameraClipKind;
  clipDraftJobName: string;
  clipDraftAlbum: string;
  clipDraftRating: ClipRating;
  clipDraftChecklist: string[];
  clipDraftTags: string;
  setClipDraftChecklist: (updater: (current: string[]) => string[]) => void;

  // Bulk selection
  setSelectedClipIds: (updater: (current: string[]) => string[]) => void;

  // Issue / inspection
  issueDraft: IssueTag;

  // Marker editor
  markerDraftLabel: string;
  markerDraftTime: string;
  setMarkerDraftLabel: (next: string) => void;
  setMarkerDraftTime: (next: string) => void;

  // Trim editor (video-only actions)
  trimStart: string;
  trimEnd: string;
  setTrimStart: (next: string) => void;
  setTrimEnd: (next: string) => void;

  // Snapshot editor
  saveSnapshotAsCopy: boolean;
  snapshotEditFlip: boolean;
  snapshotEditRotation: number;
  snapshotCrop: SnapshotCrop;
  snapshotBrightness: number;
  snapshotContrast: number;
  snapshotSharpen: number;
  snapshotAnnotation: string;
  setSnapshotEditFlip: (v: boolean) => void;
  setSnapshotEditRotation: (v: number) => void;
  setSnapshotCrop: (v: SnapshotCrop) => void;
  setSnapshotBrightness: (v: number) => void;
  setSnapshotContrast: (v: number) => void;
  setSnapshotSharpen: (v: number) => void;
  setSnapshotAnnotation: (v: string) => void;

  // Source lists
  clips: CameraClip[];
  visibleClips: CameraClip[];
  timelineClips: CameraClip[];
  timelineJobName: string;

  // Identifiers
  printerId: string;
  printerName: string;

  // UI plumbing
  setBusy: (busy: boolean) => void;
  setMessage: (msg: string) => void;
  refreshClips: () => Promise<void>;
}

export function useClipActions(deps: UseClipActionsDeps) {
  const {
    selectedClip, setSelectedClip, setSelectedClipUrl, selectedClipUrlRef,
    clipDraftName, clipDraftNotes, clipDraftKind, clipDraftJobName, clipDraftAlbum,
    clipDraftRating, clipDraftChecklist, clipDraftTags, setClipDraftChecklist,
    setSelectedClipIds,
    issueDraft,
    markerDraftLabel, markerDraftTime, setMarkerDraftLabel, setMarkerDraftTime,
    trimStart, trimEnd, setTrimStart, setTrimEnd,
    saveSnapshotAsCopy, snapshotEditFlip, snapshotEditRotation, snapshotCrop,
    snapshotBrightness, snapshotContrast, snapshotSharpen, snapshotAnnotation,
    setSnapshotEditFlip, setSnapshotEditRotation, setSnapshotCrop,
    setSnapshotBrightness, setSnapshotContrast, setSnapshotSharpen, setSnapshotAnnotation,
    clips, visibleClips, timelineClips, timelineJobName,
    printerId, printerName,
    setBusy, setMessage, refreshClips,
  } = deps;

  const selectClip = useCallback((clip: CameraClip) => {
    if (selectedClipUrlRef.current) {
      URL.revokeObjectURL(selectedClipUrlRef.current);
    }
    const url = URL.createObjectURL(clip.blob);
    selectedClipUrlRef.current = url;
    setSelectedClip(clip);
    setSelectedClipUrl(url);
  }, [selectedClipUrlRef, setSelectedClip, setSelectedClipUrl]);

  const removeClip = useCallback(async (clip: CameraClip) => {
    const ok = window.confirm('Delete this saved camera clip from local browser storage? This cannot be undone.');
    if (!ok) return;
    setBusy(true);
    try {
      await deleteClip(clip.id);
      if (selectedClip?.id === clip.id) {
        if (selectedClipUrlRef.current) {
          URL.revokeObjectURL(selectedClipUrlRef.current);
          selectedClipUrlRef.current = null;
        }
        setSelectedClip(null);
        setSelectedClipUrl('');
      }
      await refreshClips();
      setMessage('Deleted saved clip.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete saved clip.');
    } finally {
      setBusy(false);
    }
  }, [refreshClips, selectedClip?.id, selectedClipUrlRef, setBusy, setMessage, setSelectedClip, setSelectedClipUrl]);

  const removeVisibleClips = useCallback(async () => {
    if (visibleClips.length === 0) return;
    const ok = window.confirm(`Delete ${visibleClips.length} visible saved camera item${visibleClips.length === 1 ? '' : 's'} from local browser storage? This cannot be undone.`);
    if (!ok) return;
    setBusy(true);
    try {
      await Promise.all(visibleClips.map((clip) => deleteClip(clip.id)));
      if (selectedClip && visibleClips.some((clip) => clip.id === selectedClip.id)) {
        if (selectedClipUrlRef.current) {
          URL.revokeObjectURL(selectedClipUrlRef.current);
          selectedClipUrlRef.current = null;
        }
        setSelectedClip(null);
        setSelectedClipUrl('');
      }
      await refreshClips();
      setMessage('Deleted visible saved clips.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete saved clips.');
    } finally {
      setBusy(false);
    }
  }, [refreshClips, selectedClip, selectedClipUrlRef, setBusy, setMessage, setSelectedClip, setSelectedClipUrl, visibleClips]);

  const saveSelectedClipDetails = useCallback(async () => {
    if (!selectedClip) return;
    const updated = buildClipDetailsUpdate(selectedClip, {
      name: clipDraftName,
      notes: clipDraftNotes,
      kind: clipDraftKind,
      jobName: clipDraftJobName,
      album: clipDraftAlbum,
      rating: clipDraftRating,
      checklist: clipDraftChecklist,
      tags: clipDraftTags,
    });
    setBusy(true);
    try {
      await saveClip(updated);
      setSelectedClip(updated);
      await refreshClips();
      setMessage('Saved clip details.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save clip details.');
    } finally {
      setBusy(false);
    }
  }, [clipDraftAlbum, clipDraftChecklist, clipDraftJobName, clipDraftKind, clipDraftName, clipDraftNotes, clipDraftRating, clipDraftTags, refreshClips, selectedClip, setBusy, setMessage, setSelectedClip]);

  const toggleSelectedClipFavorite = useCallback(async () => {
    if (!selectedClip) return;
    const updated = buildFavoriteToggle(selectedClip);
    setBusy(true);
    try {
      await saveClip(updated);
      setSelectedClip(updated);
      await refreshClips();
      setMessage(updated.favorite ? 'Added saved camera item to favorites.' : 'Removed saved camera item from favorites.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update favorite.');
    } finally {
      setBusy(false);
    }
  }, [refreshClips, selectedClip, setBusy, setMessage, setSelectedClip]);

  const applySelectedIssue = useCallback(async () => {
    if (!selectedClip) return;
    const updated = buildIssueTagUpdate(selectedClip, issueDraft);
    setBusy(true);
    try {
      await saveClip(updated);
      setSelectedClip(updated);
      await refreshClips();
      setMessage(`Bookmarked selected media as ${issueDraft}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save issue bookmark.');
    } finally {
      setBusy(false);
    }
  }, [issueDraft, refreshClips, selectedClip, setBusy, setMessage, setSelectedClip]);

  const toggleInspectionItem = useCallback((item: string) => {
    setClipDraftChecklist((current) => (
      current.includes(item) ? current.filter((value) => value !== item) : [...current, item]
    ));
  }, [setClipDraftChecklist]);

  const toggleBulkSelection = useCallback((clipId: string) => {
    setSelectedClipIds((current) => (
      current.includes(clipId) ? current.filter((id) => id !== clipId) : [...current, clipId]
    ));
  }, [setSelectedClipIds]);

  const addSelectedClipMarker = useCallback(async () => {
    if (!selectedClip || clipKind(selectedClip) === 'snapshot') return;
    const marker = buildClipMarker(selectedClip, markerDraftTime, markerDraftLabel);
    const updated = buildClipWithMarker(selectedClip, marker);
    setBusy(true);
    try {
      await saveClip(updated);
      setSelectedClip(updated);
      setMarkerDraftLabel('');
      setMarkerDraftTime(formatClipDuration(marker.atMs));
      await refreshClips();
      setMessage('Added marker to saved video.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to add marker.');
    } finally {
      setBusy(false);
    }
  }, [markerDraftLabel, markerDraftTime, refreshClips, selectedClip, setBusy, setMarkerDraftLabel, setMarkerDraftTime, setMessage, setSelectedClip]);

  const removeSelectedClipMarker = useCallback(async (markerId: string) => {
    if (!selectedClip) return;
    const updated = buildClipWithoutMarker(selectedClip, markerId);
    setBusy(true);
    try {
      await saveClip(updated);
      setSelectedClip(updated);
      await refreshClips();
      setMessage('Removed saved marker.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to remove marker.');
    } finally {
      setBusy(false);
    }
  }, [refreshClips, selectedClip, setBusy, setMessage, setSelectedClip]);

  const applyBulkTags = useCallback(async (bulkTags: string, bulkAlbum: string) => {
    if (visibleClips.length === 0) return;
    setBusy(true);
    try {
      await Promise.all(visibleClips.map((clip) => saveClip(buildBulkClipUpdate(clip, bulkTags, bulkAlbum))));
      await refreshClips();
      setMessage('Updated visible camera items.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update visible camera items.');
    } finally {
      setBusy(false);
    }
  }, [refreshClips, setBusy, setMessage, visibleClips]);

  const cleanupOldClips = useCallback(async (cleanupDays: number) => {
    const cutoff = Date.now() - cleanupDays * 24 * 60 * 60 * 1000;
    const targets = clips.filter((clip) => !clip.favorite && clip.createdAt < cutoff);
    if (targets.length === 0) {
      setMessage('No non-favorite saved camera items match the cleanup rule.');
      return;
    }
    const ok = window.confirm(`Delete ${targets.length} non-favorite camera item${targets.length === 1 ? '' : 's'} older than ${cleanupDays} days? This cannot be undone.`);
    if (!ok) return;
    setBusy(true);
    try {
      await Promise.all(targets.map((clip) => deleteClip(clip.id)));
      await refreshClips();
      setMessage('Cleaned up old saved camera items.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to clean up saved camera items.');
    } finally {
      setBusy(false);
    }
  }, [clips, refreshClips, setBusy, setMessage]);

  const { saveTrimmedVideoCopy, makeTimelapseCopy, trimBetweenFirstTwoMarkers } = useClipVideoActions({
    selectedClip, trimStart, trimEnd, setTrimStart, setTrimEnd,
    setBusy, setMessage, refreshClips,
  });

  const { saveSnapshotEdits } = useSnapshotEditActions({
    selectedClip, setSelectedClip, setSelectedClipUrl, selectedClipUrlRef,
    saveSnapshotAsCopy, snapshotEditFlip, snapshotEditRotation, snapshotCrop,
    snapshotBrightness, snapshotContrast, snapshotSharpen, snapshotAnnotation,
    setSnapshotEditFlip, setSnapshotEditRotation, setSnapshotCrop,
    setSnapshotBrightness, setSnapshotContrast, setSnapshotSharpen, setSnapshotAnnotation,
    setBusy, setMessage, refreshClips,
  });

  const { downloadClip, exportVisibleClips, generateJobReport, generateContactSheet, exportClipBundle } = useClipExportActions({
    visibleClips, timelineClips, timelineJobName,
    printerId, printerName,
    setBusy, setMessage,
  });

  return {
    selectClip, downloadClip, exportVisibleClips, removeClip, removeVisibleClips,
    saveSelectedClipDetails, toggleSelectedClipFavorite,
    applySelectedIssue, toggleInspectionItem, toggleBulkSelection,
    generateJobReport, generateContactSheet, exportClipBundle,
    addSelectedClipMarker, removeSelectedClipMarker,
    saveTrimmedVideoCopy, makeTimelapseCopy, trimBetweenFirstTwoMarkers,
    applyBulkTags, cleanupOldClips, saveSnapshotEdits,
  };
}
