/**
 * SketchArcRadiusEditor
 *
 * Renders a floating radius callout (like the fillet-tool preview) on the arc
 * that is currently selected for editing (`sketchEditingArcId`).  Appears
 * whenever an arc-centre dot is clicked in select mode; disappears on click-
 * outside or when another arc / tool is activated.
 */

import { useEffect, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useCADStore } from '../../../store/cadStore';
import { useThemeStore } from '../../../store/themeStore';
import { computeFilletRadiusUpdate } from '../interaction/sketchInteraction/cornerFilletGeometry';

export default function SketchArcRadiusEditor() {
  const activeSketch    = useCADStore((s) => s.activeSketch);
  const editingArcId    = useCADStore((s) => s.sketchEditingArcId);
  const setEditingArcId = useCADStore((s) => s.setSketchEditingArcId);
  const replaceEntities = useCADStore((s) => s.replaceSketchEntities);
  const units           = useCADStore((s) => s.units);
  const showConstraints = useCADStore((s) => s.showSketchConstraints);
  const themeColors     = useThemeStore((s) => s.colors);

  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close when the user clicks outside the callout div or changes tool
  useEffect(() => {
    if (!editingArcId) return;
    const onDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setEditingArcId(null);
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [editingArcId, setEditingArcId]);

  // The fillet round is a constraint — hide its editor when constraints are hidden.
  if (!editingArcId || !activeSketch || !showConstraints) return null;

  const arc = activeSketch.entities.find(
    (e) => e.id === editingArcId && e.type === 'arc',
  );
  if (!arc || arc.points.length < 1 || typeof arc.radius !== 'number') return null;

  const { x, y, z } = arc.points[0]; // centre

  const handleChange = (raw: string) => {
    const v = Number(raw);
    if (Number.isNaN(v) || v <= 0) return;

    // Re-fillet: recompute the arc centre/angles AND move the two attached line
    // tangent points so the corner stays tangent at the new radius. Falls back to
    // a plain radius change if the adjoining lines can't be reconstructed.
    const upd = computeFilletRadiusUpdate(activeSketch, arc, v);
    if (!upd) {
      replaceEntities(
        activeSketch.entities.map((e) =>
          e.id === editingArcId ? { ...e, radius: v } : e,
        ),
      );
      return;
    }

    replaceEntities(
      activeSketch.entities.map((e) => {
        if (e.id === editingArcId) {
          return {
            ...e,
            radius: upd.radius,
            startAngle: upd.arcStart,
            endAngle: upd.arcEnd,
            points: [{ ...e.points[0], x: upd.center.x, y: upd.center.y, z: upd.center.z }],
          };
        }
        if (e.id === upd.line0Id) {
          const pts = [...e.points];
          pts[upd.line0PointIndex] = { ...pts[upd.line0PointIndex], x: upd.tangent0.x, y: upd.tangent0.y, z: upd.tangent0.z };
          return { ...e, points: pts };
        }
        if (e.id === upd.line1Id) {
          const pts = [...e.points];
          pts[upd.line1PointIndex] = { ...pts[upd.line1PointIndex], x: upd.tangent1.x, y: upd.tangent1.y, z: upd.tangent1.z };
          return { ...e, points: pts };
        }
        return e;
      }),
    );
  };

  const baseLabelStyle: React.CSSProperties = {
    pointerEvents: 'auto',
    userSelect: 'none',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    fontSize: '11px',
    fontWeight: 500,
    whiteSpace: 'nowrap',
    background: themeColors.bgPanel,
    color: themeColors.textPrimary,
    border: `1px solid ${themeColors.accent}`,
    borderRadius: '3px',
    padding: '3px 7px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
  };

  return (
    <Html position={[x, y, z]} zIndexRange={[400, 0]} style={{ pointerEvents: 'none', overflow: 'visible' }}>
      <div ref={wrapperRef} style={{ position: 'relative', width: 0, height: 0 }}>
        {/* SVG leader from centre to label */}
        <svg style={{ position: 'absolute', overflow: 'visible', pointerEvents: 'none' }} width="0" height="0">
          <line x1="0" y1="0" x2="22" y2="-44" stroke={themeColors.accent} strokeWidth="1" />
        </svg>

        {/* Radius input */}
        <div
          style={{ position: 'absolute', left: 22, top: -68 }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ ...baseLabelStyle, display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ color: themeColors.textSecondary, fontWeight: 600, fontSize: '10px' }}>R</span>
            <input
              type="number"
              min={0.01}
              step={0.5}
              defaultValue={arc.radius}
              key={editingArcId}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' || e.key === 'Escape') setEditingArcId(null);
              }}
              autoFocus
              style={{
                width: '52px',
                fontSize: '11px',
                textAlign: 'right',
                color: themeColors.textPrimary,
                background: themeColors.bgInput,
                border: `1px solid ${themeColors.border}`,
                borderRadius: '2px',
                padding: '1px 4px',
                pointerEvents: 'auto',
              }}
            />
            <span style={{ color: themeColors.textSecondary, fontSize: '10px' }}>{units}</span>
          </div>
        </div>
      </div>
    </Html>
  );
}
