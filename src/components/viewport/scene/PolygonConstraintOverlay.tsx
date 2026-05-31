import { Html } from '@react-three/drei';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Hexagon, Square, X, Trash2 } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import { useThemeStore } from '../../../store/themeStore';
import type { Sketch, SketchConstraint } from '../../../types/cad';

/** Center of a shape constraint, from its metadata or the member-line vertices. */
function shapeCenter(con: SketchConstraint, sketch: Sketch): THREE.Vector3 | null {
  const meta = con.polygonMeta ?? con.rectangleMeta;
  if (meta) return new THREE.Vector3(meta.center.x, meta.center.y, meta.center.z);
  const verts = con.entityIds
    .map((id) => sketch.entities.find((e) => e.id === id))
    .filter((e): e is NonNullable<typeof e> => !!e && e.points.length >= 1)
    .map((l) => new THREE.Vector3(l.points[0].x, l.points[0].y, l.points[0].z));
  if (verts.length < 3) return null;
  const c = new THREE.Vector3();
  for (const v of verts) c.add(v);
  return c.divideScalar(verts.length);
}

/** The popup editor — separate component so mounting it auto-focuses the input. */
function PolygonEditor({
  constraintId,
  sides,
  onClose,
}: {
  constraintId: string;
  sides: number;
  onClose: () => void;
}) {
  const colors = useThemeStore((s) => s.colors);
  const regeneratePolygon = useCADStore((s) => s.regeneratePolygon);
  const replaceSketchEntities = useCADStore((s) => s.replaceSketchEntities);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Auto-focus + select the side-count input as soon as the popup opens (so the
  // user can immediately type a new count right after drawing).
  useEffect(() => {
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  // Close on Escape or click outside the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const deletePolygon = () => {
    const sketch = useCADStore.getState().activeSketch;
    if (!sketch) return;
    const con = sketch.constraints.find((c) => c.id === constraintId);
    if (!con) return;
    const memberIds = new Set(con.entityIds);
    replaceSketchEntities(sketch.entities.filter((e) => !memberIds.has(e.id)));
    onClose();
  };

  const commit = (v: number) => {
    if (!Number.isNaN(v)) regeneratePolygon(constraintId, v);
  };

  return (
    <div
      ref={panelRef}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        transform: 'translate(14px, -14px)',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        background: colors.bgPanel,
        color: colors.textPrimary,
        border: `1px solid ${colors.accent}`,
        borderRadius: '4px',
        padding: '4px 6px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        fontSize: '11px',
        whiteSpace: 'nowrap',
        pointerEvents: 'auto',
      }}
    >
      <Hexagon size={13} style={{ color: colors.accent }} />
      <span style={{ color: colors.textSecondary }}>Sides</span>
      <input
        ref={inputRef}
        type="number"
        min={3}
        max={128}
        step={1}
        defaultValue={sides}
        onChange={(e) => commit(Number(e.target.value))}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') onClose();
        }}
        style={{
          width: '46px',
          fontSize: '11px',
          textAlign: 'center',
          color: colors.textPrimary,
          background: colors.bgInput,
          border: `1px solid ${colors.border}`,
          borderRadius: '2px',
          padding: '1px 2px',
        }}
      />
      <button
        title="Delete polygon"
        onClick={deletePolygon}
        style={{ display: 'flex', background: 'transparent', border: 'none', cursor: 'pointer', color: colors.textMuted, padding: 0 }}
      >
        <Trash2 size={13} />
      </button>
      <button
        title="Close"
        onClick={onClose}
        style={{ display: 'flex', background: 'transparent', border: 'none', cursor: 'pointer', color: colors.textMuted, padding: 0 }}
      >
        <X size={13} />
      </button>
    </div>
  );
}

