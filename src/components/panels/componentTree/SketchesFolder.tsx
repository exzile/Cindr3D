import { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, Eye, EyeOff, FolderOpen, PenTool } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import { useComponentStore } from '../../../store/componentStore';
import { SketchContextMenu } from './SketchContextMenu';
import type { SketchCtxMenu } from './SketchContextMenu';


const EMPTY_IDS: string[] = [];

export function SketchesFolder({ componentId, filterQuery = '' }: { componentId?: string; filterQuery?: string }) {
  // Use `sketches` (completed) + `activeSketch` (currently editing) as source of truth.
  // Previously used features.filter('sketch') which is a secondary index and can lag.
  const activeSketch = useCADStore((s) => s.activeSketch);
  const sketches = useCADStore((s) => s.sketches);
  const features = useCADStore((s) => s.features);
  const renameSketch = useCADStore((s) => s.renameSketch);
  const toggleFeatureVisibility = useCADStore((s) => s.toggleFeatureVisibility);
  const components = useComponentStore((s) => s.components);
  const activeComponentId = useComponentStore((s) => s.activeComponentId);
  const componentSketchIds = useComponentStore((s) => (
    componentId ? (s.components[componentId]?.sketchIds ?? EMPTY_IDS) : EMPTY_IDS
  ));
  const [expanded, setExpanded] = useState(true);
  const [ctxMenu, setCtxMenu] = useState<SketchCtxMenu | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  // Index features by sketchId for O(1) visibility lookups
  const sketchFeatureMap = useMemo(
    () => new Map(features.filter((f) => f.type === 'sketch' && f.sketchId).map((f) => [f.sketchId!, f])),
    [features],
  );

  const visibleSketches = useMemo(
    () => sketches.filter((s) => (
      s.id !== activeSketch?.id &&
      !s.name.startsWith('Press Pull Profile') &&
      (
        !componentId ||
        s.componentId === componentId ||
        componentSketchIds.includes(s.id) ||
        (componentId === activeComponentId && (!s.componentId || !components[s.componentId]))
      )
    )),
    [activeComponentId, activeSketch?.id, componentId, componentSketchIds, components, sketches],
  );
  const showActiveSketch = !!activeSketch
    && !activeSketch.name.startsWith('Press Pull Profile')
    && (
      !componentId ||
      activeSketch.componentId === componentId ||
      componentSketchIds.includes(activeSketch.id) ||
      (componentId === activeComponentId && (!activeSketch.componentId || !components[activeSketch.componentId]))
    );
  const filteredSketches = visibleSketches.filter((sketch) => (
    !filterQuery || sketch.name.toLowerCase().includes(filterQuery)
  ));
  const showFilteredActiveSketch = showActiveSketch &&
    (!filterQuery || activeSketch?.name.toLowerCase().includes(filterQuery));
  const sketchCount = filteredSketches.length + (showFilteredActiveSketch ? 1 : 0);
  const hasAny = sketchCount > 0;
  if (!hasAny) return null;

  // Visibility is driven by the actual feature flag, not local state
  const isVisible = (sketchId: string) => sketchFeatureMap.get(sketchId)?.visible !== false;

  const toggleVis = (sketchId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const feature = sketchFeatureMap.get(sketchId);
    if (feature) toggleFeatureVisibility(feature.id);
  };

  const allVisible = filteredSketches.every((sk) => isVisible(sk.id));
  const shouldShowChildren = expanded || !!filterQuery;
  const toggleFolderVis = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !allVisible;
    filteredSketches.forEach((sk) => {
      const feature = sketchFeatureMap.get(sk.id);
      if (feature && feature.visible !== next) toggleFeatureVisibility(feature.id);
    });
  };

  const openCtx = (e: React.MouseEvent, id: string, name: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ sketchId: id, sketchName: name, x: e.clientX, y: e.clientY });
  };

  const startRename = (id: string, currentName: string) => {
    setRenamingId(id);
    setRenameDraft(currentName);
  };

  const commitRename = (id: string) => {
    if (renameDraft.trim() && id !== 'active') {
      renameSketch(id, renameDraft.trim());
    }
    setRenamingId(null);
  };

  return (
    <div className="sketches-tree-node">
      {/* Folder header row */}
      <div className="browser-row" onClick={() => setExpanded(!expanded)}>
        <button
          className="browser-vis-btn"
          onClick={toggleFolderVis}
          title={allVisible ? 'Hide Sketches' : 'Show Sketches'}
        >
          {allVisible ? <Eye size={11} /> : <EyeOff size={11} />}
        </button>
        <span className="browser-chevron">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span className="browser-item-icon origin-axis-icon">
          <FolderOpen size={13} />
        </span>
        <span className="browser-item-label">Sketches</span>
        <span className="browser-count-badge" aria-label={`${sketchCount} sketches`}>
          {sketchCount}
        </span>
      </div>

      {/* Child rows */}
      {shouldShowChildren && (
        <>
          {/* Completed sketches */}
          {filteredSketches.map((sk) => (
            <div
              key={sk.id}
              className="browser-row browser-row-child"
              onContextMenu={(e) => openCtx(e, sk.id, sk.name)}
              onDoubleClick={() => startRename(sk.id, sk.name)}
              title="Double-click to rename, right-click to edit"
            >
              <button
                className="browser-vis-btn"
                onClick={(e) => toggleVis(sk.id, e)}
                title={isVisible(sk.id) ? 'Hide' : 'Show'}
              >
                {isVisible(sk.id) ? <Eye size={11} /> : <EyeOff size={11} />}
              </button>
              <span className="browser-chevron" />
              {/* color and opacity are dynamic (visibility state) — must stay inline */}
              <span className="browser-item-icon"
                style={{ color: isVisible(sk.id) ? 'var(--accent)' : 'var(--text-dim)', opacity: isVisible(sk.id) ? 1 : 0.5 }}>
                <PenTool size={12} />
              </span>
              {renamingId === sk.id ? (
                <input
                  className="tree-rename-input"
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={() => commitRename(sk.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRename(sk.id); if (e.key === 'Escape') setRenamingId(null); }}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="browser-item-label" style={{ opacity: isVisible(sk.id) ? 1 : 0.5 }}>
                  {sk.name}
                </span>
              )}
            </div>
          ))}

          {/* Currently editing sketch — no visibility toggle while active */}
          {showFilteredActiveSketch && activeSketch && (
            <div
              className="browser-row browser-row-child browser-row-active-sketch"
              onContextMenu={(e) => openCtx(e, 'active', activeSketch.name)}
            >
              <span className="browser-vis-btn" />
              <span className="browser-chevron" />
              <span className="browser-item-icon ct-sketch-active-icon">
                <PenTool size={12} />
              </span>
              <span className="browser-item-label browser-sketch-active-label">
                {activeSketch.name}
              </span>
            </div>
          )}
        </>
      )}

      {ctxMenu && (
        <SketchContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} />
      )}
    </div>
  );
}
