/**
 * useSnapshotEditActions — applies the live snapshot-edit draft
 * (rotation, flip, crop, brightness/contrast/sharpen, annotation) to the
 * selected snapshot clip and writes the result back to the clip store —
 * either in place or as a new copy.
 *
 * Pulled out of useClipActions so the heavy edit pipeline lives next to
 * its own deps (every snapshot* setter), and so the parent hook can
 * stay focused on selection + metadata mutations.
 */
import { useCallback, type MutableRefObject } from 'react';
import { clipKind, clipLabel, saveClip, type CameraClip, type SnapshotCrop } from './clipStore';
import { defaultCrop, transformSnapshotBlob } from './snapshotEdit';

export interface UseSnapshotEditActionsDeps {
  selectedClip: CameraClip | null;
  setSelectedClip: (clip: CameraClip | null) => void;
  setSelectedClipUrl: (url: string) => void;
  selectedClipUrlRef: MutableRefObject<string | null>;

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

  setBusy: (busy: boolean) => void;
  setMessage: (msg: string) => void;
  refreshClips: () => Promise<void>;
}

export function useSnapshotEditActions(deps: UseSnapshotEditActionsDeps) {
  const {
    selectedClip, setSelectedClip, setSelectedClipUrl, selectedClipUrlRef,
    saveSnapshotAsCopy, snapshotEditFlip, snapshotEditRotation, snapshotCrop,
    snapshotBrightness, snapshotContrast, snapshotSharpen, snapshotAnnotation,
    setSnapshotEditFlip, setSnapshotEditRotation, setSnapshotCrop,
    setSnapshotBrightness, setSnapshotContrast, setSnapshotSharpen, setSnapshotAnnotation,
    setBusy, setMessage, refreshClips,
  } = deps;

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

  return { saveSnapshotEdits };
}
