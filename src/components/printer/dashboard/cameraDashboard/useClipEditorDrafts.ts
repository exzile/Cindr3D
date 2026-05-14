/**
 * useClipEditorDrafts — every "draft" form field the clip editor exposes
 * (the snapshot adjustments, the trim points, the inline metadata form,
 * the marker inputs, the issue tag picker) plus the auto-reset effect
 * that re-hydrates all 24 drafts whenever the selected clip changes.
 *
 * The host used to declare 24 separate `useState` calls + a 50-line
 * setter cascade in a `useEffect`. This hook collapses that into a single
 * call returning { state, setters }.
 *
 * Replaces the previous `useClipDraftSync` hook (which only owned the
 * reset effect): the drafts and their re-hydration are one concern, so
 * they belong in one module.
 */
import { useEffect, useState } from 'react';
import {
  clipKind, formatClipDuration,
  type CameraClip, type CameraClipKind, type ClipRating, type IssueTag, type SnapshotCrop,
} from './clipStore';
import { defaultCrop } from './snapshotEdit';

export function useClipEditorDrafts(selectedClip: CameraClip | null) {
  // Detail form (name + notes + tags + job + album + kind + rating + checklist)
  const [clipDraftName, setClipDraftName] = useState('');
  const [clipDraftNotes, setClipDraftNotes] = useState('');
  const [clipDraftTags, setClipDraftTags] = useState('');
  const [clipDraftJobName, setClipDraftJobName] = useState('');
  const [clipDraftAlbum, setClipDraftAlbum] = useState('');
  const [clipDraftKind, setClipDraftKind] = useState<CameraClipKind>('clip');
  const [clipDraftRating, setClipDraftRating] = useState<ClipRating>('Unrated');
  const [clipDraftChecklist, setClipDraftChecklist] = useState<string[]>([]);

  // Issue bookmark picker
  const [issueDraft, setIssueDraft] = useState<IssueTag>('Warping');

  // Marker editor (video clips only)
  const [markerDraftLabel, setMarkerDraftLabel] = useState('');
  const [markerDraftTime, setMarkerDraftTime] = useState('0:00');

  // Snapshot editor (image clips only)
  const [snapshotEditFlip, setSnapshotEditFlip] = useState(false);
  const [snapshotEditRotation, setSnapshotEditRotation] = useState(0);
  const [snapshotCrop, setSnapshotCrop] = useState<SnapshotCrop>(() => defaultCrop());
  const [snapshotBrightness, setSnapshotBrightness] = useState(100);
  const [snapshotContrast, setSnapshotContrast] = useState(100);
  const [snapshotSharpen, setSnapshotSharpen] = useState(0);
  const [snapshotAnnotation, setSnapshotAnnotation] = useState('');
  const [saveSnapshotAsCopy, setSaveSnapshotAsCopy] = useState(true);

  // Trim editor (video clips only)
  const [trimStart, setTrimStart] = useState('0:00');
  const [trimEnd, setTrimEnd] = useState('');

  // Re-hydrate every draft when the user picks a new clip (or clears it).
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
    // setters are stable; only the selected clip identity drives re-sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClip]);

  return {
    clipDraftName, setClipDraftName,
    clipDraftNotes, setClipDraftNotes,
    clipDraftTags, setClipDraftTags,
    clipDraftJobName, setClipDraftJobName,
    clipDraftAlbum, setClipDraftAlbum,
    clipDraftKind, setClipDraftKind,
    clipDraftRating, setClipDraftRating,
    clipDraftChecklist, setClipDraftChecklist,
    issueDraft, setIssueDraft,
    markerDraftLabel, setMarkerDraftLabel,
    markerDraftTime, setMarkerDraftTime,
    snapshotEditFlip, setSnapshotEditFlip,
    snapshotEditRotation, setSnapshotEditRotation,
    snapshotCrop, setSnapshotCrop,
    snapshotBrightness, setSnapshotBrightness,
    snapshotContrast, setSnapshotContrast,
    snapshotSharpen, setSnapshotSharpen,
    snapshotAnnotation, setSnapshotAnnotation,
    saveSnapshotAsCopy, setSaveSnapshotAsCopy,
    trimStart, setTrimStart,
    trimEnd, setTrimEnd,
  };
}
