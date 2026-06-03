import './ComponentTree.css';
import { FileStack, PanelLeftClose, PanelLeftOpen, Plus, Search, Shapes, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useComponentStore } from '../../store/componentStore';
import { ComponentNode } from './componentTree/ComponentNode';
import { DesignFileBrowser } from './DesignFileBrowser';

const MIN_PANEL_WIDTH = 220;
const MAX_PANEL_WIDTH = 420;

export default function ComponentTree() {
  const rootComponentId = useComponentStore((s) => s.rootComponentId);
  const addComponent = useComponentStore((s) => s.addComponent);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [panelWidth, setPanelWidth] = useState(272);
  const [activeTab, setActiveTab] = useState<'model' | 'files'>('model');

  const filterQuery = useMemo(() => query.trim().toLowerCase(), [query]);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidth;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(
        MAX_PANEL_WIDTH,
        Math.max(MIN_PANEL_WIDTH, startWidth + moveEvent.clientX - startX),
      );
      setPanelWidth(nextWidth);
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  if (collapsed) {
    return (
      <div className="component-tree-panel component-tree-panel--collapsed">
        <button
          className="browser-rail-button"
          title="Expand Browser"
          aria-label="Expand Browser"
          onClick={() => setCollapsed(false)}
        >
          <PanelLeftOpen size={16} />
        </button>
        <span className="browser-rail-label">Browser</span>
      </div>
    );
  }

  return (
    <div className="component-tree-panel" style={{ width: panelWidth }}>
      <div className="tree-panel-header">
        <div className="browser-title-group">
          <h3>BROWSER</h3>
          <span className="browser-title-caption">
            {activeTab === 'model' ? 'Components, bodies, sketches' : 'Recent and project files'}
          </span>
        </div>
        <div className="browser-header-actions">
          {activeTab === 'model' && (
            <button
              className="icon-btn"
              title="New Component"
              onClick={() => addComponent(rootComponentId)}
            >
              <Plus size={14} />
            </button>
          )}
          <button
            className="icon-btn"
            title="Collapse Browser"
            aria-label="Collapse Browser"
            onClick={() => setCollapsed(true)}
          >
            <PanelLeftClose size={14} />
          </button>
        </div>
      </div>
      <div className="browser-main-tabs" role="tablist" aria-label="Browser pages">
        <button
          type="button"
          className={`browser-main-tab${activeTab === 'files' ? ' active' : ''}`}
          onClick={() => setActiveTab('files')}
          role="tab"
          aria-selected={activeTab === 'files'}
        >
          <FileStack size={13} />
          Files
        </button>
        <button
          type="button"
          className={`browser-main-tab${activeTab === 'model' ? ' active' : ''}`}
          onClick={() => setActiveTab('model')}
          role="tab"
          aria-selected={activeTab === 'model'}
        >
          <Shapes size={13} />
          Model
        </button>
      </div>
      {activeTab === 'model' ? (
        <>
          <div className="browser-search">
            <Search size={13} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search browser"
              aria-label="Search browser"
            />
            {query && (
              <button
                className="browser-search-clear"
                title="Clear search"
                aria-label="Clear search"
                onClick={() => setQuery('')}
              >
                <X size={12} />
              </button>
            )}
          </div>
          <div className="tree-scroll">
            <ComponentNode componentId={rootComponentId} filterQuery={filterQuery} />
          </div>
        </>
      ) : (
        <DesignFileBrowser />
      )}
      <div
        className="browser-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Browser"
        onPointerDown={startResize}
      />
    </div>
  );
}
