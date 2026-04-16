import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import './DuetFileManager.css';
import {
  Folder,
  File,
  Upload,
  FolderPlus,
  RefreshCw,
  Play,
  FlaskConical,
  Download,
  Pencil,
  Trash2,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Loader2,
  X,
  Image,
  FileCode,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import type { DuetFileInfo, DuetGCodeFileInfo } from '../../types/duet';
import DuetFileEditor from './DuetFileEditor';
import { formatDurationWords, formatFileSize, formatFilamentLength } from '../../utils/printerFormat';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  if (!dateStr) return '--';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

const formatDuration = (seconds: number | undefined | null) => formatDurationWords(seconds, '--', true);
const formatFilament = (mm: number) => formatFilamentLength(mm, '--');

function isGCodeFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.gcode') || lower.endsWith('.g') || lower.endsWith('.nc');
}

function isEditableFile(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith('.g') ||
    lower.endsWith('.gcode') ||
    lower.endsWith('.cfg') ||
    lower.endsWith('.csv') ||
    lower.endsWith('.json') ||
    lower.endsWith('.nc')
  );
}

// File manager directory tabs
interface FileTab {
  id: string;
  label: string;
  directory: string;
}

const FILE_TABS: FileTab[] = [
  { id: 'gcodes', label: 'G-Code Files', directory: '0:/gcodes' },
  { id: 'sys', label: 'System', directory: '0:/sys' },
  { id: 'filaments', label: 'Filaments', directory: '0:/filaments' },
];

type SortField = 'name' | 'size' | 'date';
type SortDir = 'asc' | 'desc';

function sortFiles(files: DuetFileInfo[], field: SortField, dir: SortDir): DuetFileInfo[] {
  const sorted = [...files];
  sorted.sort((a, b) => {
    // Directories always come first
    if (a.type !== b.type) return a.type === 'd' ? -1 : 1;

    let cmp = 0;
    switch (field) {
      case 'name':
        cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        break;
      case 'size':
        cmp = a.size - b.size;
        break;
      case 'date':
        cmp = new Date(a.date).getTime() - new Date(b.date).getTime();
        break;
    }
    return dir === 'asc' ? cmp : -cmp;
  });
  return sorted;
}


// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SortIcon({ field, current, dir }: { field: SortField; current: SortField; dir: SortDir }) {
  if (field !== current) return <ArrowUpDown size={12} style={{ opacity: 0.3 }} />;
  return dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
}

interface RenameDialogProps {
  currentName: string;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
}

function RenameDialog({ currentName, onConfirm, onCancel }: RenameDialogProps) {
  const [value, setValue] = useState(currentName);
  return (
    <div className="duet-file-mgr__dialog-overlay" onClick={onCancel}>
      <div className="duet-file-mgr__dialog" onClick={(e) => e.stopPropagation()}>
        <div className="duet-file-mgr__dialog-title">Rename</div>
        <input
          className="duet-file-mgr__dialog-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) onConfirm(value.trim());
            if (e.key === 'Escape') onCancel();
          }}
          autoFocus
        />
        <div className="duet-file-mgr__dialog-btns">
          <button className="duet-file-mgr__dialog-btn" onClick={onCancel}>Cancel</button>
          <button
            className="duet-file-mgr__dialog-btn--primary"
            onClick={() => value.trim() && onConfirm(value.trim())}
          >
            Rename
          </button>
        </div>
      </div>
    </div>
  );
}

