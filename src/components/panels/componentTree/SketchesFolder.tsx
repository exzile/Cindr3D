import { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, Eye, EyeOff, FolderOpen, PenTool } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import { useComponentStore } from '../../../store/componentStore';
import { SketchContextMenu } from './SketchContextMenu';
import type { SketchCtxMenu } from './SketchContextMenu';

const EMPTY_IDS: string[] = [];

export function SketchesFolder({ componentId }: { componentId?: string }) {
  // Use `sketches` (completed) + `activeSketch` (currently editing) as source of truth.
  // Previously used features.filter('sketch') which is a secondary index and can lag.
  const activeSketch = useCADStore((s) => s.activeSketch);
  const sketches = useCADStore((s) => s.sketches);
  const editSketch = useCADStore((s) => s.editSketch); // must be before any early return
  const components = useComponentStore((s) => s.components);
  const activeComponentId = useComponentStore((s) => s.activeComponentId);
  const componentSketchIds = useComponentStore((s) => (
    componentId ? (s.components[componentId]?.sketchIds ?? EMPTY_IDS) : EMPTY_IDS
  ));
  const [expanded, setExpanded] = useState(true);
  const [sketchVis, setSketchVis] = useState<Record<string, boolean>>({});
  const [ctxMenu, setCtxMenu] = useState<SketchCtxMenu | null>(null);

  const visibleSketches = useMemo(
    () => sketches.filter((s) => (
      !s.name.startsWith('Press Pull Profile') &&
      (
        !componentId ||
        s.componentId === componentId ||
        componentSketchIds.includes(s.id) ||
        (componentId === activeComponentId && (!s.componentId || !components[s.componentId]))
      )
    )),
    [activeComponentId, componentId, componentSketchIds, components, sketches],
  );
  const showActiveSketch = !!activeSketch
    && !activeSketch.name.startsWith('Press Pull Profile')
    && (
      !componentId ||
      activeSketch.componentId === componentId ||
      componentSketchIds.includes(activeSketch.id) ||
      (componentId === activeComponentId && (!activeSketch.componentId || !components[activeSketch.componentId]))
    );
  const hasAny = visibleSketches.length > 0 || showActiveSketch;
  if (!hasAny) return null;

  const isVisible = (id: string) => sketchVis[id] !== false;
  const toggleVis = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSketchVis((prev) => ({ ...prev, [id]: !isVisible(id) }));
  };

  const allVisible = visibleSketches.every((sk) => isVisible(sk.id)) && (!showActiveSketch || isVisible('active'));
  const toggleFolderVis = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !allVisible;
    const newVis: Record<string, boolean> = {};
    visibleSketches.forEach((sk) => { newVis[sk.id] = next; });
    if (showActiveSketch) newVis['active'] = next;
    setSketchVis(newVis);
  };

  const openCtx = (e: React.MouseEvent, id: string, name: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ sketchId: id, sketchName: name, x: e.clientX, y: e.clientY });
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
      </div>

      {/* Child rows */}
      {expanded && (
        <>
          {/* Completed sketches */}
          {visibleSketches.map((sk) => (
            <div
              key={sk.id}
              className="browser-row browser-row-child"
              onContextMenu={(e) => openCtx(e, sk.id, sk.name)}
              onDoubleClick={() => editSketch(sk.id)}
              title="Double-click to edit"
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
              {/* opacity is dynamic (visibility state) — must stay inline */}
              <span className="browser-item-label" style={{ opacity: isVisible(sk.id) ? 1 : 0.5 }}>
                {sk.name}
              </span>
            </div>
          ))}

          {/* Currently editing sketch */}
          {showActiveSketch && activeSketch && (
            <div
              className="browser-row browser-row-child browser-row-active-sketch"
              onContextMenu={(e) => openCtx(e, 'active', activeSketch.name)}
            >
              <button
                className="browser-vis-btn"
                onClick={(e) => toggleVis('active', e)}
                title={isVisible('active') ? 'Hide' : 'Show'}
              >
                {isVisible('active') ? <Eye size={11} /> : <EyeOff size={11} />}
              </button>
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
