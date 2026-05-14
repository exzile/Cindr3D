import {
  ChevronRight, Download, FilePlus, FileUp, FileX, FolderOpen, Save, SlidersHorizontal,
} from 'lucide-react';
import { forwardRef } from 'react';
import type { BundleSlice } from '../../../types/settings-io.types';

interface OfflineBundleMeta { filename?: string }

/**
 * File menu dropdown — the design-only block (New / Open / Save / Import /
 * Export) is gated; the settings-bundle block is available on every workspace.
 *
 * The host owns the open/close state and the action handlers so the menu can
 * stay stateless (and close itself by calling onItemAction on each click).
 */
export const FileMenu = forwardRef<HTMLDivElement, {
  open: boolean;
  isDesign: boolean;
  hasBundle: boolean;
  bundleFilename: string | null;
  sliceForWorkspace: BundleSlice;
  offlineBundle: OfflineBundleMeta | null;
  onToggleOpen: () => void;
  onNew: () => void;
  onClose: () => void;
  onOpenDesign: () => void;
  onSaveDesign: () => void;
  onImport: () => void;
  onExport: () => void;
  onLoadSettings: () => void;
  onRestoreOfflineSettings: () => void;
  onSaveSettings: () => void;
  onSaveSettingsAs: () => void;
}>(function FileMenu(props, ref) {
  const {
    open, isDesign, hasBundle, bundleFilename, sliceForWorkspace, offlineBundle,
    onToggleOpen, onNew, onClose, onOpenDesign, onSaveDesign, onImport, onExport,
    onLoadSettings, onRestoreOfflineSettings, onSaveSettings, onSaveSettingsAs,
  } = props;
  return (
    <div className="file-menu-root" ref={ref}>
      <button
        className={`file-menu-btn${open ? ' open' : ''}`}
        onClick={onToggleOpen}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        File
      </button>
      {open && (
        <div className="file-menu-dropdown">
          {/* Design-only: document lifecycle + project (.dznd) file */}
          {isDesign && (
            <>
              <button className="file-menu-item" onClick={onNew}>
                <FilePlus size={15} />
                <span>New</span>
                <span className="file-menu-shortcut">Ctrl+N</span>
              </button>
              <button className="file-menu-item" onClick={onClose}>
                <FileX size={15} />
                <span>Close</span>
                <span className="file-menu-shortcut">Ctrl+W</span>
              </button>
              <div className="file-menu-separator" />
              <button className="file-menu-item" onClick={onOpenDesign}>
                <FolderOpen size={15} />
                <span>Open Design…</span>
                <span className="file-menu-shortcut">Ctrl+O</span>
              </button>
              <button className="file-menu-item" onClick={onSaveDesign}>
                <Save size={15} />
                <span>Save Design</span>
                <span className="file-menu-shortcut">Ctrl+S</span>
              </button>
              <div className="file-menu-separator" />
              <button className="file-menu-item" onClick={onImport}>
                <FileUp size={15} />
                <span>Import…</span>
              </button>
              <button className="file-menu-item" onClick={onExport}>
                <Download size={15} />
                <span>Export…</span>
                <ChevronRight size={13} style={{ marginLeft: 'auto' }} />
              </button>
              <div className="file-menu-separator" />
            </>
          )}

          {/* Settings bundle (.dzn) — per-page save; available everywhere */}
          <button className="file-menu-item" onClick={onLoadSettings}>
            <FolderOpen size={15} />
            <span>Load Settings…</span>
          </button>
          {offlineBundle && (
            <button className="file-menu-item" onClick={onRestoreOfflineSettings}>
              <FolderOpen size={15} />
              <span>Load Last Offline Settings</span>
              <span className="file-menu-shortcut" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {offlineBundle.filename ?? 'cached'}
              </span>
            </button>
          )}
          <button
            className="file-menu-item"
            onClick={onSaveSettings}
            title={hasBundle && bundleFilename
              ? `Update ${bundleFilename} — writes only the ${sliceForWorkspace} section`
              : 'Choose a file to save settings into'}
          >
            <SlidersHorizontal size={15} />
            <span>
              {hasBundle ? `Save ${sliceForWorkspace === 'cad' ? 'Design' : sliceForWorkspace === 'slicer' ? 'Slicer' : 'Printer'} Settings` : 'Save Settings'}
            </span>
            {bundleFilename && (
              <span className="file-menu-shortcut" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {bundleFilename}
              </span>
            )}
          </button>
          <button className="file-menu-item" onClick={onSaveSettingsAs}>
            <Save size={15} />
            <span>Save Settings As…</span>
          </button>
        </div>
      )}
    </div>
  );
});
