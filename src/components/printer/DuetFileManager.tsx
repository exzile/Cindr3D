import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
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
// Styles
// ---------------------------------------------------------------------------

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    backgroundColor: '#1e1e1e',
    color: '#ccc',
    fontSize: 13,
    overflow: 'hidden',
  },
  tabBar: {
    display: 'flex',
    alignItems: 'stretch',
    backgroundColor: '#252526',
    borderBottom: '1px solid #333',
    padding: 0,
    gap: 0,
  },
  tab: {
    padding: '8px 18px',
    fontSize: 12,
    fontWeight: 500,
    color: '#999',
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    cursor: 'pointer',
    transition: 'color 0.15s, border-color 0.15s',
    whiteSpace: 'nowrap' as const,
    fontFamily: 'inherit',
  } as React.CSSProperties,
  tabActive: {
    color: '#e0e0e0',
    borderBottomColor: '#0078d4',
    fontWeight: 600,
  },
  warningBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    backgroundColor: 'rgba(255, 152, 0, 0.12)',
    borderBottom: '1px solid rgba(255, 152, 0, 0.25)',
    fontSize: 12,
    color: '#ffab40',
  },
  breadcrumbs: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    padding: '6px 10px',
    backgroundColor: '#252526',
    borderBottom: '1px solid #333',
    fontSize: 12,
    flexWrap: 'wrap' as const,
    minHeight: 32,
  },
  breadcrumbItem: {
    cursor: 'pointer',
    color: '#4fc3f7',
    padding: '2px 4px',
    borderRadius: 3,
    border: 'none',
    background: 'none',
    fontSize: 12,
    fontFamily: 'inherit',
  } as React.CSSProperties,
  breadcrumbSep: {
    color: '#666',
    display: 'flex',
    alignItems: 'center',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 10px',
    backgroundColor: '#2d2d2d',
    borderBottom: '1px solid #333',
  },
  toolbarBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 10px',
    fontSize: 12,
    border: '1px solid #555',
    borderRadius: 4,
    background: '#353535',
    color: '#ccc',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  progressContainer: {
    flex: 1,
    marginLeft: 10,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  progressBar: {
    flex: 1,
    height: 6,
    backgroundColor: '#444',
    borderRadius: 3,
    overflow: 'hidden' as const,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4caf50',
    borderRadius: 3,
    transition: 'width 0.2s',
  },
  progressText: {
    fontSize: 11,
    color: '#aaa',
    whiteSpace: 'nowrap' as const,
  },
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  fileListContainer: {
    flex: 1,
    overflow: 'auto',
    position: 'relative' as const,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
  },
  th: {
    position: 'sticky' as const,
    top: 0,
    backgroundColor: '#2d2d2d',
    textAlign: 'left' as const,
    padding: '6px 10px',
    fontSize: 11,
    fontWeight: 600,
    color: '#aaa',
    borderBottom: '1px solid #444',
    cursor: 'pointer',
    userSelect: 'none' as const,
    whiteSpace: 'nowrap' as const,
  },
  thContent: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  td: {
    padding: '5px 10px',
    borderBottom: '1px solid #2a2a2a',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  } as React.CSSProperties,
  row: {
    cursor: 'pointer',
    transition: 'background-color 0.1s',
  },
  rowHover: {
    backgroundColor: '#2a2d30',
  },
  rowSelected: {
    backgroundColor: '#264f78',
  },
  nameCell: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  actionBtn: {
    background: 'none',
    border: 'none',
    color: '#888',
    cursor: 'pointer',
    padding: '2px 4px',
    borderRadius: 3,
    display: 'inline-flex',
    alignItems: 'center',
  },
  actions: {
    display: 'flex',
    gap: 2,
    alignItems: 'center',
  },
  infoPanel: {
    width: 280,
    borderLeft: '1px solid #333',
    backgroundColor: '#252526',
    overflow: 'auto',
    padding: 12,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
    fontSize: 12,
  },
  infoPanelTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: '#e0e0e0',
    marginBottom: 4,
    wordBreak: 'break-all' as const,
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
  },
  infoLabel: {
    color: '#888',
    flexShrink: 0,
  },
  infoValue: {
    color: '#ccc',
    textAlign: 'right' as const,
    wordBreak: 'break-all' as const,
  },
  thumbnail: {
    width: '100%',
    borderRadius: 4,
    backgroundColor: '#1e1e1e',
    border: '1px solid #333',
  },
  dropOverlay: {
    position: 'absolute' as const,
    inset: 0,
    backgroundColor: 'rgba(33, 150, 243, 0.15)',
    border: '2px dashed #2196f3',
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    color: '#2196f3',
    fontWeight: 600,
    zIndex: 10,
    pointerEvents: 'none' as const,
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    color: '#888',
    gap: 8,
  },
  empty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    color: '#666',
  },
  closeInfoBtn: {
    background: 'none',
    border: 'none',
    color: '#888',
    cursor: 'pointer',
    padding: 2,
    display: 'flex',
    alignSelf: 'flex-end',
  },
  dialogOverlay: {
    position: 'fixed' as const,
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: {
    backgroundColor: '#2d2d2d',
    border: '1px solid #555',
    borderRadius: 6,
    padding: 20,
    minWidth: 320,
    color: '#ccc',
  },
  dialogTitle: {
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 12,
  },
  dialogInput: {
    width: '100%',
    padding: '6px 8px',
    fontSize: 13,
    border: '1px solid #555',
    borderRadius: 4,
    backgroundColor: '#1e1e1e',
    color: '#ccc',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  dialogBtns: {
    display: 'flex',
    gap: 8,
    justifyContent: 'flex-end',
    marginTop: 14,
  },
  dialogBtn: {
    padding: '5px 14px',
    fontSize: 12,
    border: '1px solid #555',
    borderRadius: 4,
    cursor: 'pointer',
    background: '#353535',
    color: '#ccc',
  },
  dialogBtnPrimary: {
    padding: '5px 14px',
    fontSize: 12,
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    background: '#0078d4',
    color: '#fff',
  },
} as const;

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
    <div style={styles.dialogOverlay} onClick={onCancel}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={styles.dialogTitle}>Rename</div>
        <input
          style={styles.dialogInput}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) onConfirm(value.trim());
            if (e.key === 'Escape') onCancel();
          }}
          autoFocus
        />
        <div style={styles.dialogBtns}>
          <button style={styles.dialogBtn} onClick={onCancel}>Cancel</button>
          <button
            style={styles.dialogBtnPrimary}
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
    <div style={styles.dialogOverlay} onClick={onCancel}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={styles.dialogTitle}>New Folder</div>
        <input
          style={styles.dialogInput}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Folder name"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) onConfirm(value.trim());
            if (e.key === 'Escape') onCancel();
          }}
          autoFocus
        />
        <div style={styles.dialogBtns}>
          <button style={styles.dialogBtn} onClick={onCancel}>Cancel</button>
          <button
            style={styles.dialogBtnPrimary}
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
    <div style={styles.infoPanel}>
      <button style={styles.closeInfoBtn} onClick={onClose} title="Close info panel">
        <X size={14} />
      </button>

      {/* Thumbnail display */}
      {fileInfo.thumbnails && fileInfo.thumbnails.length > 0 && (
        <div style={{ textAlign: 'center', marginBottom: 4 }}>
          {thumbnailLoading ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: 120,
                color: '#666',
                gap: 6,
              }}
            >
              <Loader2 size={16} className="spin" />
              Loading preview...
            </div>
          ) : thumbnailSrc ? (
            <img
              src={thumbnailSrc}
              alt="G-code thumbnail"
              style={styles.thumbnail}
            />
          ) : (
            <>
              <Image size={48} style={{ color: '#555' }} />
              <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                Thumbnail ({fileInfo.thumbnails[0].width}x{fileInfo.thumbnails[0].height})
              </div>
            </>
          )}
        </div>
      )}

      <div style={styles.infoPanelTitle}>
        {fileInfo.fileName.split('/').pop() || fileInfo.fileName}
      </div>

      {rows.map(([label, value]) => (
        <div key={label} style={styles.infoRow}>
          <span style={styles.infoLabel}>{label}</span>
          <span style={styles.infoValue}>{value}</span>
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
    <div style={styles.container}>
      {/* Tab bar */}
      <div style={styles.tabBar}>
        {FILE_TABS.map((tab) => (
          <button
            key={tab.id}
            style={{
              ...styles.tab,
              ...(activeFileTab === tab.id ? styles.tabActive : {}),
            }}
            onClick={() => handleTabSwitch(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* System files warning */}
      {activeFileTab === 'sys' && (
        <div style={styles.warningBanner}>
          <span style={{ fontSize: 14 }}>&#9888;</span>
          Editing system files can affect printer behavior. Be careful.
        </div>
      )}

      {/* Breadcrumbs */}
      <div style={styles.breadcrumbs}>
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.path} style={{ display: 'flex', alignItems: 'center' }}>
            {i > 0 && (
              <span style={styles.breadcrumbSep}>
                <ChevronRight size={12} />
              </span>
            )}
            <button
              style={{
                ...styles.breadcrumbItem,
                color: i === breadcrumbs.length - 1 ? '#ccc' : '#4fc3f7',
                fontWeight: i === breadcrumbs.length - 1 ? 600 : 400,
              }}
              onClick={() => handleNavigate(crumb.path)}
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </div>

      {/* Toolbar */}
      <div style={styles.toolbar}>
        <button
          style={styles.toolbarBtn}
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
          style={styles.toolbarBtn}
          onClick={() => setShowNewFolder(true)}
          title="New folder"
        >
          <FolderPlus size={14} />
          New Folder
        </button>

        <button
          style={styles.toolbarBtn}
          onClick={handleRefresh}
          disabled={loading}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
          Refresh
        </button>

        {uploading && (
          <div style={styles.progressContainer}>
            <div style={styles.progressBar}>
              <div style={{ ...styles.progressFill, width: `${uploadProgress}%` }} />
            </div>
            <span style={styles.progressText}>{uploadProgress}%</span>
          </div>
        )}
      </div>

      {/* Body: file list + optional info panel */}
      <div style={styles.body}>
        {/* File list with drag and drop */}
        <div
          style={styles.fileListContainer}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {dragOver && (
            <div style={styles.dropOverlay}>
              <Upload size={32} style={{ marginRight: 8 }} />
              Drop files to upload
            </div>
          )}

          {loading ? (
            <div style={styles.loading}>
              <Loader2 size={18} className="spin" />
              Loading...
            </div>
          ) : sortedFiles.length === 0 ? (
            <div style={styles.empty}>This folder is empty</div>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={{ ...styles.th, width: 30 }}></th>
                  <th style={styles.th} onClick={() => handleSort('name')}>
                    <div style={styles.thContent}>
                      Name <SortIcon field="name" current={sortField} dir={sortDir} />
                    </div>
                  </th>
                  <th style={{ ...styles.th, width: 90 }} onClick={() => handleSort('size')}>
                    <div style={styles.thContent}>
                      Size <SortIcon field="size" current={sortField} dir={sortDir} />
                    </div>
                  </th>
                  <th style={{ ...styles.th, width: 160 }} onClick={() => handleSort('date')}>
                    <div style={styles.thContent}>
                      Modified <SortIcon field="date" current={sortField} dir={sortDir} />
                    </div>
                  </th>
                  <th style={{ ...styles.th, width: 150, cursor: 'default' }}>Actions</th>
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
                      style={{
                        ...styles.row,
                        ...(isSelected ? styles.rowSelected : isHovered ? styles.rowHover : {}),
                      }}
                      onMouseEnter={() => setHoveredRow(item.name)}
                      onMouseLeave={() => setHoveredRow(null)}
                      onClick={() => handleRowClick(item)}
                    >
                      {/* Icon */}
                      <td style={styles.td}>
                        {isDir ? (
                          <Folder size={16} style={{ color: '#e8a838' }} />
                        ) : (
                          <File size={16} style={{ color: '#888' }} />
                        )}
                      </td>

                      {/* Name */}
                      <td style={styles.td}>
                        <span style={{ color: isDir ? '#e8a838' : '#ccc' }}>{item.name}</span>
                      </td>

                      {/* Size */}
                      <td style={{ ...styles.td, color: '#999' }}>
                        {isDir ? '--' : formatFileSize(item.size)}
                      </td>

                      {/* Modified */}
                      <td style={{ ...styles.td, color: '#999', fontSize: 11 }}>
                        {formatDate(item.date)}
                      </td>

                      {/* Actions */}
                      <td style={styles.td} onClick={(e) => e.stopPropagation()}>
                        <div style={styles.actions}>
                          {isGCode && (
                            <>
                              <button
                                style={styles.actionBtn}
                                title="Start print"
                                onClick={() => handlePrint(item)}
                              >
                                <Play size={14} style={{ color: '#4caf50' }} />
                              </button>
                              <button
                                style={styles.actionBtn}
                                title="Simulate"
                                onClick={() => handleSimulate(item)}
                              >
                                <FlaskConical size={14} style={{ color: '#ab47bc' }} />
                              </button>
                            </>
                          )}
                          {!isDir && isEditableFile(item.name) && (
                            <button
                              style={styles.actionBtn}
                              title="Edit file"
                              onClick={() => handleEditFile(item)}
                            >
                              <FileCode size={14} style={{ color: '#66bb6a' }} />
                            </button>
                          )}
                          {!isDir && (
                            <button
                              style={styles.actionBtn}
                              title="Download"
                              onClick={() => handleDownload(item)}
                            >
                              <Download size={14} style={{ color: '#42a5f5' }} />
                            </button>
                          )}
                          <button
                            style={styles.actionBtn}
                            title="Rename"
                            onClick={() => setRenameTarget(item)}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            style={styles.actionBtn}
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
