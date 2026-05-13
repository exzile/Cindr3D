import { describe, expect, it } from 'vitest';
import {
  buildBulkClipUpdate,
  buildClipDetailsUpdate,
  buildClipMarker,
  buildClipWithMarker,
  buildClipWithoutMarker,
  buildFavoriteToggle,
  buildIssueTagUpdate,
  buildTimelapseCopy,
  buildTrimmedVideoCopy,
  splitClipTags,
} from './clipMutations';
import type { CameraClip } from './clipStore';

function clip(overrides: Partial<CameraClip> = {}): CameraClip {
  return {
    id: 'clip-1',
    printerId: 'printer-1',
    printerName: 'Printer',
    kind: 'clip',
    createdAt: 1,
    durationMs: 120000,
    mimeType: 'video/webm',
    size: 100,
    blob: new Blob(['camera']),
    ...overrides,
  };
}

describe('clipMutations', () => {
  it('builds details, favorite, and issue updates', () => {
    expect(splitClipTags(' alpha, , beta ')).toEqual(['alpha', 'beta']);

    const details = buildClipDetailsUpdate(clip(), {
      name: ' First layer ',
      notes: ' Looks good ',
      kind: 'auto',
      jobName: ' case.gcode ',
      album: ' QA ',
      rating: 'Good',
      checklist: ['Surface'],
      tags: 'issue:Warping, first-layer',
    }, 10);

    expect(details).toMatchObject({
      name: 'First layer',
      notes: 'Looks good',
      kind: 'auto',
      jobName: 'case.gcode',
      album: 'QA',
      rating: 'Good',
      checklist: ['Surface'],
      tags: ['issue:Warping', 'first-layer'],
      editedAt: 10,
    });
    expect(buildFavoriteToggle(clip({ favorite: false }), 11).favorite).toBe(true);
    expect(buildIssueTagUpdate(clip({ tags: ['issue:Warping'] }), 'Warping', 12).tags).toEqual(['issue:Warping']);
  });

  it('builds sorted marker updates', () => {
    const selected = clip({ markers: [{ id: 'late', atMs: 80000, label: 'Late' }] });
    const marker = buildClipMarker(selected, '0:10', ' Start ', 20);
    const withMarker = buildClipWithMarker(selected, marker, 21);

    expect(marker).toEqual({ id: '20', atMs: 10000, label: 'Start' });
    expect(withMarker.markers?.map((item) => item.id)).toEqual(['20', 'late']);
    expect(buildClipWithoutMarker(withMarker, 'late', 22).markers?.map((item) => item.id)).toEqual(['20']);
  });

  it('builds trim, timelapse, and bulk updates', () => {
    const selected = clip({ name: 'Layer check', tags: ['review'] });
    const trim = buildTrimmedVideoCopy(selected, '0:10', '1:20', 30);

    expect(trim?.clip).toMatchObject({
      id: 'clip-1-trim-30',
      name: 'Layer check trim',
      trimStartMs: 10000,
      trimEndMs: 80000,
      durationMs: 70000,
      tags: ['review', 'trimmed'],
    });
    expect(buildTrimmedVideoCopy(selected, '1:20', '0:10', 30)).toBeNull();
    expect(buildTimelapseCopy(selected, 31)).toMatchObject({
      id: 'clip-1-timelapse-31',
      name: 'Layer check timelapse',
      kind: 'timelapse',
      tags: ['review', 'timelapse'],
    });
    expect(buildBulkClipUpdate(selected, ' review,export ', ' Album ', 32)).toMatchObject({
      album: 'Album',
      tags: ['review', 'export'],
      editedAt: 32,
    });
  });
});
