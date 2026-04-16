import {
  Home, Save, FolderOpen, Undo2, Redo2, FileUp, Download,
  Moon, Sun, Bell, HelpCircle, Printer, Settings, User,
} from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import { usePrinterStore } from '../../store/printerStore';
import { useThemeStore } from '../../store/themeStore';

interface QuickAccessBarProps {
  fileInputRef: React.RefObject<HTMLInputElement>;
  loadFileInputRef: React.RefObject<HTMLInputElement>;
  onImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function QuickAccessBar({ fileInputRef, loadFileInputRef, onImport }: QuickAccessBarProps) {
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const theme = useThemeStore((s) => s.theme);

  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const undoStackLength = useCADStore((s) => s.undoStack.length);
  const redoStackLength = useCADStore((s) => s.redoStack.length);
  const undoAction = useCADStore((s) => s.undo);
  const redoAction = useCADStore((s) => s.redo);
  const saveToFile = useCADStore((s) => s.saveToFile);
  const loadFromFile = useCADStore((s) => s.loadFromFile);
  const setShowExportDialog = useCADStore((s) => s.setShowExportDialog);

  const showPrinter = usePrinterStore((s) => s.showPrinter);
  const setShowPrinter = usePrinterStore((s) => s.setShowPrinter);
  const setShowSettings = usePrinterStore((s) => s.setShowSettings);
  const printerConnected = usePrinterStore((s) => s.connected);

  return (
    <div className="ribbon-quick-access">
      <div className="ribbon-quick-left">
        <button className="ribbon-quick-btn" title="Home" onClick={() => setStatusMessage('Dzign3D Home')}>
          <Home size={14} />
        </button>
        <div className="ribbon-quick-divider" />
        <button className="ribbon-quick-btn" title="Save (.dzn)" onClick={saveToFile}>
          <Save size={14} />
        </button>
        <button className="ribbon-quick-btn" title="Open (.dzn)" onClick={() => loadFileInputRef.current?.click()}>
          <FolderOpen size={14} />
        </button>
        <button
          className={`ribbon-quick-btn${undoStackLength === 0 ? ' ribbon-quick-btn-disabled' : ''}`}
          title="Undo (Ctrl+Z)"
          onClick={undoAction}
          disabled={undoStackLength === 0}
        >
          <Undo2 size={14} />
        </button>
        <button
          className={`ribbon-quick-btn${redoStackLength === 0 ? ' ribbon-quick-btn-disabled' : ''}`}
          title="Redo (Ctrl+Y)"
          onClick={redoAction}
          disabled={redoStackLength === 0}
        >
          <Redo2 size={14} />
        </button>
        <div className="ribbon-quick-divider" />
        <button className="ribbon-quick-btn" title="Import" onClick={() => fileInputRef.current?.click()}>
          <FileUp size={14} />
        </button>
        <button className="ribbon-quick-btn" title="Export" onClick={() => setShowExportDialog(true)}>
          <Download size={14} />
        </button>
        <input ref={fileInputRef} type="file" accept=".step,.stp,.f3d,.stl,.obj" hidden onChange={onImport} />
        <input
          ref={loadFileInputRef}
          type="file"
          accept=".dzn,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (evt) => {
              const text = evt.target?.result as string;
              if (text) loadFromFile(text);
            };
            reader.readAsText(file);
            if (loadFileInputRef.current) loadFileInputRef.current.value = '';
          }}
        />
      </div>
      <div className="ribbon-quick-center">
        <span className="ribbon-title">Untitled - Dzign3D</span>
      </div>
      <div className="ribbon-quick-right">
        <button className="ribbon-quick-btn" title="Toggle theme" onClick={toggleTheme}>
          {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
        </button>
        <button className="ribbon-quick-btn" title="Notifications" onClick={() => setStatusMessage('Notifications')}>
          <Bell size={14} />
        </button>
        <button className="ribbon-quick-btn" title="Help" onClick={() => setStatusMessage('Help')}>
          <HelpCircle size={14} />
        </button>
        <button
          className={`ribbon-quick-btn ${printerConnected ? 'connected' : ''}`}
          title={printerConnected ? 'Printer Monitor' : 'Printer Setup'}
          onClick={() => printerConnected ? setShowPrinter(!showPrinter) : setShowSettings(true)}
        >
          <Printer size={14} />
        </button>
        <button className="ribbon-quick-btn" title="Settings" onClick={() => setStatusMessage('Settings: coming soon')}>
          <Settings size={14} />
        </button>
        <div className="ribbon-quick-divider" />
        <button className="ribbon-quick-btn user-btn" title="Profile">
          <User size={14} />
        </button>
      </div>
    </div>
  );
}
