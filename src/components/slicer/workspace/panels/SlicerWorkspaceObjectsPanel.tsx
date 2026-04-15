import { useState, useCallback, useRef } from 'react';
import * as React from 'react';
import { Plus, Trash2, LayoutGrid, XCircle, Upload, Box, FlipHorizontal, RefreshCw, Layers } from 'lucide-react';
import { useSlicerStore } from '../../../../store/slicerStore';
import { useCADStore } from '../../../../store/cadStore';
import type { PlateObject } from '../../../../types/slicer';
import { colors, sharedStyles } from '../../../../utils/theme';
import { normalizeRotationRadians, normalizeScale } from '../../../../utils/slicerTransforms';

const panelStyle: React.CSSProperties = {
  background: colors.panel,
  borderRight: `1px solid ${colors.panelBorder}`,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const btnBase = sharedStyles.btnBase;
const btnAccent = sharedStyles.btnAccent;
const btnDanger = sharedStyles.btnDanger;
const inputStyle = sharedStyles.input;
const labelStyle = sharedStyles.label;

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

  const numStyle: React.CSSProperties = { ...inputStyle, width: 52, padding: '2px 4px', fontSize: 11 };
  const xyzRow = (
    label: string,
    vals: { x: number; y: number; z: number },
    onChange: (axis: 'x' | 'y' | 'z', v: number) => void,
    step = 1,
  ) => (
    <div style={{ marginBottom: 6 }}>
      <div style={labelStyle}>{label}</div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {(['x', 'y', 'z'] as const).map((ax) => (
          <label key={ax} style={{ display: 'flex', alignItems: 'center', gap: 2, color: colors.textDim, fontSize: 10 }}>
            {ax.toUpperCase()}
            <input type="number" style={numStyle} step={step}
              value={vals[ax].toFixed(step < 1 ? 3 : 1)}
              onChange={(e) => onChange(ax, parseFloat(e.target.value) || 0)} />
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ ...panelStyle, width: 240, borderRight: `1px solid ${colors.panelBorder}`, flexShrink: 0 }}>
      <div style={{
        padding: '10px', borderBottom: `1px solid ${colors.panelBorder}`,
        display: 'flex', alignItems: 'center', gap: 6,
        color: colors.text, fontSize: 13, fontWeight: 600,
      }}>
        <Layers size={16} />
        Objects on Plate
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          style={{
            margin: 8,
            padding: '10px 8px',
            border: `2px dashed ${isDragging ? colors.accent : colors.panelBorder}`,
            borderRadius: 6,
            textAlign: 'center',
            fontSize: 11,
            color: isDragging ? colors.accent : colors.textDim,
            cursor: 'pointer',
            background: isDragging ? colors.accentLight : 'transparent',
            transition: 'all 0.15s',
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={16} style={{ margin: '0 auto 4px', display: 'block', opacity: 0.6 }} />
          {importing ? 'Importing...' : 'Drop STL/OBJ/3MF or click'}
        </div>
        {importError && (
          <div style={{ padding: '4px 8px', color: colors.danger, fontSize: 11 }}>{importError}</div>
        )}
        <input ref={fileInputRef} type="file" accept=".stl,.obj,.3mf,.amf,.step,.stp"
          style={{ display: 'none' }} onChange={handleFileInput} />

        {plateObjects.length === 0 && !importing && (
          <div style={{ padding: '8px 10px', color: colors.textDim, fontSize: 11, textAlign: 'center' }}>
            No objects on the build plate.
          </div>
        )}
        {plateObjects.map((obj) => (
          <div key={obj.id} onClick={() => selectPlateObject(obj.id)}
            style={{
              padding: '5px 10px',
              background: obj.id === selectedId ? colors.panelLight : 'transparent',
              borderLeft: obj.id === selectedId ? `3px solid ${colors.accent}` : '3px solid transparent',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
            <div>
              <div style={{ color: colors.text, fontSize: 12 }}>{obj.name}</div>
              <div style={{ color: colors.textDim, fontSize: 10 }}>{sizeStr(obj)}</div>
            </div>
            <button title="Remove" onClick={(e) => { e.stopPropagation(); removeFromPlate(obj.id); }}
              style={{ background: 'transparent', border: 'none', color: colors.danger, cursor: 'pointer', padding: 2, display: 'flex' }}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {selectedObj && pos && rot && scl && (
        <div style={{ borderTop: `1px solid ${colors.panelBorder}`, padding: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: colors.textDim, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Transform
          </div>
          {xyzRow('Position (mm)', pos, (ax, v) => updObj({ position: { ...pos, [ax]: v } }), 0.1)}
          {xyzRow('Rotation (°)', rot, (ax, v) => updObj({ rotation: { ...rot, [ax]: v } }), 1)}
          {xyzRow('Scale', scl, (ax, v) => updObj({ scale: { ...scl, [ax]: Math.max(0.001, v) } }), 0.01)}
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            <button style={{ ...btnBase, fontSize: 10, padding: '3px 6px', flex: 1 }}
              onClick={() => updObj({ scale: { x: 1, y: 1, z: 1 }, rotation: { x: 0, y: 0, z: 0 } })}>
              <RefreshCw size={10} /> Reset
            </button>
            <button style={{ ...btnBase, fontSize: 10, padding: '3px 6px', flex: 1 }}
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
          <div style={{ display: 'flex', gap: 4 }}>
            <button style={{ ...btnBase, fontSize: 10, padding: '3px 6px', flex: 1 }}
              title="Mirror X"
              onClick={() => updObj({ mirrorX: !(selectedObj as { mirrorX?: boolean }).mirrorX })}>
              <FlipHorizontal size={10} /> X
            </button>
            <button style={{ ...btnBase, fontSize: 10, padding: '3px 6px', flex: 1 }}
              title="Mirror Y"
              onClick={() => updObj({ mirrorY: !(selectedObj as { mirrorY?: boolean }).mirrorY })}>
              <FlipHorizontal size={10} /> Y
            </button>
            <button style={{ ...btnBase, fontSize: 10, padding: '3px 6px', flex: 1 }}
              title="Mirror Z"
              onClick={() => updObj({ mirrorZ: !(selectedObj as { mirrorZ?: boolean }).mirrorZ })}>
              <FlipHorizontal size={10} /> Z
            </button>
          </div>
        </div>
      )}

      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6, borderTop: `1px solid ${colors.panelBorder}` }}>
        <div style={{ position: 'relative' }}>
          <button style={{ ...btnAccent, width: '100%', justifyContent: 'center' }} onClick={() => setShowAddMenu(!showAddMenu)}>
            <Plus size={14} /> Add from CAD
          </button>
          {showAddMenu && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 0, right: 0,
              background: colors.panelLight, border: `1px solid ${colors.panelBorder}`,
              borderRadius: 4, marginBottom: 4, maxHeight: 180, overflowY: 'auto', zIndex: 10,
            }}>
              {features.length === 0 && (
                <div style={{ padding: 10, color: colors.textDim, fontSize: 11 }}>
                  No CAD features available.
                </div>
              )}
              {features.filter(f => f.type !== 'sketch').map((f) => (
                <div key={f.id} onClick={() => handleAddModel(f)}
                  style={{ padding: '5px 10px', cursor: 'pointer', fontSize: 12, color: colors.text, borderBottom: `1px solid ${colors.panelBorder}` }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = colors.panel)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                  <Box size={12} style={{ marginRight: 6 }} />
                  {f.name}
                </div>
              ))}
            </div>
          )}
        </div>
        <button style={{ ...btnBase, justifyContent: 'center' }} onClick={() => autoArrange()}>
          <LayoutGrid size={14} /> Auto Arrange
        </button>
        <button style={{ ...btnDanger, justifyContent: 'center' }} onClick={() => clearPlate()} disabled={plateObjects.length === 0}>
          <XCircle size={14} /> Clear Plate
        </button>
      </div>
    </div>
  );
}
