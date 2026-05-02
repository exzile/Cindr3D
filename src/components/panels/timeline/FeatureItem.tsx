import { useState } from 'react';
import {
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  PauseCircle,
  Pencil,
  PlayCircle,
  SkipBack,
  Trash2,
} from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import type { Feature } from '../../../types/cad';
import { editDialogFor } from './editDialogFor';
import { FeatureIcon } from './FeatureIcon';

export function FeatureItem({ feature, index, indented }: { feature: Feature; index: number; indented?: boolean }) {
  const toggleVisibility = useCADStore((s) => s.toggleFeatureVisibility);
  const toggleSuppressed = useCADStore((s) => s.toggleFeatureSuppressed);
  const removeFeature = useCADStore((s) => s.removeFeature);
  const selectedFeatureId = useCADStore((s) => s.selectedFeatureId);
  const setSelectedFeatureId = useCADStore((s) => s.setSelectedFeatureId);
  const setEditingFeatureId = useCADStore((s) => s.setEditingFeatureId);
  const loadExtrudeForEdit = useCADStore((s) => s.loadExtrudeForEdit);
  const editSketch = useCADStore((s) => s.editSketch);
  const setActiveDialog = useCADStore((s) => s.setActiveDialog);
  const reorderFeature = useCADStore((s) => s.reorderFeature);
  const renameFeature = useCADStore((s) => s.renameFeature);
  const rollbackIndex = useCADStore((s) => s.rollbackIndex);
  const setRollbackIndex = useCADStore((s) => s.setRollbackIndex);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const createFeatureGroup = useCADStore((s) => s.createFeatureGroup);
  const moveFeatureToGroup = useCADStore((s) => s.moveFeatureToGroup);
  const featureGroups = useCADStore((s) => s.featureGroups);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [moveToGroupOpen, setMoveToGroupOpen] = useState(false);

  const isSelected = selectedFeatureId === feature.id;
  const isRolledBack = rollbackIndex >= 0 && index > rollbackIndex;

  const handleDoubleClick = () => {
    if (feature.type === 'sketch' && feature.sketchId) {
      editSketch(feature.sketchId);
      return;
    }
    if (feature.type === 'extrude') {
      loadExtrudeForEdit(feature.id);
      return;
    }
    const dialogId = editDialogFor(feature);
    if (!dialogId) {
      setStatusMessage(`${feature.name}: no editable parameters`);
      return;
    }
    setEditingFeatureId(feature.id);
    setActiveDialog(dialogId);
  };

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

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const closeContextMenu = () => {
    setContextMenu(null);
    setMoveToGroupOpen(false);
  };

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
          <button className={`timeline-action-btn ${rollbackIndex === index ? 'active' : ''}`} onClick={handleRollbackClick} title={rollbackIndex === index ? 'Clear rollback' : 'Roll back to this feature'}>
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
          <div className="timeline-context-overlay" onClick={closeContextMenu} onContextMenu={(e) => { e.preventDefault(); closeContextMenu(); }} />
          <div className="timeline-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(e) => e.stopPropagation()}>
            {editDialogFor(feature) && (
              <button className="timeline-context-menu__btn" onClick={() => { handleDoubleClick(); closeContextMenu(); }}>
                <Pencil size={12} />
                Edit
              </button>
            )}
            <button
              className="timeline-context-menu__btn"
              onClick={() => {
                const name = window.prompt('Rename feature', feature.name);
                if (name?.trim()) {
                  renameFeature(feature.id, name.trim());
                  setStatusMessage(`Feature renamed to "${name.trim()}"`);
                }
                closeContextMenu();
              }}
            >
              <Pencil size={12} />
              Rename
            </button>

            <div className="timeline-context-menu__sep" />

            <button className="timeline-context-menu__btn" onClick={() => { toggleSuppressed(feature.id); closeContextMenu(); }}>
              {feature.suppressed ? <PlayCircle size={12} /> : <PauseCircle size={12} />}
              {feature.suppressed ? 'Unsuppress' : 'Suppress'}
            </button>

            <button
              className="timeline-context-menu__btn"
              onClick={() => {
                if (rollbackIndex === index) {
                  setRollbackIndex(-1);
                  setStatusMessage('Rollback cleared');
                } else {
                  setRollbackIndex(index);
                  setStatusMessage(`Rolled back to "${feature.name}"`);
                }
                closeContextMenu();
              }}
            >
              <SkipBack size={12} />
              {rollbackIndex === index ? 'Clear Rollback' : 'Roll Back To Here'}
            </button>

            <div className="timeline-context-menu__sep" />

            {featureGroups.length > 0 && (
              <div className="timeline-submenu-container">
                <button className="timeline-context-menu__btn" onClick={() => setMoveToGroupOpen((v) => !v)}>
                  <FolderOpen size={12} />
                  Move to Group ▸
                </button>
                {moveToGroupOpen && (
                  <div className="timeline-context-submenu">
                    {featureGroups.map((g) => (
                      <button
                        key={g.id}
                        className="timeline-context-menu__btn"
                        onClick={() => {
                          moveFeatureToGroup(feature.id, g.id);
                          setStatusMessage(`Moved "${feature.name}" to group "${g.name}"`);
                          closeContextMenu();
                        }}
                      >
                        <Folder size={12} />
                        {g.name}
                      </button>
                    ))}
                    {feature.groupId && (
                      <button
                        className="timeline-context-menu__btn"
                        onClick={() => {
                          moveFeatureToGroup(feature.id, null);
                          setStatusMessage(`Removed "${feature.name}" from group`);
                          closeContextMenu();
                        }}
                      >
                        <FolderOpen size={12} />
                        Remove from Group
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            <button className="timeline-context-menu__btn" onClick={() => { createFeatureGroup('Group', [feature.id]); closeContextMenu(); }}>
              <Folder size={12} />
              Group Selected
            </button>

            <div className="timeline-context-menu__sep" />

            <button className="timeline-context-menu__btn danger" onClick={() => { removeFeature(feature.id); closeContextMenu(); }}>
              <Trash2 size={12} />
              Delete
            </button>
          </div>
        </>
      )}
    </>
  );
}
