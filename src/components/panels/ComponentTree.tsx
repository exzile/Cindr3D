import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronRight, ChevronDown, Eye, EyeOff, Box, Layers,
  Plus, Trash2, Copy, Lock, Unlock, Anchor,
  Axis3D, CircleDot, Link2,
  MoreHorizontal, Crosshair, Minus, Square, PenTool, FolderOpen,
  Search, Scissors, Settings,
} from 'lucide-react';
import { useComponentStore } from '../../store/componentStore';
import { useCADStore } from '../../store/cadStore';
import type { MaterialAppearance } from '../../types/cad';

// ===== Material Picker =====
function MaterialPicker({
  bodyId,
  onClose,
}: {
  bodyId: string;
  onClose: () => void;
}) {
  const setBodyMaterial = useComponentStore((s) => s.setBodyMaterial);

  const materials: MaterialAppearance[] = [
    { id: 'aluminum', name: 'Aluminum', color: '#B0B8C0', metalness: 0.8, roughness: 0.3, opacity: 1, category: 'metal' },
    { id: 'steel', name: 'Steel', color: '#8090A0', metalness: 0.9, roughness: 0.35, opacity: 1, category: 'metal' },
    { id: 'stainless', name: 'Stainless Steel', color: '#C8CCD0', metalness: 0.85, roughness: 0.2, opacity: 1, category: 'metal' },
    { id: 'brass', name: 'Brass', color: '#C8A84A', metalness: 0.9, roughness: 0.25, opacity: 1, category: 'metal' },
    { id: 'copper', name: 'Copper', color: '#C87040', metalness: 0.9, roughness: 0.3, opacity: 1, category: 'metal' },
    { id: 'abs', name: 'ABS Plastic', color: '#E8E0D0', metalness: 0, roughness: 0.6, opacity: 1, category: 'plastic' },
    { id: 'pla', name: 'PLA', color: '#D0D8E0', metalness: 0, roughness: 0.5, opacity: 1, category: 'plastic' },
    { id: 'nylon', name: 'Nylon', color: '#F0EDE8', metalness: 0, roughness: 0.55, opacity: 1, category: 'plastic' },
    { id: 'oak', name: 'Oak Wood', color: '#A07840', metalness: 0, roughness: 0.8, opacity: 1, category: 'wood' },
    { id: 'rubber-black', name: 'Rubber', color: '#303030', metalness: 0, roughness: 0.9, opacity: 1, category: 'rubber' },
    { id: 'glass-clear', name: 'Glass', color: '#E8F0FF', metalness: 0.1, roughness: 0.05, opacity: 0.3, category: 'glass' },
    { id: 'carbon-fiber', name: 'Carbon Fiber', color: '#202020', metalness: 0.3, roughness: 0.5, opacity: 1, category: 'composite' },
  ];

  return (
    <div className="material-picker">
      <div className="material-picker-header">
        <span>Material</span>
        <button className="icon-btn" onClick={onClose}>&times;</button>
      </div>
      <div className="material-grid">
        {materials.map((mat) => (
          <button
            key={mat.id}
            className="material-swatch"
            title={mat.name}
            onClick={() => { setBodyMaterial(bodyId, mat); onClose(); }}
          >
            <div className="swatch-color" style={{ background: mat.color }} />
            <span className="swatch-label">{mat.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ===== Body Node =====
function BodyNode({ bodyId }: { bodyId: string }) {
  const body = useComponentStore((s) => s.bodies[bodyId]);
  const toggleVisibility = useComponentStore((s) => s.toggleBodyVisibility);
  const selectedBodyId = useComponentStore((s) => s.selectedBodyId);
  const setSelectedBodyId = useComponentStore((s) => s.setSelectedBodyId);
  const [showMaterial, setShowMaterial] = useState(false);

  if (!body) return null;

  return (
    <div className="tree-leaf">
      <div
        className={`tree-item body-item ${selectedBodyId === bodyId ? 'selected' : ''}`}
        onClick={() => setSelectedBodyId(selectedBodyId === bodyId ? null : bodyId)}
      >
        <Box size={12} className="tree-icon body-icon" />
        <span className="tree-name">{body.name}</span>
        <div
          className="body-color-dot"
          style={{ background: body.material.color }}
          title={body.material.name}
          onClick={(e) => { e.stopPropagation(); setShowMaterial(!showMaterial); }}
        />
        <button
          className="tree-action"
          onClick={(e) => { e.stopPropagation(); toggleVisibility(bodyId); }}
        >
          {body.visible ? <Eye size={11} /> : <EyeOff size={11} />}
        </button>
      </div>
      {showMaterial && (
        <MaterialPicker bodyId={bodyId} onClose={() => setShowMaterial(false)} />
      )}
    </div>
  );
}

// ===== Construction Node =====
function ConstructionNode({ id }: { id: string }) {
  const construction = useComponentStore((s) => s.constructions[id]);
  const toggleVisibility = useComponentStore((s) => s.toggleConstructionVisibility);

  if (!construction) return null;

  const icon = construction.type === 'plane' ? <Layers size={12} /> :
               construction.type === 'axis' ? <Axis3D size={12} /> :
               <CircleDot size={12} />;

  return (
    <div className="tree-item construction-item">
      {icon}
      <span className="tree-name construction-name">{construction.name}</span>
      <button
        className="tree-action"
        onClick={() => toggleVisibility(id)}
      >
        {construction.visible ? <Eye size={11} /> : <EyeOff size={11} />}
      </button>
    </div>
  );
}

// ===== Joint Node =====
function JointNode({ id }: { id: string }) {
  const joint = useComponentStore((s) => s.joints[id]);
  const toggleLock = useComponentStore((s) => s.toggleJointLock);

  if (!joint) return null;

  return (
    <div className="tree-item joint-item">
      <Link2 size={12} />
      <span className="tree-name">{joint.name}</span>
      <span className="joint-type-badge">{joint.type}</span>
      <button
        className="tree-action"
        onClick={() => toggleLock(id)}
      >
        {joint.locked ? <Lock size={11} /> : <Unlock size={11} />}
      </button>
    </div>
  );
}

// ===== Component Node (recursive) =====
function ComponentNode({ componentId, depth = 0 }: { componentId: string; depth?: number }) {
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

  const [showContextMenu, setShowContextMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const renameComponent = useComponentStore((s) => s.renameComponent);

  if (!component) return null;

  const isExpanded = expandedIds.has(componentId);
  const isActive = activeComponentId === componentId;
  const isRoot = component.parentId === null;
  const hasChildren = component.childIds.length > 0 ||
                      component.bodyIds.length > 0 ||
                      component.constructionIds.length > 0 ||
                      component.jointIds.length > 0;

  const handleRename = () => {
    if (newName.trim()) {
      renameComponent(componentId, newName.trim());
    }
    setRenaming(false);
  };

  return (
    <div className="tree-node" style={{ '--depth': depth } as React.CSSProperties}>
      <div
        className={`tree-item component-item ${isActive ? 'active' : ''}`}
        onClick={() => setActiveComponentId(componentId)}
        onDoubleClick={() => {
          setRenaming(true);
          setNewName(component.name);
        }}
      >
        <button
          className="tree-expand"
          onClick={(e) => { e.stopPropagation(); toggleExpanded(componentId); }}
        >
          {hasChildren ? (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span className="tree-expand-spacer" />}
        </button>

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
          <span className="tree-name">{component.name}</span>
        )}

        {component.grounded && <Anchor size={10} className="grounded-icon" />}

        <div className="tree-item-actions">
          <button
            className="tree-action"
            onClick={(e) => { e.stopPropagation(); toggleVisibility(componentId); }}
          >
            {component.visible ? <Eye size={11} /> : <EyeOff size={11} />}
          </button>
          <button
            className="tree-action"
            onClick={(e) => { e.stopPropagation(); setShowContextMenu(!showContextMenu); }}
          >
            <MoreHorizontal size={11} />
          </button>
        </div>
      </div>

      {/* Context menu */}
      {showContextMenu && (
        <div className="tree-context-menu" onMouseLeave={() => setShowContextMenu(false)}>
          <button onClick={() => { addComponent(componentId); setShowContextMenu(false); }}>
            <Plus size={12} /> New Component
          </button>
          <button onClick={() => { addBody(componentId); setShowContextMenu(false); }}>
            <Box size={12} /> New Body
          </button>
          {!isRoot && (
            <>
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
          {/* Origin planes/axes (always shown for active component) */}
          {isActive && (
            <div className="tree-origin-group">
              <div className="tree-item origin-item">
                <Layers size={11} className="origin-icon" />
                <span className="tree-name origin-name">Origin</span>
              </div>
            </div>
          )}

          {/* Construction geometry */}
          {component.constructionIds.map((id) => (
            <ConstructionNode key={id} id={id} />
          ))}

          {/* Bodies */}
          {component.bodyIds.map((id) => (
            <BodyNode key={id} bodyId={id} />
          ))}

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

// ===== Origin Tree (Fusion 360 style: O, X, Y, Z, XY, XZ, YZ) =====
function OriginTree() {
  const [expanded, setExpanded] = useState(false);
  const [visibility, setVisibility] = useState<Record<string, boolean>>({
    origin: true, X: true, Y: true, Z: true, XY: true, XZ: true, YZ: true,
  });

  const toggleVis = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const items = [
    { key: 'origin', label: 'O', icon: <Crosshair size={12} />, color: '#ff9800' },
    { key: 'X', label: 'X Axis', icon: <Minus size={12} />, color: '#e04040' },
    { key: 'Y', label: 'Y Axis', icon: <Minus size={12} />, color: '#40b040' },
    { key: 'Z', label: 'Z Axis', icon: <Minus size={12} />, color: '#4080e0' },
    { key: 'XY', label: 'XY Plane', icon: <Square size={12} />, color: '#4080e0' },
    { key: 'XZ', label: 'XZ Plane', icon: <Square size={12} />, color: '#40b040' },
    { key: 'YZ', label: 'YZ Plane', icon: <Square size={12} />, color: '#e04040' },
  ];

  const allVisible = Object.values(visibility).every(Boolean);

  return (
    <div className="origin-tree-node">
      {/* Folder header row */}
      <div className="browser-row" onClick={() => setExpanded(!expanded)}>
        <button
          className="browser-vis-btn"
          onClick={(e) => {
            e.stopPropagation();
            const next = !allVisible;
            setVisibility({ origin: next, X: next, Y: next, Z: next, XY: next, XZ: next, YZ: next });
          }}
          title={allVisible ? 'Hide Origin' : 'Show Origin'}
        >
          {allVisible ? <Eye size={11} /> : <EyeOff size={11} />}
        </button>
        <span className="browser-chevron">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span className="browser-item-icon" style={{ color: 'var(--text-dim)' }}>
          <Axis3D size={13} />
        </span>
        <span className="browser-item-label">Origin</span>
      </div>

      {/* Child rows */}
      {expanded && items.map((item) => (
        <div key={item.key} className="browser-row browser-row-child">
          <button
            className="browser-vis-btn"
            onClick={(e) => toggleVis(item.key, e)}
            title={visibility[item.key] ? 'Hide' : 'Show'}
          >
            {visibility[item.key] ? <Eye size={11} /> : <EyeOff size={11} />}
          </button>
          <span className="browser-chevron" /> {/* spacer */}
          <span className="browser-item-icon" style={{ color: item.color, opacity: visibility[item.key] ? 1 : 0.4 }}>
            {item.icon}
          </span>
          <span className="browser-item-label" style={{ opacity: visibility[item.key] ? 1 : 0.5 }}>
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ===== Sketch Item Context Menu =====
interface SketchCtxMenu {
  sketchId: string;
  sketchName: string;
  x: number;
  y: number;
}

function SketchContextMenu({ menu, onClose }: { menu: SketchCtxMenu; onClose: () => void }) {
  const editSketch = useCADStore((s) => s.editSketch);


  const cs = (label: string) => () => { alert(`${label} — coming soon`); onClose(); };

  const items: Array<{ label: string; shortcut?: string; icon?: React.ReactNode; danger?: boolean; separator?: boolean; onClick: () => void }> = [
    { label: 'Move to Group', icon: <FolderOpen size={13} />, onClick: cs('Move to Group') },
    { label: 'Create Selection Set', icon: <Layers size={13} />, onClick: cs('Create Selection Set') },
    { label: 'Offset Plane', icon: <Layers size={13} />, onClick: cs('Offset Plane') },
    { label: '', separator: true, onClick: () => {} },
    { label: 'Edit Sketch', icon: <PenTool size={13} />, onClick: () => { editSketch(menu.sketchId); onClose(); } },
    { label: 'Redefine Sketch Plane', icon: <PenTool size={13} />, onClick: cs('Redefine Sketch Plane') },
    { label: 'Slice Sketch', icon: <Scissors size={13} />, onClick: cs('Slice Sketch') },
    { label: 'Configure', icon: <Settings size={13} />, onClick: cs('Configure') },
    { label: '', separator: true, onClick: () => {} },
    { label: 'Delete', shortcut: 'Del', icon: <Trash2 size={13} />, danger: true, onClick: cs('Delete Sketch') },
    { label: 'Rename', icon: <MoreHorizontal size={13} />, onClick: cs('Rename') },
    { label: '', separator: true, onClick: () => {} },
    { label: 'Look At', icon: <Eye size={13} />, onClick: cs('Look At') },
    { label: 'Hide Profile', icon: <EyeOff size={13} />, onClick: cs('Hide Profile') },
    { label: 'Show Dimension', icon: <Eye size={13} />, onClick: cs('Show Dimension') },
    { label: 'Hide Projected Geometries', icon: <EyeOff size={13} />, onClick: cs('Hide Projected Geometries') },
    { label: 'Hide Construction Geometries', icon: <EyeOff size={13} />, onClick: cs('Hide Construction Geometries') },
    { label: 'Show/Hide', shortcut: 'V', icon: <Eye size={13} />, onClick: cs('Show/Hide') },
    { label: '', separator: true, onClick: () => {} },
    { label: 'Find in Window', icon: <Search size={13} />, onClick: cs('Find in Window') },
    { label: 'Find in Timeline', icon: <Search size={13} />, onClick: cs('Find in Timeline') },
  ];

  return createPortal(
    <>
      <div className="sketch-ctx-backdrop" onClick={onClose} />
      <div className="sketch-ctx-menu" style={{ top: menu.y, left: menu.x }}>
        {items.map((item, i) =>
          item.separator ? (
            <div key={i} className="sketch-ctx-sep" />
          ) : (
            <button
              key={i}
              className={`sketch-ctx-item${item.danger ? ' danger' : ''}`}
              onClick={item.onClick}
            >
              <span className="sketch-ctx-icon">{item.icon}</span>
              <span className="sketch-ctx-label">{item.label}</span>
              {item.shortcut && <span className="sketch-ctx-shortcut">{item.shortcut}</span>}
            </button>
          )
        )}
      </div>
    </>,
    document.body
  );
}

// ===== Sketches Folder =====
function SketchesFolder() {
  // Use `sketches` (completed) + `activeSketch` (currently editing) as source of truth.
  // Previously used features.filter('sketch') which is a secondary index and can lag.
  const activeSketch = useCADStore((s) => s.activeSketch);
  const sketches = useCADStore((s) => s.sketches);
  const editSketch = useCADStore((s) => s.editSketch); // must be before any early return
  const [expanded, setExpanded] = useState(true);
  const [sketchVis, setSketchVis] = useState<Record<string, boolean>>({});
  const [ctxMenu, setCtxMenu] = useState<SketchCtxMenu | null>(null);

  const hasAny = sketches.length > 0 || !!activeSketch;
  if (!hasAny) return null;

  const isVisible = (id: string) => sketchVis[id] !== false;
  const toggleVis = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSketchVis((prev) => ({ ...prev, [id]: !isVisible(id) }));
  };

  const allVisible = sketches.every((sk) => isVisible(sk.id)) && (!activeSketch || isVisible('active'));
  const toggleFolderVis = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !allVisible;
    const newVis: Record<string, boolean> = {};
    sketches.forEach((sk) => { newVis[sk.id] = next; });
    if (activeSketch) newVis['active'] = next;
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
        <span className="browser-item-icon" style={{ color: 'var(--text-dim)' }}>
          <FolderOpen size={13} />
        </span>
        <span className="browser-item-label">Sketches</span>
      </div>

      {/* Child rows */}
      {expanded && (
        <>
          {/* Completed sketches */}
          {sketches.map((sk) => (
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
              <span className="browser-item-icon"
                style={{ color: isVisible(sk.id) ? 'var(--accent)' : 'var(--text-dim)', opacity: isVisible(sk.id) ? 1 : 0.5 }}>
                <PenTool size={12} />
              </span>
              <span className="browser-item-label" style={{ opacity: isVisible(sk.id) ? 1 : 0.5 }}>
                {sk.name}
              </span>
            </div>
          ))}

          {/* Currently editing sketch */}
          {activeSketch && (
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
              <span className="browser-item-icon" style={{ color: 'var(--warning)' }}>
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

// ===== Main Component Tree =====
export default function ComponentTree() {
  const rootComponentId = useComponentStore((s) => s.rootComponentId);
  const addComponent = useComponentStore((s) => s.addComponent);

  return (
    <div className="component-tree-panel">
      <div className="tree-panel-header">
        <h3>BROWSER</h3>
        <button
          className="icon-btn"
          title="New Component"
          onClick={() => addComponent(rootComponentId)}
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="tree-scroll">
        <ComponentNode componentId={rootComponentId} />
        <OriginTree />
        <SketchesFolder />
      </div>
    </div>
  );
}
