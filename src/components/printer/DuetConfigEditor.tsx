import { useState } from 'react';
import {
  FileCode2, FolderOpen, ChevronRight, Settings2,
  Home, Layers, Play, Zap, Wrench, Plus, FileText,
} from 'lucide-react';
import DuetFileEditor from './DuetFileEditor';
import { usePrinterStore } from '../../store/printerStore';
import './config/DuetConfigEditor.css';

// ---------------------------------------------------------------------------
// Config file catalogue
// ---------------------------------------------------------------------------

interface ConfigFile {
  path: string;
  label: string;
  desc: string;
}

interface ConfigGroup {
  id: string;
  label: string;
  Icon: React.ComponentType<{ size?: number }>;
  files: ConfigFile[];
}

const CONFIG_GROUPS: ConfigGroup[] = [
  {
    id: 'core',
    label: 'System',
    Icon: Settings2,
    files: [
      { path: '0:/sys/config.g',          label: 'config.g',          desc: 'Main machine configuration — runs on boot' },
      { path: '0:/sys/config-override.g', label: 'config-override.g', desc: 'Runtime overrides saved by M500' },
    ],
  },
  {
    id: 'homing',
    label: 'Homing',
    Icon: Home,
    files: [
      { path: '0:/sys/homeall.g', label: 'homeall.g', desc: 'Home all axes (G28)' },
      { path: '0:/sys/homex.g',   label: 'homex.g',   desc: 'Home X axis' },
      { path: '0:/sys/homey.g',   label: 'homey.g',   desc: 'Home Y axis' },
      { path: '0:/sys/homez.g',   label: 'homez.g',   desc: 'Home Z axis' },
    ],
  },
  {
    id: 'bed',
    label: 'Bed',
    Icon: Layers,
    files: [
      { path: '0:/sys/bed.g',            label: 'bed.g',            desc: 'Bed leveling / mesh compensation (G32)' },
      { path: '0:/sys/deployprobe.g',    label: 'deployprobe.g',    desc: 'Deploy the Z probe' },
      { path: '0:/sys/retractprobe.g',   label: 'retractprobe.g',   desc: 'Retract the Z probe' },
    ],
  },
  {
    id: 'lifecycle',
    label: 'Print Lifecycle',
    Icon: Play,
    files: [
      { path: '0:/sys/start.g',  label: 'start.g',  desc: 'Runs at the start of every print' },
      { path: '0:/sys/stop.g',   label: 'stop.g',   desc: 'Runs when a print finishes normally' },
      { path: '0:/sys/pause.g',  label: 'pause.g',  desc: 'Runs when a print is paused' },
      { path: '0:/sys/resume.g', label: 'resume.g', desc: 'Runs when a paused print is resumed' },
      { path: '0:/sys/cancel.g', label: 'cancel.g', desc: 'Runs when a print is cancelled' },
    ],
  },
  {
    id: 'toolchange',
    label: 'Tool Change (T0)',
    Icon: Wrench,
    files: [
      { path: '0:/sys/tpre0.g',  label: 'tpre0.g',  desc: 'Runs before tool 0 is selected' },
      { path: '0:/sys/tpost0.g', label: 'tpost0.g', desc: 'Runs after tool 0 is selected' },
      { path: '0:/sys/tfree0.g', label: 'tfree0.g', desc: 'Runs when tool 0 is deselected' },
    ],
  },
  {
    id: 'other',
    label: 'Other',
    Icon: Zap,
    files: [
      { path: '0:/sys/sleep.g',                label: 'sleep.g',                desc: 'Runs when the machine goes to sleep (M1)' },
      { path: '0:/sys/resurrect-prologue.g',   label: 'resurrect-prologue.g',   desc: 'Print-recovery preamble' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Browse modal — lets the user type an arbitrary path
// ---------------------------------------------------------------------------

function BrowseModal({ onOpen, onClose }: { onOpen: (path: string) => void; onClose: () => void }) {
  const [path, setPath] = useState('0:/sys/');
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: '#2d2d2d', border: '1px solid #555', borderRadius: 8, padding: 20, minWidth: 420, color: '#ccc', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Open file</div>
        <input
          style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #555', borderRadius: 4, background: '#1e1e1e', color: '#ccc', outline: 'none', boxSizing: 'border-box' }}
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && path.trim()) onOpen(path.trim());
            if (e.key === 'Escape') onClose();
          }}
          autoFocus
          placeholder="0:/sys/config.g"
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button style={{ padding: '5px 12px', fontSize: 12, border: '1px solid #555', borderRadius: 4, background: '#353535', color: '#ccc', cursor: 'pointer' }} onClick={onClose}>Cancel</button>
          <button
            style={{ padding: '5px 12px', fontSize: 12, border: 'none', borderRadius: 4, background: '#0078d4', color: '#fff', cursor: 'pointer' }}
            onClick={() => path.trim() && onOpen(path.trim())}
          >
            Open
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DuetConfigEditor() {
  const connected = usePrinterStore((s) => s.connected);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [showBrowse, setShowBrowse] = useState(false);
  const [dirty, setDirty] = useState(false);

  const handleOpen = (path: string) => {
    if (!connected) return;
    if (dirty && openPath !== path && !confirm('You have unsaved changes. Switch files anyway?')) return;
    setShowBrowse(false);
    setOpenPath(path);
    setDirty(false);
  };

  return (
    <div className="duet-config-editor">
      {/* Toolbar */}
      <div className="duet-config-editor__toolbar">
        <div className="duet-config-editor__toolbar-title">
          <FileCode2 size={15} />
          Configuration Files
        </div>
        <button
          className="duet-config-editor__browse-btn"
          onClick={() => setShowBrowse(true)}
          disabled={!connected}
          title="Open any file by path"
        >
          <Plus size={13} /> Browse&hellip;
        </button>
      </div>

      {!connected ? (
        <div className="duet-config-editor__not-connected">
          <FolderOpen size={32} />
          <span>Connect to a Duet board to edit configuration files</span>
        </div>
      ) : (
        <div className="duet-config-editor__body">
          {/* File bar */}
          <div className="duet-config-editor__files">
            {CONFIG_GROUPS.map((group) => (
              <div key={group.id} className="duet-config-editor__group">
                <div className="duet-config-editor__group-header">
                  <group.Icon size={11} />
                  {group.label}
                </div>
                {group.files.map((file) => {
                  const active = openPath === file.path;
                  return (
                    <div
                      key={file.path}
                      className={
                        'duet-config-editor__file-row' +
                        (active ? ' is-active' : '') +
                        (active && dirty ? ' is-dirty' : '')
                      }
                      onClick={() => handleOpen(file.path)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleOpen(file.path); }}
                    >
                      <FileCode2 size={14} className="duet-config-editor__file-icon" />
                      <div className="duet-config-editor__file-info">
                        <div className="duet-config-editor__file-name">{file.label}</div>
                        <div className="duet-config-editor__file-desc">{file.desc}</div>
                      </div>
                      {!active && (
                        <ChevronRight size={13} className="duet-config-editor__chevron" />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Editor pane */}
          <div className="duet-config-editor__editor-pane">
            {openPath ? (
              <DuetFileEditor
                key={openPath}
                filePath={openPath}
                inline
                onClose={() => {
                  if (dirty && !confirm('You have unsaved changes. Close anyway?')) return;
                  setOpenPath(null);
                  setDirty(false);
                }}
                onDirtyChange={setDirty}
              />
            ) : (
              <div className="duet-config-editor__placeholder">
                <FileText size={36} className="duet-config-editor__placeholder-icon" />
                <div>Select a file on the left to start editing.</div>
                <div style={{ fontSize: 11, opacity: 0.75, maxWidth: 360, lineHeight: 1.5 }}>
                  Use <strong>Insert</strong> inside the editor to add commands
                  tailored to the active file — e.g. probing for <code>bed.g</code>,
                  kinematics for <code>config.g</code>.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showBrowse && (
        <BrowseModal onOpen={handleOpen} onClose={() => setShowBrowse(false)} />
      )}
    </div>
  );
}
