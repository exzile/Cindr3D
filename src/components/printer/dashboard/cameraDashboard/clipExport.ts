/**
 * Download/report/export helpers for saved camera clips. Kept React-free so
 * CameraDashboardPanel only coordinates UI state around these operations.
 */
import { strToU8, zipSync } from 'fflate';
import { formatBytes } from '../helpers';
import {
  clipExportName,
  clipFileExtension,
  clipIssueTags,
  clipKind,
  clipLabel,
  clipManifest,
  formatClipDuration,
  type CameraClip,
} from './clipStore';
import { imageFromBlob } from './snapshotEdit';

export function timestampForFile(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function slugPrinterName(printerName: string): string {
  return printerName.replace(/\s+/g, '-');
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function cameraClipDownloadName(clip: CameraClip): string {
  return `${slugPrinterName(clip.printerName)}-camera-${clipKind(clip)}-${timestampForFile(new Date(clip.createdAt))}.${clipFileExtension(clip)}`;
}

export function downloadClipBlob(clip: CameraClip): void {
  downloadBlob(clip.blob, cameraClipDownloadName(clip));
}

export function exportClipsManifest(clips: CameraClip[], exportedAt = new Date().toISOString()): Blob {
  return new Blob([JSON.stringify({ exportedAt, clips: clips.map(clipManifest) }, null, 2)], { type: 'application/json' });
}

export function downloadClipManifest(clips: CameraClip[], exportedAt = new Date().toISOString()): void {
  downloadBlob(exportClipsManifest(clips, exportedAt), `camera-clips-manifest-${exportedAt.replace(/[:.]/g, '-')}.json`);
}

export function buildJobReportMarkdown(
  clipsToReport: CameraClip[],
  printerName: string,
  timelineJobName: string,
  generatedAt = new Date(),
): string {
  const lines = [
    `# ${printerName} camera report`,
    '',
    `Generated: ${generatedAt.toLocaleString()}`,
    `Job: ${timelineJobName || 'Recent media'}`,
    `Items: ${clipsToReport.length}`,
    `Storage: ${formatBytes(clipsToReport.reduce((sum, clip) => sum + clip.size, 0))}`,
    '',
    '## Findings',
    ...clipsToReport.map((clip) => [
      `- ${new Date(clip.createdAt).toLocaleString()} - ${clipLabel(clip)}`,
      `  - Type: ${clipKind(clip)}`,
      `  - Rating: ${clip.rating ?? 'Unrated'}`,
      `  - Issues: ${clipIssueTags(clip).join(', ') || 'None'}`,
      `  - Checklist: ${(clip.checklist ?? []).join(', ') || 'None'}`,
      clip.notes ? `  - Notes: ${clip.notes}` : '',
      (clip.markers?.length ?? 0) > 0 ? `  - Markers: ${clip.markers?.map((marker) => `${marker.label} ${formatClipDuration(marker.atMs)}`).join('; ')}` : '',
    ].filter(Boolean).join('\n')),
  ];

  return lines.join('\n');
}

export function downloadJobReport(clipsToReport: CameraClip[], printerName: string, timelineJobName: string): void {
  const blob = new Blob([buildJobReportMarkdown(clipsToReport, printerName, timelineJobName)], { type: 'text/markdown' });
  downloadBlob(blob, `${slugPrinterName(printerName)}-camera-report-${timestampForFile()}.md`);
}

export async function createContactSheetBlob(snapshots: CameraClip[]): Promise<Blob> {
  const cellWidth = 320;
  const cellHeight = 230;
  const columns = Math.min(3, snapshots.length);
  const rows = Math.ceil(snapshots.length / columns);
  const canvas = document.createElement('canvas');
  canvas.width = columns * cellWidth;
  canvas.height = rows * cellHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Contact sheet canvas is not available.');
  context.fillStyle = '#020617';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await Promise.all(snapshots.map(async (clip, index) => {
    const image = await imageFromBlob(clip.blob);
    const x = (index % columns) * cellWidth;
    const y = Math.floor(index / columns) * cellHeight;
    context.fillStyle = '#050505';
    context.fillRect(x + 10, y + 10, cellWidth - 20, cellHeight - 48);
    context.drawImage(image, x + 10, y + 10, cellWidth - 20, cellHeight - 48);
    context.fillStyle = '#fff';
    context.font = '700 14px system-ui, sans-serif';
    context.fillText(clipLabel(clip).slice(0, 34), x + 12, y + cellHeight - 22);
  }));

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Unable to save contact sheet.')), 'image/png');
  });
}

export async function downloadContactSheet(snapshots: CameraClip[], printerName: string): Promise<void> {
  downloadBlob(await createContactSheetBlob(snapshots), `${slugPrinterName(printerName)}-contact-sheet-${timestampForFile()}.png`);
}

export async function createClipBundleBlob(clipsToExport: CameraClip[], printerId: string, printerName: string): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {};
  await Promise.all(clipsToExport.map(async (clip, index) => {
    entries[`media/${clipExportName(clip, index)}`] = new Uint8Array(await clip.blob.arrayBuffer());
  }));
  entries['manifest.json'] = strToU8(JSON.stringify({
    exportedAt: new Date().toISOString(),
    printerId,
    printerName,
    clips: clipsToExport.map(clipManifest),
  }, null, 2));
  const zipped = zipSync(entries, { level: 6 });
  const zippedBuffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
  return new Blob([zippedBuffer], { type: 'application/zip' });
}

export async function downloadClipBundle(clipsToExport: CameraClip[], printerId: string, printerName: string): Promise<void> {
  downloadBlob(await createClipBundleBlob(clipsToExport, printerId, printerName), `${slugPrinterName(printerName)}-camera-bundle-${timestampForFile()}.zip`);
}
