import { useState, useCallback } from 'react';
import { Edit3, Settings, Search, Sliders } from 'lucide-react';
import { useSlicerStore } from '../../../../store/slicerStore';
import { useSlicerVisibilityStore } from '../../../../store/slicerVisibilityStore';
import type { PrintProfile } from '../../../../types/slicer';
import { SlicerPrintProfileSettings } from '../../SlicerPrintProfileSettings';
import { SlicerSettingsVisibilityModal } from '../modals/SlicerSettingsVisibilityModal';
import './SlicerWorkspaceSettingsPanel.css';

// The Printer and Material pickers used to live here but are now owned by
// the ribbon (Prepare workspace → Plate tab). This panel keeps only the
// Print Profile picker + its detailed settings so there's exactly one
// editor for each profile kind.
export function SlicerWorkspaceSettingsPanel({ onEditProfile }: { onEditProfile: (type: 'printer' | 'material' | 'print') => void }) {
  const printProfiles = useSlicerStore((s) => s.printProfiles);
  const activePrintId = useSlicerStore((s) => s.activePrintProfileId);
  const setActivePrint = useSlicerStore((s) => s.setActivePrintProfile);
  const getActivePrintProfile = useSlicerStore((s) => s.getActivePrintProfile);
  const updatePrintProfile = useSlicerStore((s) => s.updatePrintProfile);

  const isVisible = useSlicerVisibilityStore((s) => s.isVisible);
  // Subscribe to the visible map itself so toggles in the modal re-render this panel.
  useSlicerVisibilityStore((s) => s.visible);

  const print = getActivePrintProfile();

  const [settingsSearch, setSettingsSearch] = useState('');
  const [showVisibilityModal, setShowVisibilityModal] = useState(false);

  const upd = useCallback((updates: Record<string, unknown>) => {
    if (print) updatePrintProfile(print.id, updates as Partial<PrintProfile>);
  }, [print, updatePrintProfile]);

  return (
    <div className="slicer-workspace-settings-panel">
      <div className="slicer-workspace-settings-panel__header">
        <div className="slicer-workspace-settings-panel__header-title">
          <Settings size={16} />
          Slicer Settings
        </div>
        <button
          type="button"
          className="slicer-workspace-settings-panel__gear"
          onClick={() => setShowVisibilityModal(true)}
          title="Customize which sections appear"
          aria-label="Customize sections"
        >
          <Sliders size={14} />
        </button>
        {isVisible('printProfile') && (
          <div className="slicer-workspace-settings-panel__profile-row">
            <select
              className="slicer-workspace-settings-panel__profile-select"
              value={activePrintId}
              onChange={(e) => setActivePrint(e.target.value)}
            >
              {printProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className="slicer-workspace-settings-panel__compact-button" onClick={() => onEditProfile('print')}>
              <Edit3 size={12} />
            </button>
          </div>
        )}
      </div>

      <div className="slicer-workspace-settings-panel__search-shell">
        <div className="slicer-workspace-settings-panel__search-wrap">
          <Search size={12} className="slicer-workspace-settings-panel__search-icon" />
          <input
            type="text"
            placeholder="Search settings..."
            value={settingsSearch}
            onChange={(e) => setSettingsSearch(e.target.value)}
            className="slicer-workspace-settings-panel__search-input"
          />
        </div>
      </div>

      <div className="slicer-workspace-settings-panel__content">
        {print && <SlicerPrintProfileSettings print={print} upd={upd} />}
      </div>

      {showVisibilityModal && (
        <SlicerSettingsVisibilityModal onClose={() => setShowVisibilityModal(false)} />
      )}
    </div>
  );
}
