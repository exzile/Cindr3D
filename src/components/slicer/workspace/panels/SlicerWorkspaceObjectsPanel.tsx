import { useState, useCallback, useRef } from 'react';
import * as React from 'react';
import { Plus, Trash2, LayoutGrid, XCircle, Upload, Box, FlipHorizontal, RefreshCw, Layers } from 'lucide-react';
import { useSlicerStore } from '../../../../store/slicerStore';
import { useCADStore } from '../../../../store/cadStore';
import type { PlateObject } from '../../../../types/slicer';
import { normalizeRotationRadians, normalizeScale } from '../../../../utils/slicerTransforms';
import { NON_BODY_FEATURE_TYPES } from '../../slicerFeatureTypes';
import './SlicerWorkspaceObjectsPanel.css';

export function SlicerWorkspaceObjectsPanel() {
  const plateObjects = useSlicerStore((s) => s.plateObjects);
  const selectedId = useSlicerStore((s) => s.selectedPlateObjectId);
  const selectPlateObject = useSlicerStore((s) => s.selectPlateObject);
  const removeFromPlate = useSlicerStore((s) => s.removeFromPlate);
  const autoArrange = useSlicerStore((s) => s.autoArrange);
  const clearPlate = useSlicerStore((s) => s.clearPlate);
  const addToPlate = useSlicerStore((s) => s.addToPlate);
  const updatePlateObject = useSlicerStore((s) => s.updatePlateObject);
  const importFileToPlate = useSlicerStore((s) => s.importFileToPlate);
  const getActivePrinterProfile = useSlicerStore((s) => s.getActivePrinterProfile);
  const features = useCADStore((s) => s.features);

  const [showAddMenu, setShowAddMenu] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedObj = plateObjects.find((o) => o.id === selectedId) ?? null;

  const handleImportFile = useCallback(async (file: File) => {
    setImporting(true);
    setImportError(null);
    try {
      await importFileToPlate(file);
    } catch (err) {
      setImportError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }, [importFileToPlate]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleImportFile(file);
    if (e.target) e.target.value = '';
  }, [handleImportFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleImportFile(file);
  }, [handleImportFile]);

  const handleAddModel = useCallback((feature: typeof features[0]) => {
    addToPlate(feature.id, feature.name, null);
    setShowAddMenu(false);
  }, [addToPlate, features]);

  const sizeStr = (obj: PlateObject) => {
    const sx = (obj.boundingBox.max.x - obj.boundingBox.min.x).toFixed(1);
    const sy = (obj.boundingBox.max.y - obj.boundingBox.min.y).toFixed(1);
    const sz = (obj.boundingBox.max.z - obj.boundingBox.min.z).toFixed(1);
    return `${sx} × ${sy} × ${sz} mm`;
  };

  const updObj = useCallback((updates: Record<string, unknown>) => {
    if (!selectedId) return;
    updatePlateObject(selectedId, updates as Partial<PlateObject>);
  }, [selectedId, updatePlateObject]);

  const pos = selectedObj ? (selectedObj.position as { x: number; y: number; z: number }) : null;
  const rot = selectedObj ? normalizeRotationRadians((selectedObj as { rotation?: unknown }).rotation) : null;
  const scl = selectedObj ? normalizeScale((selectedObj as { scale?: unknown }).scale) : null;

  const xyzRow = (
    label: string,
    vals: { x: number; y: number; z: number },
    onChange: (axis: 'x' | 'y' | 'z', v: number) => void,
    step = 1,
  ) => (
    <div className="slicer-workspace-objects-panel__xyz-row">
      <div className="slicer-workspace-objects-panel__xyz-label">{label}</div>
      <div className="slicer-workspace-objects-panel__xyz-inputs">
        {(['x', 'y', 'z'] as const).map((ax) => (
          <label key={ax} className="slicer-workspace-objects-panel__axis-field">
            {ax.toUpperCase()}
            <input
              type="number"
              className="slicer-workspace-objects-panel__axis-input"
              step={step}
              value={vals[ax].toFixed(step < 1 ? 3 : 1)}
              onChange={(e) => onChange(ax, parseFloat(e.target.value) || 0)} />
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <div className="slicer-workspace-objects-panel">
      <div className="slicer-workspace-objects-panel__header">
        <Layers size={16} />
        Objects on Plate
      </div>

      <div className="slicer-workspace-objects-panel__list">
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`slicer-workspace-objects-panel__dropzone ${isDragging ? 'is-dragging' : ''}`}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={16} className="slicer-workspace-objects-panel__dropzone-icon" />
          {importing ? 'Importing...' : 'Drop STL/OBJ/3MF or click'}
        </div>
        {importError && (
          <div className="slicer-workspace-objects-panel__import-error">{importError}</div>
        )}
        <input ref={fileInputRef} type="file" accept=".stl,.obj,.3mf,.amf,.step,.stp" className="slicer-workspace-objects-panel__file-input" onChange={handleFileInput} />

        {plateObjects.length === 0 && !importing && (
          <div className="slicer-workspace-objects-panel__empty">
            No objects on the build plate.
          </div>
        )}
        {plateObjects.map((obj) => {
          const w = obj.boundingBox.max.x - obj.boundingBox.min.x;
          const d = obj.boundingBox.max.y - obj.boundingBox.min.y;
          const h = obj.boundingBox.max.z - obj.boundingBox.min.z;
          const initials = obj.name.slice(0, 2).toUpperCase();
          return (
            <div key={obj.id} onClick={() => selectPlateObject(obj.id)} className={`slicer-workspace-objects-panel__row ${obj.id === selectedId ? 'is-selected' : ''}`}>
              <div className="slicer-workspace-objects-panel__thumb" aria-hidden>
                <svg viewBox="0 0 28 28" width="28" height="28" className="slicer-workspace-objects-panel__thumb-svg">
                  {/* isometric box silhouette */}
                  <polygon points="14,4 24,9 24,19 14,24 4,19 4,9" className="slicer-workspace-objects-panel__thumb-hex" />
                  <polyline points="14,4 14,14" className="slicer-workspace-objects-panel__thumb-edge" />
                  <polyline points="14,14 24,9" className="slicer-workspace-objects-panel__thumb-edge" />
                  <polyline points="14,14 4,9" className="slicer-workspace-objects-panel__thumb-edge" />
                  <text x="14" y="17" textAnchor="middle" className="slicer-workspace-objects-panel__thumb-text">{initials}</text>
                </svg>
              </div>
              <div className="slicer-workspace-objects-panel__row-info">
                <div className="slicer-workspace-objects-panel__name" title={obj.name}>{obj.name}</div>
                <div className="slicer-workspace-objects-panel__size">{w.toFixed(1)} × {d.toFixed(1)} × {h.toFixed(1)} mm</div>
              </div>
              <button title={`Remove ${obj.name}`} className="slicer-workspace-objects-panel__remove" onClick={(e) => { e.stopPropagation(); removeFromPlate(obj.id); }}>
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </div>

      {selectedObj && pos && rot && scl && (
        <div className="slicer-workspace-objects-panel__transform">
          <div className="slicer-workspace-objects-panel__transform-title">
            Transform
          </div>
          {xyzRow('Position (mm)', pos, (ax, v) => updObj({ position: { ...pos, [ax]: v } }), 0.1)}
          {xyzRow('Rotation (°)', rot, (ax, v) => updObj({ rotation: { ...rot, [ax]: v } }), 1)}
          {xyzRow('Scale', scl, (ax, v) => updObj({ scale: { ...scl, [ax]: Math.max(0.001, v) } }), 0.01)}
          <div className="slicer-workspace-objects-panel__button-row">
            <button className="slicer-workspace-objects-panel__button"
              onClick={() => updObj({ scale: { x: 1, y: 1, z: 1 }, rotation: { x: 0, y: 0, z: 0 } })}>
              <RefreshCw size={10} /> Reset
            </button>
            <button className="slicer-workspace-objects-panel__button"
              onClick={() => {
                const b = selectedObj.boundingBox;
                const bv = getActivePrinterProfile()?.buildVolume ?? { x: 220, y: 220, z: 250 };
                const s = normalizeScale((selectedObj as { scale?: unknown }).scale);
                const w = (b.max.x - b.min.x) * s.x;
                const d = (b.max.y - b.min.y) * s.y;
                const minZ = b.min.z * s.z;
                updObj({ position: {
                  x: bv.x / 2 - b.min.x * s.x - w / 2,
                  y: bv.y / 2 - b.min.y * s.y - d / 2,
                  z: isFinite(minZ) ? -minZ : 0,
                }});
              }}>
              Center
            </button>
          </div>
          <div className="slicer-workspace-objects-panel__button-row slicer-workspace-objects-panel__button-row--mirrors">
            <button className="slicer-workspace-objects-panel__button"
              title="Mirror X"
              onClick={() => updObj({ mirrorX: !(selectedObj as { mirrorX?: boolean }).mirrorX })}>
              <FlipHorizontal size={10} /> X
            </button>
            <button className="slicer-workspace-objects-panel__button"
              title="Mirror Y"
              onClick={() => updObj({ mirrorY: !(selectedObj as { mirrorY?: boolean }).mirrorY })}>
              <FlipHorizontal size={10} /> Y
            </button>
            <button className="slicer-workspace-objects-panel__button"
              title="Mirror Z"
              onClick={() => updObj({ mirrorZ: !(selectedObj as { mirrorZ?: boolean }).mirrorZ })}>
              <FlipHorizontal size={10} /> Z
            </button>
          </div>
        </div>
      )}

      <div className="slicer-workspace-objects-panel__actions">
        <div className="slicer-workspace-objects-panel__add-wrap">
          <button className="slicer-workspace-objects-panel__action-button" onClick={() => setShowAddMenu(!showAddMenu)}>
            <Plus size={14} /> Add from CAD
          </button>
          {showAddMenu && (
            <div className="slicer-workspace-objects-panel__menu">
              {features.length === 0 && (
                <div className="slicer-workspace-objects-panel__menu-empty">
                  No CAD features available.
                </div>
              )}
              {features.filter(f => !NON_BODY_FEATURE_TYPES.has(f.type) && !f.suppressed).map((f) => (
                <div key={f.id} onClick={() => handleAddModel(f)} className="slicer-workspace-objects-panel__menu-item">
                  <Box size={12} className="slicer-workspace-objects-panel__menu-item-icon" />
                  {f.name}
                </div>
              ))}
            </div>
          )}
        </div>
        <button className="slicer-workspace-objects-panel__secondary-button" onClick={() => autoArrange()}>
          <LayoutGrid size={14} /> Auto Arrange
        </button>
        <button className="slicer-workspace-objects-panel__danger-button" onClick={() => clearPlate()} disabled={plateObjects.length === 0}>
          <XCircle size={14} /> Clear Plate
        </button>
      </div>
    </div>
  );
}
