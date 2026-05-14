import { Eye, EyeOff, Minus, Plus } from 'lucide-react';
import type { DragEvent } from 'react';
import { defaultPanelLayout, type DashboardLayoutItem, type PanelId } from '../../../store/dashboardLayoutStore';
import { PANEL_DEFS } from './config';

function panelSort(layouts: Record<PanelId, DashboardLayoutItem>) {
  return (a: (typeof PANEL_DEFS)[number], b: (typeof PANEL_DEFS)[number]) => {
    const aLayout = layouts[a.id] ?? defaultPanelLayout(a.id);
    const bLayout = layouts[b.id] ?? defaultPanelLayout(b.id);
    return aLayout.y - bLayout.y || aLayout.x - bLayout.x || a.title.localeCompare(b.title);
  };
}

/**
 * The "edit layout" ribbon shown above the dashboard grid: two drop targets
 * (active / hidden) and a list of chips that can be dragged between them
 * or clicked to toggle visibility.
 */
export function DashboardLayoutOverlay({
  panels,
  layouts,
  hidden,
  dragId,
  onDragStart,
  onDragEnd,
  onVisibilityDrop,
  onClearPanels,
  onDone,
  onAddPanel,
  onSetHidden,
}: {
  panels: typeof PANEL_DEFS;
  layouts: Record<PanelId, DashboardLayoutItem>;
  hidden: Record<string, boolean>;
  dragId: PanelId | null;
  onDragStart: (id: PanelId) => void;
  onDragEnd: () => void;
  onVisibilityDrop: (event: DragEvent, hidden: boolean) => void;
  onClearPanels: () => void;
  onDone: () => void;
  onAddPanel: (id: PanelId) => void;
  onSetHidden: (id: PanelId, hidden: boolean) => void;
}) {
  const visiblePanels = panels.filter((panel) => !hidden[panel.id]).sort(panelSort(layouts));
  const hiddenPanels = panels.filter((panel) => hidden[panel.id]);

  const renderChip = (panel: (typeof PANEL_DEFS)[number]) => {
    const isHidden = hidden[panel.id] ?? false;
    const chipClass = [
      'dc-layout-chip',
      isHidden ? 'is-hidden' : '',
      dragId === panel.id ? 'is-dragging' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div
        key={panel.id}
        className={chipClass}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', panel.id);
          onDragStart(panel.id);
        }}
        onDragEnd={onDragEnd}
        onClick={() => isHidden ? onAddPanel(panel.id) : onSetHidden(panel.id, true)}
        title={isHidden ? `Add ${panel.title}` : `Remove ${panel.title}`}
        role="button"
        aria-pressed={!isHidden}
        aria-label={isHidden ? `Add ${panel.title}` : `Remove ${panel.title}`}
      >
        <span className="dc-layout-chip__icon">{panel.icon}</span>
        <span className="dc-layout-chip__label">{panel.title}</span>
        <span className="dc-layout-chip__badge">
          {isHidden ? <Plus size={9} /> : <Minus size={9} />}
        </span>
      </div>
    );
  };

  return (
    <div className="dc-layout-ribbon" aria-label="Dashboard cards">
      <div className="dc-layout-ribbon__label">
        <span className="dc-layout-ribbon__count">{visiblePanels.length} / {panels.length}</span>
        <span>Cards</span>
      </div>

      <div
        className="dc-layout-ribbon__section dc-layout-ribbon__section--active"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(event) => onVisibilityDrop(event, false)}
      >
        <div className="dc-layout-chip-list">
          {visiblePanels.length > 0 ? visiblePanels.map(renderChip) : (
            <span className="dc-layout-ribbon__empty">Drop here</span>
          )}
        </div>
        <span className="dc-layout-ribbon__section-label"><Eye size={9} /> Active</span>
      </div>

      <div className="dc-layout-ribbon__divider" />

      <div
        className="dc-layout-ribbon__section dc-layout-ribbon__section--hidden"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(event) => onVisibilityDrop(event, true)}
      >
        <div className="dc-layout-chip-list">
          {hiddenPanels.length > 0 ? hiddenPanels.map(renderChip) : (
            <span className="dc-layout-ribbon__empty">None</span>
          )}
        </div>
        <span className="dc-layout-ribbon__section-label"><EyeOff size={9} /> Hidden</span>
      </div>

      <div className="dc-layout-ribbon__actions">
        <button
          className="dc-layout-clear"
          disabled={visiblePanels.length === 0}
          onClick={onClearPanels}
          title="Clear all cards"
        >
          Clear
        </button>
        <button
          className="dc-layout-done"
          onClick={onDone}
          title="Done editing layout"
        >
          Done
        </button>
      </div>
    </div>
  );
}
