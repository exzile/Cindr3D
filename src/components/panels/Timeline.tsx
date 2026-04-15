import { useState } from 'react';
import {
  Eye, EyeOff, Trash2, PenTool, ArrowUpFromLine,
  RotateCcw, Blend, FileBox, ChevronDown, PauseCircle, PlayCircle,
  SkipBack, CheckSquare, Folder, FolderOpen, ChevronRight, Pencil,
} from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import type { Feature, FeatureGroup } from '../../types/cad';

function FeatureIcon({ type }: { type: Feature['type'] }) {
  switch (type) {
    case 'sketch': return <PenTool size={14} />;
    case 'extrude': return <ArrowUpFromLine size={14} />;
    case 'revolve': return <RotateCcw size={14} />;
    case 'fillet': return <Blend size={14} />;
    case 'chamfer': return <ChevronDown size={14} />;
    case 'base-feature': return <FileBox size={14} />;
    case 'import': return <FileBox size={14} />;
    default: return <FileBox size={14} />;
  }
}

// MM4 — Group header row
function GroupHeader({ group }: { group: FeatureGroup }) {
  const toggleFeatureGroup = useCADStore((s) => s.toggleFeatureGroup);
  const renameFeatureGroup = useCADStore((s) => s.renameFeatureGroup);
  const deleteFeatureGroup = useCADStore((s) => s.deleteFeatureGroup);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(group.name);

  const commitRename = () => {
    if (editName.trim()) renameFeatureGroup(group.id, editName.trim());
    setEditing(false);
  };

  return (
    <div
      className="timeline-group-header"
      onClick={() => toggleFeatureGroup(group.id)}
    >
      <span className="timeline-group-header__accent">
        {group.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
      </span>
      <span className="timeline-group-header__accent">
        {group.collapsed ? <Folder size={13} /> : <FolderOpen size={13} />}
      </span>
      {editing ? (
        <input
          autoFocus
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditing(false); }}
          onClick={(e) => e.stopPropagation()}
          className="timeline-group-header__input"
        />
      ) : (
        <span className="timeline-group-header__name">{group.name}</span>
      )}
      <button
        className="timeline-action-btn timeline-group-header__btn"
        onClick={(e) => { e.stopPropagation(); setEditName(group.name); setEditing(true); }}
        title="Rename group"
      >
        <Pencil size={11} />
      </button>
      <button
        className="timeline-action-btn danger timeline-group-header__btn"
        onClick={(e) => { e.stopPropagation(); deleteFeatureGroup(group.id); }}
        title="Delete group"
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}

// D186: Open the dialog that originally committed this feature, pre-filled.
// Maps feature type/params to a dialog id in App.tsx's ActiveDialog switch.
function editDialogFor(feature: Feature): string | null {
  const p = feature.params ?? {};
  switch (feature.type) {
    case 'shell':           return 'shell';
    case 'draft':           return 'draft';
    case 'scale':           return 'scale';
    case 'combine':         return 'combine';
    case 'hole':            return 'hole';
    case 'thread':          return 'thread';
    case 'thicken':         return 'thicken';
    case 'linear-pattern':  return 'linear-pattern';
    case 'circular-pattern':return 'circular-pattern';
    case 'pattern-on-path': return 'pattern-on-path';
    case 'mirror':          return 'mirror';
    case 'offset-face':     return 'offset-face';
    case 'split-body':
      if (p.isSurfaceTrim)   return 'surface-trim';
      if (p.isSurfaceSplit)  return 'surface-split';
      if (p.unstitch)        return 'unstitch';
      return 'split';
    case 'rib':
      if (p.webStyle === 'perpendicular') return 'web';
      if (p.embossStyle === 'emboss')     return 'emboss';
      if (p.restStyle === 'rest')         return 'rest';
      return null;
    case 'construction-plane': return 'construction-plane';
    case 'construction-axis':  return 'axis-perp-to-face';
    case 'primitive': {
      const kind = String(p.kind ?? '');
      if (kind && ['box','cylinder','sphere','torus','coil'].includes(kind)) {
        return `primitive-${kind}`;
      }
      return null;
    }
    case 'import':
      if (p.isRigidGroup)        return 'rigid-group';
      if (p.isPhysicalMaterial)  return 'physical-material';
      if (p.isAppearance)        return 'appearance';
      if (p.isMoveBody)          return 'move-body';
      if (p.isBoundaryFill)      return 'boundary-fill';
      if (p.baseFeature)         return 'base-feature';
      if (p.isCanvasRef)         return 'insert-canvas';
      return null;
    case 'sweep':
      if (p.isPipe)              return 'pipe';
      if (p.isSurfaceOffset)     return 'offset-surface';
      if (p.isSurfaceExtend)     return 'surface-extend';
      return null;
    default:                    return null;
  }
}