/** Inline editor for a rectangle constraint: width + height. */
function RectangleEditor({
  constraintId,
  width,
  height,
  onClose,
}: {
  constraintId: string;
  width: number;
  height: number;
  onClose: () => void;
}) {
  const colors = useThemeStore((s) => s.colors);
  const regenerateRectangle = useCADStore((s) => s.regenerateRectangle);
  const replaceSketchEntities = useCADStore((s) => s.replaceSketchEntities);
  const wRef = useRef<HTMLInputElement>(null);
  const hRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = window.setTimeout(() => { wRef.current?.focus(); wRef.current?.select(); }, 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose(); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [onClose]);

  const apply = () => {
    const w = Number(wRef.current?.value);
    const h = Number(hRef.current?.value);
    if (!Number.isNaN(w) && !Number.isNaN(h)) regenerateRectangle(constraintId, w, h);
  };

  const deleteRect = () => {
    const sketch = useCADStore.getState().activeSketch;
    if (!sketch) return;
    const con = sketch.constraints.find((c) => c.id === constraintId);
    if (!con) return;
    const memberIds = new Set(con.entityIds);
    replaceSketchEntities(sketch.entities.filter((e) => !memberIds.has(e.id)));
    onClose();
  };

  const inputStyle: React.CSSProperties = {
    width: '52px', fontSize: '11px', textAlign: 'center',
    color: colors.textPrimary, background: colors.bgInput,
    border: `1px solid ${colors.border}`, borderRadius: '2px', padding: '1px 2px',
  };

  return (
    <div
      ref={panelRef}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        transform: 'translate(14px, -14px)', display: 'flex', alignItems: 'center', gap: '5px',
        background: colors.bgPanel, color: colors.textPrimary, border: `1px solid ${colors.accent}`,
        borderRadius: '4px', padding: '4px 6px', boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', fontSize: '11px',
        whiteSpace: 'nowrap', pointerEvents: 'auto',
      }}
    >
      <Square size={13} style={{ color: colors.accent }} />
      <input ref={wRef} type="number" min={0.01} step={1} defaultValue={width.toFixed(2)}
        onChange={apply} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') onClose(); }} style={inputStyle} />
      <span style={{ color: colors.textSecondary }}>×</span>
      <input ref={hRef} type="number" min={0.01} step={1} defaultValue={height.toFixed(2)}
        onChange={apply} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') onClose(); }} style={inputStyle} />
      <button title="Delete rectangle" onClick={deleteRect}
        style={{ display: 'flex', background: 'transparent', border: 'none', cursor: 'pointer', color: colors.textMuted, padding: 0 }}>
        <Trash2 size={13} />
      </button>
      <button title="Close" onClick={onClose}
        style={{ display: 'flex', background: 'transparent', border: 'none', cursor: 'pointer', color: colors.textMuted, padding: 0 }}>
        <X size={13} />
      </button>
    </div>
  );
}

const glyphButtonStyle = (colors: { bgPanel: string; border: string; accent: string }): React.CSSProperties => ({
  pointerEvents: 'auto', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: '20px', height: '20px', background: colors.bgPanel, border: `1px solid ${colors.border}`,
  borderRadius: '4px', cursor: 'pointer', color: colors.accent, boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
});

/**
 * Fusion-style shape affordance: a small glyph at each regular polygon's or
 * rectangle's center. Clicking it opens an inline editor to change the side
 * count (polygon) or width/height (rectangle), or delete the shape. The polygon
 * editor also auto-opens right after a polygon is drawn.
 */
export default function PolygonConstraintOverlay() {
  const activeSketch = useCADStore((s) => s.activeSketch);
  const editingId = useCADStore((s) => s.editingPolygonConstraintId);
  const setEditingId = useCADStore((s) => s.setEditingPolygonConstraintId);
  const colors = useThemeStore((s) => s.colors);

  if (!activeSketch) return null;
  const shapeConstraints = activeSketch.constraints.filter((c) => c.type === 'polygon' || c.type === 'rectangle');
  if (shapeConstraints.length === 0) return null;

  const badgeStyle: React.CSSProperties = {
    position: 'absolute', bottom: '-6px', right: '-6px', fontSize: '9px', fontWeight: 700,
    lineHeight: '12px', minWidth: '12px', textAlign: 'center', color: colors.textPrimary,
    background: colors.bgPanel, border: `1px solid ${colors.border}`, borderRadius: '6px', padding: '0 2px',
  };

  return (
    <group renderOrder={1000}>
      {shapeConstraints.map((con) => {
        const center = shapeCenter(con, activeSketch);
        if (!center) return null;
        const isEditing = editingId === con.id;
        const isRect = con.type === 'rectangle';
        const rm = con.rectangleMeta;
        return (
          <Html key={con.id} position={center} center zIndexRange={[210, 0]} style={{ pointerEvents: 'none' }}>
            {isEditing ? (
              isRect ? (
                <RectangleEditor constraintId={con.id} width={rm?.width ?? 0} height={rm?.height ?? 0} onClose={() => setEditingId(null)} />
              ) : (
                <PolygonEditor constraintId={con.id} sides={con.entityIds.length} onClose={() => setEditingId(null)} />
              )
            ) : (
              <button
                title={isRect
                  ? `Rectangle (${(rm?.width ?? 0).toFixed(1)} × ${(rm?.height ?? 0).toFixed(1)}) — click to edit`
                  : `Regular polygon (${con.entityIds.length} sides) — click to edit`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setEditingId(con.id); }}
                style={glyphButtonStyle(colors)}
              >
                {isRect ? <Square size={13} /> : <Hexagon size={13} />}
                {!isRect && <span style={badgeStyle}>{con.entityIds.length}</span>}
              </button>
            )}
          </Html>
        );
      })}
    </group>
  );
}
