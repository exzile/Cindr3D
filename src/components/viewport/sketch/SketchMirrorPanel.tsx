import { useEffect, useMemo } from 'react';
import { MousePointer2, X } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import { useDraggablePanel } from './useDraggablePanel';
import './SketchPalette.css';
import './SketchToolPanel.css';

const LINE_TYPES = new Set(['line', 'construction-line', 'centerline']);

/** Fusion-style sketch mirror collector. Objects and mirror line are picked in the viewport. */
export default function SketchMirrorPanel() {
  const {
    dragHandleProps,
    isDragging,
    panelEventProps,
    panelRef,
    panelStyle,
  } = useDraggablePanel();
  const activeTool = useCADStore((s) => s.activeTool);
  const setActiveTool = useCADStore((s) => s.setActiveTool);
  const activeSketch = useCADStore((s) => s.activeSketch);
  const selectedEntityIds = useCADStore((s) => s.selectedEntityIds);
  const setSelectedEntityIds = useCADStore((s) => s.setSelectedEntityIds);
  const mirrorObjectIds = useCADStore((s) => s.sketchMirrorObjectIds);
  const setMirrorObjectIds = useCADStore((s) => s.setSketchMirrorObjectIds);
  const mirrorLineId = useCADStore((s) => s.sketchMirrorLineId);
  const setMirrorLineId = useCADStore((s) => s.setSketchMirrorLineId);
  const selectionMode = useCADStore((s) => s.sketchMirrorSelectionMode);
  const setSelectionMode = useCADStore((s) => s.setSketchMirrorSelectionMode);
  const clearMirrorSelections = useCADStore((s) => s.clearSketchMirrorSelections);
  const commitMirror = useCADStore((s) => s.commitSketchMirror);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const entityById = useMemo(
    () => new Map((activeSketch?.entities ?? []).map((entity) => [entity.id, entity])),
    [activeSketch?.entities],
  );

  const validObjectIds = useMemo(
    () => mirrorObjectIds.filter((id) => entityById.has(id) && id !== mirrorLineId),
    [entityById, mirrorLineId, mirrorObjectIds],
  );
  const mirrorLine = mirrorLineId ? entityById.get(mirrorLineId) : null;
  const hasMirrorLine = Boolean(mirrorLine && LINE_TYPES.has(mirrorLine.type));
  const canCommit = validObjectIds.length > 0 && hasMirrorLine;

  useEffect(() => {
    if (activeTool !== 'sketch-mirror') return;
    if (mirrorObjectIds.length > 0 || selectedEntityIds.length === 0) return;
    const selectedObjects = selectedEntityIds.filter((id) => {
      const entity = entityById.get(id);
      return Boolean(entity && id !== mirrorLineId);
    });
    if (selectedObjects.length > 0) {
      setMirrorObjectIds(selectedObjects);
      setSelectionMode('objects');
      setStatusMessage(`${selectedObjects.length} mirror object${selectedObjects.length === 1 ? '' : 's'} selected`);
    }
  }, [
    activeTool,
    entityById,
    mirrorLineId,
    mirrorObjectIds.length,
    selectedEntityIds,
    setMirrorObjectIds,
    setSelectionMode,
    setStatusMessage,
  ]);

  useEffect(() => {
    if (activeTool !== 'sketch-mirror') return;
    const highlighted = mirrorLineId ? [...validObjectIds, mirrorLineId] : validObjectIds;
    setSelectedEntityIds(highlighted);
  }, [activeTool, mirrorLineId, setSelectedEntityIds, validObjectIds]);

  if (activeTool !== 'sketch-mirror') return null;

  const activateObjects = () => {
    setSelectionMode('objects');
    setStatusMessage('Mirror Objects: click sketch geometry to include or remove it');
  };

  const activateLine = () => {
    setSelectionMode('line');
    setStatusMessage('Mirror Line: click a line, construction line, or centerline');
  };

  const clearObjects = () => {
    setMirrorObjectIds([]);
    setSelectedEntityIds(mirrorLineId ? [mirrorLineId] : []);
    setStatusMessage('Mirror objects cleared');
  };

  const clearLine = () => {
    setMirrorLineId(null);
    setSelectedEntityIds(validObjectIds);
    setStatusMessage('Mirror line cleared');
  };

  const cancel = () => {
    clearMirrorSelections();
    setSelectedEntityIds([]);
    setActiveTool('select');
  };

  const commit = () => {
    if (!canCommit) {
      setStatusMessage(!hasMirrorLine ? 'Mirror: select a mirror line first' : 'Mirror: select at least one object');
      return;
    }
    commitMirror();
    setActiveTool('select');
  };

  return (
    <div
      ref={panelRef}
      className={`sketch-palette sketch-mirror-palette${isDragging ? ' is-dragging' : ''}`}
      style={panelStyle}
      role="dialog"
      aria-label="Sketch Mirror"
      {...panelEventProps}
    >
      <div className="sketch-palette-header" {...dragHandleProps}>
        <span className="sketch-palette-dot" aria-hidden="true" />
        <span className="sketch-palette-title">MIRROR</span>
      </div>

      <div className="sketch-palette-body sketch-mirror-palette__body">
        <div className="sketch-mirror-palette__row">
          <span className="sketch-palette-label">Objects</span>
          <button
            type="button"
            className={`sketch-mirror-palette__collector ${selectionMode === 'objects' ? 'is-active' : ''}`}
            onClick={activateObjects}
          >
            <MousePointer2 size={14} />
            <span>{validObjectIds.length > 0 ? `${validObjectIds.length} selected` : 'Select'}</span>
          </button>
          <button
            type="button"
            className="sketch-mirror-palette__clear"
            onClick={clearObjects}
            disabled={validObjectIds.length === 0}
            title="Clear mirrored objects"
          >
            <X size={13} />
          </button>
        </div>

        <div className="sketch-mirror-palette__row">
          <span className="sketch-palette-label">Mirror Line</span>
          <button
            type="button"
            className={`sketch-mirror-palette__collector ${selectionMode === 'line' ? 'is-active' : ''}`}
            onClick={activateLine}
          >
            <MousePointer2 size={14} />
            <span>{hasMirrorLine ? '1 selected' : 'Select'}</span>
          </button>
          <button
            type="button"
            className="sketch-mirror-palette__clear"
            onClick={clearLine}
            disabled={!hasMirrorLine}
            title="Clear mirror line"
          >
            <X size={13} />
          </button>
        </div>

        <div className="sketch-palette-hint sketch-mirror-palette__hint">
          {selectionMode === 'line'
            ? 'Click a sketch line to define the symmetry axis.'
            : 'Click completed sketch entities to toggle them in the mirror set.'}
        </div>
      </div>

      <div className="sketch-palette-footer sketch-mirror-palette__footer">
        <span className="sketch-mirror-palette__info" aria-hidden="true">i</span>
        <button
          className="sketch-mirror-palette__button sketch-mirror-palette__button--primary"
          onClick={commit}
          disabled={!canCommit}
        >
          OK
        </button>
        <button className="sketch-mirror-palette__button" onClick={cancel}>Cancel</button>
      </div>
    </div>
  );
}
