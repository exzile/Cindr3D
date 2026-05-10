import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import * as React from 'react';
import * as THREE from 'three';
import {
  Plus, Trash2, LayoutGrid, XCircle, Upload, Box,
  Layers, Copy, Eye, EyeOff, Lock, Unlock, Palette, AlertTriangle,
  Save, FolderOpen, AlignEndHorizontal, ArrowDownToLine, RotateCw,
  Scissors, CircleDot, Maximize2, Wrench, Link2,
} from 'lucide-react';
import { useSlicerStore } from '../../../../store/slicerStore';
import { useCADStore } from '../../../../store/cadStore';
import type { PlateObject } from '../../../../types/slicer';
import { NON_BODY_FEATURE_TYPES } from '../../slicerFeatureTypes';
import { validatePlate } from '../../../../store/slicer/plateValidation';
import { CalibrationMenu } from '../bottom/CalibrationMenu';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu';
import { GeometryToolsModal, type GeometryTool } from '../GeometryToolsModal';
import { computeMeshStats } from '../../../../engine/meshStats';
import { fetchModelUrlToFile } from '../../../../utils/printFromUrl';
import './SlicerWorkspaceObjectsPanel.css';

const MODIFIER_LABELS: Record<string, string> = {
  normal: 'Normal printable',
  cutting_mesh: 'Cutting mesh',
  infill_mesh: 'Infill mesh',
  support_mesh: 'Support mesh',
  anti_overhang_mesh: 'Anti-overhang mesh',
};

