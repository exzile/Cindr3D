import { useState, useCallback, useRef } from 'react';
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
} from 'lucide-react';
import { usePrinterStore } from '../store/printerStore';

export default function DuetMacros() {
  const connected = usePrinterStore((s) => s.connected);
  const macros = usePrinterStore((s) => s.macros);
  const macroPath = usePrinterStore((s) => s.macroPath);
  const refreshMacros = usePrinterStore((s) => s.refreshMacros);
  const navigateMacros = usePrinterStore((s) => s.navigateMacros);
  const runMacro = usePrinterStore((s) => s.runMacro);
  const service = usePrinterStore((s) => s.service);
  const setError = usePrinterStore((s) => s.setError);

  const [runningMacro, setRunningMacro] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ROOT_PATH = '0:/macros';

  // Build breadcrumb segments from macroPath
  const breadcrumbs = (() => {
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
  })();

  const isAtRoot = macroPath === ROOT_PATH;

  // Quick macros: .g files at root level (only shown when at root)
  const quickMacros = isAtRoot
    ? macros.filter((f) => f.type === 'f' && f.name.endsWith('.g')).slice(0, 6)
    : [];

  const folders = macros.filter((f) => f.type === 'd');
  const files = macros.filter((f) => f.type === 'f');

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
        setError(`Macro upload failed: ${(err as Error).message}`);
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
        setError(`Failed to delete macro: ${(err as Error).message}`);
      } finally {
        setDeleting(null);
      }
    },
    [macroPath, service, refreshMacros, setError],
  );

  if (!connected) {
    return (
      <div className="duet-macros-empty">
        <p>Connect to a printer to manage macros.</p>
      </div>
    );
  }

  return (
    <div className="duet-macros">
      {/* Toolbar */}
      <div className="duet-macros-toolbar">
        <button className="icon-btn" onClick={refreshMacros} title="Refresh macros">
          <RefreshCw size={14} />
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
      <div className="duet-macros-list">
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
    </div>
  );
}
