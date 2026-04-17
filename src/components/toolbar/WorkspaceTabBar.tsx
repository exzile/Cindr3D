import { ChevronDown, X } from 'lucide-react';
import type { Workspace, RibbonTab, TabDef } from './toolbar.types';

const designTabs: TabDef[] = [
  { id: 'solid', label: 'SOLID', color: 'var(--tab-solid)' },
  { id: 'surface', label: 'SURFACE', color: 'var(--tab-surface)' },
  { id: 'mesh', label: 'MESH', color: 'var(--tab-mesh)' },
  { id: 'form', label: 'FORM', color: 'var(--tab-form)' },
{ id: 'manage', label: 'MANAGE', color: 'var(--tab-manage)' },
  { id: 'utilities', label: 'UTILITIES', color: 'var(--tab-utilities)' },
];

const prepareTabs: TabDef[] = [
  { id: 'plate', label: 'PLATE', color: 'var(--tab-prepare)' },
  { id: 'profiles', label: 'PROFILES', color: 'var(--tab-prepare)' },
  { id: 'slice', label: 'SLICE', color: 'var(--tab-prepare)' },
  { id: 'export', label: 'EXPORT', color: 'var(--tab-prepare)' },
];

interface WorkspaceTabBarProps {
  workspace: Workspace;
  wsDropdownOpen: boolean;
  setWsDropdownOpen: (open: boolean) => void;
  onWorkspaceSwitch: (ws: Workspace) => void;
  inSketch: boolean;
  activeTab: RibbonTab;
  onTabClick: (tabId: RibbonTab) => void;
  sketchPlaneSelecting: boolean;
  onCancelPlaneSelect: () => void;
}

export function WorkspaceTabBar({
  workspace,
  wsDropdownOpen,
  setWsDropdownOpen,
  onWorkspaceSwitch,
  inSketch,
  activeTab,
  onTabClick,
  sketchPlaneSelecting,
  onCancelPlaneSelect,
}: WorkspaceTabBarProps) {
  const currentTabs = workspace === 'design' ? designTabs
    : workspace === 'prepare' ? prepareTabs
    : [];

  return (
    <div className="ribbon-tab-row">
      {/* Workspace Dropdown */}
      <div className="ribbon-workspace-selector" onMouseLeave={() => setWsDropdownOpen(false)}>
        <button
          className="ribbon-workspace-btn"
          onClick={() => setWsDropdownOpen(!wsDropdownOpen)}
        >
          {workspace === 'design' ? 'DESIGN' : workspace === 'prepare' ? 'PREPARE' : '3D PRINTER'}
          <ChevronDown size={11} className="ribbon-workspace-chevron" />
        </button>
        {wsDropdownOpen && (
          <div className="ribbon-workspace-dropdown">
            <button
              className={`ribbon-workspace-option ${workspace === 'design' ? 'active' : ''}`}
              onClick={() => onWorkspaceSwitch('design')}
            >
              Design
            </button>
            <button
              className={`ribbon-workspace-option ${workspace === 'prepare' ? 'active' : ''}`}
              onClick={() => onWorkspaceSwitch('prepare')}
            >
              Prepare (3D Print)
            </button>
            <button
              className={`ribbon-workspace-option ${workspace === 'printer' ? 'active' : ''}`}
              onClick={() => onWorkspaceSwitch('printer')}
            >
              3D Printer
            </button>
          </div>
        )}
      </div>

      <div className="ribbon-tab-divider-v" />

      {/* Tab names */}
      <div className="ribbon-tabs">
        {currentTabs.map((tab) => (
          <button
            key={tab.id}
            className={`ribbon-tab ${!inSketch && activeTab === tab.id ? 'active' : ''} ${inSketch ? 'sketch-passive' : ''}`}
            style={{ '--tab-color': tab.color } as React.CSSProperties}
            onClick={() => !inSketch && onTabClick(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        {inSketch && (
          <button
            className="ribbon-tab active contextual sketch-contextual-tab"
            style={{ '--tab-color': '#ff8c00' } as React.CSSProperties}
          >
            SKETCH
          </button>
        )}
      </div>

      {/* Plane selection indicator */}
      {sketchPlaneSelecting && !inSketch && (
        <div className="ribbon-sketch-indicator">
          <span className="text-accent">Select a plane or planar face</span>
          <button className="ribbon-cancel-btn" onClick={onCancelPlaneSelect} title="Cancel">
            <X size={12} /> Cancel
          </button>
        </div>
      )}
    </div>
  );
}
