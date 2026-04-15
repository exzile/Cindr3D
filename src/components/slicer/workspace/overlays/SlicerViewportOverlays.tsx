import { useState, type ReactNode } from 'react';
import * as React from 'react';
import * as THREE from 'three';
import {
  Move, RotateCw, Maximize2, FlipHorizontal, SlidersHorizontal, RefreshCw,
  Lock, Unlock, ArrowDownToLine,
} from 'lucide-react';
import { useSlicerStore } from '../../../../store/slicerStore';
import type { PlateObject } from '../../../../types/slicer';
import { colors } from '../../../../utils/theme';
import { normalizeRotationRadians, normalizeScale } from '../../../../utils/slicerTransforms';
import './SlicerViewportOverlays.css';

type TransformMode = 'move' | 'scale' | 'rotate' | 'mirror' | 'settings';

export function SlicerViewportOverlays() {
  const [uniformScale, setUniform] = useState(true);
  const [snapScale, setSnap] = useState(false);

  const selectedId = useSlicerStore((s) => s.selectedPlateObjectId);
  const plateObjects = useSlicerStore((s) => s.plateObjects);
  const updatePlateObject = useSlicerStore((s) => s.updatePlateObject);
  const mode = useSlicerStore((s) => s.transformMode) as TransformMode;
  const setMode = useSlicerStore((s) => s.setTransformMode);

  const obj = plateObjects.find((o) => o.id === selectedId) ?? null;

  const upd = (changes: Record<string, unknown>) => {
    if (!obj) return;
    updatePlateObject(obj.id, changes as Partial<PlateObject>);
  };

  const axisClass = ['slicer-overlay-axis--x', 'slicer-overlay-axis--y', 'slicer-overlay-axis--z'] as const;

  const numIn = (
    val: string,
    onChange: (v: string) => void,
    disabled = false,
    narrow = false,
  ) => (
    <input
      type="number"
      disabled={disabled}
      className={`slicer-overlay-number-input${narrow ? ' slicer-overlay-number-input--narrow' : ''}`}
      value={val}
      onChange={(e) => onChange(e.target.value)}
    />
  );

  const checkRow = (label: ReactNode, checked: boolean, onClick: () => void) => (
    <label
      className="slicer-overlay-check-row"
      onClick={(e) => { e.preventDefault(); onClick(); }}
    >
      <input type="checkbox" checked={checked} onChange={onClick} className="slicer-overlay-check-input" />
      {label}
    </label>
  );

  const divider = <div className="slicer-overlay-divider" />;

  const toolbarItems: { id: TransformMode; icon: ReactNode; title: string }[] = [
    { id: 'move', icon: <Move size={18} />, title: 'Move' },
    { id: 'scale', icon: <Maximize2 size={18} />, title: 'Scale' },
    { id: 'rotate', icon: <RotateCw size={18} />, title: 'Rotate' },
    { id: 'mirror', icon: <FlipHorizontal size={18} />, title: 'Mirror' },
    { id: 'settings', icon: <SlidersHorizontal size={18} />, title: 'Per-object Settings' },
  ];

  const toolbar = (
    <div className="slicer-overlay-toolbar">
      {toolbarItems.map(({ id, icon, title }) => (
        <button
          key={id}
          title={title}
          onClick={() => setMode(id)}
          className={`slicer-overlay-toolbar-button ${mode === id ? 'is-active' : ''}`}
        >
          {icon}
        </button>
      ))}
    </div>
  );

  if (!obj) return toolbar;

  const pos = obj.position as { x: number; y: number; z: number };
  const rot = normalizeRotationRadians((obj as { rotation?: unknown }).rotation);
  const scl = normalizeScale((obj as { scale?: unknown }).scale);
  const locked = !!obj.locked;

  const bboxSize = {
    x: Math.abs(obj.boundingBox.max.x - obj.boundingBox.min.x),
    y: Math.abs(obj.boundingBox.max.y - obj.boundingBox.min.y),
    z: Math.abs(obj.boundingBox.max.z - obj.boundingBox.min.z),
  };

  const header = (
    <div className="slicer-overlay-header">
      <div className="slicer-overlay-header-name">
        {obj.name}
      </div>
      <button
        title={locked ? 'Unlock model' : 'Lock model'}
        onClick={() => upd({ locked: !locked })}
        className={`slicer-overlay-lock-button ${locked ? 'is-locked' : ''}`}
      >
        {locked ? <Lock size={13} /> : <Unlock size={13} />}
      </button>
    </div>
  );

  const movePanel = (
    <div className="slicer-overlay-panel">
      {header}
      {(['x', 'y', 'z'] as const).map((ax, i) => (
        <div key={ax} className="slicer-overlay-row">
          <span className={`slicer-overlay-axis ${axisClass[i]}`}>{ax.toUpperCase()}</span>
          {numIn(pos[ax].toFixed(1), (v) => { if (!locked) upd({ position: { ...pos, [ax]: parseFloat(v) || 0 } }); }, locked)}
          <span className="slicer-overlay-unit">mm</span>
        </div>
      ))}
      {divider}
      {checkRow('Lock Model', locked, () => upd({ locked: !locked }))}
      <label
        className={`slicer-overlay-drop-row ${locked ? 'is-disabled' : ''}`}
        onClick={() => {
          if (locked) return;
          const minZ = isFinite(obj.boundingBox.min.z) ? obj.boundingBox.min.z * (scl.z) : 0;
          upd({ position: { ...pos, z: -minZ } });
        }}
      >
        <ArrowDownToLine size={13} color={locked ? colors.textDim : colors.accent} />
        Drop Down <span className="slicer-overlay-drop-highlight">Model</span>
      </label>
      <button
        className="slicer-overlay-full-btn"
        disabled={locked}
        onClick={() => {
          const bv = useSlicerStore.getState().getActivePrinterProfile()?.buildVolume ?? { x: 220, y: 220, z: 250 };
          const b = obj.boundingBox;
          const w = (b.max.x - b.min.x) * scl.x;
          const d = (b.max.y - b.min.y) * scl.y;
          const minZ = b.min.z * scl.z;
          upd({ position: {
            x: bv.x / 2 - b.min.x * scl.x - w / 2,
            y: bv.y / 2 - b.min.y * scl.y - d / 2,
            z: isFinite(minZ) ? -minZ : pos.z,
          } });
        }}
      >
        Center on Plate
      </button>
    </div>
  );

  const layFlat = () => {
    if (locked) return;
    const geom: THREE.BufferGeometry | null = obj.geometry ?? null;

    if (!geom?.attributes?.position) {
      upd({ rotation: { x: 0, y: 0, z: 0 } });
      return;
    }

    const posAttr = geom.attributes.position;
    const indexAttr = geom.index;
    const triCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;

    const currentQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rot.x, rot.y, rot.z, 'XYZ'),
    );

    const va = new THREE.Vector3();
    const vb = new THREE.Vector3();
    const vc = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const cross = new THREE.Vector3();
    const down = new THREE.Vector3(0, 0, -1);

    const buckets = new Map<string, { worldNormal: THREE.Vector3; area: number }>();

    for (let i = 0; i < triCount; i++) {
      const i0 = indexAttr ? indexAttr.getX(i * 3) : i * 3;
      const i1 = indexAttr ? indexAttr.getX(i * 3 + 1) : i * 3 + 1;
      const i2 = indexAttr ? indexAttr.getX(i * 3 + 2) : i * 3 + 2;

      va.fromBufferAttribute(posAttr, i0);
      vb.fromBufferAttribute(posAttr, i1);
      vc.fromBufferAttribute(posAttr, i2);

      e1.subVectors(vb, va);
      e2.subVectors(vc, va);
      cross.crossVectors(e1, e2);

      const area = cross.length() / 2;
      if (area < 1e-6) continue;

      const worldNorm = cross.clone().normalize().applyQuaternion(currentQuat);

      const key = `${worldNorm.x.toFixed(2)},${worldNorm.y.toFixed(2)},${worldNorm.z.toFixed(2)}`;
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.area += area;
      } else {
        buckets.set(key, { worldNormal: worldNorm, area });
      }
    }

    let bestWorldNormal = new THREE.Vector3(0, 0, -1);
    let bestScore = -Infinity;
    for (const { worldNormal, area } of buckets.values()) {
      const dotDown = worldNormal.dot(down);
      const score = dotDown * area;
      if (score > bestScore) {
        bestScore = score;
        bestWorldNormal = worldNormal.clone();
      }
    }

    const correctionQuat = new THREE.Quaternion().setFromUnitVectors(bestWorldNormal, down);

    const finalQuat = new THREE.Quaternion().multiplyQuaternions(correctionQuat, currentQuat);
    const finalEuler = new THREE.Euler().setFromQuaternion(finalQuat, 'XYZ');

    const tmpBox = new THREE.Box3().setFromBufferAttribute(posAttr as THREE.BufferAttribute);
    const rotMat = new THREE.Matrix4().makeRotationFromQuaternion(finalQuat);
    const cornerOffsets: [number, number, number][] = [
      [tmpBox.min.x, tmpBox.min.y, tmpBox.min.z], [tmpBox.max.x, tmpBox.min.y, tmpBox.min.z],
      [tmpBox.min.x, tmpBox.max.y, tmpBox.min.z], [tmpBox.max.x, tmpBox.max.y, tmpBox.min.z],
      [tmpBox.min.x, tmpBox.min.y, tmpBox.max.z], [tmpBox.max.x, tmpBox.min.y, tmpBox.max.z],
      [tmpBox.min.x, tmpBox.max.y, tmpBox.max.z], [tmpBox.max.x, tmpBox.max.y, tmpBox.max.z],
    ];
    let newMinZ = Infinity;
    for (const [cx, cy, cz] of cornerOffsets) {
      const scaled = new THREE.Vector3(cx * scl.x, cy * scl.y, cz * scl.z);
      scaled.applyMatrix4(rotMat);
      if (scaled.z < newMinZ) newMinZ = scaled.z;
    }

    upd({
      rotation: { x: finalEuler.x, y: finalEuler.y, z: finalEuler.z },
      position: { ...pos, z: isFinite(newMinZ) ? -newMinZ : pos.z },
    });
  };

  const setScale = (axis: 'x' | 'y' | 'z', raw: string, fromMm: boolean) => {
    if (locked) return;
    const parsed = parseFloat(raw);
    if (!isFinite(parsed) || parsed <= 0) return;
    const baseMm = bboxSize[axis] || 1;
    const newFactor = fromMm ? parsed / baseMm : parsed / 100;
    const snapped = snapScale ? Math.round(newFactor * 20) / 20 : newFactor;

    if (uniformScale) {
      const ratio = snapped / (scl[axis] || 1);
      upd({ scale: { x: scl.x * ratio, y: scl.y * ratio, z: scl.z * ratio } });
    } else {
      upd({ scale: { ...scl, [axis]: snapped } });
    }
  };

  const scalePanel = (
    <div className="slicer-overlay-panel">
      {header}
      <div className="slicer-overlay-scale-header-row">
        <span className="slicer-overlay-scale-header-spacer" />
        <span className="slicer-overlay-scale-header-text">Size (mm)</span>
        <span className="slicer-overlay-scale-header-text">Scale (%)</span>
      </div>
      {(['x', 'y', 'z'] as const).map((ax, i) => {
        const sizeMm = (bboxSize[ax] * scl[ax]).toFixed(1);
        const pct = (scl[ax] * 100).toFixed(1);
        return (
          <div key={ax} className="slicer-overlay-row">
            <span className={`slicer-overlay-axis ${axisClass[i]}`}>{ax.toUpperCase()}</span>
            {numIn(sizeMm, (v) => setScale(ax, v, true), locked)}
            <span className="slicer-overlay-unit slicer-overlay-unit--wide">mm</span>
            {numIn(pct, (v) => setScale(ax, v, false), locked, true)}
            <span className="slicer-overlay-unit">%</span>
          </div>
        );
      })}
      {divider}
      {checkRow('Snap Scaling', snapScale, () => setSnap(!snapScale))}
      {checkRow('Uniform Scaling', uniformScale, () => setUniform(!uniformScale))}
      <button
        className="slicer-overlay-full-btn"
        disabled={locked}
        onClick={() => upd({ scale: { x: 1, y: 1, z: 1 } })}
      >
        <RefreshCw size={11} /> Reset Scale
      </button>
    </div>
  );

  const rotatePanel = (
    <div className="slicer-overlay-panel">
      {header}
      {(['x', 'y', 'z'] as const).map((ax, i) => (
        <div key={ax} className="slicer-overlay-row">
          <span className={`slicer-overlay-axis ${axisClass[i]}`}>{ax.toUpperCase()}</span>
          {numIn(
            ((rot[ax] * 180) / Math.PI % 360).toFixed(1),
            (v) => { if (!locked) upd({ rotation: { ...rot, [ax]: (parseFloat(v) || 0) * Math.PI / 180 } }); },
            locked,
          )}
          <span className="slicer-overlay-unit">°</span>
        </div>
      ))}
      {divider}
      <div className="slicer-overlay-btn-row">
        {(['x', 'y', 'z'] as const).map((ax, i) => (
          <button
            key={ax}
            disabled={locked}
            className="slicer-overlay-flex-btn"
            title={`Rotate 90° around ${ax.toUpperCase()}`}
            onClick={() => {
              const cur = rot[ax];
              upd({ rotation: { ...rot, [ax]: cur + Math.PI / 2 } });
            }}
          >
            <span className={`slicer-overlay-rotate-axis-label ${axisClass[i]}`}>{ax.toUpperCase()}</span> +90°
          </button>
        ))}
      </div>
      <div className="slicer-overlay-btn-row slicer-overlay-btn-row--mt">
        <button
          className="slicer-overlay-flex-btn"
          disabled={locked}
          onClick={layFlat}
          title="Rotate so the largest flat face rests on the build plate"
        >
          <ArrowDownToLine size={11} /> Lay Flat
        </button>
        <button
          className="slicer-overlay-flex-btn"
          disabled={locked}
          onClick={() => upd({ rotation: { x: 0, y: 0, z: 0 } })}
        >
          <RefreshCw size={11} /> Reset
        </button>
      </div>
    </div>
  );

  const mirrorPanel = (
    <div className="slicer-overlay-panel">
      {header}
      <div className="slicer-overlay-btn-row">
        {(['x', 'y', 'z'] as const).map((ax, i) => {
          const key = `mirror${ax.toUpperCase()}` as 'mirrorX' | 'mirrorY' | 'mirrorZ';
          const active = !!(obj as { mirrorX?: boolean; mirrorY?: boolean; mirrorZ?: boolean })[key];
          return (
            <button
              key={ax}
              disabled={locked}
              className={`slicer-overlay-mirror-btn${active ? ' is-active' : ''}`}
              onClick={() => upd({ [key]: !active })}
            >
              <FlipHorizontal size={13} />
              <span className={`slicer-overlay-mirror-axis-label ${axisClass[i]}`}>{ax.toUpperCase()}</span>
            </button>
          );
        })}
      </div>
      {divider}
      <div className="slicer-overlay-hint">
        Click an axis to toggle mirroring
      </div>
    </div>
  );

  const settingsPanel = (
    <div className="slicer-overlay-panel">
      {header}
      <div className="slicer-overlay-settings-intro">
        Override global print settings for this object only.
      </div>
      {([
        ['infillDensity', 'Infill Density', '%', 0, 100],
        ['wallCount', 'Wall Count', '', 1, 20],
        ['layerHeight', 'Layer Height', 'mm', 0.05, 1],
      ] as [string, string, string, number, number][]).map(([key, label, unit, min, max]) => {
        const perObj = (obj as { perObjectSettings?: Record<string, number | undefined> }).perObjectSettings ?? {};
        const val = perObj[key] ?? '';
        return (
          <div key={key} className="slicer-overlay-row">
            <span className="slicer-overlay-settings-label">{label}</span>
            <input
              type="number"
              min={min}
              max={max}
              placeholder="(global)"
              disabled={locked}
              className="slicer-overlay-settings-input"
              value={val}
              onChange={(e) => {
                const v = e.target.value === '' ? undefined : parseFloat(e.target.value);
                const next = { ...perObj };
                if (v === undefined) delete next[key]; else next[key] = v;
                upd({ perObjectSettings: next });
              }}
            />
            {unit && <span className="slicer-overlay-settings-unit">{unit}</span>}
          </div>
        );
      })}
    </div>
  );

  const panels: Record<TransformMode, ReactNode> = {
    move: movePanel,
    scale: scalePanel,
    rotate: rotatePanel,
    mirror: mirrorPanel,
    settings: settingsPanel,
  };

  return (
    <>
      {toolbar}
      {panels[mode]}
    </>
  );
}