export function SlicerWorkspaceObjectsPanel() {
  const plateObjects = useSlicerStore((s) => s.plateObjects);
  const selectedId = useSlicerStore((s) => s.selectedPlateObjectId);
  const additionalSelectedIds = useSlicerStore((s) => s.additionalSelectedIds);
  const selectPlateObject = useSlicerStore((s) => s.selectPlateObject);
  const togglePlateObjectInSelection = useSlicerStore((s) => s.togglePlateObjectInSelection);
  const selectPlateObjectRange = useSlicerStore((s) => s.selectPlateObjectRange);
  const removeFromPlate = useSlicerStore((s) => s.removeFromPlate);
  const autoArrange = useSlicerStore((s) => s.autoArrange);
  const clearPlate = useSlicerStore((s) => s.clearPlate);
  const addToPlate = useSlicerStore((s) => s.addToPlate);
  const updatePlateObject = useSlicerStore((s) => s.updatePlateObject);
  const importFileToPlate = useSlicerStore((s) => s.importFileToPlate);
  const duplicatePlateObject = useSlicerStore((s) => s.duplicatePlateObject);
  const exportPlateJson = useSlicerStore((s) => s.exportPlateJson);
  const exportPlateThreeMf = useSlicerStore((s) => s.exportPlateThreeMf);
  const importPlateJson = useSlicerStore((s) => s.importPlateJson);
  const layFlatPlateObject = useSlicerStore((s) => s.layFlatPlateObject);
  const autoOrientPlateObject = useSlicerStore((s) => s.autoOrientPlateObject);
  const dropToBedPlateObject = useSlicerStore((s) => s.dropToBedPlateObject);
  const centerPlateObject = useSlicerStore((s) => s.centerPlateObject);
  const reorderPlateObjects = useSlicerStore((s) => s.reorderPlateObjects);
  const resolveOverlapForObject = useSlicerStore((s) => s.resolveOverlapForObject);
  const getActivePrinterProfile = useSlicerStore((s) => s.getActivePrinterProfile);
  const getActiveMaterialProfile = useSlicerStore((s) => s.getActiveMaterialProfile);
  const getActivePrintProfile = useSlicerStore((s) => s.getActivePrintProfile);
  const features = useCADStore((s) => s.features);

  const [showAddMenu, setShowAddMenu] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [modelUrl, setModelUrl] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [colorPickerForId, setColorPickerForId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [activeTool, setActiveTool] = useState<{ tool: GeometryTool; id: string } | null>(null);
  const [dragRowId, setDragRowId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const plateLoadInputRef = useRef<HTMLInputElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Listen for "open context menu for this object" events fired from the
  // viewport mesh on right-click. Keeps the menu logic in one place
  // (here) rather than duplicating it inside the 3D scene.
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ id: string; x: number; y: number }>).detail;
      setContextMenu(detail);
    };
    window.addEventListener('slicer:object-context-menu', handler);
    return () => window.removeEventListener('slicer:object-context-menu', handler);
  }, []);

  const selectedIds = useMemo(
    () => (selectedId ? [selectedId, ...additionalSelectedIds] : []),
    [selectedId, additionalSelectedIds],
  );

  const printer = getActivePrinterProfile();
  const validation = useMemo(
    () => validatePlate(plateObjects, printer?.buildVolume ?? { x: 220, y: 220, z: 250 }, {
      originCenter: printer?.originCenter,
    }),
    [plateObjects, printer?.buildVolume, printer?.originCenter],
  );

  const handleImportFile = useCallback(async (file: File) => {
    if (isMountedRef.current) {
      setImporting(true);
      setImportError(null);
    }
    try {
      await importFileToPlate(file);
    } catch (err) {
      if (isMountedRef.current) {
        setImportError((err as Error).message);
      }
    } finally {
      if (isMountedRef.current) {
        setImporting(false);
      }
    }
  }, [importFileToPlate]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleImportFile(file);
    if (e.target) e.target.value = '';
  }, [handleImportFile]);

  const handleImportUrl = useCallback(async () => {
    const url = modelUrl.trim();
    if (!url) return;
    if (isMountedRef.current) {
      setImporting(true);
      setImportError(null);
    }
    try {
      const { file, sourceMetadata } = await fetchModelUrlToFile(url);
      const importedId = await importFileToPlate(file);
      if (importedId) {
        useSlicerStore.getState().updatePlateObject(importedId, { sourceMetadata } as Partial<PlateObject>);
      }
      if (isMountedRef.current) setModelUrl('');
    } catch (err) {
      if (isMountedRef.current) setImportError((err as Error).message);
    } finally {
      if (isMountedRef.current) setImporting(false);
    }
  }, [importFileToPlate, modelUrl]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleImportFile(file);
  }, [handleImportFile]);

  const handleAddModel = useCallback((feature: typeof features[0]) => {
    addToPlate(feature.id, feature.name, null);
    setShowAddMenu(false);
    setAddSearch('');
  }, [addToPlate]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!isDragging) setIsDragging(true);
  }, [isDragging]);

  const addableFeatures = useMemo(
    () => features.filter((f) => !NON_BODY_FEATURE_TYPES.has(f.type) && !f.suppressed),
    [features],
  );
  const filteredFeatures = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    if (!q) return addableFeatures;
    return addableFeatures.filter((f) => f.name.toLowerCase().includes(q));
  }, [addableFeatures, addSearch]);

  const handleRowClick = useCallback((e: React.MouseEvent, id: string) => {
    if (e.shiftKey && selectedId) {
      selectPlateObjectRange(selectedId, id);
    } else if (e.ctrlKey || e.metaKey) {
      togglePlateObjectInSelection(id);
    } else {
      selectPlateObject(id);
    }
  }, [selectedId, selectPlateObject, togglePlateObjectInSelection, selectPlateObjectRange]);

  const handleRowKeyboardSelect = useCallback((e: React.KeyboardEvent, id: string) => {
    if (e.shiftKey && selectedId) {
      selectPlateObjectRange(selectedId, id);
    } else if (e.ctrlKey || e.metaKey) {
      togglePlateObjectInSelection(id);
    } else {
      selectPlateObject(id);
    }
  }, [selectedId, selectPlateObject, togglePlateObjectInSelection, selectPlateObjectRange]);

  const focusPlateRow = useCallback((index: number) => {
    const bounded = Math.max(0, Math.min(plateObjects.length - 1, index));
    const id = plateObjects[bounded]?.id;
    if (!id) return;
    const row = document.querySelector<HTMLElement>(`[data-plate-row-id="${CSS.escape(id)}"]`);
    row?.focus();
    selectPlateObject(id);
  }, [plateObjects, selectPlateObject]);

  const handleRowKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>, id: string) => {
    if (e.target !== e.currentTarget) return;
    const index = plateObjects.findIndex((obj) => obj.id === id);
    if (index < 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusPlateRow(index + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusPlateRow(index - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusPlateRow(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusPlateRow(plateObjects.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleRowKeyboardSelect(e, id);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeFromPlate(id);
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      if (!selectedIds.includes(id)) selectPlateObject(id);
      const rect = e.currentTarget.getBoundingClientRect();
      setContextMenu({ id, x: rect.left + 16, y: rect.top + 16 });
    }
  }, [focusPlateRow, handleRowKeyboardSelect, plateObjects, removeFromPlate, selectedIds, selectPlateObject]);

  const handleColorChange = useCallback((color: string) => {
    if (colorPickerForId) updatePlateObject(colorPickerForId, { color } as Partial<PlateObject>);
  }, [colorPickerForId, updatePlateObject]);

  const openColorPicker = useCallback((id: string) => {
    setColorPickerForId(id);
    requestAnimationFrame(() => colorInputRef.current?.click());
  }, []);

  const handleSavePlate = useCallback(() => {
    const json = exportPlateJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plate.dzign-plate.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [exportPlateJson]);

  const handleSavePlateThreeMf = useCallback(async () => {
    const blob = await exportPlateThreeMf();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plate.3mf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [exportPlateThreeMf]);

  const handleLoadPlate = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (file.name.toLowerCase().endsWith('.3mf')) {
        await importFileToPlate(file);
      } else {
        const text = await file.text();
        importPlateJson(text);
      }
    } catch (err) {
      console.error('Plate load failed:', err);
      alert(`Plate load failed: ${(err as Error).message}`);
    } finally {
      if (e.target) e.target.value = '';
    }
  }, [importFileToPlate, importPlateJson]);

  // Drag-to-reorder handlers. We use HTML5 drag events on the rows; Vite
  // / React-DnD would be heavier than needed here. The drag identifier is
  // the source object id; on drop we splice it before the target.
  const handleRowDragStart = useCallback((e: React.DragEvent, id: string) => {
    setDragRowId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plate-object-id', id);
  }, []);
  const handleRowDragOver = useCallback((e: React.DragEvent) => {
    if (dragRowId) e.preventDefault();
  }, [dragRowId]);
  const handleRowDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = dragRowId;
    setDragRowId(null);
    if (!sourceId || sourceId === targetId) return;
    const ids = plateObjects.map((o) => o.id);
    const fromIdx = ids.indexOf(sourceId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const reordered = [...ids];
    reordered.splice(fromIdx, 1);
    const insertAt = toIdx + (toIdx > fromIdx ? -1 : 0);
    reordered.splice(insertAt, 0, sourceId);
    reorderPlateObjects(reordered);
  }, [dragRowId, plateObjects, reorderPlateObjects]);

  const handleRowContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    if (!selectedIds.includes(id)) selectPlateObject(id);
    setContextMenu({ id, x: e.clientX, y: e.clientY });
  }, [selectedIds, selectPlateObject]);

  const buildContextItems = useCallback((id: string): ContextMenuItem[] => {
    const obj = plateObjects.find((o) => o.id === id);
    if (!obj) return [];
    const role = obj.modifierMeshRole ?? 'normal';
    return [
      { label: 'Duplicate', shortcut: 'Ctrl+D', icon: <Copy size={12} />, onClick: () => duplicatePlateObject(id) },
      { label: obj.hidden ? 'Show' : 'Hide', icon: obj.hidden ? <Eye size={12} /> : <EyeOff size={12} />,
        onClick: () => updatePlateObject(id, { hidden: !obj.hidden } as Partial<PlateObject>) },
      { label: obj.locked ? 'Unlock' : 'Lock', icon: obj.locked ? <Unlock size={12} /> : <Lock size={12} />,
        onClick: () => updatePlateObject(id, { locked: !obj.locked } as Partial<PlateObject>) },
      { separator: true } as ContextMenuItem,
      { label: 'Lay Flat', shortcut: 'F', icon: <AlignEndHorizontal size={12} />, onClick: () => layFlatPlateObject(id) },
      { label: 'Auto-orient', icon: <RotateCw size={12} />, onClick: () => autoOrientPlateObject(id) },
      { label: 'Drop to Bed', shortcut: 'B', icon: <ArrowDownToLine size={12} />, onClick: () => dropToBedPlateObject(id) },
      { label: 'Center', onClick: () => centerPlateObject(id) },
      { label: 'Resolve overlap', onClick: () => resolveOverlapForObject(id) },
      { separator: true } as ContextMenuItem,
      { label: 'Scale to size…', icon: <Maximize2 size={12} />, onClick: () => setActiveTool({ tool: 'scale-to-size', id }) },
      { label: 'Hollow…', icon: <CircleDot size={12} />, onClick: () => setActiveTool({ tool: 'hollow', id }) },
      { label: 'Cut by plane…', icon: <Scissors size={12} />, onClick: () => setActiveTool({ tool: 'cut', id }) },
      { separator: true } as ContextMenuItem,
      { label: `Role: ${MODIFIER_LABELS[role]} →`, disabled: true, onClick: () => undefined },
      { label: 'Normal printable', onClick: () => updatePlateObject(id, { modifierMeshRole: 'normal' } as Partial<PlateObject>),
        disabled: role === 'normal' },
      { label: 'Cutting mesh', onClick: () => updatePlateObject(id, { modifierMeshRole: 'cutting_mesh' } as Partial<PlateObject>),
        disabled: role === 'cutting_mesh' },
      { label: 'Infill mesh', onClick: () => updatePlateObject(id, { modifierMeshRole: 'infill_mesh' } as Partial<PlateObject>),
        disabled: role === 'infill_mesh' },
      { label: 'Support mesh', onClick: () => updatePlateObject(id, { modifierMeshRole: 'support_mesh' } as Partial<PlateObject>),
        disabled: role === 'support_mesh' },
      { label: 'Anti-overhang mesh', onClick: () => updatePlateObject(id, { modifierMeshRole: 'anti_overhang_mesh' } as Partial<PlateObject>),
        disabled: role === 'anti_overhang_mesh' },
      { separator: true } as ContextMenuItem,
      { label: 'Set color…', icon: <Palette size={12} />, onClick: () => openColorPicker(id) },
      { label: 'Delete', shortcut: 'Del', icon: <Trash2 size={12} />, danger: true, onClick: () => removeFromPlate(id) },
    ];
  }, [plateObjects, duplicatePlateObject, updatePlateObject, layFlatPlateObject, autoOrientPlateObject,
      dropToBedPlateObject, centerPlateObject, resolveOverlapForObject, openColorPicker, removeFromPlate]);

  // Per-row stats. Computed lazily via tooltip — heavy meshes don't pay
  // unless the user actually hovers. We memoize per-id to avoid re-computing
  // on every render.
  const statsCacheRef = useRef(new Map<string, string>());
  const buildRowTooltip = (obj: PlateObject): string => {
    const cached = statsCacheRef.current.get(obj.id);
    if (cached) return cached;
    if (!(obj.geometry instanceof THREE.BufferGeometry)) return obj.name;
    try {
      const stats = computeMeshStats(obj.geometry);
      const sx = obj.scale?.x ?? 1;
      const sy = obj.scale?.y ?? 1;
      const sz = obj.scale?.z ?? 1;
      const volScale = Math.abs(sx * sy * sz);
      const volMl = (stats.volumeMm3 * volScale) / 1000;
      const surfaceCm2 = (stats.surfaceAreaMm2 * Math.cbrt(volScale * volScale)) / 100;
      const text = [
        obj.name,
        `Triangles: ${stats.triangleCount.toLocaleString()}`,
        `Volume: ${volMl.toFixed(2)} cm³`,
        `Surface area: ${surfaceCm2.toFixed(1)} cm²`,
      ].join('\n');
      statsCacheRef.current.set(obj.id, text);
      return text;
    } catch {
      return obj.name;
    }
  };

  return (
    <div className="slicer-workspace-objects-panel">
      <div className="slicer-workspace-objects-panel__header">
        <Layers size={16} />
        Objects on Plate
      </div>

      <div className="slicer-workspace-objects-panel__list">
        <div
          onDragOver={handleDragOver}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`slicer-workspace-objects-panel__dropzone ${isDragging ? 'is-dragging' : ''}`}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={16} className="slicer-workspace-objects-panel__dropzone-icon" />
          {importing ? 'Importing...' : 'Drop STL/OBJ/3MF/.plate.json or click'}
        </div>
        {importError && (
          <div className="slicer-workspace-objects-panel__import-error">{importError}</div>
        )}
        <input ref={fileInputRef} type="file" accept=".stl,.obj,.3mf,.amf,.step,.stp,.json" className="slicer-workspace-objects-panel__file-input" onChange={handleFileInput} />

        <form
          className="slicer-workspace-objects-panel__url-import"
          onSubmit={(e) => {
            e.preventDefault();
            void handleImportUrl();
          }}
        >
          <Link2 size={13} className="slicer-workspace-objects-panel__url-icon" />
          <input
            type="url"
            value={modelUrl}
            onChange={(e) => setModelUrl(e.target.value)}
            placeholder="Paste model or marketplace URL"
            className="slicer-workspace-objects-panel__url-input"
            aria-label="STL OBJ 3MF AMF STEP model URL or marketplace model page"
          />
          <button
            type="submit"
            className="slicer-workspace-objects-panel__url-button"
            disabled={importing || modelUrl.trim().length === 0}
          >
            Import
          </button>
        </form>

        {validation.hasIssues && (
          <div className="slicer-workspace-objects-panel__validation" role="alert">
            <AlertTriangle size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            {validation.outOfBounds.length > 0 && (
              <div>{validation.outOfBounds.length} object{validation.outOfBounds.length === 1 ? '' : 's'} outside build volume</div>
            )}
            {validation.overlapping.length > 0 && (
              <div>{validation.overlapping.length} object overlap{validation.overlapping.length === 1 ? '' : 's'} detected</div>
            )}
          </div>
        )}

        {plateObjects.length === 0 && !importing && (
          <div className="slicer-workspace-objects-panel__empty">
            No objects on the build plate.
          </div>
        )}
        <div role="listbox" aria-label="Objects on build plate">
        {plateObjects.map((obj) => {
          const w = obj.boundingBox.max.x - obj.boundingBox.min.x;
          const d = obj.boundingBox.max.y - obj.boundingBox.min.y;
          const h = obj.boundingBox.max.z - obj.boundingBox.min.z;
          const initials = obj.name.slice(0, 2).toUpperCase();
          const inSelection = selectedIds.includes(obj.id);
          const isAnchor = obj.id === selectedId;
          const issues = validation.issuesById.get(obj.id);
          const isModifier = obj.modifierMeshRole && obj.modifierMeshRole !== 'normal';
          return (
            <div
              key={obj.id}
              role="option"
              tabIndex={0}
              aria-selected={inSelection}
              aria-label={`${obj.name}, ${w.toFixed(1)} by ${d.toFixed(1)} by ${h.toFixed(1)} millimeters${issues ? `, ${issues.length} issue${issues.length === 1 ? '' : 's'}` : ''}`}
              data-plate-row-id={obj.id}
              draggable
              onDragStart={(e) => handleRowDragStart(e, obj.id)}
              onDragOver={handleRowDragOver}
              onDrop={(e) => handleRowDrop(e, obj.id)}
              onDragEnd={() => setDragRowId(null)}
              onClick={(e) => handleRowClick(e, obj.id)}
              onKeyDown={(e) => handleRowKeyDown(e, obj.id)}
              onContextMenu={(e) => handleRowContextMenu(e, obj.id)}
              className={`slicer-workspace-objects-panel__row${isAnchor ? ' is-selected' : ''}${inSelection && !isAnchor ? ' is-multi' : ''}${dragRowId === obj.id ? ' is-dragging' : ''}`}
              title={[buildRowTooltip(obj), issues?.join('\n')].filter(Boolean).join('\n\n')}
            >
              <div
                className="slicer-workspace-objects-panel__thumb"
                aria-hidden
                style={obj.color ? { color: obj.color } : undefined}
              >
                <svg viewBox="0 0 28 28" width="28" height="28" className="slicer-workspace-objects-panel__thumb-svg">
                  <polygon points="14,4 24,9 24,19 14,24 4,19 4,9" className="slicer-workspace-objects-panel__thumb-hex" style={obj.color ? { fill: obj.color, opacity: 0.45 } : undefined} />
                  <polyline points="14,4 14,14" className="slicer-workspace-objects-panel__thumb-edge" />
                  <polyline points="14,14 24,9" className="slicer-workspace-objects-panel__thumb-edge" />
                  <polyline points="14,14 4,9" className="slicer-workspace-objects-panel__thumb-edge" />
                  <text x="14" y="17" textAnchor="middle" className="slicer-workspace-objects-panel__thumb-text">{initials}</text>
                </svg>
              </div>
              <div className="slicer-workspace-objects-panel__row-info">
                <div className="slicer-workspace-objects-panel__name" title={obj.name}>
                  {issues && <AlertTriangle size={10} style={{ color: 'var(--warning, #d68a00)', marginRight: 3, verticalAlign: 'middle' }} />}
                  {isModifier && <Wrench size={10} style={{ color: 'var(--accent)', marginRight: 3, verticalAlign: 'middle' }} />}
                  {obj.name}
                </div>
                <div className="slicer-workspace-objects-panel__size">{w.toFixed(1)} × {d.toFixed(1)} × {h.toFixed(1)} mm</div>
                {obj.sourceMetadata && (
                  <div className="slicer-workspace-objects-panel__source" title={obj.sourceMetadata.url}>
                    Source: {obj.sourceMetadata.sourceSite === 'direct' ? 'URL' : obj.sourceMetadata.sourceSite}
                  </div>
                )}
              </div>
              <div className="slicer-workspace-objects-panel__row-icons">
                <button
                  type="button"
                  title={obj.hidden ? 'Show object' : 'Hide object'}
                  aria-label={`${obj.hidden ? 'Show' : 'Hide'} ${obj.name}`}
                  className={`slicer-workspace-objects-panel__icon-btn${obj.hidden ? ' is-active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); updatePlateObject(obj.id, { hidden: !obj.hidden } as Partial<PlateObject>); }}
                >
                  {obj.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
                <button
                  type="button"
                  title={obj.locked ? 'Unlock object' : 'Lock object'}
                  aria-label={`${obj.locked ? 'Unlock' : 'Lock'} ${obj.name}`}
                  className={`slicer-workspace-objects-panel__icon-btn${obj.locked ? ' is-active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); updatePlateObject(obj.id, { locked: !obj.locked } as Partial<PlateObject>); }}
                >
                  {obj.locked ? <Lock size={12} /> : <Unlock size={12} />}
                </button>
                <button
                  type="button"
                  title="Set object color"
                  aria-label={`Set color for ${obj.name}`}
                  className="slicer-workspace-objects-panel__icon-btn"
                  onClick={(e) => { e.stopPropagation(); openColorPicker(obj.id); }}
                  style={obj.color ? { color: obj.color } : undefined}
                >
                  <Palette size={12} />
                </button>
                <button
                  type="button"
                  title={`Duplicate ${obj.name} (Ctrl+D)`}
                  aria-label={`Duplicate ${obj.name}`}
                  className="slicer-workspace-objects-panel__icon-btn"
                  onClick={(e) => { e.stopPropagation(); duplicatePlateObject(obj.id); }}
                >
                  <Copy size={12} />
                </button>
                <button
                  type="button"
                  title={`Remove ${obj.name} (Del)`}
                  aria-label={`Remove ${obj.name}`}
                  className="slicer-workspace-objects-panel__icon-btn"
                  onClick={(e) => { e.stopPropagation(); removeFromPlate(obj.id); }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}
        </div>
      </div>

      <input
        ref={colorInputRef}
        type="color"
        className="slicer-workspace-objects-panel__color-input"
        value={(colorPickerForId && plateObjects.find((o) => o.id === colorPickerForId)?.color) || '#4fc3f7'}
        onChange={(e) => handleColorChange(e.target.value)}
      />

      <div className="slicer-workspace-objects-panel__actions">
        <div className="slicer-workspace-objects-panel__add-wrap">
          <button className="slicer-workspace-objects-panel__action-button" onClick={() => setShowAddMenu((prev) => !prev)}>
            <Plus size={14} /> Add from CAD
          </button>
          {showAddMenu && (
            <div className="slicer-workspace-objects-panel__menu">
              <input
                type="text"
                placeholder="Search features..."
                className="slicer-workspace-objects-panel__menu-search"
                value={addSearch}
                onChange={(e) => setAddSearch(e.target.value)}
                autoFocus
              />
              {filteredFeatures.length === 0 && (
                <div className="slicer-workspace-objects-panel__menu-empty">
                  {addableFeatures.length === 0 ? 'No CAD features available.' : 'No matches.'}
                </div>
              )}
              {filteredFeatures.map((f) => (
                <div key={f.id} onClick={() => handleAddModel(f)} className="slicer-workspace-objects-panel__menu-item">
                  <Box size={12} className="slicer-workspace-objects-panel__menu-item-icon" />
                  {f.name}
                </div>
              ))}
            </div>
          )}
        </div>
        <button className="slicer-workspace-objects-panel__secondary-button" onClick={() => autoArrange()} title="Bin-pack objects on the plate">
          <LayoutGrid size={14} /> Auto Arrange
        </button>
        <button className="slicer-workspace-objects-panel__danger-button" onClick={() => clearPlate()} disabled={plateObjects.length === 0}>
          <XCircle size={14} /> Clear Plate
        </button>
        <div className="slicer-workspace-objects-panel__plate-io">
          <button
            className="slicer-workspace-objects-panel__secondary-button"
            onClick={handleSavePlate}
            title="Save plate to file"
          >
            <Save size={14} /> Save JSON
          </button>
          <button
            className="slicer-workspace-objects-panel__secondary-button"
            onClick={() => void handleSavePlateThreeMf()}
            title="Save round-trippable 3MF plate"
          >
            <Save size={14} /> Save 3MF
          </button>
          <button
            className="slicer-workspace-objects-panel__secondary-button"
            onClick={() => plateLoadInputRef.current?.click()}
            title="Load plate from file"
          >
            <FolderOpen size={14} /> Load
          </button>
        </div>
        <input
          ref={plateLoadInputRef}
          type="file"
          accept=".json,.dzign-plate.json,.3mf"
          className="slicer-workspace-objects-panel__file-input"
          onChange={handleLoadPlate}
        />
        <CalibrationMenu
          activePrinter={getActivePrinterProfile()}
          activeMaterial={getActiveMaterialProfile()}
          activePrint={getActivePrintProfile()}
        />
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildContextItems(contextMenu.id)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {activeTool && (
        <GeometryToolsModal
          tool={activeTool.tool}
          objectId={activeTool.id}
          onClose={() => setActiveTool(null)}
        />
      )}
    </div>
  );
}