interface NewFolderDialogProps {
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

function NewFolderDialog({ onConfirm, onCancel }: NewFolderDialogProps) {
  const [value, setValue] = useState('');
  return (
    <div className="duet-file-mgr__dialog-overlay" onClick={onCancel}>
      <div className="duet-file-mgr__dialog" onClick={(e) => e.stopPropagation()}>
        <div className="duet-file-mgr__dialog-title">New Folder</div>
        <input
          className="duet-file-mgr__dialog-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Folder name"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) onConfirm(value.trim());
            if (e.key === 'Escape') onCancel();
          }}
          autoFocus
        />
        <div className="duet-file-mgr__dialog-btns">
          <button className="duet-file-mgr__dialog-btn" onClick={onCancel}>Cancel</button>
          <button
            className="duet-file-mgr__dialog-btn--primary"
            onClick={() => value.trim() && onConfirm(value.trim())}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function FileInfoPanel({
  fileInfo,
  onClose,
}: {
  fileInfo: DuetGCodeFileInfo;
  onClose: () => void;
}) {
  const service = usePrinterStore((s) => s.service);
  const [thumbnailSrc, setThumbnailSrc] = useState<string | null>(null);
  const [thumbnailLoading, setThumbnailLoading] = useState(false);

  // Fetch the largest thumbnail when file info changes
  useEffect(() => {
    setThumbnailSrc(null);
    if (!service || !fileInfo.thumbnails || fileInfo.thumbnails.length === 0) return;

    // Pick the largest thumbnail by area
    const largest = [...fileInfo.thumbnails].sort(
      (a, b) => b.width * b.height - a.width * a.height,
    )[0];

    let cancelled = false;
    setThumbnailLoading(true);

    service
      .getThumbnail(fileInfo.fileName, largest.offset)
      .then((dataUrl) => {
        if (!cancelled && dataUrl) setThumbnailSrc(dataUrl);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setThumbnailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [service, fileInfo.fileName, fileInfo.thumbnails]);

  const rows: [string, string][] = [
    ['File', fileInfo.fileName.split('/').pop() || fileInfo.fileName],
    ['Size', formatFileSize(fileInfo.size)],
    ['Generated by', fileInfo.generatedBy || '--'],
    ['Object height', fileInfo.height > 0 ? `${fileInfo.height} mm` : '--'],
    ['Layer height', fileInfo.layerHeight > 0 ? `${fileInfo.layerHeight} mm` : '--'],
    ['First layer', fileInfo.firstLayerHeight > 0 ? `${fileInfo.firstLayerHeight} mm` : '--'],
    ['Layers', fileInfo.numLayers > 0 ? String(fileInfo.numLayers) : '--'],
    ['Print time (slicer)', formatDuration(fileInfo.printTime)],
    ['Simulated time', formatDuration(fileInfo.simulatedTime)],
    ['Last modified', formatDate(fileInfo.lastModified)],
  ];

  // Filament per extruder
  if (fileInfo.filament && fileInfo.filament.length > 0) {
    fileInfo.filament.forEach((mm, i) => {
      const label = fileInfo.filament.length === 1 ? 'Filament' : `Filament E${i}`;
      rows.push([label, formatFilament(mm)]);
    });
  }

  return (
    <div className="duet-file-mgr__info-panel">
      <button className="duet-file-mgr__close-info-btn" onClick={onClose} title="Close info panel">
        <X size={14} />
      </button>

      {/* Thumbnail display */}
      {fileInfo.thumbnails && fileInfo.thumbnails.length > 0 && (
        <div className="duet-file-mgr__thumbnail-center">
          {thumbnailLoading ? (
            <div className="duet-file-mgr__thumbnail-loading">
              <Loader2 size={16} className="spin" />
              Loading preview...
            </div>
          ) : thumbnailSrc ? (
            <img
              src={thumbnailSrc}
              alt="G-code thumbnail"
              className="duet-file-mgr__thumbnail"
            />
          ) : (
            <>
              <Image size={48} style={{ color: 'var(--border-strong)' }} />
              <div className="duet-file-mgr__thumbnail-caption">
                Thumbnail ({fileInfo.thumbnails[0].width}x{fileInfo.thumbnails[0].height})
              </div>
            </>
          )}
        </div>
      )}

      <div className="duet-file-mgr__info-panel-title">
        {fileInfo.fileName.split('/').pop() || fileInfo.fileName}
      </div>

      {rows.map(([label, value]) => (
        <div key={label} className="duet-file-mgr__info-row">
          <span className="duet-file-mgr__info-label">{label}</span>
          <span className="duet-file-mgr__info-value">{value}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function DuetFileManager() {
  const currentDirectory = usePrinterStore((s) => s.currentDirectory);
  const files = usePrinterStore((s) => s.files);
  const selectedFile = usePrinterStore((s) => s.selectedFile);
  const uploading = usePrinterStore((s) => s.uploading);
  const uploadProgress = usePrinterStore((s) => s.uploadProgress);
  const service = usePrinterStore((s) => s.service);
  const connected = usePrinterStore((s) => s.connected);

  const navigateToDirectory = usePrinterStore((s) => s.navigateToDirectory);
  const refreshFiles = usePrinterStore((s) => s.refreshFiles);
  const uploadFile = usePrinterStore((s) => s.uploadFile);
  const deleteFile = usePrinterStore((s) => s.deleteFile);
  const selectFile = usePrinterStore((s) => s.selectFile);
  const startPrint = usePrinterStore((s) => s.startPrint);
  const setError = usePrinterStore((s) => s.setError);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Tab bar state
  const [activeFileTab, setActiveFileTab] = useState<string>('gcodes');

  // File editor state
  const [editingFilePath, setEditingFilePath] = useState<string | null>(null);

  // Dialogs
  const [renameTarget, setRenameTarget] = useState<DuetFileInfo | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);

  // Sorted file list
  const sortedFiles = useMemo(() => sortFiles(files, sortField, sortDir), [files, sortField, sortDir]);

  // Current tab root directory
  const currentTabRoot = useMemo(
    () => FILE_TABS.find((t) => t.id === activeFileTab)?.directory ?? '0:/gcodes',
    [activeFileTab],
  );

  // Breadcrumb segments relative to the current tab root
  const breadcrumbs = useMemo(() => {
    const parts = currentDirectory.split('/').filter(Boolean);
    const rootParts = currentTabRoot.split('/').filter(Boolean);
    const crumbs: { label: string; path: string }[] = [];
    let acc = '';
    for (let i = 0; i < parts.length; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      // Show the root as the tab label, skip intermediate root parts
      if (i < rootParts.length - 1) continue;
      if (i === rootParts.length - 1) {
        const tab = FILE_TABS.find((t) => t.id === activeFileTab);
        crumbs.push({ label: tab?.label ?? parts[i], path: acc });
      } else {
        crumbs.push({ label: parts[i], path: acc });
      }
    }
    return crumbs;
  }, [currentDirectory, currentTabRoot, activeFileTab]);

  // Refresh on mount
  useEffect(() => {
    if (connected && service) {
      setLoading(true);
      refreshFiles().finally(() => setLoading(false));
    }
  }, [connected, service]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sort toggling
  const handleSort = useCallback(
    (field: SortField) => {
      if (field === sortField) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDir('asc');
      }
    },
    [sortField],
  );

  // Navigation
  const handleNavigate = useCallback(
    async (dir: string) => {
      setLoading(true);
      setSelectedName(null);
      try {
        await navigateToDirectory(dir);
      } finally {
        setLoading(false);
      }
    },
    [navigateToDirectory],
  );

  // Tab switching
  const handleTabSwitch = useCallback(
    async (tabId: string) => {
      const tab = FILE_TABS.find((t) => t.id === tabId);
      if (!tab) return;
      setActiveFileTab(tabId);
      setSelectedName(null);
      setLoading(true);
      try {
        await navigateToDirectory(tab.directory);
      } finally {
        setLoading(false);
      }
    },
    [navigateToDirectory],
  );

  // Open file in editor
  const handleEditFile = useCallback(
    (item: DuetFileInfo) => {
      setEditingFilePath(`${currentDirectory}/${item.name}`);
    },
    [currentDirectory],
  );

  // Click on a row
  const handleRowClick = useCallback(
    async (item: DuetFileInfo) => {
      if (item.type === 'd') {
        handleNavigate(`${currentDirectory}/${item.name}`);
      } else {
        setSelectedName(item.name);
        if (isGCodeFile(item.name)) {
          await selectFile(`${currentDirectory}/${item.name}`);
        }
      }
    },
    [currentDirectory, handleNavigate, selectFile],
  );

  // Upload via file picker
  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList) return;
      for (let i = 0; i < fileList.length; i++) {
        await uploadFile(fileList[i]);
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [uploadFile],
  );

  // Drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      const droppedFiles = e.dataTransfer.files;
      if (!droppedFiles || droppedFiles.length === 0) return;
      for (let i = 0; i < droppedFiles.length; i++) {
        await uploadFile(droppedFiles[i]);
      }
    },
    [uploadFile],
  );

  // Refresh
  const handleRefresh = useCallback(async () => {
    setLoading(true);
    try {
      await refreshFiles();
    } finally {
      setLoading(false);
    }
  }, [refreshFiles]);

  // New folder
  const handleNewFolder = useCallback(
    async (name: string) => {
      if (!service) return;
      setShowNewFolder(false);
      try {
        await service.createDirectory(`${currentDirectory}/${name}`);
        await refreshFiles();
      } catch (err) {
        setError(`Failed to create folder: ${(err as Error).message}`);
      }
    },
    [service, currentDirectory, refreshFiles, setError],
  );

  // Rename
  const handleRename = useCallback(
    async (newName: string) => {
      if (!service || !renameTarget) return;
      const oldPath = `${currentDirectory}/${renameTarget.name}`;
      const newPath = `${currentDirectory}/${newName}`;
      setRenameTarget(null);
      try {
        await service.moveFile(oldPath, newPath);
        await refreshFiles();
      } catch (err) {
        setError(`Rename failed: ${(err as Error).message}`);
      }
    },
    [service, renameTarget, currentDirectory, refreshFiles, setError],
  );

  // Delete
  const handleDelete = useCallback(
    async (item: DuetFileInfo) => {
      const path = `${currentDirectory}/${item.name}`;
      if (!confirm(`Delete "${item.name}"?`)) return;
      try {
        await deleteFile(path);
        if (selectedName === item.name) {
          setSelectedName(null);
        }
      } catch (err) {
        setError(`Delete failed: ${(err as Error).message}`);
      }
    },
    [currentDirectory, deleteFile, selectedName, setError],
  );

  // Start print
  const handlePrint = useCallback(
    async (item: DuetFileInfo) => {
      await startPrint(`${currentDirectory}/${item.name}`);
    },
    [currentDirectory, startPrint],
  );

  // Simulate
  const handleSimulate = useCallback(
    async (item: DuetFileInfo) => {
      if (!service) return;
      try {
        await service.simulateFile(`${currentDirectory}/${item.name}`);
      } catch (err) {
        setError(`Simulate failed: ${(err as Error).message}`);
      }
    },
    [service, currentDirectory, setError],
  );

  // Download
  const handleDownload = useCallback(
    async (item: DuetFileInfo) => {
      if (!service) return;
      try {
        const blob = await service.downloadFile(`${currentDirectory}/${item.name}`);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = item.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        setError(`Download failed: ${(err as Error).message}`);
      }
    },
    [service, currentDirectory, setError],
  );

  return (
    <div className="duet-file-mgr">
      {/* Tab bar */}
      <div className="duet-file-mgr__tab-bar">
        {FILE_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`duet-file-mgr__tab${activeFileTab === tab.id ? ' is-active' : ''}`}
            onClick={() => handleTabSwitch(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* System files warning */}
      {activeFileTab === 'sys' && (
        <div className="duet-file-mgr__warning-banner">
          <span className="duet-file-mgr__warning-icon">&#9888;</span>
          Editing system files can affect printer behavior. Be careful.
        </div>
      )}

      {/* Breadcrumbs */}
      <div className="duet-file-mgr__breadcrumbs">
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.path} className="duet-file-mgr__breadcrumb-wrap">
            {i > 0 && (
              <span className="duet-file-mgr__breadcrumb-sep">
                <ChevronRight size={12} />
              </span>
            )}
            <button
              className={`duet-file-mgr__breadcrumb-item${i === breadcrumbs.length - 1 ? ' is-current' : ''}`}
              onClick={() => handleNavigate(crumb.path)}
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </div>

      {/* Toolbar */}
      <div className="duet-file-mgr__toolbar">
        <button
          className="duet-file-mgr__toolbar-btn"
          onClick={handleUploadClick}
          disabled={uploading}
          title="Upload file"
        >
          <Upload size={14} />
          Upload
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={activeFileTab === 'gcodes' ? '.gcode,.g,.nc' : '.g,.gcode,.cfg,.csv,.json,.nc,.bin'}
          multiple
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        <button
          className="duet-file-mgr__toolbar-btn"
          onClick={() => setShowNewFolder(true)}
          title="New folder"
        >
          <FolderPlus size={14} />
          New Folder
        </button>

        <button
          className="duet-file-mgr__toolbar-btn"
          onClick={handleRefresh}
          disabled={loading}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
          Refresh
        </button>

        {uploading && (
          <div className="duet-file-mgr__progress-container">
            <div className="duet-file-mgr__progress-bar">
              <div className="duet-file-mgr__progress-fill" style={{ width: `${uploadProgress}%` }} />
            </div>
            <span className="duet-file-mgr__progress-text">{uploadProgress}%</span>
          </div>
        )}
      </div>

      {/* Body: file list + optional info panel */}
      <div className="duet-file-mgr__body">
        {/* File list with drag and drop */}
        <div
          className="duet-file-mgr__file-list"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {dragOver && (
            <div className="duet-file-mgr__drop-overlay">
              <Upload size={32} className="duet-file-mgr__drop-icon" />
              Drop files to upload
            </div>
          )}

          {loading ? (
            <div className="duet-file-mgr__loading">
              <Loader2 size={18} className="spin" />
              Loading...
            </div>
          ) : sortedFiles.length === 0 ? (
            <div className="duet-file-mgr__empty">This folder is empty</div>
          ) : (
            <table className="duet-file-mgr__table">
              <thead>
                <tr>
                  <th className="duet-file-mgr__th" style={{ width: 30 }}></th>
                  <th className="duet-file-mgr__th" onClick={() => handleSort('name')}>
                    <div className="duet-file-mgr__th-content">
                      Name <SortIcon field="name" current={sortField} dir={sortDir} />
                    </div>
                  </th>
                  <th className="duet-file-mgr__th" style={{ width: 90 }} onClick={() => handleSort('size')}>
                    <div className="duet-file-mgr__th-content">
                      Size <SortIcon field="size" current={sortField} dir={sortDir} />
                    </div>
                  </th>
                  <th className="duet-file-mgr__th" style={{ width: 160 }} onClick={() => handleSort('date')}>
                    <div className="duet-file-mgr__th-content">
                      Modified <SortIcon field="date" current={sortField} dir={sortDir} />
                    </div>
                  </th>
                  <th className="duet-file-mgr__th duet-file-mgr__th--no-sort" style={{ width: 150 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedFiles.map((item) => {
                  const isDir = item.type === 'd';
                  const isSelected = selectedName === item.name;
                  const isHovered = hoveredRow === item.name;
                  const isGCode = !isDir && isGCodeFile(item.name);

                  return (
                    <tr
                      key={item.name}
                      className={`duet-file-mgr__row${isSelected ? ' is-selected' : ''}`}
                      onClick={() => handleRowClick(item)}
                    >
                      {/* Icon */}
                      <td className="duet-file-mgr__td">
                        {isDir ? (
                          <Folder size={16} className="duet-file-mgr__icon--dir" />
                        ) : (
                          <File size={16} className="duet-file-mgr__icon--file" />
                        )}
                      </td>

                      {/* Name */}
                      <td className="duet-file-mgr__td">
                        <span className={isDir ? 'duet-file-mgr__name--dir' : 'duet-file-mgr__name--file'}>{item.name}</span>
                      </td>

                      {/* Size */}
                      <td className="duet-file-mgr__td duet-file-mgr__td--muted">
                        {isDir ? '--' : formatFileSize(item.size)}
                      </td>

                      {/* Modified */}
                      <td className="duet-file-mgr__td duet-file-mgr__td--muted duet-file-mgr__td--small">
                        {formatDate(item.date)}
                      </td>

                      {/* Actions */}
                      <td className="duet-file-mgr__td" onClick={(e) => e.stopPropagation()}>
                        <div className="duet-file-mgr__actions">
                          {isGCode && (
                            <>
                              <button
                                className="duet-file-mgr__action-btn"
                                title="Start print"
                                onClick={() => handlePrint(item)}
                              >
                                <Play size={14} className="duet-file-mgr__icon--play" />
                              </button>
                              <button
                                className="duet-file-mgr__action-btn"
                                title="Simulate"
                                onClick={() => handleSimulate(item)}
                              >
                                <FlaskConical size={14} className="duet-file-mgr__icon--simulate" />
                              </button>
                            </>
                          )}
                          {!isDir && isEditableFile(item.name) && (
                            <button
                              className="duet-file-mgr__action-btn"
                              title="Edit file"
                              onClick={() => handleEditFile(item)}
                            >
                              <FileCode size={14} className="duet-file-mgr__icon--edit" />
                            </button>
                          )}
                          {!isDir && (
                            <button
                              className="duet-file-mgr__action-btn"
                              title="Download"
                              onClick={() => handleDownload(item)}
                            >
                              <Download size={14} style={{ color: '#42a5f5' }} />
                            </button>
                          )}
                          <button
                            className="duet-file-mgr__action-btn"
                            title="Rename"
                            onClick={() => setRenameTarget(item)}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="duet-file-mgr__action-btn"
                            title="Delete"
                            onClick={() => handleDelete(item)}
                          >
                            <Trash2 size={14} style={{ color: '#ef5350' }} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Info panel for selected gcode file */}
        {selectedFile && (
          <FileInfoPanel
            fileInfo={selectedFile}
            onClose={() => {
              setSelectedName(null);
              usePrinterStore.setState({ selectedFile: null });
            }}
          />
        )}
      </div>

      {/* Dialogs */}
      {renameTarget && (
        <RenameDialog
          currentName={renameTarget.name}
          onConfirm={handleRename}
          onCancel={() => setRenameTarget(null)}
        />
      )}
      {showNewFolder && (
        <NewFolderDialog
          onConfirm={handleNewFolder}
          onCancel={() => setShowNewFolder(false)}
        />
      )}

      {/* File editor modal */}
      {editingFilePath && (
        <DuetFileEditor
          filePath={editingFilePath}
          onClose={() => {
            setEditingFilePath(null);
            // Refresh file list in case the file was saved
            handleRefresh();
          }}
        />
      )}
    </div>
  );
}
