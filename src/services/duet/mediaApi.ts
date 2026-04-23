import { parseHeightMapCsv } from './heightMap';
import type { DuetConfig, DuetHeightMap } from '../../types/duet';

export async function getHeightMapData(
  downloadFile: (path: string) => Promise<Blob>,
  path = '0:/sys/heightmap.csv',
): Promise<DuetHeightMap | null> {
  try {
    const blob = await downloadFile(path);
    const text = await blob.text();
    return parseHeightMapCsv(text);
  } catch {
    return null;
  }
}

export function getWebcamStreamUrl(baseUrl: string): string {
  return `${baseUrl}/webcam/?action=stream`;
}

export function getSnapshotImageUrl(baseUrl: string): string {
  return `${baseUrl}/webcam/?action=snapshot`;
}

export async function getThumbnailData(
  config: DuetConfig,
  baseUrl: string,
  filename: string,
  offset: number,
  request: <T = unknown>(url: string, init?: RequestInit) => Promise<T>,
): Promise<string | null> {
  try {
    if (config.mode === 'sbc') {
      const url = `${baseUrl}/machine/thumbnail/${encodeURIComponent(filename)}?offset=${offset}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }

    let fullData = '';
    let currentOffset = offset;
    while (true) {
      const url = `${baseUrl}/rr_thumbnail?name=${encodeURIComponent(filename)}&offset=${currentOffset}`;
      const res = await request<{
        fileName: string;
        offset: number;
        data: string;
        next: number;
        err: number;
      }>(url);
      if (res.err !== 0) return null;
      fullData += res.data;
      if (res.next === 0) break;
      currentOffset = res.next;
    }

    if (!fullData) return null;
    return `data:image/png;base64,${fullData}`;
  } catch {
    return null;
  }
}
