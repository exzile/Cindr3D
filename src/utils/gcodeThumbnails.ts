import type { SliceMove, SliceResult } from '../types/slicer';

export interface GCodeThumbnail {
  width: number;
  height: number;
  format: 'png';
  data: string;
}

const THUMBNAIL_BLOCK_RE = /\r?\n?;\s*thumbnail begin \d+x\d+ \d+[\s\S]*?;\s*thumbnail end\r?\n?/gi;
const THUMBNAIL_LINE_WIDTH = 76;

function base64ByteLength(data: string): number {
  const clean = data.replace(/\s+/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

function chunkBase64(data: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < data.length; i += THUMBNAIL_LINE_WIDTH) {
    chunks.push(data.slice(i, i + THUMBNAIL_LINE_WIDTH));
  }
  return chunks;
}

function thumbnailBlock(thumbnail: GCodeThumbnail): string[] {
  const lines = [
    `; thumbnail begin ${thumbnail.width}x${thumbnail.height} ${base64ByteLength(thumbnail.data)}`,
    ...chunkBase64(thumbnail.data).map((line) => `; ${line}`),
    '; thumbnail end',
  ];
  return lines;
}

export function embedGCodeThumbnails(gcode: string, thumbnails: GCodeThumbnail[]): string {
  const usable = thumbnails.filter((thumbnail) => thumbnail.format === 'png' && thumbnail.data.trim().length > 0);
  if (usable.length === 0) return gcode;

  const cleaned = gcode.replace(THUMBNAIL_BLOCK_RE, '\n').replace(/\n{3,}/g, '\n\n');
  const lines = cleaned.split(/\r?\n/);
  const headerEndIndex = lines.findIndex((line) => line.trim() === '; HEADER_BLOCK_END');
  const insertionIndex = headerEndIndex >= 0 ? headerEndIndex : 0;
  const block = usable.flatMap((thumbnail) => thumbnailBlock(thumbnail));
  lines.splice(insertionIndex, 0, ...block);
  return lines.join('\n');
}

function extrusionMoves(result: SliceResult): SliceMove[] {
  return result.layers
    .flatMap((layer) => layer.moves)
    .filter((move) => move.type !== 'travel' && move.lineWidth > 0);
}

function moveBounds(moves: SliceMove[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (moves.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const move of moves) {
    minX = Math.min(minX, move.from.x, move.to.x);
    minY = Math.min(minY, move.from.y, move.to.y);
    maxX = Math.max(maxX, move.from.x, move.to.x);
    maxY = Math.max(maxY, move.from.y, move.to.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  return { minX, minY, maxX, maxY };
}

export function colorForMove(type: SliceMove['type']): string {
  switch (type) {
    case 'wall-outer':
      return '#2563eb';
    case 'wall-inner':
      return '#38bdf8';
    case 'top-bottom':
      return '#f97316';
    case 'infill':
      return '#22c55e';
    case 'support':
      return '#eab308';
    case 'support-tree':
      return '#84cc16';
    case 'skirt':
    case 'brim':
      return '#a855f7';
    default:
      return '#94a3b8';
  }
}

export async function renderSliceThumbnailPng(
  result: SliceResult,
  size: number,
): Promise<GCodeThumbnail | null> {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const moves = extrusionMoves(result);
  const bounds = moveBounds(moves);
  if (!bounds) return null;

  canvas.width = size;
  canvas.height = size;
  const pad = Math.max(3, Math.round(size * 0.08));
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = Math.min((size - pad * 2) / width, (size - pad * 2) / height);
  const xOffset = (size - width * scale) * 0.5;
  const yOffset = (size - height * scale) * 0.5;
  const mapX = (x: number) => xOffset + (x - bounds.minX) * scale;
  const mapY = (y: number) => size - (yOffset + (y - bounds.minY) * scale);

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.lineWidth = Math.max(1, size / 150);
  ctx.strokeRect(xOffset, yOffset, width * scale, height * scale);

  for (const move of moves) {
    ctx.beginPath();
    ctx.strokeStyle = colorForMove(move.type);
    ctx.lineWidth = Math.max(1, move.lineWidth * scale);
    ctx.lineCap = 'round';
    ctx.moveTo(mapX(move.from.x), mapY(move.from.y));
    ctx.lineTo(mapX(move.to.x), mapY(move.to.y));
    ctx.stroke();
  }

  const dataUrl = canvas.toDataURL('image/png');
  const marker = 'base64,';
  const markerIndex = dataUrl.indexOf(marker);
  if (markerIndex < 0) return null;
  return {
    width: size,
    height: size,
    format: 'png',
    data: dataUrl.slice(markerIndex + marker.length),
  };
}

export async function withEmbeddedGCodeThumbnails(
  gcode: string,
  result: SliceResult,
  enabled = true,
): Promise<string> {
  if (!enabled) return gcode;
  const thumbnails = await Promise.all([
    renderSliceThumbnailPng(result, 32),
    renderSliceThumbnailPng(result, 300),
  ]);
  return embedGCodeThumbnails(gcode, thumbnails.filter((thumbnail): thumbnail is GCodeThumbnail => thumbnail !== null));
}
