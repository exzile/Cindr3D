/**
 * Pure builders for saved camera clip edits. The panel persists the returned
 * clips; this module just centralizes the object transformations.
 */
import {
  clipLabel,
  parseClipDuration,
  type CameraClip,
  type CameraClipKind,
  type CameraMarker,
  type ClipRating,
  type IssueTag,
} from './clipStore';

export interface ClipDetailsDraft {
  name: string;
  notes: string;
  kind: CameraClipKind;
  jobName: string;
  album: string;
  rating: ClipRating;
  checklist: string[];
  tags: string;
}

export interface TrimmedClipResult {
  clip: CameraClip;
  startMs: number;
  endMs: number;
}

export function splitClipTags(tags: string): string[] {
  return tags.split(',').map((tag) => tag.trim()).filter(Boolean);
}

export function buildClipDetailsUpdate(selectedClip: CameraClip, draft: ClipDetailsDraft, editedAt = Date.now()): CameraClip {
  return {
    ...selectedClip,
    name: draft.name.trim() || undefined,
    notes: draft.notes.trim() || undefined,
    kind: draft.kind,
    jobName: draft.jobName.trim() || undefined,
    album: draft.album.trim() || undefined,
    rating: draft.rating === 'Unrated' ? undefined : draft.rating,
    checklist: draft.checklist.length ? draft.checklist : undefined,
    tags: splitClipTags(draft.tags),
    editedAt,
  };
}

export function buildFavoriteToggle(selectedClip: CameraClip, editedAt = Date.now()): CameraClip {
  return {
    ...selectedClip,
    favorite: !selectedClip.favorite,
    editedAt,
  };
}

export function buildIssueTagUpdate(selectedClip: CameraClip, issueDraft: IssueTag, editedAt = Date.now()): CameraClip {
  const issueTag = `issue:${issueDraft}`;
  return {
    ...selectedClip,
    tags: Array.from(new Set([...(selectedClip.tags ?? []), issueTag])),
    editedAt,
  };
}

export function buildClipMarker(selectedClip: CameraClip, markerDraftTime: string, markerDraftLabel: string, now = Date.now()): CameraMarker {
  return {
    id: `${now}`,
    atMs: Math.max(0, Math.min(selectedClip.durationMs, parseClipDuration(markerDraftTime))),
    label: markerDraftLabel.trim() || `Marker ${(selectedClip.markers?.length ?? 0) + 1}`,
  };
}

export function buildClipWithMarker(selectedClip: CameraClip, marker: CameraMarker, editedAt = Date.now()): CameraClip {
  return {
    ...selectedClip,
    markers: [...(selectedClip.markers ?? []), marker].sort((a, b) => a.atMs - b.atMs),
    editedAt,
  };
}

export function buildClipWithoutMarker(selectedClip: CameraClip, markerId: string, editedAt = Date.now()): CameraClip {
  return {
    ...selectedClip,
    markers: (selectedClip.markers ?? []).filter((marker) => marker.id !== markerId),
    editedAt,
  };
}

export function buildTrimmedVideoCopy(selectedClip: CameraClip, trimStart: string, trimEnd: string, now = Date.now()): TrimmedClipResult | null {
  const startMs = Math.max(0, parseClipDuration(trimStart));
  const parsedEndMs = trimEnd.trim() ? parseClipDuration(trimEnd) : selectedClip.durationMs;
  if (parsedEndMs <= startMs) return null;
  const endMs = Math.min(parsedEndMs, selectedClip.durationMs);
  return {
    startMs,
    endMs,
    clip: {
      ...selectedClip,
      id: `${selectedClip.id}-trim-${now}`,
      name: `${clipLabel(selectedClip)} trim`,
      trimStartMs: startMs,
      trimEndMs: endMs,
      durationMs: endMs - startMs,
      tags: Array.from(new Set([...(selectedClip.tags ?? []), 'trimmed'])),
      editedAt: now,
    },
  };
}

export function buildTimelapseCopy(selectedClip: CameraClip, now = Date.now()): CameraClip {
  return {
    ...selectedClip,
    id: `${selectedClip.id}-timelapse-${now}`,
    name: `${clipLabel(selectedClip)} timelapse`,
    kind: 'timelapse',
    tags: Array.from(new Set([...(selectedClip.tags ?? []), 'timelapse'])),
    editedAt: now,
  };
}

export function buildBulkClipUpdate(clip: CameraClip, bulkTags: string, bulkAlbum: string, editedAt = Date.now()): CameraClip {
  const tags = splitClipTags(bulkTags);
  return {
    ...clip,
    album: bulkAlbum.trim() || clip.album,
    tags: Array.from(new Set([...(clip.tags ?? []), ...tags])),
    editedAt,
  };
}
