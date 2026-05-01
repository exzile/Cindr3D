import { useEffect, useRef, useState } from 'react';
import {
  ChevronRight, ChevronDown, Eye, EyeOff, Box, Layers,
  Plus, Trash2, Copy, Anchor, MoreHorizontal, Circle, Minus, Unlink,
} from 'lucide-react';
import { useComponentStore } from '../../../store/componentStore';
import { useCADStore } from '../../../store/cadStore';
import { ConstructionNode } from './ConstructionNode';
import { JointNode } from './JointNode';
import { BodiesFolder } from './BodiesFolder';
import { SketchesFolder } from './SketchesFolder';

// ── CORR-15: Full origin entities folder ─────────────────────────────────────
// Shows origin point, X/Y/Z axes, and XY/XZ/YZ planes — matching Fusion SDK
// Component.originConstructionPoint + xConstructionAxis etc.
function OriginFolder() {
  const [expanded, setExpanded] = useState(true);

  const AXES = [
    { label: 'X Axis', color: '#e53935' },
    { label: 'Y Axis', color: '#43a047' },
    { label: 'Z Axis', color: '#1e88e5' },
  ] as const;

  const PLANES = [
    { label: 'XY Plane' },
    { label: 'XZ Plane' },
    { label: 'YZ Plane' },
  ] as const;

  return (
    <div className="tree-origin-group">
      {/* Folder header */}
      <div
        className="tree-item origin-item"
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded((v) => !v)}
      >
        {expanded ? <ChevronDown size={10} className="origin-icon" /> : <ChevronRight size={10} className="origin-icon" />}
        <Layers size={11} className="origin-icon" />
        <span className="tree-name origin-name">Origin</span>
      </div>

      {expanded && (
        <div className="tree-children">
          {/* Origin Point */}
          <div className="tree-item origin-item origin-entity">
            <Circle size={9} className="origin-icon" />
            <span className="tree-name origin-name">Origin Point</span>
          </div>

          {/* X / Y / Z Axes */}
          {AXES.map(({ label, color }) => (
            <div key={label} className="tree-item origin-item origin-entity">
              <Minus size={9} style={{ color }} />
              <span className="tree-name origin-name">{label}</span>
            </div>
          ))}

          {/* XY / XZ / YZ Planes */}
          {PLANES.map(({ label }) => (
            <div key={label} className="tree-item origin-item origin-entity">
              <Layers size={9} className="origin-icon" />
              <span className="tree-name origin-name">{label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ComponentNode({ componentId, depth = 0 }: { componentId: string; depth?: number }) {
  const component = useComponentStore((s) => s.components[componentId]);
  const expandedIds = useComponentStore((s) => s.expandedIds);
  const toggleExpanded = useComponentStore((s) => s.toggleExpanded);
  const toggleVisibility = useComponentStore((s) => s.toggleComponentVisibility);
  const activeComponentId = useComponentStore((s) => s.activeComponentId);
  const setActiveComponentId = useComponentStore((s) => s.setActiveComponentId);
  const addComponent = useComponentStore((s) => s.addComponent);
  const removeComponent = useComponentStore((s) => s.removeComponent);
  const duplicateComponent = useComponentStore((s) => s.duplicateComponent);
  const addBody = useComponentStore((s) => s.addBody);
  const setComponentGrounded = useComponentStore((s) => s.setComponentGrounded);
  const makeComponentIndependent = useComponentStore((s) => s.makeComponentIndependent);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const historyEnabled = useCADStore((s) => s.historyEnabled);
  const toggleHistoryMode = useCADStore((s) => s.toggleHistoryMode);

  const [showContextMenu, setShowContextMenu] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const renameComponent = useComponentStore((s) => s.renameComponent);

  if (!component) return null;

  const isExpanded = expandedIds.has(componentId);
  const isActive = activeComponentId === componentId;
  const isRoot = component.parentId === null;
  const hasChildren = component.childIds.length > 0 ||
                      component.bodyIds.length > 0 ||
                      component.sketchIds.length > 0 ||
                      component.constructionIds.length > 0 ||
                      component.jointIds.length > 0;

  const handleRename = () => {
    if (newName.trim()) {
      renameComponent(componentId, newName.trim());
    }
    setRenaming(false);
  };

  const beginRename = () => {
    setNewName(component.name);
    setRenaming(true);
  };

  useEffect(() => {
    if (!showContextMenu) return;
    const closeIfOutside = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      setShowContextMenu(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowContextMenu(false);
    };
    document.addEventListener('pointerdown', closeIfOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeIfOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [showContextMenu]);

  return (
    /* --depth is a dynamic CSS custom property for indent — must stay inline */
    <div className="tree-node" style={{ '--depth': depth } as React.CSSProperties}>
      <div
        className={`tree-item component-item ${isActive ? 'active' : ''}`}
        role="treeitem"
        tabIndex={0}
        onClick={() => setActiveComponentId(componentId)}
        onDoubleClick={(e) => {
          e.stopPropagation();
          beginRename();
        }}
        onKeyDown={(e) => {
          if (e.key === 'F2') {
            e.preventDefault();
            beginRename();
          }
        }}
      >
        <button
          className="browser-vis-btn"
          onClick={(e) => { e.stopPropagation(); toggleVisibility(componentId); }}
          title={component.visible ? `Hide ${component.name}` : `Show ${component.name}`}
          aria-label={component.visible ? `Hide ${component.name}` : `Show ${component.name}`}
        >
          {component.visible ? <Eye size={11} /> : <EyeOff size={11} />}
        </button>

        <button
          className="tree-expand"
          onClick={(e) => { e.stopPropagation(); toggleExpanded(componentId); }}
        >
          {hasChildren ? (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span className="tree-expand-spacer" />}
        </button>

        {/* background is dynamic (per-component color) — must stay inline */}
        <div className="component-color-bar" style={{ background: component.color }} />

        {renaming ? (
          <input
            className="tree-rename-input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenaming(false); }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="tree-name" style={{ opacity: component.visible ? 1 : 0.5 }}>{component.name}</span>
        )}

        {component.grounded && <Anchor size={10} className="grounded-icon" />}

        <div className="tree-item-actions">
          <button
            className="tree-action"
            onClick={(e) => { e.stopPropagation(); setShowContextMenu(!showContextMenu); }}
            title={`${component.name} actions`}
            aria-label={`${component.name} actions`}
          >
            <MoreHorizontal size={11} />
          </button>
        </div>
      </div>

      {/* Context menu */}
      {showContextMenu && (
        <div ref={contextMenuRef} className="tree-context-menu" onMouseLeave={() => setShowContextMenu(false)}>
          <button onClick={() => { addComponent(componentId); setShowContextMenu(false); }}>
            <Plus size={12} /> New Component
          </button>
          <button onClick={() => { addBody(componentId); setShowContextMenu(false); }}>
            <Box size={12} /> New Body
          </button>
          <button onClick={() => {
            const next = !component.grounded;
            setComponentGrounded(componentId, next);
            setStatusMessage(`${component.name}: ${next ? 'Grounded' : 'Ungrounded'}`);
            setShowContextMenu(false);
          }}>
            <Anchor size={12} /> {component.grounded ? 'Unground' : 'Ground'}
          </button>
          {isRoot && (
            <button onClick={() => {
              toggleHistoryMode();
              setShowContextMenu(false);
            }}>
              {historyEnabled ? 'Do not capture design history' : 'Capture design history'}
            </button>
          )}
          {!isRoot && (
            <>
              {/* A28: Make Independent — only shown for externally-linked components */}
              {component.isLinked && (
                <button onClick={() => {
                  makeComponentIndependent(componentId);
                  setStatusMessage(`${component.name}: made independent (link broken)`);
                  setShowContextMenu(false);
                }}>
                  <Unlink size={12} /> Make Independent
                </button>
              )}
              <button onClick={() => { duplicateComponent(componentId); setShowContextMenu(false); }}>
                <Copy size={12} /> Duplicate
              </button>
              <button className="danger" onClick={() => { removeComponent(componentId); setShowContextMenu(false); }}>
                <Trash2 size={12} /> Delete
              </button>
            </>
          )}
        </div>
      )}

      {/* Children */}
      {isExpanded && (
        <div className="tree-children">
          {/* CORR-15: Full origin entities folder (always shown for active component) */}
          {isActive && <OriginFolder />}

          {/* Construction geometry */}
          {component.constructionIds.map((id) => (
            <ConstructionNode key={id} id={id} />
          ))}

          <BodiesFolder componentId={componentId} />
          <SketchesFolder componentId={componentId} />

          {/* Joints */}
          {component.jointIds.map((id) => (
            <JointNode key={id} id={id} />
          ))}

          {/* Child components */}
          {component.childIds.map((id) => (
            <ComponentNode key={id} componentId={id} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
