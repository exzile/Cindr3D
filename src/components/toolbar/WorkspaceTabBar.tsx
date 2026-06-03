import * as React from 'react';
import { DraftingCompass, Layers3, Printer, X, type LucideIcon } from 'lucide-react';
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
  onWorkspaceSwitch: (ws: Workspace) => void;
  inSketch: boolean;
  activeTab: RibbonTab;
  onTabClick: (tabId: RibbonTab) => void;
  sketchPlaneSelecting: boolean;
  onCancelPlaneSelect: () => void;
}

export function WorkspaceTabBar({
  workspace,
  onWorkspaceSwitch,
  inSketch,
  activeTab,
  onTabClick,
  sketchPlaneSelecting,
  onCancelPlaneSelect,
}: WorkspaceTabBarProps) {
  const focusFrameRef = React.useRef<number | null>(null);
  const language = useLanguageStore((s) => s.language);
  const currentTabs = workspace === 'design' ? designTabs : [];
  const t = (key: TranslationKey) => translate(language, key);
  const workspaces: Array<{ id: Workspace; label: TranslationKey; icon: LucideIcon }> = [
    { id: 'design', label: 'app.workspace.design', icon: DraftingCompass },
    { id: 'prepare', label: 'app.workspace.slicer', icon: Layers3 },
    { id: 'printer', label: 'app.workspace.printer', icon: Printer },
  ];
  const handleDesignTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, tabId: RibbonTab) => {
    if (inSketch) return;
    const index = currentTabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) return;
    // eslint-disable-next-line no-useless-assignment
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % currentTabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + currentTabs.length) % currentTabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = currentTabs.length - 1;
    else return;

    event.preventDefault();
    const nextTab = currentTabs[nextIndex];
    onTabClick(nextTab.id);
    if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = requestAnimationFrame(() => {
      focusFrameRef.current = null;
      document.querySelector<HTMLButtonElement>(`[data-ribbon-tab="${nextTab.id}"]`)?.focus();
    });
  };

  React.useEffect(() => () => {
    if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current);
  }, []);

  const handleWorkspaceKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    ws: Workspace,
  ) => {
    const workspaceIds = workspaces.map((item) => item.id);
    const index = workspaceIds.indexOf(ws);
    // eslint-disable-next-line no-useless-assignment
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % workspaceIds.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + workspaceIds.length) % workspaceIds.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = workspaceIds.length - 1;
    else return;

    event.preventDefault();
    const nextWorkspace = workspaceIds[nextIndex];
    onWorkspaceSwitch(nextWorkspace);
    if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = requestAnimationFrame(() => {
      focusFrameRef.current = null;
      document.querySelector<HTMLButtonElement>(`[data-workspace-tab="${nextWorkspace}"]`)?.focus();
    });
  };

  return (
    <div className="ribbon-navigation">
      <div className="ribbon-workspace-row" role="tablist" aria-label={t('app.workspace.selector')}>
        {workspaces.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={`ribbon-workspace-btn ${workspace === item.id ? 'active' : ''}`}
              onClick={() => onWorkspaceSwitch(item.id)}
              onKeyDown={(event) => handleWorkspaceKeyDown(event, item.id)}
              role="tab"
              aria-selected={workspace === item.id}
              tabIndex={workspace === item.id ? 0 : -1}
              data-workspace-tab={item.id}
              data-workspace={item.id}
            >
              <Icon className="ribbon-workspace-icon" size={14} strokeWidth={2.2} aria-hidden="true" />
              <span>{t(item.label)}</span>
            </button>
          );
        })}
      </div>

      {/* Tab names */}
      {(currentTabs.length > 0 || inSketch || sketchPlaneSelecting) && (
        <div className="ribbon-tab-row">
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
      )}
    </div>
  );
}
