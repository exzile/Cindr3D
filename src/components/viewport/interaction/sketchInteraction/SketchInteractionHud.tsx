import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { GeometryEngine } from '../../../../engine/GeometryEngine';
import { useCADStore } from '../../../../store/cadStore';
import type { Sketch, SketchPoint, SnapType } from '../../../../types/cad';
import type { ThemeColors } from '../../../../types/theme.types';

interface SketchInteractionHudProps {
  mousePos: THREE.Vector3 | null;
  activeSketch: Sketch | null;
  activeTool: string;
  drawingPoints: SketchPoint[];
  units: string;
  themeColors: ThemeColors;
  snapTarget: { worldPos: THREE.Vector3; type: SnapType } | null;
  hoverMidpoints?: THREE.Vector3[];
}

export function SketchInteractionHud({
  mousePos,
  activeSketch,
  activeTool,
  drawingPoints,
  units,
  themeColors,
  snapTarget,
  hoverMidpoints,
}: SketchInteractionHudProps) {
  const polygonSides = useCADStore((s) => s.sketchPolygonSides);
  const setPolygonSides = useCADStore((s) => s.setSketchPolygonSides);

  if (!mousePos || !activeSketch) {
    return null;
  }

  const isPolygonTool =
    activeTool === 'polygon' ||
    activeTool === 'polygon-inscribed' ||
    activeTool === 'polygon-circumscribed' ||
    activeTool === 'polygon-edge';
  // Anchor the editable side-count box to the polygon's first placed point (its
  // center / first edge endpoint) so it stays stationary and clickable while the
  // cursor moves to size the polygon. Before the first click it follows the
  // cursor as a read-only hint.
  const polygonAnchor =
    drawingPoints.length >= 1
      ? new THREE.Vector3(drawingPoints[0].x, drawingPoints[0].y, drawingPoints[0].z)
      : mousePos;
  const polygonInputInteractive = drawingPoints.length >= 1;

  const showLineDimensions =
    (activeTool === 'line' ||
      activeTool === 'construction-line' ||
      activeTool === 'centerline' ||
      activeTool === 'midpoint-line') &&
    drawingPoints.length >= 1;

  let lineLengthText = '';
  let lineAngleText = '';
  let lineMidpoint: THREE.Vector3 | null = null;
  let lineAnglePosition: THREE.Vector3 | null = null;
  let lineDeltaText = '';

  if (showLineDimensions) {
    const startPoint = drawingPoints[0];
    const startVector = new THREE.Vector3(startPoint.x, startPoint.y, startPoint.z);
    const delta =
      activeTool === 'midpoint-line'
        ? mousePos.clone().sub(startVector).multiplyScalar(2)
        : mousePos.clone().sub(startVector);
    const length = delta.length();
    const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
    const angleRadians = Math.atan2(delta.dot(t2), delta.dot(t1));
    const angleDegrees = (angleRadians * 180) / Math.PI;
    const deltaU = delta.dot(t1);
    const deltaV = delta.dot(t2);
    const arcRadius = Math.min(length * 0.25, 1.5);
    const midAngle = angleRadians / 2;

    lineLengthText = `${length.toFixed(3)} ${units}`;
    lineAngleText = `${Math.abs(angleDegrees).toFixed(1)} deg`;
    lineDeltaText = `d ${deltaU.toFixed(2)}, ${deltaV.toFixed(2)}`;
    lineMidpoint = startVector.clone().add(mousePos).multiplyScalar(0.5);
    lineAnglePosition = startVector
      .clone()
      .addScaledVector(t1, Math.cos(midAngle) * arcRadius * 1.9)
      .addScaledVector(t2, Math.sin(midAngle) * arcRadius * 1.9);
  }

  const showRadiusHud =
    (activeTool === 'circle' || activeTool === 'circle-2point' || activeTool === 'arc') &&
    drawingPoints.length >= 1;

  let radiusHudText = '';
  let radiusHudPosition: THREE.Vector3 | null = null;

  if (showRadiusHud) {
    const centerPoint = drawingPoints[0];
    const centerVector = new THREE.Vector3(centerPoint.x, centerPoint.y, centerPoint.z);
    const radius =
      activeTool === 'circle-2point'
        ? mousePos.distanceTo(centerVector) / 2
        : mousePos.distanceTo(centerVector);
    radiusHudText = `r=${radius.toFixed(3)} ${units}`;
    radiusHudPosition = centerVector.clone().add(mousePos).multiplyScalar(0.5);
  }

  // Overall Slot dimensions: length + angle on axis drag, width on perpendicular drag.
  const isLinearSlotTool =
    activeTool === 'slot-overall' ||
    activeTool === 'slot-center' ||
    activeTool === 'slot' ||
    activeTool === 'slot-center-point';
  const showSlotDims = isLinearSlotTool && drawingPoints.length >= 1;
  let slotHudText = '';
  let slotHudPosition: THREE.Vector3 | null = null;
  let slotHintText = '';
  if (showSlotDims) {
    const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
    const planeNormal = t1.clone().cross(t2).normalize();
    if (drawingPoints.length === 1) {
      const p0 = new THREE.Vector3(drawingPoints[0].x, drawingPoints[0].y, drawingPoints[0].z);
      const delta = mousePos.clone().sub(p0);
      // slot-center-point: first click is the midpoint, so full c-to-c = 2× the half-length
      const displayLen = activeTool === 'slot-center-point' ? delta.length() * 2 : delta.length();
      const angDeg = (Math.atan2(delta.dot(t2), delta.dot(t1)) * 180) / Math.PI;
      slotHudText = `${displayLen.toFixed(3)} ${units}   ${Math.abs(angDeg).toFixed(1)} deg`;
      slotHudPosition = p0.clone().add(mousePos).multiplyScalar(0.5);
      slotHintText = activeTool === 'slot-center-point' ? 'Select end centre' : 'Select end point';
    } else if (drawingPoints.length === 2) {
      const p1 = new THREE.Vector3(drawingPoints[0].x, drawingPoints[0].y, drawingPoints[0].z);
      const p2 = new THREE.Vector3(drawingPoints[1].x, drawingPoints[1].y, drawingPoints[1].z);
      const axisDir = p2.clone().sub(p1).normalize();
      const perpDir = axisDir.clone().cross(planeNormal).normalize();
      const width = Math.abs(mousePos.clone().sub(p1).dot(perpDir)) * 2;
      slotHudText = `${width.toFixed(3)} ${units}`;
      slotHudPosition = mousePos.clone();
      slotHintText = 'Select width';
    }
  }

  // Ellipse / elliptical-arc creation dimensions: major-axis length + angle while
  // placing the first axis, then minor-axis length while placing the second.
  const showEllipseDims =
    (activeTool === 'ellipse' || activeTool === 'elliptical-arc') && drawingPoints.length >= 1;
  let ellipseHudText = '';
  let ellipseHudPosition: THREE.Vector3 | null = null;
  if (showEllipseDims) {
    const centerPoint = drawingPoints[0];
    const centerVector = new THREE.Vector3(centerPoint.x, centerPoint.y, centerPoint.z);
    const { t1, t2 } = GeometryEngine.getSketchAxes(activeSketch);
    if (drawingPoints.length === 1) {
      const mv = mousePos.clone().sub(centerVector);
      const len = mv.length();
      const angDeg = (Math.atan2(mv.dot(t2), mv.dot(t1)) * 180) / Math.PI;
      ellipseHudText = `${len.toFixed(2)} ${units}   ${Math.abs(angDeg).toFixed(1)}°`;
      ellipseHudPosition = centerVector.clone().add(mousePos).multiplyScalar(0.5);
    } else if (drawingPoints.length === 2) {
      const mp = drawingPoints[1];
      const majorDir = new THREE.Vector3(mp.x - centerPoint.x, mp.y - centerPoint.y, mp.z - centerPoint.z).normalize();
      const planeNormal = t1.clone().cross(t2).normalize();
      const minorDir = majorDir.clone().cross(planeNormal).normalize();
      const minorLen = Math.abs(mousePos.clone().sub(centerVector).dot(minorDir));
      ellipseHudText = `minor ${minorLen.toFixed(2)} ${units}`;
      ellipseHudPosition = mousePos.clone();
    }
  }

  const baseLabelStyle: React.CSSProperties = {
    pointerEvents: 'none',
    userSelect: 'none',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    fontSize: '11px',
    fontWeight: 500,
    whiteSpace: 'nowrap',
    background: themeColors.bgPanel,
    color: themeColors.textPrimary,
    border: `1px solid ${themeColors.border}`,
    borderRadius: '3px',
    padding: '3px 7px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
  };
  const lengthLabelStyle: React.CSSProperties = {
    ...baseLabelStyle,
    borderColor: themeColors.accent,
  };
  const cursorLabelStyle: React.CSSProperties = {
    ...baseLabelStyle,
    background: 'transparent',
    border: 'none',
    boxShadow: 'none',
    color: themeColors.textSecondary,
    transform: 'translate(20px, -22px)',
  };
  const deltaLabelStyle: React.CSSProperties = {
    ...baseLabelStyle,
    background: 'transparent',
    border: 'none',
    boxShadow: 'none',
    fontSize: '10px',
    color: themeColors.textMuted,
    transform: 'translate(20px, 4px)',
  };

  return (
    <>
      <group position={mousePos}>
        <mesh>
          <ringGeometry args={[0.3, 0.4, 16]} />
          <meshBasicMaterial color={0xff6600} />
        </mesh>
      </group>

      {showLineDimensions && lineMidpoint && lineAnglePosition && (
        <>
          <Html position={lineMidpoint} center zIndexRange={[100, 0]} style={{ pointerEvents: 'none' }}>
            <div style={lengthLabelStyle}>{lineLengthText}</div>
          </Html>
          <Html position={lineAnglePosition} center zIndexRange={[100, 0]} style={{ pointerEvents: 'none' }}>
            <div style={baseLabelStyle}>{lineAngleText}</div>
          </Html>
          <Html position={mousePos} zIndexRange={[100, 0]} style={{ pointerEvents: 'none' }}>
            <div style={cursorLabelStyle}>Specify next point</div>
          </Html>
          <Html position={mousePos} zIndexRange={[100, 0]} style={{ pointerEvents: 'none' }}>
            <div style={deltaLabelStyle}>{lineDeltaText}</div>
          </Html>
        </>
      )}

      {showRadiusHud && radiusHudPosition && (
        <Html position={radiusHudPosition} center zIndexRange={[100, 0]} style={{ pointerEvents: 'none' }}>
          <div style={lengthLabelStyle}>{radiusHudText}</div>
        </Html>
      )}

      {showSlotDims && slotHudPosition && (
        <>
          <Html position={slotHudPosition} center zIndexRange={[100, 0]} style={{ pointerEvents: 'none' }}>
            <div style={lengthLabelStyle}>{slotHudText}</div>
          </Html>
          <Html position={mousePos} zIndexRange={[100, 0]} style={{ pointerEvents: 'none' }}>
            <div style={cursorLabelStyle}>{slotHintText}</div>
          </Html>
        </>
      )}

      {showEllipseDims && ellipseHudPosition && (
        <Html position={ellipseHudPosition} center zIndexRange={[100, 0]} style={{ pointerEvents: 'none' }}>
          <div style={lengthLabelStyle}>{ellipseHudText}</div>
        </Html>
      )}

      {/* Fusion-style inline side-count field for the polygon tools. */}
      {isPolygonTool && (
        <Html position={polygonAnchor} zIndexRange={[200, 0]} style={{ pointerEvents: 'none' }}>
          <div
            style={{
              ...baseLabelStyle,
              transform: 'translate(24px, -34px)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              pointerEvents: polygonInputInteractive ? 'auto' : 'none',
              borderColor: themeColors.accent,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <span style={{ color: themeColors.textSecondary }}>Sides</span>
            {polygonInputInteractive ? (
              <input
                type="number"
                min={3}
                max={128}
                step={1}
                value={polygonSides}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isNaN(v)) setPolygonSides(v);
                }}
                onKeyDown={(e) => e.stopPropagation()}
                style={{
                  width: '42px',
                  fontSize: '11px',
                  textAlign: 'center',
                  color: themeColors.textPrimary,
                  background: themeColors.bgInput,
                  border: `1px solid ${themeColors.border}`,
                  borderRadius: '2px',
                  padding: '1px 2px',
                }}
              />
            ) : (
              <strong style={{ color: themeColors.textPrimary }}>{polygonSides}</strong>
            )}
          </div>
        </Html>
      )}

      {/* Dim midpoint triangles on hovered segments — visible before the cursor reaches snap radius */}
      {hoverMidpoints?.filter(mid =>
        !(snapTarget?.type === 'midpoint' && snapTarget.worldPos.distanceTo(mid) < 0.1)
      ).map((mid, i) => (
        <Html key={i} position={mid} center zIndexRange={[290, 0]} style={{ pointerEvents: 'none' }}>
          <div style={{
            width: 0, height: 0,
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderBottom: '11px solid rgba(194,65,12,0.5)',
            pointerEvents: 'none',
          }} />
        </Html>
      ))}

      {snapTarget && (
        <Html position={mousePos} center zIndexRange={[300, 0]} style={{ pointerEvents: 'none' }}>
          {snapTarget.type === 'endpoint' && (
            <div style={{ width: 10, height: 10, border: '2px solid #c2410c', transform: 'rotate(45deg)', pointerEvents: 'none' }} />
          )}
          {snapTarget.type === 'midpoint' && (
            <div style={{ width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderBottom: '11px solid #c2410c', pointerEvents: 'none' }} />
          )}
          {snapTarget.type === 'center' && (
            <div style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid #c2410c', pointerEvents: 'none' }} />
          )}
          {snapTarget.type === 'intersection' && (
            <div style={{ width: 12, height: 12, position: 'relative', pointerEvents: 'none' }}>
              <div style={{ position: 'absolute', top: 5, left: 0, width: 12, height: 2, background: '#c2410c', transform: 'rotate(45deg)', transformOrigin: 'center' }} />
              <div style={{ position: 'absolute', top: 5, left: 0, width: 12, height: 2, background: '#c2410c', transform: 'rotate(-45deg)', transformOrigin: 'center' }} />
            </div>
          )}
          {snapTarget.type === 'perpendicular' && (
            <div style={{ width: 12, height: 12, position: 'relative', pointerEvents: 'none' }}>
              <div style={{ position: 'absolute', bottom: 0, left: 0, width: 6, height: 2, background: '#cc88ff' }} />
              <div style={{ position: 'absolute', bottom: 0, left: 0, width: 2, height: 8, background: '#cc88ff' }} />
            </div>
          )}
          {snapTarget.type === 'tangent' && (
            <div style={{ width: 12, height: 12, position: 'relative', pointerEvents: 'none' }}>
              <div style={{ position: 'absolute', top: 1, left: 1, width: 10, height: 10, borderRadius: '50%', border: '2px solid #ff88cc' }} />
              <div style={{ position: 'absolute', top: -2, left: 5, width: 2, height: 16, background: '#ff88cc', transform: 'rotate(0deg)' }} />
            </div>
          )}
        </Html>
      )}
    </>
  );
}
