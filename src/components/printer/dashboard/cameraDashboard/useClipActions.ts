/**
 * useClipActions — every saved-clip operation the dashboard exposes:
 *
 *   Selection:
 *     • selectClip
 *
 *   Single-clip mutations on `selectedClip`:
 *     • saveSelectedClipDetails (name/notes/kind/job/album/rating/checklist/tags)
 *     • toggleSelectedClipFavorite
 *     • applySelectedIssue
 *     • addSelectedClipMarker / removeSelectedClipMarker
 *     • saveTrimmedVideoCopy / makeTimelapseCopy / trimBetweenFirstTwoMarkers
 *     • saveSnapshotEdits (rotation/flip/crop/brightness/contrast/sharpen/annotation)
 *     • removeClip
 *
 *   Multi-clip / library:
 *     • downloadClip / exportVisibleClips / removeVisibleClips
 *     • applyBulkTags / cleanupOldClips
 *     • generateJobReport / generateContactSheet / exportClipBundle
 *     • toggleInspectionItem / toggleBulkSelection
 *
 * Big deps surface because the parent owns all the draft state for the
 * inline editor + the bulk-edit fields; passing them in keeps the hook
 * stateless and the parent's React tree the single source of truth.
 */
import { useCallback, type MutableRefObject } from 'react';
import {
  clipKind, clipLabel, deleteClip, formatClipDuration, saveClip,
  type CameraClip, type CameraClipKind, type CameraMarker, type ClipRating,
  type IssueTag, type SnapshotCrop,
} from './clipStore';
import {
  buildBulkClipUpdate, buildClipDetailsUpdate, buildClipMarker, buildClipWithMarker,
  buildClipWithoutMarker, buildFavoriteToggle, buildIssueTagUpdate,
  buildTimelapseCopy, buildTrimmedVideoCopy,
} from './clipMutations';
import {
  downloadClipBlob, downloadClipBundle, downloadClipManifest,
  downloadContactSheet, downloadJobReport,
} from './clipExport';
import { defaultCrop, transformSnapshotBlob } from './snapshotEdit';

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

  // Trim editor
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

  // Bulk edit
  bulkTags: string;
  bulkAlbum: string;
  cleanupDays: number;

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
    bulkTags, bulkAlbum, cleanupDays,
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

  const downloadClip = useCallback((clip: CameraClip) => {
    downloadClipBlob(clip);
  }, []);

  const exportVisibleClips = useCallback(() => {
    visibleClips.forEach(downloadClip);
    downloadClipManifest(visibleClips);
  }, [downloadClip, visibleClips]);

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

  const generateJobReport = useCallback((clipsToReport: CameraClip[]) => {
    const reportClips = clipsToReport.length ? clipsToReport : timelineClips;
    downloadJobReport(reportClips, printerName, timelineJobName);
    setMessage('Generated camera job report.');
  }, [printerName, setMessage, timelineClips, timelineJobName]);

  const generateContactSheet = useCallback(async (clipsToUse: CameraClip[]) => {
    const snapshots = clipsToUse.filter((clip) => clipKind(clip) === 'snapshot');
    if (snapshots.length === 0) {
      setMessage('Select one or more snapshots before generating a contact sheet.');
      return;
    }
    setBusy(true);
    try {
      await downloadContactSheet(snapshots, printerName);
      setMessage(`Generated contact sheet with ${snapshots.length} snapshot${snapshots.length === 1 ? '' : 's'}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to generate contact sheet.');
    } finally {
      setBusy(false);
    }
  }, [printerName, setBusy, setMessage]);

  const exportClipBundle = useCallback(async (clipsToExport: CameraClip[]) => {
    if (clipsToExport.length === 0) return;
    setBusy(true);
    try {
      await downloadClipBundle(clipsToExport, printerId, printerName);
      setMessage(`Exported ${clipsToExport.length} camera item${clipsToExport.length === 1 ? '' : 's'} as a bundle.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to export camera bundle.');
    } finally {
      setBusy(false);
    }
  }, [printerId, printerName, setBusy, setMessage]);

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

  const saveTrimmedVideoCopy = useCallback(async () => {
    if (!selectedClip || clipKind(selectedClip) === 'snapshot') return;
    const result = buildTrimmedVideoCopy(selectedClip, trimStart, trimEnd);
    if (!result) {
      setMessage('Trim end must be after trim start.');
      return;
    }
    setBusy(true);
    try {
      await saveClip(result.clip);
      await refreshClips();
      setMessage('Saved trimmed video reference. Export includes trim metadata for the selected segment.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save trimmed video.');
    } finally {
      setBusy(false);
    }
  }, [refreshClips, selectedClip, setBusy, setMessage, trimEnd, trimStart]);

  const makeTimelapseCopy = useCallback(async () => {
    if (!selectedClip || clipKind(selectedClip) === 'snapshot') return;
    const updated = buildTimelapseCopy(selectedClip);
    setBusy(true);
    try {
      await saveClip(updated);
      await refreshClips();
      setMessage('Saved timelapse version.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save timelapse version.');
    } finally {
      setBusy(false);
    }
  }, [refreshClips, selectedClip, setBusy, setMessage]);

  const trimBetweenFirstTwoMarkers = useCallback(async () => {
    if (!selectedClip || clipKind(selectedClip) === 'snapshot') return;
    const markers = [...(selectedClip.markers ?? [])].sort((a, b) => a.atMs - b.atMs);
    if (markers.length < 2) {
      setMessage('Add at least two markers before trimming marker-to-marker.');
      return;
    }
    setTrimStart(formatClipDuration(markers[0].atMs));
    setTrimEnd(formatClipDuration(markers[1].atMs));
    setMessage(`Prepared trim from ${markers[0].label} to ${markers[1].label}.`);
  }, [selectedClip, setMessage, setTrimEnd, setTrimStart]);

  const applyBulkTags = useCallback(async () => {
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
  }, [bulkAlbum, bulkTags, refreshClips, setBusy, setMessage, visibleClips]);

  const cleanupOldClips = useCallback(async () => {
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
  }, [cleanupDays, clips, refreshClips, setBusy, setMessage]);

  const saveSnapshotEdits = useCallback(async () => {
    if (!selectedClip || clipKind(selectedClip) !== 'snapshot') return;
    const cropChanged = snapshotCrop.x !== 0 || snapshotCrop.y !== 0 || snapshotCrop.width !== 1 || snapshotCrop.height !== 1;
    const hasAdjustments = snapshotBrightness !== 100 || snapshotContrast !== 100 || snapshotSharpen > 0 || Boolean(snapshotAnnotation.trim());
    if (!snapshotEditFlip && snapshotEditRotation === 0 && !cropChanged && !hasAdjustments) {
      setMessage('No snapshot edits to save.');
      return;
    }
    setBusy(true);
    try {
      const blob = await transformSnapshotBlob(
        selectedClip.blob,
        snapshotEditRotation,
        snapshotEditFlip,
        snapshotCrop,
        snapshotBrightness,
        snapshotContrast,
        snapshotSharpen,
        snapshotAnnotation,
      );
      const now = Date.now();
      const updated: CameraClip = {
        ...selectedClip,
        id: saveSnapshotAsCopy ? `${selectedClip.id}-edit-${now}` : selectedClip.id,
        name: saveSnapshotAsCopy ? `${clipLabel(selectedClip)} edit` : selectedClip.name,
        blob,
        thumbnailBlob: blob,
        mimeType: blob.type || 'image/png',
        size: blob.size,
        snapshotAdjustments: {
          brightness: snapshotBrightness,
          contrast: snapshotContrast,
          sharpen: snapshotSharpen,
          crop: snapshotCrop,
          annotation: snapshotAnnotation.trim(),
        },
        editedAt: now,
      };
      await saveClip(updated);
      if (selectedClipUrlRef.current) {
        URL.revokeObjectURL(selectedClipUrlRef.current);
      }
      const url = URL.createObjectURL(updated.blob);
      selectedClipUrlRef.current = url;
      setSelectedClip(updated);
      setSelectedClipUrl(url);
      setSnapshotEditFlip(false);
      setSnapshotEditRotation(0);
      setSnapshotCrop(defaultCrop());
      setSnapshotBrightness(100);
      setSnapshotContrast(100);
      setSnapshotSharpen(0);
      setSnapshotAnnotation('');
      await refreshClips();
      setMessage(saveSnapshotAsCopy ? 'Saved edited snapshot as a copy.' : 'Saved edited snapshot.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save edited snapshot.');
    } finally {
      setBusy(false);
    }
  }, [
    refreshClips, saveSnapshotAsCopy, selectedClip, selectedClipUrlRef,
    setBusy, setMessage, setSelectedClip, setSelectedClipUrl,
    setSnapshotAnnotation, setSnapshotBrightness, setSnapshotContrast, setSnapshotCrop,
    setSnapshotEditFlip, setSnapshotEditRotation, setSnapshotSharpen,
    snapshotAnnotation, snapshotBrightness, snapshotContrast, snapshotCrop,
    snapshotEditFlip, snapshotEditRotation, snapshotSharpen,
  ]);

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
