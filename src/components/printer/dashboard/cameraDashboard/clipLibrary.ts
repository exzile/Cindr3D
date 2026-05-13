/**
 * Pure clip-library selectors for the camera dashboard. These keep the panel
 * from owning every storage/filter/sort detail directly.
 */
import {
  clipIssueTags,
  clipKind,
  clipLabel,
  type CameraClip,
  type CameraClipKind,
  type ClipFilter,
  type ClipSort,
} from './clipStore';

export interface ClipStorageSummary {
  count: number;
  size: number;
}

export interface ClipJobStorageSummary extends ClipStorageSummary {
  name: string;
}

export function clipStorageSize(clip: CameraClip): number {
  return clip.size + (clip.thumbnailBlob?.size ?? 0);
}

export function totalClipStorageBytes(clips: CameraClip[]): number {
  return clips.reduce((sum, clip) => sum + clipStorageSize(clip), 0);
}

export function summarizeClipStorageByKind(clips: CameraClip[]): Record<CameraClipKind, ClipStorageSummary> {
  return clips.reduce<Record<CameraClipKind, ClipStorageSummary>>((acc, clip) => {
    const kind = clipKind(clip);
    acc[kind].count += 1;
    acc[kind].size += clipStorageSize(clip);
    return acc;
  }, {
    auto: { count: 0, size: 0 },
    clip: { count: 0, size: 0 },
    snapshot: { count: 0, size: 0 },
    timelapse: { count: 0, size: 0 },
  });
}

export function summarizeClipStorageByJob(clips: CameraClip[], limit = 4): ClipJobStorageSummary[] {
  const grouped = new Map<string, ClipStorageSummary>();
  clips.forEach((clip) => {
    const key = clip.jobName || 'No job';
    const current = grouped.get(key) ?? { count: 0, size: 0 };
    current.count += 1;
    current.size += clipStorageSize(clip);
    grouped.set(key, current);
  });

  return Array.from(grouped.entries())
    .map(([name, value]) => ({ name, ...value }))
    .sort((a, b) => b.size - a.size)
    .slice(0, limit);
}

export function clipAlbums(clips: CameraClip[]): string[] {
  return Array.from(new Set(clips.map((clip) => clip.album?.trim()).filter(Boolean) as string[])).sort();
}

export function sortedSnapshotClips(clips: CameraClip[]): CameraClip[] {
  return clips.filter((clip) => clipKind(clip) === 'snapshot').sort((a, b) => b.createdAt - a.createdAt);
}

export function selectCompareClip(snapshotClips: CameraClip[], compareClipId: string, selectedClipId?: string): CameraClip | null {
  return snapshotClips.find((clip) => clip.id === compareClipId)
    ?? snapshotClips.find((clip) => clip.id !== selectedClipId)
    ?? null;
}

export function filterVisibleClips(
  clips: CameraClip[],
  clipFilter: ClipFilter,
  clipSort: ClipSort,
  clipQuery: string,
): CameraClip[] {
  const query = clipQuery.trim().toLowerCase();
  return clips
    .filter((clip) => {
      const kind = clipKind(clip);
      const matchesFilter = clipFilter === 'all'
        || kind === clipFilter
        || (clipFilter === 'job' && Boolean(clip.jobName))
        || (clipFilter === 'favorite' && Boolean(clip.favorite))
        || (clipFilter === 'album' && Boolean(clip.album))
        || (clipFilter === 'issue' && clipIssueTags(clip).length > 0);
      if (!matchesFilter) return false;
      if (!query) return true;
      const haystack = [
        clipLabel(clip),
        clip.jobName,
        clip.album,
        clip.notes,
        ...(clip.tags ?? []),
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => {
      if (clipSort === 'oldest') return a.createdAt - b.createdAt;
      if (clipSort === 'largest') return b.size - a.size;
      return b.createdAt - a.createdAt;
    });
}

export function timelineClipsForJob(clips: CameraClip[], timelineJobName: string): CameraClip[] {
  const source = timelineJobName ? clips.filter((clip) => clip.jobName === timelineJobName) : clips.slice(0, 12);
  return [...source].sort((a, b) => a.createdAt - b.createdAt).slice(-16);
}
