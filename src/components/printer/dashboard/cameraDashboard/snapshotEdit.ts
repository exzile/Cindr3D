/**
 * Canvas-based snapshot editing pipeline (rotate, flip, crop, brightness,
 * contrast, sharpen, annotation) for the CameraDashboardPanel. Plus the
 * small pure numeric / format helpers it uses. No React.
 */
import type { SnapshotCrop } from './clipStore';

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function defaultCrop(): SnapshotCrop {
  return { x: 0, y: 0, width: 1, height: 1 };
}

export function formatLastFrame(lastFrameAt: number | null, now: number): string {
  if (!lastFrameAt) return 'Waiting for frame';
  const seconds = Math.max(0, Math.round((now - lastFrameAt) / 1000));
  if (seconds < 2) return 'Frame just now';
  if (seconds < 60) return `Last frame ${seconds}s ago`;
  return `Last frame ${Math.round(seconds / 60)}m ago`;
}

export function formatMeasurementDistance(distanceMm: number | null): string {
  if (distanceMm === null) return 'Calibrate bed corners to measure';
  if (distanceMm >= 1000) return `${(distanceMm / 1000).toFixed(2)} m`;
  return `${distanceMm.toFixed(distanceMm >= 100 ? 1 : 2)} mm`;
}

export interface MediaViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function measureContainedMedia(frame: HTMLElement, media: HTMLImageElement | HTMLVideoElement | null): MediaViewportRect {
  const frameRect = frame.getBoundingClientRect();
  if (!frameRect.width || !frameRect.height) return { left: 0, top: 0, width: 100, height: 100 };
  const intrinsicWidth = media instanceof HTMLVideoElement
    ? media.videoWidth
    : media?.naturalWidth;
  const intrinsicHeight = media instanceof HTMLVideoElement
    ? media.videoHeight
    : media?.naturalHeight;
  if (!intrinsicWidth || !intrinsicHeight) return { left: 0, top: 0, width: 100, height: 100 };

  const frameRatio = frameRect.width / frameRect.height;
  const mediaRatio = intrinsicWidth / intrinsicHeight;
  if (!Number.isFinite(mediaRatio) || mediaRatio <= 0) return { left: 0, top: 0, width: 100, height: 100 };

  if (mediaRatio > frameRatio) {
    const height = (frameRect.width / mediaRatio / frameRect.height) * 100;
    return { left: 0, top: (100 - height) / 2, width: 100, height };
  }

  const width = (frameRect.height * mediaRatio / frameRect.width) * 100;
  return { left: (100 - width) / 2, top: 0, width, height: 100 };
}

export function sameMediaViewport(a: MediaViewportRect, b: MediaViewportRect): boolean {
  return Math.abs(a.left - b.left) < 0.02
    && Math.abs(a.top - b.top) < 0.02
    && Math.abs(a.width - b.width) < 0.02
    && Math.abs(a.height - b.height) < 0.02;
}

export async function imageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new window.Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Apply rotation / flip / crop / brightness / contrast / sharpen / annotation
 * to a snapshot blob and return a new PNG blob. Throws if 2D canvas context
 * is unavailable in the current browser.
 */
export async function transformSnapshotBlob(
  blob: Blob,
  rotation: number,
  flipHorizontal: boolean,
  crop: SnapshotCrop,
  brightness: number,
  contrast: number,
  sharpen: number,
  annotation: string,
): Promise<Blob> {
  const image = await imageFromBlob(blob);
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const swapsAxes = normalizedRotation === 90 || normalizedRotation === 270;
  const cropX = Math.round(clamp01(crop.x) * image.naturalWidth);
  const cropY = Math.round(clamp01(crop.y) * image.naturalHeight);
  const cropWidth = Math.max(1, Math.round(clamp01(crop.width) * image.naturalWidth));
  const cropHeight = Math.max(1, Math.round(clamp01(crop.height) * image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = swapsAxes ? cropHeight : cropWidth;
  canvas.height = swapsAxes ? cropWidth : cropHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Snapshot editor is not available in this browser.');

  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((normalizedRotation * Math.PI) / 180);
  context.scale(flipHorizontal ? -1 : 1, 1);
  context.filter = `brightness(${brightness}%) contrast(${contrast}%)`;
  context.drawImage(image, cropX, cropY, cropWidth, cropHeight, -cropWidth / 2, -cropHeight / 2, cropWidth, cropHeight);
  context.filter = 'none';

  if (sharpen > 0) {
    context.globalAlpha = Math.min(0.28, sharpen / 250);
    context.drawImage(canvas, -1, 0);
    context.drawImage(canvas, 1, 0);
    context.drawImage(canvas, 0, -1);
    context.drawImage(canvas, 0, 1);
    context.globalAlpha = 1;
  }

  if (annotation.trim()) {
    const text = annotation.trim();
    const pad = Math.max(10, Math.round(canvas.width * 0.018));
    context.font = `700 ${Math.max(16, Math.round(canvas.width * 0.032))}px system-ui, sans-serif`;
    const textWidth = context.measureText(text).width;
    const boxHeight = Math.max(32, Math.round(canvas.height * 0.075));
    context.fillStyle = 'rgba(2, 6, 23, 0.72)';
    context.fillRect(pad, pad, Math.min(canvas.width - pad * 2, textWidth + pad * 2), boxHeight);
    context.fillStyle = '#ffffff';
    context.fillText(text, pad * 1.7, pad + boxHeight * 0.65);

    context.strokeStyle = '#f59e0b';
    context.lineWidth = Math.max(3, Math.round(canvas.width * 0.006));
    context.beginPath();
    context.moveTo(canvas.width * 0.72, canvas.height * 0.22);
    context.lineTo(canvas.width * 0.86, canvas.height * 0.36);
    context.lineTo(canvas.width * 0.8, canvas.height * 0.36);
    context.moveTo(canvas.width * 0.86, canvas.height * 0.36);
    context.lineTo(canvas.width * 0.86, canvas.height * 0.3);
    context.stroke();
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error('Unable to save edited snapshot.'));
    }, 'image/png');
  });
}
