/**
 * useClipDraftSync — keeps the inline-editor draft state in lockstep with
 * the currently-selected clip. When a new clip is selected (or the selection
 * clears), every draft field — name, tags, kind, job/album, rating,
 * checklist, marker time/label, snapshot edits, trim start/end — is
 * re-seeded from the clip (or reset to defaults).
 *
 * Pulled out of the host so the 40-line setter cascade lives alongside the
 * other clip-related orchestration in `cameraDashboard/`.
 */
import { useEffect } from 'react';
import { clipKind, formatClipDuration, type CameraClip, type CameraClipKind, type ClipRating, type SnapshotCrop } from './clipStore';
import { defaultCrop } from './snapshotEdit';

export interface UseClipDraftSyncDeps {
  selectedClip: CameraClip | null;

  setClipDraftName: (v: string) => void;
  setClipDraftNotes: (v: string) => void;
  setClipDraftTags: (v: string) => void;
  setClipDraftJobName: (v: string) => void;
  setClipDraftAlbum: (v: string) => void;
  setClipDraftKind: (v: CameraClipKind) => void;
  setClipDraftRating: (v: ClipRating) => void;
  setClipDraftChecklist: (v: string[]) => void;

  setMarkerDraftLabel: (v: string) => void;
  setMarkerDraftTime: (v: string) => void;

  setSnapshotEditFlip: (v: boolean) => void;
  setSnapshotEditRotation: (v: number) => void;
  setSnapshotCrop: (v: SnapshotCrop) => void;
  setSnapshotBrightness: (v: number) => void;
  setSnapshotContrast: (v: number) => void;
  setSnapshotSharpen: (v: number) => void;
  setSnapshotAnnotation: (v: string) => void;

  setTrimStart: (v: string) => void;
  setTrimEnd: (v: string) => void;
}

export function useClipDraftSync(deps: UseClipDraftSyncDeps) {
  const {
    selectedClip,
    setClipDraftName, setClipDraftNotes, setClipDraftTags,
    setClipDraftJobName, setClipDraftAlbum, setClipDraftKind, setClipDraftRating,
    setClipDraftChecklist,
    setMarkerDraftLabel, setMarkerDraftTime,
    setSnapshotEditFlip, setSnapshotEditRotation, setSnapshotCrop,
    setSnapshotBrightness, setSnapshotContrast, setSnapshotSharpen, setSnapshotAnnotation,
    setTrimStart, setTrimEnd,
  } = deps;

  useEffect(() => {
    if (!selectedClip) {
      setClipDraftName('');
      setClipDraftNotes('');
      setClipDraftTags('');
      setClipDraftJobName('');
      setClipDraftAlbum('');
      setClipDraftKind('clip');
      setClipDraftRating('Unrated');
      setClipDraftChecklist([]);
      setMarkerDraftLabel('');
      setMarkerDraftTime('0:00');
      setSnapshotEditFlip(false);
      setSnapshotEditRotation(0);
      setSnapshotCrop(defaultCrop());
      setSnapshotBrightness(100);
      setSnapshotContrast(100);
      setSnapshotSharpen(0);
      setSnapshotAnnotation('');
      setTrimStart('0:00');
      setTrimEnd('');
      return;
    }
    setClipDraftName(selectedClip.name ?? '');
    setClipDraftNotes(selectedClip.notes ?? '');
    setClipDraftTags((selectedClip.tags ?? []).join(', '));
    setClipDraftJobName(selectedClip.jobName ?? '');
    setClipDraftAlbum(selectedClip.album ?? '');
    setClipDraftKind(clipKind(selectedClip));
    setClipDraftRating(selectedClip.rating ?? 'Unrated');
    setClipDraftChecklist(selectedClip.checklist ?? []);
    setMarkerDraftLabel('');
    setMarkerDraftTime('0:00');
    setSnapshotEditFlip(false);
    setSnapshotEditRotation(0);
    setSnapshotCrop(selectedClip.snapshotAdjustments?.crop ?? defaultCrop());
    setSnapshotBrightness(selectedClip.snapshotAdjustments?.brightness ?? 100);
    setSnapshotContrast(selectedClip.snapshotAdjustments?.contrast ?? 100);
    setSnapshotSharpen(selectedClip.snapshotAdjustments?.sharpen ?? 0);
    setSnapshotAnnotation(selectedClip.snapshotAdjustments?.annotation ?? '');
    setTrimStart(formatClipDuration(selectedClip.trimStartMs ?? 0));
    setTrimEnd(selectedClip.trimEndMs ? formatClipDuration(selectedClip.trimEndMs) : '');
  // The setters are stable; only the selectedClip identity should drive re-sync.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClip]);
}
