// =============================================================================
// Project IO — unified .dzn settings bundle (cross-workspace configs).
//
// The bundle holds every page's settings in one JSON file:
//   { version, app, cad, slicer, printer, theme, exportedAt }
//
// The buildExportPayload / applySettings pair in utils/settingsExport.ts owns
// the schema. This module is the *file-layer* wrapper:
//   - Picks a file (File System Access API where available; download+upload
//     elsewhere)
//   - Remembers the currently-open handle so subsequent "Save" calls rewrite
//     the same file in place instead of prompting again
//   - Supports per-page-slice saves: e.g. a Save click on the Printer page
//     reads the current bundle, replaces only the `printer` slice, and
//     writes it back — leaving the CAD / slicer / theme slices untouched
//
// Design vs. settings files are distinct:
//   - .dznd  = design project (geometry, sketches, features, components)
//   - .dzn   = settings bundle (what this module handles)
// =============================================================================

import { create } from 'zustand';
import {
  buildExportPayload,
  applySettings,
  type ExportedSettings,
} from './settingsExport';
import type { BundleSlice, ImportResult } from '../types/settings-io.types';

export type { BundleSlice };

// Chromium-only: the File System Access API lets us hold on to a user-picked
// file and rewrite it without re-prompting. Typed locally so the project
// doesn't require @types/wicg-file-system-access.
interface FSFileHandle {
  getFile: () => Promise<File>;
  createWritable: () => Promise<{
    write: (data: string | Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
  name: string;
}

interface WindowWithFS {
  showOpenFilePicker?: (opts: {
    types?: { description: string; accept: Record<string, string[]> }[];
    multiple?: boolean;
  }) => Promise<FSFileHandle[]>;
  showSaveFilePicker?: (opts: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FSFileHandle>;
}

function getFSApi(): WindowWithFS {
  return window as unknown as WindowWithFS;
}

function hasFileSystemAccess(): boolean {
  const w = getFSApi();
  return typeof w.showOpenFilePicker === 'function' && typeof w.showSaveFilePicker === 'function';
}

const FILE_TYPES = [
  {
    description: 'Cindr3D Settings Bundle',
    accept: { 'application/json': ['.dzn'] },
  },
];

const OFFLINE_BUNDLE_KEY = 'cindr3d-last-settings-bundle';

export interface OfflineBundleMetadata {
  filename: string | null;
  savedAt: string;
}

interface OfflineBundleRecord extends OfflineBundleMetadata {
  payload: ExportedSettings;
}

// ---------------------------------------------------------------------------
// Store — tracks the currently-open bundle file
// ---------------------------------------------------------------------------

interface ProjectFileState {
  // Handle to the bundle file on disk (FSA only). Null if the user has not
  // opened or saved-as a bundle yet, or if FSA is unavailable.
  handle: FSFileHandle | null;
  // User-friendly filename for UI (works in both FSA and fallback paths).
  filename: string | null;
  // True once the user has opened/saved a bundle at least once during the
  // session. Used to decide whether "Save" can write in place or must prompt.
  hasBundle: boolean;
  setHandle: (handle: FSFileHandle | null, filename: string | null) => void;
  clear: () => void;
}

export const useProjectFileStore = create<ProjectFileState>((set) => ({
  handle: null,
  filename: null,
  hasBundle: false,
  setHandle: (handle, filename) => set({
    handle,
    filename,
    hasBundle: handle !== null || filename !== null,
  }),
  clear: () => set({ handle: null, filename: null, hasBundle: false }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function downloadJSON(json: string, suggestedName: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
}

function rememberOfflineBundle(payload: ExportedSettings, filename: string | null): void {
  try {
    const record: OfflineBundleRecord = {
      filename,
      savedAt: new Date().toISOString(),
      payload,
    };
    localStorage.setItem(OFFLINE_BUNDLE_KEY, JSON.stringify(record));
  } catch {
    // Local storage can be unavailable or full; bundle IO should still work.
  }
}

function readOfflineBundleRecord(): OfflineBundleRecord | null {
  try {
    const raw = localStorage.getItem(OFFLINE_BUNDLE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OfflineBundleRecord>;
    if (!parsed.payload || typeof parsed.savedAt !== 'string') return null;
    return {
      filename: typeof parsed.filename === 'string' ? parsed.filename : null,
      savedAt: parsed.savedAt,
      payload: parsed.payload as ExportedSettings,
    };
  } catch {
    return null;
  }
}

export function getLastOfflineBundleMetadata(): OfflineBundleMetadata | null {
  const record = readOfflineBundleRecord();
  return record ? { filename: record.filename, savedAt: record.savedAt } : null;
}

export function restoreLastOfflineBundle(): ImportResult & { filename?: string; savedAt?: string } {
  const record = readOfflineBundleRecord();
  if (!record) {
    return { ok: false, appliedSections: [], warnings: [], error: 'No offline settings bundle is available.' };
  }
  const result = applySettings(record.payload);
  if (result.ok) {
    useProjectFileStore.getState().setHandle(null, record.filename);
  }
  return {
    ...result,
    filename: record.filename ?? undefined,
    savedAt: record.savedAt,
  };
}

async function readHandleJSON(handle: FSFileHandle): Promise<unknown> {
  const file = await handle.getFile();
  const text = await file.text();
  return JSON.parse(text);
}

async function writeHandleJSON(handle: FSFileHandle, payload: object): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(payload, null, 2));
  await writable.close();
}

function mergeSlice(
  base: Partial<ExportedSettings>,
  fresh: ExportedSettings,
  slice: BundleSlice | null,
): ExportedSettings {
  // No slice → full replace (but preserve the original `exportedAt`-style
  // audit trail by bumping it to now via fresh).
  if (!slice) {
    return { ...fresh };
  }
  // Slice-merge: start from whatever was on disk (so other pages' edits from
  // other devices aren't clobbered), then overlay just our slice from `fresh`.
  const merged: ExportedSettings = {
    version: fresh.version,
    app: fresh.app,
    exportedAt: fresh.exportedAt,
    cad: (base.cad ?? fresh.cad) as ExportedSettings['cad'],
    slicer: (base.slicer ?? fresh.slicer) as ExportedSettings['slicer'],
    printer: (base.printer ?? fresh.printer) as ExportedSettings['printer'],
    theme: (base.theme ?? fresh.theme) as ExportedSettings['theme'],
  };
  merged[slice] = fresh[slice] as never;
  return merged;
}

export interface OpenResult extends ImportResult {
  filename?: string;
}

// ---------------------------------------------------------------------------
// Open
// ---------------------------------------------------------------------------

/**
 * Prompt for a .dzn file and apply all sections. Remembers the file handle
 * so subsequent savePageSlice() calls write back to the same file.
 */
export async function openBundle(): Promise<OpenResult> {
  const w = getFSApi();
  if (hasFileSystemAccess() && w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({ types: FILE_TYPES, multiple: false });
      const raw = await readHandleJSON(handle);
      const result = applySettings(raw);
      if (result.ok) {
        useProjectFileStore.getState().setHandle(handle, handle.name);
        rememberOfflineBundle(raw as ExportedSettings, handle.name);
      }
      return { ...result, filename: handle.name };
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') {
        return { ok: false, appliedSections: [], warnings: [], error: 'Open cancelled.' };
      }
      return { ok: false, appliedSections: [], warnings: [], error: (err as Error).message };
    }
  }
  // Fallback: hidden <input type="file">
  return new Promise<OpenResult>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.dzn,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve({ ok: false, appliedSections: [], warnings: [], error: 'No file selected.' });
        return;
      }
      try {
        const text = await file.text();
        const raw = JSON.parse(text);
        const result = applySettings(raw);
        if (result.ok) {
          useProjectFileStore.getState().setHandle(null, file.name);
          rememberOfflineBundle(raw as ExportedSettings, file.name);
        }
        resolve({ ...result, filename: file.name });
      } catch (e) {
        resolve({ ok: false, appliedSections: [], warnings: [], error: (e as Error).message });
      }
    };
    input.click();
  });
}

