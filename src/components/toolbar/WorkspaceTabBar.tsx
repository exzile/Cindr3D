import * as React from 'react';
import { ChevronDown, X } from 'lucide-react';
import type { Workspace, RibbonTab, TabDef } from '../../types/toolbar.types';
import { useLanguageStore } from '../../store/languageStore';
import { translate, type TranslationKey } from '../../i18n';

const designTabs: TabDef[] = [
  { id: 'solid', label: 'app.ribbon.solid', color: 'var(--tab-solid)' },
  { id: 'surface', label: 'app.ribbon.surface', color: 'var(--tab-surface)' },
  { id: 'mesh', label: 'app.ribbon.mesh', color: 'var(--tab-mesh)' },
  { id: 'form', label: 'app.ribbon.form', color: 'var(--tab-form)' },
  { id: 'manage', label: 'app.ribbon.manage', color: 'var(--tab-manage)' },
  { id: 'utilities', label: 'app.ribbon.utilities', color: 'var(--tab-utilities)' },
];

// Prepare workspace no longer uses sub-tabs — PLATE / PROFILES / SLICE / EXPORT
// all sit together on a single ribbon row now. See RibbonPrepareTab.tsx.

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
  const language = useLanguageStore((s) => s.language);
  const currentTabs = workspace === 'design' ? designTabs : [];
  const t = (key: TranslationKey) => translate(language, key);
  const workspaceLabel = workspace === 'design'
    ? t('app.workspace.design').toUpperCase()
    : workspace === 'prepare'
      ? t('app.workspace.prepare').toUpperCase()
      : t('app.workspace.printer').toUpperCase();
  const handleDesignTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, tabId: RibbonTab) => {
    if (inSketch) return;
    const index = currentTabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) return;
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % currentTabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + currentTabs.length) % currentTabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = currentTabs.length - 1;
    else return;

    event.preventDefault();
    const nextTab = currentTabs[nextIndex];
    onTabClick(nextTab.id);
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-ribbon-tab="${nextTab.id}"]`)?.focus();
    });
  };

  const handleWorkspaceOptionKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    ws: Workspace,
  ) => {
    const workspaces: Workspace[] = ['design', 'prepare', 'printer'];
    const index = workspaces.indexOf(ws);
    let nextIndex = index;
    if (event.key === 'ArrowDown') nextIndex = (index + 1) % workspaces.length;
    else if (event.key === 'ArrowUp') nextIndex = (index - 1 + workspaces.length) % workspaces.length;
    else if (event.key === 'Escape') {
      event.preventDefault();
      setWsDropdownOpen(false);
      document.querySelector<HTMLButtonElement>('.ribbon-workspace-btn')?.focus();
      return;
    } else return;

    event.preventDefault();
    document.querySelector<HTMLButtonElement>(`[data-workspace-option="${workspaces[nextIndex]}"]`)?.focus();
  };

  return (
    <div className="ribbon-tab-row">
      {/* Workspace Dropdown */}
      <div className="ribbon-workspace-selector" onMouseLeave={() => setWsDropdownOpen(false)}>
        <button
          className="ribbon-workspace-btn"
          onClick={() => setWsDropdownOpen(!wsDropdownOpen)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setWsDropdownOpen(true);
              requestAnimationFrame(() => {
                document.querySelector<HTMLButtonElement>(`[data-workspace-option="${workspace}"]`)?.focus();
              });
            }
          }}
          aria-haspopup="menu"
          aria-expanded={wsDropdownOpen}
        >
          {workspaceLabel}
          <ChevronDown size={11} className="ribbon-workspace-chevron" />
        </button>
        {wsDropdownOpen && (
          <div className="ribbon-workspace-dropdown" role="menu" aria-label={t('app.workspace.selector')}>
            <button
              className={`ribbon-workspace-option ${workspace === 'design' ? 'active' : ''}`}
              onClick={() => onWorkspaceSwitch('design')}
              onKeyDown={(event) => handleWorkspaceOptionKeyDown(event, 'design')}
              role="menuitemradio"
              aria-checked={workspace === 'design'}
              data-workspace-option="design"
            >
              {t('app.workspace.design')}
            </button>
            <button
              className={`ribbon-workspace-option ${workspace === 'prepare' ? 'active' : ''}`}
              onClick={() => onWorkspaceSwitch('prepare')}
              onKeyDown={(event) => handleWorkspaceOptionKeyDown(event, 'prepare')}
              role="menuitemradio"
              aria-checked={workspace === 'prepare'}
              data-workspace-option="prepare"
            >
              {t('app.workspace.preparePrint')}
            </button>
            <button
              className={`ribbon-workspace-option ${workspace === 'printer' ? 'active' : ''}`}
              onClick={() => onWorkspaceSwitch('printer')}
              onKeyDown={(event) => handleWorkspaceOptionKeyDown(event, 'printer')}
              role="menuitemradio"
              aria-checked={workspace === 'printer'}
              data-workspace-option="printer"
            >
              {t('app.workspace.printer')}
            </button>
          </div>
        )}
      </div>

      <div className="ribbon-tab-divider-v" />

      {/* Tab names */}
      <div className="ribbon-tabs" role="tablist" aria-label={t('app.workspace.designRibbonTabs')}>
        {currentTabs.map((tab) => (
          <button
            key={tab.id}
            className={`ribbon-tab ${!inSketch && activeTab === tab.id ? 'active' : ''} ${inSketch ? 'sketch-passive' : ''}`}
            style={{ '--tab-color': tab.color } as React.CSSProperties}
            onClick={() => !inSketch && onTabClick(tab.id)}
            onKeyDown={(event) => handleDesignTabKeyDown(event, tab.id)}
            role="tab"
            aria-selected={!inSketch && activeTab === tab.id}
            tabIndex={!inSketch && activeTab === tab.id ? 0 : -1}
            data-ribbon-tab={tab.id}
          >
            {t(tab.label as TranslationKey)}
          </button>
        ))}
        {inSketch && (
          <button
            className="ribbon-tab active contextual sketch-contextual-tab"
            style={{ '--tab-color': '#ff8c00' } as React.CSSProperties}
          >
            {t('app.ribbon.sketch')}
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
