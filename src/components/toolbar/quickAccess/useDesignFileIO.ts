/**
 * useDesignFileIO — owns the design (.dznd) file lifecycle:
 *
 *   • the persistent FileSystemFileHandle (so Ctrl+S can rewrite in place,
 *     not download a fresh copy each time)
 *   • the auto-save interval effect (writes to the handle when granted; falls
 *     back to a download if no handle is available)
 *   • the Ctrl+S keyboard shortcut (mirrors auto-save: write-in-place, else
 *     open the Save As dialog)
 *
 * Extracted out of QuickAccessBar so the toolbar component can focus on
 * layout + menus instead of mixing in long-running file-IO side effects.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useCADStore } from '../../../store/cadStore';
import {
  attachDesignRecentFileHandle,
  designFileBaseName,
  designRecentFileId,
  useDesignFileStore,
} from '../../../store/designFileStore';

type FSHandleWithPerms = FileSystemFileHandle & {
  queryPermission(opts: { mode: string }): Promise<PermissionState>;
  requestPermission(opts: { mode: string }): Promise<PermissionState>;
};

export interface DesignFileIODeps {
  isDesign: boolean;
  autoSave: boolean;
  autoSaveInterval: number;
  currentDesignFile: string | null;
  setCurrentDesignFile: (next: string | null) => void;
  setStatusMessage: (msg: string) => void;
  openSaveAs: () => void;
}

export function useDesignFileIO(deps: DesignFileIODeps) {
  const {
    isDesign, autoSave, autoSaveInterval, currentDesignFile,
    setCurrentDesignFile, setStatusMessage, openSaveAs,
  } = deps;

  const getDesignJSON = useCADStore((s) => s.getDesignJSON);
  const saveToFile = useCADStore((s) => s.saveToFile);
  const loadFromFile = useCADStore((s) => s.loadFromFile);

  const autoSaveInFlightRef = useRef(false);

  // Returns true if written, false if write permission isn't yet granted
  // (silently skips so auto-save never triggers a browser permission dialog).
  const writeToHandle = useCallback(async (handle: FileSystemFileHandle): Promise<boolean> => {
    const perm = await (handle as FSHandleWithPerms).queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return false;
    const json = getDesignJSON();
    const writable = await handle.createWritable();
    await writable.write(new Blob([json], { type: 'application/json' }));
    await writable.close();
    return true;
  }, [getDesignJSON]);

  const openDesignFile = useCallback(async (loadFileInputRef: React.RefObject<HTMLInputElement | null>) => {
    if ('showOpenFilePicker' in window) {
      try {
        const [handle] = await (window as unknown as {
          showOpenFilePicker(opts?: object): Promise<FileSystemFileHandle[]>;
        }).showOpenFilePicker({
          types: [{ description: 'Cindr3D Design', accept: { 'application/json': ['.dznd', '.json'] } }],
          multiple: false,
        });
        const file = await handle.getFile();
        const text = await file.text();
        loadFromFile(text);
        const recentId = designRecentFileId('picker', file.name);
        useDesignFileStore.getState().setFileHandle(handle);
        setCurrentDesignFile(designFileBaseName(file.name));
        attachDesignRecentFileHandle(recentId, handle);
        useDesignFileStore.getState().addRecentFile({
          id: recentId,
          name: file.name,
          source: 'picker',
        });
        // Pre-request write permission while the user gesture (file picker) is
        // still active so auto-save can overwrite without a browser dialog.
        try {
          await (handle as FSHandleWithPerms).requestPermission({ mode: 'readwrite' });
        } catch { /* browser doesn't support it — writes fall back to download */ }
      } catch (err) {
        if (!(err instanceof Error && err.name === 'AbortError')) setStatusMessage('Open failed');
      }
    } else {
      loadFileInputRef.current?.click();
    }
  }, [loadFromFile, setCurrentDesignFile, setStatusMessage]);

  /** Save As — picks a new location and stores the handle for subsequent Ctrl+S writes. */
  const saveDesignAs = useCallback(async (baseName: string): Promise<boolean> => {
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as unknown as {
          showSaveFilePicker(opts?: object): Promise<FileSystemFileHandle>;
        }).showSaveFilePicker({
          suggestedName: `${baseName}.dznd`,
          types: [{ description: 'Cindr3D Design', accept: { 'application/json': ['.dznd'] } }],
        });
        const wrote = await writeToHandle(handle);
        if (!wrote) { setStatusMessage('Save failed — write permission not granted'); return false; }
        const recentId = designRecentFileId('save', `${baseName}.dznd`);
        useDesignFileStore.getState().setFileHandle(handle);
        setStatusMessage(`Design saved: ${baseName}.dznd`);
        setCurrentDesignFile(baseName);
        attachDesignRecentFileHandle(recentId, handle);
        useDesignFileStore.getState().addRecentFile({
          id: recentId,
          name: `${baseName}.dznd`,
          source: 'save',
        });
        return true;
      } catch (err) {
        if (!(err instanceof Error && err.name === 'AbortError')) setStatusMessage('Save failed');
        return false;
      }
    } else {
      saveToFile(baseName);
      setCurrentDesignFile(baseName);
      useDesignFileStore.getState().setFileHandle(null);
      return true;
    }
  }, [saveToFile, setCurrentDesignFile, setStatusMessage, writeToHandle]);

  /** Drops the file handle + clears the current-file name. Call from File → New. */
  const resetFileState = useCallback(() => {
    useDesignFileStore.getState().setFileHandle(null);
    setCurrentDesignFile(null);
  }, [setCurrentDesignFile]);

  /** Imports a file selected via the hidden input (legacy browsers without showOpenFilePicker). */
  const importTextFromInput = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      if (text) {
        loadFromFile(text);
        useDesignFileStore.getState().setFileHandle(null);
        setCurrentDesignFile(designFileBaseName(file.name));
        useDesignFileStore.getState().addRecentFile({
          id: designRecentFileId('upload', file.name),
          name: file.name,
          source: 'upload',
        });
      }
    };
    reader.onerror = () => setStatusMessage('Failed to read design file');
    reader.readAsText(file);
  }, [loadFromFile, setCurrentDesignFile, setStatusMessage]);

  // Auto-save interval — writes to the stored file handle when available (true overwrite),
  // falls back to a browser download only if no handle exists.
  useEffect(() => {
    if (!autoSave || !isDesign) return;
    if (!Number.isFinite(autoSaveInterval) || autoSaveInterval <= 0) return;
    const intervalMs = autoSaveInterval * 1000;
    const id = setInterval(async () => {
      if (autoSaveInFlightRef.current) return;
      autoSaveInFlightRef.current = true;
      try {
        const handle = useDesignFileStore.getState().fileHandle;
        const name = currentDesignFile ?? 'design';
        if (handle) {
          try {
            const wrote = await writeToHandle(handle);
            if (wrote) setStatusMessage(`Auto-saved: ${name}.dznd`);
            // If !wrote, write permission wasn't granted — skip silently (no browser dialog)
          } catch {
            setStatusMessage('Auto-save failed — file may have been moved or deleted');
          }
        } else if (currentDesignFile) {
          saveToFile(currentDesignFile);
          setStatusMessage(`Auto-saved: ${currentDesignFile}.dznd`);
        }
      } finally {
        autoSaveInFlightRef.current = false;
      }
    }, intervalMs);
    return () => clearInterval(id);
  }, [autoSave, autoSaveInterval, currentDesignFile, isDesign, saveToFile, setStatusMessage, writeToHandle]);

  // Ctrl+S — write to stored handle (true overwrite) if available, else fallback
  useEffect(() => {
    if (!isDesign) return;
    const handleKeyDown = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const handle = useDesignFileStore.getState().fileHandle;
        const name = currentDesignFile ?? 'design';
        if (handle) {
          try {
            const wrote = await writeToHandle(handle);
            if (wrote) setStatusMessage(`Design saved: ${name}.dznd`);
            else openSaveAs();
          } catch {
            setStatusMessage('Save failed — file may have been moved or deleted');
          }
        } else if (currentDesignFile) {
          saveToFile(currentDesignFile);
          setStatusMessage(`Design saved: ${currentDesignFile}.dznd`);
        } else {
          openSaveAs();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isDesign, currentDesignFile, saveToFile, setStatusMessage, writeToHandle, openSaveAs]);

  return {
    openDesignFile,
    saveDesignAs,
    resetFileState,
    importTextFromInput,
  };
}
