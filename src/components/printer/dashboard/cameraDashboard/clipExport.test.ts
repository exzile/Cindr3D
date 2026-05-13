import { describe, expect, it } from 'vitest';
import {
  buildJobReportMarkdown,
  cameraClipDownloadName,
  exportClipsManifest,
  slugPrinterName,
  timestampForFile,
} from './clipExport';
import type { CameraClip } from './clipStore';

function clip(overrides: Partial<CameraClip> = {}): CameraClip {
  return {
    id: 'clip-1',
    printerId: 'printer-1',
    printerName: 'Shop Printer',
    kind: 'clip',
    createdAt: Date.UTC(2026, 0, 2, 3, 4, 5),
    durationMs: 1200,
    mimeType: 'video/webm',
    size: 2048,
    blob: new Blob(['camera']),
    ...overrides,
  };
}

describe('clipExport helpers', () => {
  it('formats stable download names', () => {
    const date = new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 6));

    expect(timestampForFile(date)).toBe('2026-01-02T03-04-05-006Z');
    expect(slugPrinterName('Shop Printer')).toBe('Shop-Printer');
    expect(cameraClipDownloadName(clip())).toBe('Shop-Printer-camera-clip-2026-01-02T03-04-05-000Z.webm');
    expect(cameraClipDownloadName(clip({ kind: 'snapshot', mimeType: 'image/png' }))).toBe('Shop-Printer-camera-snapshot-2026-01-02T03-04-05-000Z.png');
  });

  it('builds manifest JSON for exported clips', async () => {
    const blob = exportClipsManifest([clip({ name: 'First layer' })], '2026-05-12T12:00:00.000Z');
    const manifest = JSON.parse(await blob.text()) as { exportedAt: string; clips: Array<{ id: string; name: string }> };

    expect(manifest.exportedAt).toBe('2026-05-12T12:00:00.000Z');
    expect(manifest.clips).toMatchObject([{ id: 'clip-1', name: 'First layer' }]);
  });

  it('builds markdown job reports with ratings, issues, checklist, notes, and markers', () => {
    const report = buildJobReportMarkdown([
      clip({
        name: 'Layer review',
        rating: 'Needs review',
        tags: ['issue:Warping'],
        checklist: ['First layer'],
        notes: 'Corner lifting',
        markers: [{ id: 'm1', atMs: 61000, label: 'Lift starts' }],
      }),
    ], 'Shop Printer', 'case.gcode', new Date(Date.UTC(2026, 4, 12, 12, 0, 0)));

    expect(report).toContain('# Shop Printer camera report');
    expect(report).toContain('Job: case.gcode');
    expect(report).toContain('- Rating: Needs review');
    expect(report).toContain('- Issues: Warping');
    expect(report).toContain('- Checklist: First layer');
    expect(report).toContain('- Notes: Corner lifting');
    expect(report).toContain('- Markers: Lift starts 1:01');
  });
});