function FeatureItem({ feature, index, indented }: { feature: Feature; index: number; indented?: boolean }) {
  const toggleVisibility = useCADStore((s) => s.toggleFeatureVisibility);
  const toggleSuppressed = useCADStore((s) => s.toggleFeatureSuppressed);
  const removeFeature = useCADStore((s) => s.removeFeature);
  const selectedFeatureId = useCADStore((s) => s.selectedFeatureId);
  const setSelectedFeatureId = useCADStore((s) => s.setSelectedFeatureId);
  const setEditingFeatureId = useCADStore((s) => s.setEditingFeatureId);
  const setActiveDialog = useCADStore((s) => s.setActiveDialog);
  const reorderFeature = useCADStore((s) => s.reorderFeature);
  const rollbackIndex = useCADStore((s) => s.rollbackIndex);
  const setRollbackIndex = useCADStore((s) => s.setRollbackIndex);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const createFeatureGroup = useCADStore((s) => s.createFeatureGroup);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const isSelected = selectedFeatureId === feature.id;
  // D190: feature is rolled back (skipped) if index > rollbackIndex (and rollbackIndex >= 0)
  const isRolledBack = rollbackIndex >= 0 && index > rollbackIndex;

  // D186: double-click to edit — open the dialog that committed this feature
  const handleDoubleClick = () => {
    const dialogId = editDialogFor(feature);
    if (!dialogId) {
      setStatusMessage(`${feature.name}: no editable parameters`);
      return;
    }
    setEditingFeatureId(feature.id);
    setActiveDialog(dialogId);
  };

  // D189: drag-reorder
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/feature-id', feature.id);
    e.dataTransfer.setData('text/feature-index', String(index));
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('text/feature-id')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  };
  const handleDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData('text/feature-id');
    if (!id || id === feature.id) return;
    e.preventDefault();
    reorderFeature(id, index);
  };

  // D190: Set rollback marker via alt-click on the timeline row
  const handleRollbackClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (rollbackIndex === index) {
      setRollbackIndex(-1);
      setStatusMessage('Rollback cleared');
    } else {
      setRollbackIndex(index);
      setStatusMessage(`Rolled back to "${feature.name}"`);
    }
  };

  // MM4 right-click context menu
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const closeContextMenu = () => setContextMenu(null);

  return (
    <>
    <div
      className={`timeline-item ${isSelected ? 'selected' : ''} ${isRolledBack ? 'rolled-back' : ''} ${indented ? 'indented' : ''}`}
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={() => setSelectedFeatureId(isSelected ? null : feature.id)}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      title="Double-click to edit • Drag to reorder • Right-click for options"
    >
      <div className="timeline-item-icon">
        <FeatureIcon type={feature.type} />
      </div>
      <div className="timeline-item-info">
        <span className="timeline-item-name">{feature.name}</span>
        <span className="timeline-item-type">{feature.type}</span>
      </div>
      <div className="timeline-item-actions">
        <button
          className={`timeline-action-btn ${rollbackIndex === index ? 'active' : ''}`}
          onClick={handleRollbackClick}
          title={rollbackIndex === index ? 'Clear rollback' : 'Roll back to this feature'}
        >
          <SkipBack size={14} />
        </button>
        <button
          className={`timeline-action-btn ${feature.suppressed ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            toggleSuppressed(feature.id);
          }}
          title={feature.suppressed ? 'Unsuppress' : 'Suppress'}
        >
          {feature.suppressed ? <PlayCircle size={14} /> : <PauseCircle size={14} />}
        </button>
        <button
          className="timeline-action-btn"
          onClick={(e) => {
            e.stopPropagation();
            toggleVisibility(feature.id);
          }}
          title={feature.visible ? 'Hide' : 'Show'}
        >
          {feature.visible ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        <button
          className="timeline-action-btn danger"
          onClick={(e) => {
            e.stopPropagation();
            removeFeature(feature.id);
          }}
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
    {contextMenu && (
      <>
        <div
          className="timeline-context-overlay"
          onClick={closeContextMenu}
          onContextMenu={(e) => { e.preventDefault(); closeContextMenu(); }}
        />
        <div
          className="timeline-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="timeline-context-menu__btn"
            onClick={() => {
              createFeatureGroup('Group', [feature.id]);
              closeContextMenu();
            }}
          >
            <Folder size={12} />
            Group Selected
          </button>
        </div>
      </>
    )}
    </>
  );
}

export default function Timeline() {
  const allFeatures = useCADStore((s) => s.features);
  const historyEnabled = useCADStore((s) => s.historyEnabled);
  const featureGroups = useCADStore((s) => s.featureGroups);
  const rollbackIndex = useCADStore((s) => s.rollbackIndex);
  const setRollbackIndex = useCADStore((s) => s.setRollbackIndex);
  const baseFeatureActive = useCADStore((s) => s.baseFeatureActive);
  const finishBaseFeature = useCADStore((s) => s.finishBaseFeature);
  const [dragOverEnd, setDragOverEnd] = useState(false);
  const reorderFeature = useCADStore((s) => s.reorderFeature);

  // MM1: Only show features that were recorded while history was enabled
  const features = allFeatures.filter((f) => !f.suppressTimeline);

  const handleEndDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData('text/feature-id');
    if (!id) return;
    e.preventDefault();
    reorderFeature(id, features.length);
    setDragOverEnd(false);
  };

  // MM4: Build grouped render list
  // Collect groups that have at least one member feature
  const activeGroupIds = new Set(features.map((f) => f.groupId).filter(Boolean) as string[]);
  const relevantGroups = featureGroups.filter((g) => activeGroupIds.has(g.id));
  const groupMap = new Map(relevantGroups.map((g) => [g.id, g]));
  // Track which groupIds we've already rendered a header for
  const renderedGroupHeaders = new Set<string>();

  const renderFeatureList = () => {
    const rows: React.ReactNode[] = [];
    features.forEach((feature, i) => {
      if (feature.groupId) {
        const group = groupMap.get(feature.groupId);
        if (group && !renderedGroupHeaders.has(group.id)) {
          renderedGroupHeaders.add(group.id);
          rows.push(<GroupHeader key={`group-${group.id}`} group={group} />);
        }
        if (!group || !group.collapsed) {
          rows.push(<FeatureItem key={feature.id} feature={feature} index={i} indented={!!feature.groupId} />);
        }
      } else {
        rows.push(<FeatureItem key={feature.id} feature={feature} index={i} />);
      }
    });
    return rows;
  };

  return (
    <div className="timeline-panel">
      {/* MM1 — Direct Modeling mode notice */}
      {!historyEnabled && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: '#4a3800',
            color: '#ffb300',
            padding: '5px 10px',
            fontSize: 12,
            fontWeight: 600,
            borderBottom: '1px solid #7a5e00',
          }}
        >
          Design history not captured (Direct Modeling mode)
        </div>
      )}
      {/* MM3 — Base Feature active banner */}
      {baseFeatureActive && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: '#7c5c00',
            color: '#ffd966',
            padding: '5px 10px',
            fontSize: 12,
            fontWeight: 600,
            borderBottom: '1px solid #a07800',
          }}
        >
          <span style={{ flex: 1 }}>Base Feature open — parametric recompute suppressed</span>
          <button
            onClick={finishBaseFeature}
            title="Finish Base Feature"
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: '#ffd966', color: '#3a2c00',
              border: 'none', borderRadius: 3,
              padding: '2px 8px', cursor: 'pointer',
              fontSize: 11, fontWeight: 700,
            }}
          >
            <CheckSquare size={12} />
            Finish
          </button>
        </div>
      )}
      <div className="timeline-header">
        <h3>Timeline</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {rollbackIndex >= 0 && (
            <button
              className="timeline-action-btn active"
              onClick={() => setRollbackIndex(-1)}
              title="Clear rollback marker"
              style={{ fontSize: 11, padding: '2px 6px' }}
            >
              Rollback @ {rollbackIndex + 1}
            </button>
          )}
          <span className="feature-count">{features.length} features</span>
        </div>
      </div>
      <div className="timeline-list">
        {features.length === 0 ? (
          <div className="timeline-empty">
            <p>No features yet</p>
            <p className="timeline-hint">Start by creating a sketch</p>
          </div>
        ) : (
          <>
            {renderFeatureList()}
            <div
              className={`timeline-drop-target ${dragOverEnd ? 'active' : ''}`}
              style={{
                height: 6,
                borderRadius: 3,
                background: dragOverEnd ? 'var(--accent)' : 'transparent',
                transition: 'background 120ms',
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('text/feature-id')) {
                  e.preventDefault();
                  setDragOverEnd(true);
                }
              }}
              onDragLeave={() => setDragOverEnd(false)}
              onDrop={handleEndDrop}
            />
          </>
        )}
      </div>
    </div>
  );
}
