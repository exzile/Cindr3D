import { Html } from '@react-three/drei';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Hexagon, X, Trash2 } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
import { useThemeStore } from '../../../store/themeStore';
import type { Sketch, SketchConstraint } from '../../../types/cad';

/** Center of a polygon constraint, from its metadata or the member-line vertices. */
function polygonCenter(con: SketchConstraint, sketch: Sketch): THREE.Vector3 | null {
  if (con.polygonMeta) {
    return new THREE.Vector3(con.polygonMeta.center.x, con.polygonMeta.center.y, con.polygonMeta.center.z);
  }
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

/**
 * Fusion-style polygon affordance: a small hexagon glyph at each regular
 * polygon's center. Clicking it opens an inline editor to change the side count
 * (or delete the polygon). The editor also auto-opens right after a polygon is
 * drawn so the user can immediately type the desired number of sides.
 */
export default function PolygonConstraintOverlay() {
  const activeSketch = useCADStore((s) => s.activeSketch);
  const editingId = useCADStore((s) => s.editingPolygonConstraintId);
  const setEditingId = useCADStore((s) => s.setEditingPolygonConstraintId);
  const colors = useThemeStore((s) => s.colors);

  if (!activeSketch) return null;
  const polyConstraints = activeSketch.constraints.filter((c) => c.type === 'polygon');
  if (polyConstraints.length === 0) return null;

  return (
    <group renderOrder={1000}>
      {polyConstraints.map((con) => {
        const center = polygonCenter(con, activeSketch);
        if (!center) return null;
        const sides = con.entityIds.length;
        const isEditing = editingId === con.id;
        return (
          <Html key={con.id} position={center} center zIndexRange={[210, 0]} style={{ pointerEvents: 'none' }}>
            {isEditing ? (
              <PolygonEditor constraintId={con.id} sides={sides} onClose={() => setEditingId(null)} />
            ) : (
              <button
                title={`Regular polygon (${sides} sides) — click to edit`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setEditingId(con.id); }}
                style={{
                  pointerEvents: 'auto',
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '20px',
                  height: '20px',
                  background: colors.bgPanel,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '4px',
                  cursor: 'pointer',
                  color: colors.accent,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }}
              >
                <Hexagon size={13} />
                <span
                  style={{
                    position: 'absolute',
                    bottom: '-6px',
                    right: '-6px',
                    fontSize: '9px',
                    fontWeight: 700,
                    lineHeight: '12px',
                    minWidth: '12px',
                    textAlign: 'center',
                    color: colors.textPrimary,
                    background: colors.bgPanel,
                    border: `1px solid ${colors.border}`,
                    borderRadius: '6px',
                    padding: '0 2px',
                  }}
                >
                  {sides}
                </span>
              </button>
            )}
          </Html>
        );
      })}
    </group>
  );
}
