import { useMemo, useRef, useState } from 'react';
import {
  Clock3,
  FileJson,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import {
  attachDesignRecentFileHandle,
  designFileBaseName,
  type DesignRecentFileSource,
  designRecentFileId,
  getDesignRecentFileHandle,
  useDesignFileStore,
} from '../../store/designFileStore';

type DirectoryHandleWithEntries = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
};

interface FolderFileEntry {
  id: string;
  name: string;
  size: number;
  modified: number;
  handle: FileSystemFileHandle;
}

const DESIGN_FILE_PATTERN = /\.(dznd|json)$/i;
type HandleOpenSource = Exclude<DesignRecentFileSource, 'upload'>;
type FileHandleWithPermissions = FileSystemFileHandle & {
  requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
};

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRecentTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

async function requestWritePermission(handle: FileSystemFileHandle) {
  try {
    await (handle as FileHandleWithPermissions).requestPermission?.({ mode: 'readwrite' });
  } catch {
    // Read-only folder grants are still useful for opening; saving will fall back to Save As.
  }
}

export function DesignFileBrowser() {
  const inputRef = useRef<HTMLInputElement>(null);
  const loadFromFile = useCADStore((s) => s.loadFromFile);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const setCurrentDesignFile = useDesignFileStore((s) => s.setCurrentDesignFile);
  const setFileHandle = useDesignFileStore((s) => s.setFileHandle);
  const recentFiles = useDesignFileStore((s) => s.recentFiles);
  const addRecentFile = useDesignFileStore((s) => s.addRecentFile);
  const clearRecentFiles = useDesignFileStore((s) => s.clearRecentFiles);
  const [activeSection, setActiveSection] = useState<'recent' | 'folder'>('recent');
  const [folderName, setFolderName] = useState<string | null>(null);
  const [folderFiles, setFolderFiles] = useState<FolderFileEntry[]>([]);
  const [folderHandle, setFolderHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [busy, setBusy] = useState(false);

  const canPickFolder = 'showDirectoryPicker' in window;
  const sortedFolderFiles = useMemo(
    () => [...folderFiles].sort((a, b) => b.modified - a.modified),
    [folderFiles],
  );

  const openHandle = async (
    handle: FileSystemFileHandle,
    source: HandleOpenSource,
    displayPath?: string,
  ) => {
    try {
      await requestWritePermission(handle);
      const file = await handle.getFile();
      const text = await file.text();
      loadFromFile(text);
      const recentId = designRecentFileId(source, file.name, displayPath);
      setFileHandle(handle);
      setCurrentDesignFile(designFileBaseName(file.name));
      attachDesignRecentFileHandle(recentId, handle);
      addRecentFile({
        id: recentId,
        name: file.name,
        displayPath,
        source,
      });
      setStatusMessage(`Opened ${file.name}`);
    } catch {
      setStatusMessage('Open failed');
    }
  };

  const openLocalFile = async () => {
    if ('showOpenFilePicker' in window) {
      try {
        const [handle] = await (window as unknown as {
          showOpenFilePicker(opts?: object): Promise<FileSystemFileHandle[]>;
        }).showOpenFilePicker({
          types: [{ description: 'Cindr3D Design', accept: { 'application/json': ['.dznd', '.json'] } }],
          multiple: false,
        });
        await openHandle(handle, 'picker');
      } catch (err) {
        if (!(err instanceof Error && err.name === 'AbortError')) setStatusMessage('Open failed');
      }
    } else {
      inputRef.current?.click();
    }
  };

  const loadFolder = async (handle: FileSystemDirectoryHandle) => {
    setBusy(true);
    try {
      const entries: FolderFileEntry[] = [];
      for await (const [, entryHandle] of (handle as DirectoryHandleWithEntries).entries()) {
        if (entryHandle.kind !== 'file' || !DESIGN_FILE_PATTERN.test(entryHandle.name)) continue;
        try {
          const file = await entryHandle.getFile();
          entries.push({
            id: `${handle.name}/${file.name}`.toLowerCase(),
            name: file.name,
            size: file.size,
            modified: file.lastModified,
            handle: entryHandle,
          });
        } catch {
          // Ignore files that disappear or cannot be read after folder selection.
        }
      }
      setFolderHandle(handle);
      setFolderName(handle.name);
      setFolderFiles(entries);
      setActiveSection('folder');
      setStatusMessage(`Folder loaded: ${handle.name}`);
    } catch {
      setStatusMessage('Folder open failed');
    } finally {
      setBusy(false);
    }
  };

  const chooseFolder = async () => {
    if (!canPickFolder) {
      setStatusMessage('Folder browser requires a Chromium browser');
      return;
    }
    try {
      const handle = await (window as unknown as {
        showDirectoryPicker(opts?: object): Promise<FileSystemDirectoryHandle>;
      }).showDirectoryPicker({ mode: 'read' });
      await loadFolder(handle);
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) setStatusMessage('Folder open failed');
    }
  };

  const handleInputFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text !== 'string') return;
      loadFromFile(text);
      setFileHandle(null);
      setCurrentDesignFile(designFileBaseName(file.name));
      addRecentFile({
        id: designRecentFileId('upload', file.name),
        name: file.name,
        source: 'upload',
      });
      setStatusMessage(`Opened ${file.name}`);
    };
    reader.onerror = () => setStatusMessage('Open failed');
    reader.readAsText(file);
  };

  const openRecent = async (id: string) => {
    const handle = getDesignRecentFileHandle(id);
    if (!handle) {
      setStatusMessage('Choose the file or folder again to reopen this recent item');
      return;
    }
    const recent = recentFiles.find((file) => file.id === id);
    const source = recent?.source === 'folder' || recent?.source === 'save'
      ? recent.source
      : 'picker';
    await openHandle(
      handle,
      source,
      recent?.displayPath,
    );
  };

  return (
    <div className="design-file-browser">
      <div className="browser-section-tabs" role="tablist" aria-label="File browser sections">
        <button
          className={`browser-section-tab${activeSection === 'recent' ? ' active' : ''}`}
          type="button"
          onClick={() => setActiveSection('recent')}
          role="tab"
          aria-selected={activeSection === 'recent'}
        >
          <Clock3 size={13} />
          Recent
        </button>
        <button
          className={`browser-section-tab${activeSection === 'folder' ? ' active' : ''}`}
          type="button"
          onClick={() => setActiveSection('folder')}
          role="tab"
          aria-selected={activeSection === 'folder'}
        >
          <FolderOpen size={13} />
          Folder
        </button>
      </div>

      <div className="file-browser-actions">
        <button type="button" className="file-browser-primary" onClick={openLocalFile}>
          <Upload size={13} />
          Open Design
        </button>
        <button type="button" className="file-browser-secondary" onClick={chooseFolder} disabled={!canPickFolder || busy}>
          {busy ? <Loader2 size={13} className="file-browser-spin" /> : <HardDrive size={13} />}
          Project Folder
        </button>
      </div>

      {activeSection === 'recent' ? (
        <div className="file-browser-list" aria-label="Recent design files">
          <div className="file-browser-list-header">
            <span>Latest files</span>
            {recentFiles.length > 0 && (
              <button type="button" className="file-browser-clear" onClick={clearRecentFiles} title="Clear recent files">
                <Trash2 size={12} />
              </button>
            )}
          </div>
          {recentFiles.length === 0 ? (
            <div className="file-browser-empty">Open a design to start this list.</div>
          ) : (
            recentFiles.map((file) => (
              <button
                type="button"
                className="file-browser-row"
                key={file.id}
                onClick={() => void openRecent(file.id)}
              >
                <FileJson size={15} className="file-browser-row-icon" />
                <span className="file-browser-row-main">
                  <span className="file-browser-row-name">{file.name}</span>
                  <span className="file-browser-row-meta">{file.displayPath ?? file.source}</span>
                </span>
                <span className="file-browser-row-date">{formatRecentTime(file.openedAt)}</span>
              </button>
            ))
          )}
        </div>
      ) : (
        <div className="file-browser-list" aria-label="Project folder design files">
          <div className="file-browser-list-header">
            <span>{folderName ?? 'Project folder'}</span>
            {folderHandle && (
              <button type="button" className="file-browser-clear" onClick={() => void loadFolder(folderHandle)} title="Refresh folder">
                <RefreshCw size={12} />
              </button>
            )}
          </div>
          {!canPickFolder ? (
            <div className="file-browser-empty">Folder browsing requires a Chromium browser.</div>
          ) : sortedFolderFiles.length === 0 ? (
            <div className="file-browser-empty">Choose a folder with .dznd files.</div>
          ) : (
            sortedFolderFiles.map((file) => (
              <button
                type="button"
                className="file-browser-row"
                key={file.id}
                onClick={() => void openHandle(file.handle, 'folder', folderName ? `${folderName}/${file.name}` : file.name)}
              >
                <FileJson size={15} className="file-browser-row-icon" />
                <span className="file-browser-row-main">
                  <span className="file-browser-row-name">{file.name}</span>
                  <span className="file-browser-row-meta">{formatFileSize(file.size)}</span>
                </span>
                <span className="file-browser-row-date">{formatRecentTime(file.modified)}</span>
              </button>
            ))
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".dznd,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) handleInputFile(file);
          if (inputRef.current) inputRef.current.value = '';
        }}
      />
    </div>
  );
}
