/**
 * useClipVideoActions — saved-video-only operations that don't apply to
 * snapshots: writing a trimmed reference, making a "timelapse" copy of
 * an existing video clip, and pre-filling the trim editor with the gap
 * between the first two markers.
 */
import { useCallback } from 'react';
import {
  clipKind, formatClipDuration, saveClip,
  type CameraClip,
} from './clipStore';
import { buildTimelapseCopy, buildTrimmedVideoCopy } from './clipMutations';

export interface UseClipVideoActionsDeps {
  selectedClip: CameraClip | null;
  trimStart: string;
  trimEnd: string;
  setTrimStart: (next: string) => void;
  setTrimEnd: (next: string) => void;
  setBusy: (busy: boolean) => void;
  setMessage: (msg: string) => void;
  refreshClips: () => Promise<void>;
}

export function useClipVideoActions(deps: UseClipVideoActionsDeps) {
  const {
    selectedClip, trimStart, trimEnd, setTrimStart, setTrimEnd,
    setBusy, setMessage, refreshClips,
  } = deps;

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

  return { saveTrimmedVideoCopy, makeTimelapseCopy, trimBetweenFirstTwoMarkers };
}
