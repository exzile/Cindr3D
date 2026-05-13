import { describe, expect, it } from 'vitest';
import {
  clipAlbums,
  filterVisibleClips,
  selectCompareClip,
  sortedSnapshotClips,
  summarizeClipStorageByKind,
  summarizeClipStorageByJob,
  timelineClipsForJob,
  totalClipStorageBytes,
} from './clipLibrary';
import type { CameraClip, CameraClipKind } from './clipStore';

function clip({ id, createdAt, ...overrides }: Partial<CameraClip> & { id: string; createdAt: number }): CameraClip {
  const kind: CameraClipKind = overrides.kind ?? 'clip';
  return {
    id,
    printerId: 'printer-1',
    printerName: 'Printer',
    kind,
    createdAt,
    durationMs: kind === 'snapshot' ? 0 : 1200,
    mimeType: kind === 'snapshot' ? 'image/png' : 'video/webm',
    size: 100,
    blob: new Blob(['clip']),
    ...overrides,
  };
}

describe('clipLibrary selectors', () => {
  const clips = [
    clip({ id: 'a', createdAt: 1, kind: 'clip', size: 100, jobName: 'Case', favorite: true, tags: ['issue:Warping'] }),
    clip({ id: 'b', createdAt: 3, kind: 'snapshot', size: 300, album: 'Before' }),
    clip({ id: 'c', createdAt: 2, kind: 'auto', size: 200, jobName: 'Case', notes: 'Layer shift observed' }),
  ];

  it('summarizes clip storage by kind and job', () => {
    expect(totalClipStorageBytes(clips)).toBe(600);
    expect(summarizeClipStorageByKind(clips).clip).toEqual({ count: 1, size: 100 });
    expect(summarizeClipStorageByKind(clips).snapshot).toEqual({ count: 1, size: 300 });
    expect(summarizeClipStorageByJob(clips)[0]).toEqual({ name: 'Case', count: 2, size: 300 });
  });

  it('filters, sorts, and selects timeline media', () => {
    expect(clipAlbums(clips)).toEqual(['Before']);
    expect(filterVisibleClips(clips, 'issue', 'newest', '').map((item) => item.id)).toEqual(['a']);
    expect(filterVisibleClips(clips, 'all', 'largest', 'layer').map((item) => item.id)).toEqual(['c']);
    expect(timelineClipsForJob(clips, 'Case').map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('selects snapshot comparisons by explicit id or selected clip fallback', () => {
    const snapshots = sortedSnapshotClips([
      clip({ id: 'first', createdAt: 1, kind: 'snapshot' }),
      clip({ id: 'second', createdAt: 2, kind: 'snapshot' }),
    ]);

    expect(selectCompareClip(snapshots, 'first', 'second')?.id).toBe('first');
    expect(selectCompareClip(snapshots, '', 'second')?.id).toBe('first');
    expect(selectCompareClip(snapshots, '', 'first')?.id).toBe('second');
  });
});
