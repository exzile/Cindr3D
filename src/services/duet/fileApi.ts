import type { DuetConfig, DuetFileInfo, DuetGCodeFileInfo } from '../../types/duet';
import { uploadViaXhr } from './upload';

type RequestFn = <T = unknown>(url: string, init?: RequestInit) => Promise<T>;

type FileApiContext = {
  config: DuetConfig;
  baseUrl: string;
  request: RequestFn;
};

export async function listFiles(
  { config, baseUrl, request }: FileApiContext,
  directory: string,
): Promise<DuetFileInfo[]> {
  if (config.mode === 'sbc') {
    const url = `${baseUrl}/machine/directory/${encodeURIComponent(directory)}`;
    return request<DuetFileInfo[]>(url);
  }

  const allFiles: DuetFileInfo[] = [];
  let first = 0;
  let hasMore = true;

  while (hasMore) {
    const url = `${baseUrl}/rr_filelist?dir=${encodeURIComponent(directory)}&first=${first}`;
    const res = await request<{
      dir: string;
      first: number;
      files: Array<{ type: string; name: string; size: number; date: string }>;
      next: number;
      err?: number;
    }>(url);

    if (res.err !== undefined && res.err !== 0) {
      throw new Error(`File listing error (err=${res.err})`);
    }

    for (const f of res.files ?? []) {
      allFiles.push({
        type: f.type === 'd' ? 'd' : 'f',
        name: f.name,
        size: f.size,
        date: f.date,
      });
    }

    if (res.next !== 0 && res.next > first) {
      first = res.next;
    } else {
      hasMore = false;
    }
  }

  return allFiles;
}

export async function getFileInfo(
  { config, baseUrl, request }: FileApiContext,
  filename: string,
): Promise<DuetGCodeFileInfo> {
  if (config.mode === 'sbc') {
    const url = `${baseUrl}/machine/fileinfo/${encodeURIComponent(filename)}`;
    return request<DuetGCodeFileInfo>(url);
  }

  const url = `${baseUrl}/rr_fileinfo?name=${encodeURIComponent(filename)}`;
  const res = await request<DuetGCodeFileInfo & { err?: number }>(url);
  if (res.err !== undefined && res.err !== 0) {
    throw new Error(`File info error (err=${res.err})`);
  }
  return res;
}

export async function uploadFile(
  { config, baseUrl }: FileApiContext,
  path: string,
  content: Blob | File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  if (config.mode === 'sbc') {
    const url = `${baseUrl}/machine/file/${encodeURIComponent(path)}`;
    return uploadViaXhr('PUT', url, content, onProgress);
  }

  const url = `${baseUrl}/rr_upload?name=${encodeURIComponent(path)}&time=${encodeURIComponent(new Date().toISOString())}`;
  return uploadViaXhr('POST', url, content, onProgress, (responseText) => {
    let res: { err?: number };
    try {
      res = JSON.parse(responseText) as { err?: number };
    } catch {
      return; // non-JSON response — treat as success (some RRF builds omit body on success)
    }
    if (res.err !== 0) {
      throw new Error(`Upload error (err=${res.err})`);
    }
  });
}

export async function downloadFile(
  { config, baseUrl }: FileApiContext,
  path: string,
): Promise<Blob> {
  const url = config.mode === 'sbc'
    ? `${baseUrl}/machine/file/${encodeURIComponent(path)}`
    : `${baseUrl}/rr_download?name=${encodeURIComponent(path)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status}`);
  }
  return res.blob();
}

export async function deleteFile(
  { config, baseUrl, request }: FileApiContext,
  path: string,
): Promise<void> {
  if (config.mode === 'sbc') {
    const url = `${baseUrl}/machine/file/${encodeURIComponent(path)}`;
    await request(url, { method: 'DELETE' });
    return;
  }

  const url = `${baseUrl}/rr_delete?name=${encodeURIComponent(path)}`;
  await request(url);
}

export async function moveFile(
  { config, baseUrl, request }: FileApiContext,
  from: string,
  to: string,
): Promise<void> {
  if (config.mode === 'sbc') {
    const url = `${baseUrl}/machine/file/move`;
    await request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    });
    return;
  }

  const url = `${baseUrl}/rr_move?old=${encodeURIComponent(from)}&new=${encodeURIComponent(to)}`;
  await request(url);
}

export async function createDirectory(
  { config, baseUrl, request }: FileApiContext,
  path: string,
): Promise<void> {
  if (config.mode === 'sbc') {
    const url = `${baseUrl}/machine/directory/${encodeURIComponent(path)}`;
    await request(url, { method: 'PUT' });
    return;
  }

  const url = `${baseUrl}/rr_mkdir?dir=${encodeURIComponent(path)}`;
  await request(url);
}
