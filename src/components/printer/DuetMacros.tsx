import { useState, useCallback, useRef, useMemo } from 'react';
import './DuetMacros.css';
import { errorMessage } from '../../utils/errorHandling';
import {
  Play,
  FolderOpen,
  ChevronRight,
  RefreshCw,
  Upload,
  Trash2,
  Loader2,
  Home,
  Zap,
  FilePlus,
  Pencil,
  Search,
} from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import DuetFileEditor from './DuetFileEditor';

const ROOT_PATH = '0:/macros';

export default function DuetMacros() {
  const macros = usePrinterStore((s) => s.macros);
  const macroPath = usePrinterStore((s) => s.macroPath);
  const refreshMacros = usePrinterStore((s) => s.refreshMacros);
  const navigateMacros = usePrinterStore((s) => s.navigateMacros);
  const runMacro = usePrinterStore((s) => s.runMacro);
  const service = usePrinterStore((s) => s.service);
  const setError = usePrinterStore((s) => s.setError);

  const [runningMacro, setRunningMacro] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [macroSearch, setMacroSearch] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAtRoot = macroPath === ROOT_PATH;

  const breadcrumbs = useMemo(() => {
    const parts: { label: string; path: string }[] = [{ label: 'Macros', path: ROOT_PATH }];
    if (macroPath !== ROOT_PATH) {
      const relative = macroPath.slice(ROOT_PATH.length + 1);
      const segments = relative.split('/').filter(Boolean);
      let accumulated = ROOT_PATH;
      for (const seg of segments) {
        accumulated += '/' + seg;
        parts.push({ label: seg, path: accumulated });
      }
    }
    return parts;
  }, [macroPath]);

  const { folders, files, quickMacros } = useMemo(() => {
    const lowerSearch = macroSearch.toLowerCase();
    const matched = macros.filter((f) => !macroSearch || f.name.toLowerCase().includes(lowerSearch));
    return {
      folders: matched.filter((f) => f.type === 'd'),
      files: matched.filter((f) => f.type === 'f'),
      quickMacros: isAtRoot
        ? macros.filter((f) => f.type === 'f' && f.name.endsWith('.g')).slice(0, 6)
        : [],
    };
  }, [macros, macroSearch, isAtRoot]);

  const handleRunMacro = useCallback(
    async (filename: string) => {
      setRunningMacro(filename);
      try {
        await runMacro(filename);
      } finally {
        setRunningMacro(null);
      }
    },
    [runMacro],
  );

  const handleNavigateFolder = useCallback(
    (folderName: string) => {
      navigateMacros(macroPath + '/' + folderName);
    },
    [macroPath, navigateMacros],
  );

  const handleBreadcrumbClick = useCallback(
    (path: string) => {
      navigateMacros(path);
    },
    [navigateMacros],
  );

  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !service) return;
      try {
        const uploadPath = `${macroPath}/${file.name}`;
        await service.uploadFile(uploadPath, file);
        refreshMacros();
      } catch (err) {
        setError(`Macro upload failed: ${errorMessage(err, 'Unknown error')}`);
      }
      // Reset input so the same file can be uploaded again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [macroPath, service, refreshMacros, setError],
  );

  const handleDelete = useCallback(
    async (filename: string) => {
      if (!confirm(`Delete macro "${filename}"?`)) return;
      setDeleting(filename);
      try {
        const fullPath = `${macroPath}/${filename}`;
        if (service) {
          await service.deleteFile(fullPath);
        }
        refreshMacros();
      } catch (err) {
        setError(`Failed to delete macro: ${errorMessage(err, 'Unknown error')}`);
      } finally {
        setDeleting(null);
      }
    },
    [macroPath, service, refreshMacros, setError],
  );

  const handleNewMacro = useCallback(() => {
    const name = window.prompt('Enter new macro filename (e.g. my_macro.g):');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    const fileName = trimmed.includes('.') ? trimmed : trimmed + '.g';
    setEditingPath(`${macroPath}/${fileName}`);
    setCreatingNew(true);
  }, [macroPath]);

  const handleEditMacro = useCallback(
    (filename: string) => {
      setEditingPath(`${macroPath}/${filename}`);
      setCreatingNew(false);
    },
    [macroPath],
  );

  const handleEditorClose = useCallback(() => {
    setEditingPath(null);
    setCreatingNew(false);
    refreshMacros();
  }, [refreshMacros]);

  // Drag-and-drop handlers
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
      if (!droppedFiles || droppedFiles.length === 0 || !service) return;
      for (let i = 0; i < droppedFiles.length; i++) {
        try {
          const uploadPath = `${macroPath}/${droppedFiles[i].name}`;
          await service.uploadFile(uploadPath, droppedFiles[i]);
        } catch (err) {
          setError(`Macro upload failed: ${errorMessage(err, 'Unknown error')}`);
        }
      }
      refreshMacros();
    },
    [macroPath, service, refreshMacros, setError],
  );

  return (
    <div className="duet-macros">
      {/* Toolbar */}
      <div className="duet-macros-toolbar">
        <button className="icon-btn" onClick={refreshMacros} title="Refresh macros">
          <RefreshCw size={14} />
        </button>
        <button className="icon-btn" onClick={handleNewMacro} title="New macro">
          <FilePlus size={14} />
        </button>
        <button
          className="icon-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Upload macro"
        >
          <Upload size={14} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".g,.gcode,.macro"
          style={{ display: 'none' }}
          onChange={handleUpload}
        />
        <div className="duet-macros-search-wrap">
          <Search size={12} className="duet-macros-search-icon" />
          <input
            type="text"
            value={macroSearch}
            onChange={(e) => setMacroSearch(e.target.value)}
            placeholder="Filter macros..."
            className="duet-macros-search-input"
            spellCheck={false}
          />
          {macroSearch && (
            <button
              className="duet-macros-search-clear"
              onClick={() => setMacroSearch('')}
              title="Clear search"
            >
              x
            </button>
          )}
        </div>
      </div>

      {/* Breadcrumb navigation */}
      <div className="duet-macros-breadcrumbs">
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.path} className="breadcrumb-segment">
            {i > 0 && <ChevronRight size={12} className="breadcrumb-sep" />}
            <button
              className={`breadcrumb-btn ${i === breadcrumbs.length - 1 ? 'active' : ''}`}
              onClick={() => handleBreadcrumbClick(crumb.path)}
              disabled={i === breadcrumbs.length - 1}
            >
              {i === 0 ? <Home size={12} /> : null}
              <span>{crumb.label}</span>
            </button>
          </span>
        ))}
      </div>

      {/* Quick macro buttons (root only) */}
      {quickMacros.length > 0 && (
        <div className="duet-macros-quick">
          <div className="quick-label">
            <Zap size={12} /> Quick Actions
          </div>
          <div className="quick-buttons">
            {quickMacros.map((macro) => (
              <button
                key={macro.name}
                className="quick-macro-btn"
                onClick={() => handleRunMacro(macro.name)}
                disabled={runningMacro !== null}
                title={`Run ${macro.name}`}
              >
                {runningMacro === macro.name ? (
                  <Loader2 size={12} className="spin" />
                ) : (
                  <Play size={12} />
                )}
                <span>{macro.name.replace(/\.g$/, '')}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Macro list */}
      <div
        className="duet-macros-list"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {dragOver && (
          <div className="duet-macros-drop-overlay">
            <Upload size={28} className="duet-macros-drop-icon" />
            Drop files to upload macros
          </div>
        )}

        {folders.length === 0 && files.length === 0 && (
          <div className="duet-macros-empty">No macros in this directory.</div>
        )}

        {/* Folders */}
        {folders.map((folder) => (
          <div
            key={folder.name}
            className="macro-item folder"
            onClick={() => handleNavigateFolder(folder.name)}
          >
            <FolderOpen size={14} className="macro-icon" />
            <span className="macro-name">{folder.name}</span>
            <ChevronRight size={14} className="macro-chevron" />
          </div>
        ))}

        {/* Files */}
        {files.map((file) => (
          <div key={file.name} className="macro-item file">
            <span className="macro-name" title={file.name}>
              {file.name}
            </span>
            <div className="macro-actions">
              <button
                className="icon-btn"
                onClick={() => handleEditMacro(file.name)}
                title={`Edit ${file.name}`}
              >
                <Pencil size={14} />
              </button>
              <button
                className="icon-btn"
                onClick={() => handleRunMacro(file.name)}
                disabled={runningMacro !== null}
                title={`Run ${file.name}`}
              >
                {runningMacro === file.name ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Play size={14} />
                )}
              </button>
              <button
                className="icon-btn danger"
                onClick={() => handleDelete(file.name)}
                disabled={deleting === file.name}
                title={`Delete ${file.name}`}
              >
                {deleting === file.name ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Trash2 size={14} />
                )}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Running indicator */}
      {runningMacro && (
        <div className="duet-macros-running">
          <Loader2 size={14} className="spin" />
          <span>Running: {runningMacro}</span>
        </div>
      )}

      {/* File editor modal */}
      {editingPath && (
        <DuetFileEditor
          filePath={editingPath}
          onClose={handleEditorClose}
          isNew={creatingNew}
        />
      )}
    </div>
  );
}