// ---------------------------------------------------------------------------
// Save As
// ---------------------------------------------------------------------------

export async function saveBundleAs(suggested = 'settings.dzn'): Promise<{ ok: boolean; filename?: string; error?: string }> {
  const payload = buildExportPayload();
  const w = getFSApi();
  if (hasFileSystemAccess() && w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: suggested,
        types: FILE_TYPES,
      });
      await writeHandleJSON(handle, payload);
      useProjectFileStore.getState().setHandle(handle, handle.name);
      rememberOfflineBundle(payload, handle.name);
      return { ok: true, filename: handle.name };
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') {
        return { ok: false, error: 'Save cancelled.' };
      }
      return { ok: false, error: (err as Error).message };
    }
  }
  // Fallback: trigger a download and remember just the name so the UI can
  // show it. Subsequent saves will re-prompt (no in-place write without FSA).
  downloadJSON(JSON.stringify(payload, null, 2), suggested);
  useProjectFileStore.getState().setHandle(null, suggested);
  rememberOfflineBundle(payload, suggested);
  return { ok: true, filename: suggested };
}

// ---------------------------------------------------------------------------
// Save (per-slice; falls back to Save As when no handle is open)
// ---------------------------------------------------------------------------

/**
 * Persist the current state of a single workspace slice into the open .dzn
 * bundle. Pass `null` to persist every slice (full replace).
 *
 * - If a bundle handle is open (FSA): read the current file, overlay just the
 *   requested slice, write back in place.
 * - If only a filename is known (download fallback) or no bundle yet: degrade
 *   to Save As so the user still gets a file on disk.
 */
export async function saveBundleSlice(
  slice: BundleSlice | null,
  suggested = 'settings.dzn',
): Promise<{ ok: boolean; filename?: string; error?: string }> {
  const { handle } = useProjectFileStore.getState();
  const fresh = buildExportPayload();

  if (handle) {
    try {
      let base: Partial<ExportedSettings> = {};
      try {
        const existing = await readHandleJSON(handle);
        if (existing && typeof existing === 'object') {
          base = existing as Partial<ExportedSettings>;
        }
      } catch {
        // File gone / unreadable — overwrite rather than fail
      }
      const merged = mergeSlice(base, fresh, slice);
      await writeHandleJSON(handle, merged);
      rememberOfflineBundle(merged, handle.name);
      return { ok: true, filename: handle.name };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  // No in-place target → Save As.
  return saveBundleAs(suggested);
}

// ---------------------------------------------------------------------------
// Convenience close (e.g. on New)
// ---------------------------------------------------------------------------

export function closeBundle(): void {
  useProjectFileStore.getState().clear();
}
