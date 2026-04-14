import { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Environment, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import { useCADStore } from '../store/cadStore';
import { useThemeStore } from '../store/themeStore';
import { GeometryEngine } from '../engine/GeometryEngine';
// import ToolPanel from './ToolPanel'; // Removed — sketch options handled by SketchPalette
import ViewCube from './ViewCube';
import CanvasControls from './CanvasControls';
import SketchPalette from './SketchPalette';
import type { SketchEntity, SketchPoint, Sketch, Feature } from '../types/cad';

/** Syncs the Three.js scene background / clear color with the active theme */
function SceneTheme() {
  const { gl, scene } = useThree();
  const canvasBg = useThemeStore((s) => s.colors.canvasBg);

  useEffect(() => {
    const color = new THREE.Color(canvasBg);
    gl.setClearColor(color);
    scene.background = color;
  }, [canvasBg, gl, scene]);

  return null;
}

/**
 * Renders one sketch's wire geometry. Caches the Three.js Group via useMemo so it is
 * only recreated when the sketch reference changes (Zustand does immutable updates),
 * and disposes all child line geometries on cleanup to prevent GPU memory leaks.
 * NOTE: SKETCH_MATERIAL is a shared module-level constant — never dispose it here.
 */
function SketchGeometry({ sketch }: { sketch: Sketch }) {
  const group = useMemo(() => GeometryEngine.createSketchGeometry(sketch), [sketch]);

  useEffect(() => {
    return () => {
      group.traverse((obj) => {
        if ((obj as THREE.Line).isLine) {
          (obj as THREE.Line).geometry.dispose();
        }
      });
    };
  }, [group]);

  return <primitive object={group} />;
}

function SketchRenderer() {
  const activeSketch = useCADStore((s) => s.activeSketch);
  const features = useCADStore((s) => s.features);
  const sketches = useCADStore((s) => s.sketches);

  return (
    <>
      {features.filter(f => f.type === 'sketch' && f.visible).map((feature) => {
        const sketch = sketches.find(s => s.id === feature.sketchId);
        if (!sketch) return null;
        return <SketchGeometry key={feature.id} sketch={sketch} />;
      })}
      {activeSketch && activeSketch.entities.length > 0 && (
        <SketchGeometry key={`active-${activeSketch.id}-e${activeSketch.entities.length}`} sketch={activeSketch} />
      )}
    </>
  );
}

/** Extrude geometry item — memoized, disposes ExtrudeGeometry on change/unmount. */
function ExtrudeItem({ feature, sketch }: { feature: Feature; sketch: Sketch }) {
  const distance = (feature.params.distance as number) || 10;
  const mesh = useMemo(
    () => GeometryEngine.extrudeSketch(sketch, distance),
    [sketch, distance],
  );
  useEffect(() => {
    return () => { mesh?.geometry.dispose(); };
  }, [mesh]);
  if (!mesh) return null;
  return <primitive object={mesh} />;
}

/** Revolve geometry item — memoized, disposes LatheGeometry on change/unmount. */
function RevolveItem({ feature, sketch }: { feature: Feature; sketch: Sketch }) {
  const angle = ((feature.params.angle as number) || 360) * (Math.PI / 180);
  // Stable axis vector — created once per component instance
  const axis = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const mesh = useMemo(
    () => GeometryEngine.revolveSketch(sketch, angle, axis),
    [sketch, angle, axis],
  );
  useEffect(() => {
    return () => { mesh?.geometry.dispose(); };
  }, [mesh]);
  if (!mesh) return null;
  return <primitive object={mesh} />;
}

function ExtrudedBodies() {
  const features = useCADStore((s) => s.features);
  const sketches = useCADStore((s) => s.sketches);

  return (
    <>
      {features.filter(f => f.type === 'extrude' && f.visible).map((feature) => {
        const sketch = sketches.find(s => s.id === feature.sketchId);
        if (!sketch) return null;
        return <ExtrudeItem key={feature.id} feature={feature} sketch={sketch} />;
      })}
      {features.filter(f => f.type === 'revolve' && f.visible).map((feature) => {
        const sketch = sketches.find(s => s.id === feature.sketchId);
        if (!sketch) return null;
        return <RevolveItem key={feature.id} feature={feature} sketch={sketch} />;
      })}
    </>
  );
}

function ImportedModels() {
  const features = useCADStore((s) => s.features);

  return (
    <>
      {features.filter(f => f.type === 'import' && f.visible && f.mesh).map((feature) => (
        <primitive key={feature.id} object={feature.mesh!} />
      ))}
    </>
  );
}

function SketchPlaneIndicator() {
  const activeSketch = useCADStore((s) => s.activeSketch);

  if (!activeSketch) return null;

  // Rotations must produce a mesh whose normal matches the sketch plane normal:
  //   PlaneGeometry default faces +Z (vertical wall). Rotating by -90° around X
  //   makes it horizontal (faces +Y). Rotating by +90° around Y makes it face +X.
  const planeRotation: [number, number, number] = (() => {
    switch (activeSketch.plane) {
      case 'XY': return [-Math.PI / 2, 0, 0]; // horizontal ground
      case 'XZ': return [0, 0, 0];            // vertical front (faces +Z)
      case 'YZ': return [0, Math.PI / 2, 0];  // vertical side (faces +X)
      default:   return [-Math.PI / 2, 0, 0];
    }
  })();

  return (
    <mesh rotation={planeRotation} position={[0, 0, 0]}>
      <planeGeometry args={[200, 200]} />
      <meshBasicMaterial
        color={0x4488ff}
        transparent
        opacity={0.05}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

// ── Shift + Middle-Mouse-Button pan handler ─────────────────────────────────
// OrbitControls maps middle button to dolly. This component intercepts
// Shift+Middle drag and converts it to panning (moves camera + target together).
function ShiftMiddlePan() {
  const { gl, camera } = useThree();
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; update: () => void; enabled: boolean } | null;

  useEffect(() => {
    const canvas = gl.domElement;
    let panning = false;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 1 && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        panning = true;
        lastX = e.clientX;
        lastY = e.clientY;
        try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        if (controls) controls.enabled = false;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!panning) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      const rect = canvas.getBoundingClientRect();
      const target = controls ? controls.target : new THREE.Vector3();
      const dist = camera.position.distanceTo(target);
      // Scale pan speed with distance so it feels consistent at any zoom level
      const scale = (dist / rect.height) * 2;

      // Build right/up vectors from camera orientation
      const right = new THREE.Vector3();
      right.setFromMatrixColumn(camera.matrixWorld, 0); // camera local X
      const up = new THREE.Vector3();
      up.setFromMatrixColumn(camera.matrixWorld, 1);    // camera local Y

      const pan = right.multiplyScalar(-dx * scale).add(
        up.multiplyScalar(dy * scale)
      );

      camera.position.add(pan);
      if (controls) {
        controls.target.add(pan);
        controls.update();
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.button === 1 && panning) {
        panning = false;
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        if (controls) controls.enabled = true;
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      if (controls) controls.enabled = true;
    };
  }, [gl, camera, controls]);

  return null;
}

function SketchInteraction() {
  const { camera, gl, raycaster } = useThree();
  const activeTool = useCADStore((s) => s.activeTool);
  const activeSketch = useCADStore((s) => s.activeSketch);
  const addSketchEntity = useCADStore((s) => s.addSketchEntity);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);
  const snapEnabled = useCADStore((s) => s.snapEnabled);
  const gridSize = useCADStore((s) => s.gridSize);

  const [drawingPoints, setDrawingPoints] = useState<SketchPoint[]>([]);
  const [mousePos, setMousePos] = useState<THREE.Vector3 | null>(null);
  const previewRef = useRef<THREE.Group>(null);
  // Stable preview material — created once, never recreated per frame
  const previewMaterial = useRef(new THREE.LineBasicMaterial({ color: 0xffaa00, linewidth: 2 }));

  // Dispose the shared preview material when SketchInteraction unmounts
  useEffect(() => {
    const mat = previewMaterial.current;
    return () => { mat.dispose(); };
  }, []);

  // Clear in-progress drawing when the user switches tools
  useEffect(() => {
    setDrawingPoints([]);
    setMousePos(null);
  }, [activeTool]);

  const getSketchPlane = useCallback((): THREE.Plane => {
    if (!activeSketch) return new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // Normals must match getPlaneNormal() in cadStore and the visual plane selector:
    //   XY = horizontal ground   → Y-normal  (0, 1, 0)
    //   XZ = vertical front wall → Z-normal  (0, 0, 1)
    //   YZ = vertical side wall  → X-normal  (1, 0, 0)
    switch (activeSketch.plane) {
      case 'XY': return new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      case 'XZ': return new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
      case 'YZ': return new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
      default:   return new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    }
  }, [activeSketch]);

  const snapToGrid = useCallback((point: THREE.Vector3): THREE.Vector3 => {
    if (!snapEnabled) return point;
    const snap = gridSize / 10;
    return new THREE.Vector3(
      Math.round(point.x / snap) * snap,
      Math.round(point.y / snap) * snap,
      Math.round(point.z / snap) * snap
    );
  }, [snapEnabled, gridSize]);

  const getWorldPoint = useCallback((event: MouseEvent): THREE.Vector3 | null => {
    const rect = gl.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    raycaster.setFromCamera(mouse, camera);
    const plane = getSketchPlane();
    const intersection = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(plane, intersection);

    if (hit) return snapToGrid(intersection);
    return null;
  }, [camera, gl, raycaster, getSketchPlane, snapToGrid]);

  useEffect(() => {
    if (!activeSketch || activeTool === 'select') return;

    // Plane-aware tangent axes — same as GeometryEngine.getPlaneAxes
    const { t1, t2 } = GeometryEngine.getPlaneAxes(activeSketch.plane);

    // Project a 3-D point difference onto the plane's 2-D local axes
    const projectToPlane = (pt: SketchPoint, origin: SketchPoint) => {
      const d = new THREE.Vector3(pt.x - origin.x, pt.y - origin.y, pt.z - origin.z);
      return { u: d.dot(t1), v: d.dot(t2) };
    };

    const handleMouseMove = (event: MouseEvent) => {
      const point = getWorldPoint(event);
      if (point) {
        setMousePos(point);
        if (drawingPoints.length > 0) {
          const start = drawingPoints[0];
          if (activeTool === 'circle' || activeTool === 'polygon') {
            const radius = point.distanceTo(new THREE.Vector3(start.x, start.y, start.z));
            setStatusMessage(`Radius: ${radius.toFixed(2)} — click to place`);
          } else if (activeTool === 'arc') {
            if (drawingPoints.length === 1) {
              const r = point.distanceTo(new THREE.Vector3(start.x, start.y, start.z));
              setStatusMessage(`Arc radius: ${r.toFixed(2)} — click to set start angle`);
            } else {
              setStatusMessage('Click to set end angle');
            }
          } else {
            const dx = point.x - start.x;
            const dy = point.y - start.y;
            const dz = point.z - start.z;
            setStatusMessage(`Δ: ${dx.toFixed(2)}, ${dy.toFixed(2)}, ${dz.toFixed(2)}`);
          }
        } else {
          setStatusMessage(`Click to start ${activeTool} — Position: ${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)}`);
        }
      }
    };

    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const point = getWorldPoint(event);
      if (!point) return;

      const sketchPoint: SketchPoint = {
        id: crypto.randomUUID(),
        x: point.x,
        y: point.y,
        z: point.z,
      };

      switch (activeTool) {
        case 'line': {
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('Line start placed — click to set end point (right-click to cancel)');
          } else {
            const entity: SketchEntity = {
              id: crypto.randomUUID(),
              type: 'line',
              points: [drawingPoints[0], sketchPoint],
            };
            addSketchEntity(entity);
            setDrawingPoints([sketchPoint]); // Chain lines — next start = this end
            setStatusMessage('Line added — click to continue, right-click or Escape to stop');
          }
          break;
        }
        case 'circle': {
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('Circle center placed — click to set radius');
          } else {
            const center = drawingPoints[0];
            // Full 3-D distance — correct for every sketch plane
            const radius = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z)
              .distanceTo(new THREE.Vector3(center.x, center.y, center.z));
            if (radius > 0.001) {
              addSketchEntity({
                id: crypto.randomUUID(),
                type: 'circle',
                points: [center],
                radius,
              });
              setStatusMessage(`Circle added (r=${radius.toFixed(2)})`);
            } else {
              setStatusMessage('Circle too small — try again');
            }
            setDrawingPoints([]);
          }
          break;
        }
        case 'rectangle': {
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('Rectangle corner placed — click to set opposite corner');
          } else {
            addSketchEntity({
              id: crypto.randomUUID(),
              type: 'rectangle',
              points: [drawingPoints[0], sketchPoint],
              closed: true,
            });
            setDrawingPoints([]);
            setStatusMessage('Rectangle added');
          }
          break;
        }
        case 'arc': {
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]); // center
            setStatusMessage('Arc center placed — click to set radius & start angle');
          } else if (drawingPoints.length === 1) {
            setDrawingPoints([...drawingPoints, sketchPoint]); // start point
            setStatusMessage('Arc start set — click to set end angle');
          } else {
            // Use plane-local 2-D coordinates so angles are correct on every plane
            const center = drawingPoints[0];
            const startPt = drawingPoints[1];
            const { u: u1, v: v1 } = projectToPlane(startPt, center);
            const { u: u2, v: v2 } = projectToPlane(sketchPoint, center);
            const radius = Math.sqrt(u1 * u1 + v1 * v1);
            if (radius > 0.001) {
              addSketchEntity({
                id: crypto.randomUUID(),
                type: 'arc',
                points: [center],
                radius,
                startAngle: Math.atan2(v1, u1),
                endAngle: Math.atan2(v2, u2),
              });
              setStatusMessage('Arc added');
            } else {
              setStatusMessage('Arc too small — try again');
            }
            setDrawingPoints([]);
          }
          break;
        }
        case 'polygon': {
          if (drawingPoints.length === 0) {
            setDrawingPoints([sketchPoint]);
            setStatusMessage('Polygon center placed — click to set radius (6-sided)');
          } else {
            const center = drawingPoints[0];
            const radius = new THREE.Vector3(sketchPoint.x, sketchPoint.y, sketchPoint.z)
              .distanceTo(new THREE.Vector3(center.x, center.y, center.z));
            if (radius > 0.001) {
              const sides = 6; // hexagon by default
              for (let i = 0; i < sides; i++) {
                const a1 = (i / sides) * Math.PI * 2;
                const a2 = ((i + 1) / sides) * Math.PI * 2;
                const p1: SketchPoint = {
                  id: crypto.randomUUID(),
                  x: center.x + t1.x * Math.cos(a1) * radius + t2.x * Math.sin(a1) * radius,
                  y: center.y + t1.y * Math.cos(a1) * radius + t2.y * Math.sin(a1) * radius,
                  z: center.z + t1.z * Math.cos(a1) * radius + t2.z * Math.sin(a1) * radius,
                };
                const p2: SketchPoint = {
                  id: crypto.randomUUID(),
                  x: center.x + t1.x * Math.cos(a2) * radius + t2.x * Math.sin(a2) * radius,
                  y: center.y + t1.y * Math.cos(a2) * radius + t2.y * Math.sin(a2) * radius,
                  z: center.z + t1.z * Math.cos(a2) * radius + t2.z * Math.sin(a2) * radius,
                };
                addSketchEntity({ id: crypto.randomUUID(), type: 'line', points: [p1, p2] });
              }
              setStatusMessage(`Hexagon added (r=${radius.toFixed(2)})`);
            } else {
              setStatusMessage('Polygon too small — try again');
            }
            setDrawingPoints([]);
          }
          break;
        }
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawingPoints([]);
        setStatusMessage('Drawing cancelled');
      }
    };

    // Right-click stops the current drawing operation at the last placed point
    const handleContextMenu = (event: MouseEvent) => {
      if (drawingPoints.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        setDrawingPoints([]);
        setStatusMessage('');
      }
    };

    const canvas = gl.domElement;
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('click', handleClick);
    canvas.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeSketch, activeTool, drawingPoints, getWorldPoint, addSketchEntity, setStatusMessage]);

  // Preview of current drawing operation
  useFrame(() => {
    if (!previewRef.current) return;
    // Dispose geometry of each child before removing — prevents GPU memory leak
    while (previewRef.current.children.length > 0) {
      const child = previewRef.current.children[0] as THREE.Line;
      child.geometry?.dispose(); // dispose geometry (material is shared — do NOT dispose it)
      previewRef.current.remove(child);
    }

    if (drawingPoints.length === 0 || !mousePos) return;

    const material = previewMaterial.current;
    const start = drawingPoints[0];
    const startV = new THREE.Vector3(start.x, start.y, start.z);

    // Plane-aware axis vectors via GeometryEngine helper
    const { t1, t2 } = GeometryEngine.getPlaneAxes(activeSketch?.plane ?? 'XZ');

    const addLine = (pts: THREE.Vector3[]) => {
      const geom = new THREE.BufferGeometry().setFromPoints(pts);
      previewRef.current!.add(new THREE.Line(geom, material));
    };

    const circlePoints = (center: THREE.Vector3, radius: number, segs = 64): THREE.Vector3[] => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        pts.push(center.clone().addScaledVector(t1, Math.cos(a) * radius).addScaledVector(t2, Math.sin(a) * radius));
      }
      return pts;
    };

    switch (activeTool) {
      case 'line': {
        addLine([startV, mousePos]);
        break;
      }
      case 'rectangle': {
        const delta = mousePos.clone().sub(startV);
        const dt1 = t1.clone().multiplyScalar(delta.dot(t1));
        const dt2 = t2.clone().multiplyScalar(delta.dot(t2));
        addLine([
          startV.clone(),
          startV.clone().add(dt1),
          startV.clone().add(dt1).add(dt2),
          startV.clone().add(dt2),
          startV.clone(),
        ]);
        break;
      }
      case 'circle': {
        const radius = mousePos.distanceTo(startV);
        addLine(circlePoints(startV, radius));
        // Radius indicator line
        addLine([startV, mousePos]);
        break;
      }
      case 'arc': {
        if (drawingPoints.length === 1) {
          // Show radius line from center to mouse
          addLine([startV, mousePos]);
          // Show dashed circle outline at radius
          addLine(circlePoints(startV, mousePos.distanceTo(startV)));
        } else if (drawingPoints.length === 2) {
          // Second point defines the start angle; mouse defines end angle
          const startPt2 = drawingPoints[1];
          const startV2 = new THREE.Vector3(startPt2.x, startPt2.y, startPt2.z);
          const radius = startV2.distanceTo(startV);
          const d1 = startV2.clone().sub(startV);
          const d2 = mousePos.clone().sub(startV);
          const startAngle = Math.atan2(d1.dot(t2), d1.dot(t1));
          const endAngle = Math.atan2(d2.dot(t2), d2.dot(t1));
          const segs = 32;
          const arcPts: THREE.Vector3[] = [];
          for (let i = 0; i <= segs; i++) {
            const a = startAngle + (i / segs) * (endAngle - startAngle);
            arcPts.push(startV.clone().addScaledVector(t1, Math.cos(a) * radius).addScaledVector(t2, Math.sin(a) * radius));
          }
          addLine(arcPts);
          // Show radius lines to start and end
          addLine([startV, startV2]);
          addLine([startV, mousePos.clone().sub(startV).normalize().multiplyScalar(radius).add(startV)]);
        }
        break;
      }
      case 'polygon': {
        const radius = mousePos.distanceTo(startV);
        const sides = 6;
        const polyPts: THREE.Vector3[] = [];
        for (let i = 0; i <= sides; i++) {
          const a = (i / sides) * Math.PI * 2;
          polyPts.push(startV.clone().addScaledVector(t1, Math.cos(a) * radius).addScaledVector(t2, Math.sin(a) * radius));
        }
        addLine(polyPts);
        addLine([startV, mousePos]);
        break;
      }
    }
  });

  // Cursor crosshair at mouse position
  if (!mousePos || !activeSketch) return null;

  return (
    <group ref={previewRef}>
      {/* Crosshair cursor */}
      <group position={mousePos}>
        <mesh>
          <ringGeometry args={[0.3, 0.4, 16]} />
          <meshBasicMaterial color={0xff6600} />
        </mesh>
      </group>
    </group>
  );
}

/** World-space X / Y / Z axis lines — always rendered regardless of grid or sketch mode */
function WorldAxes() {
  const themeColors = useThemeStore((s) => s.colors);
  const AXIS_LEN = 500;

  return (
    <group>
      {/* X axis — Red */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array([-AXIS_LEN, 0, 0, AXIS_LEN, 0, 0]), 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color={themeColors.axisRed} linewidth={2} />
      </line>
      {/* Y axis — Green (vertical/up). themeStore: axisGreen = Y */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array([0, -AXIS_LEN, 0, 0, AXIS_LEN, 0]), 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color={themeColors.axisGreen} linewidth={2} />
      </line>
      {/* Z axis — Blue (depth). themeStore: axisBlue = Z */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array([0, 0, -AXIS_LEN, 0, 0, AXIS_LEN]), 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color={themeColors.axisBlue} linewidth={2} />
      </line>
    </group>
  );
}

/**
 * Grid shown while a sketch is active — aligned to the sketch plane.
 *
 * Uses THREE.GridHelper (line-based, no shader tricks) so it renders correctly
 * for every orientation including vertical planes (XZ, YZ).
 *
 * GridHelper lies in the Three.js XZ ground plane (Y-normal) by default.
 * We wrap it in a <group> and rotate to match our sketch-plane conventions:
 *   XY  horizontal, Y-normal    → group rotation [0,     0, 0    ]  (no change)
 *   XZ  vertical front, Z-normal → group rotation [-PI/2, 0, 0    ]  (Y→Z)
 *   YZ  vertical side,  X-normal → group rotation [0,     0, PI/2 ]  (Y→-X)
 */
function SketchPlaneGrid({ plane }: { plane: 'XY' | 'XZ' | 'YZ' }) {
  const themeColors = useThemeStore((s) => s.colors);

  // 1000-unit grid, 100 divisions → 10-unit major cells (matching section grid of GroundPlaneGrid)
  const helper = useMemo(
    () => new THREE.GridHelper(1000, 100, themeColors.gridSection, themeColors.gridCell),
    [themeColors.gridSection, themeColors.gridCell],
  );

  // Dispose GPU resources when the component unmounts or helper is recreated
  useEffect(() => {
    return () => {
      helper.geometry.dispose();
      const mats = Array.isArray(helper.material) ? helper.material : [helper.material];
      (mats as THREE.Material[]).forEach((m) => m.dispose());
    };
  }, [helper]);

  const groupRotation: [number, number, number] =
    plane === 'XZ' ? [-Math.PI / 2, 0, 0] :
    plane === 'YZ' ? [0,            0, Math.PI / 2] :
    [0, 0, 0]; // XY

  return (
    <group rotation={groupRotation}>
      <primitive object={helper} />
    </group>
  );
}

/** Infinite ground-plane grid with fading (shown in 3-D mode only) */
function GroundPlaneGrid() {
  const themeColors = useThemeStore((s) => s.colors);

  return (
    <Grid
      args={[300, 300]}
      cellSize={1}
      cellThickness={0.5}
      cellColor={themeColors.gridCell}
      sectionSize={10}
      sectionThickness={1}
      sectionColor={themeColors.gridSection}
      fadeDistance={200}
      fadeStrength={1.5}
      fadeFrom={0}
      followCamera={false}
      infiniteGrid
    />
  );
}

/** Interactive plane selection for "Create Sketch" — shows 3 origin planes the user can click */
function SketchPlaneSelector() {
  const selecting = useCADStore((s) => s.sketchPlaneSelecting);
  const startSketch = useCADStore((s) => s.startSketch);
  const setSketchPlaneSelecting = useCADStore((s) => s.setSketchPlaneSelecting);
  const [hovered, setHovered] = useState<string | null>(null);
  const { gl } = useThree();

  // Change cursor when hovering a plane
  useEffect(() => {
    if (!selecting) return;
    gl.domElement.style.cursor = hovered ? 'pointer' : 'crosshair';
    return () => { gl.domElement.style.cursor = 'auto'; };
  }, [selecting, hovered, gl]);

  // Escape to cancel
  useEffect(() => {
    if (!selecting) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSketchPlaneSelecting(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selecting, setSketchPlaneSelecting]);

  if (!selecting) return null;

  const PLANE_SIZE = 40;
  const HALF_PS = PLANE_SIZE / 2;

  const planes: { id: string; plane: 'XY' | 'XZ' | 'YZ'; color: string; hoverColor: string; position: [number, number, number]; rotation: [number, number, number]; labelPos: [number, number, number]; }[] = [
    {
      id: 'xy', plane: 'XY',
      color: '#4488ff', hoverColor: '#66aaff',
      position: [0, 0, 0],
      rotation: [-Math.PI / 2, 0, 0],
      labelPos: [HALF_PS + 3, 0, HALF_PS + 3],
    },
    {
      id: 'xz', plane: 'XZ',
      color: '#44cc44', hoverColor: '#66ee66',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      labelPos: [HALF_PS + 3, HALF_PS + 3, 0],
    },
    {
      id: 'yz', plane: 'YZ',
      color: '#ff4444', hoverColor: '#ff6666',
      position: [0, 0, 0],
      rotation: [0, Math.PI / 2, 0],
      labelPos: [0, HALF_PS + 3, HALF_PS + 3],
    },
  ];

  return (
    <group>
      {planes.map((p) => {
        const isHovered = hovered === p.id;
        return (
          <group key={p.id}>
            {/* Clickable plane */}
            <mesh
              position={p.position}
              rotation={p.rotation}
              onPointerOver={(e) => { e.stopPropagation(); setHovered(p.id); }}
              onPointerOut={(e) => { e.stopPropagation(); setHovered(null); }}
              onClick={(e) => { e.stopPropagation(); startSketch(p.plane); }}
            >
              <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
              <meshBasicMaterial
                color={isHovered ? p.hoverColor : p.color}
                transparent
                opacity={isHovered ? 0.35 : 0.15}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>

            {/* Plane border */}
            <lineLoop
              position={p.position}
              rotation={p.rotation}
            >
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  args={[new Float32Array([
                    -HALF_PS, -HALF_PS, 0,
                     HALF_PS, -HALF_PS, 0,
                     HALF_PS,  HALF_PS, 0,
                    -HALF_PS,  HALF_PS, 0,
                  ]), 3]}
                />
              </bufferGeometry>
              <lineBasicMaterial
                color={isHovered ? p.hoverColor : p.color}
                transparent
                opacity={isHovered ? 0.8 : 0.4}
              />
            </lineLoop>
          </group>
        );
      })}
    </group>
  );
}

function CameraController({ onQuaternionChange }: { onQuaternionChange: (q: THREE.Quaternion) => void }) {
  const { camera, controls } = useThree();
  const cameraHomeCounter = useCADStore((s) => s.cameraHomeCounter);
  const cameraTargetQuaternion = useCADStore((s) => s.cameraTargetQuaternion);
  const setCameraTargetQuaternion = useCADStore((s) => s.setCameraTargetQuaternion);
  const animatingRef = useRef(false);
  const animProgressRef = useRef(0);
  const startQuatRef = useRef(new THREE.Quaternion());
  const targetQuatRef = useRef(new THREE.Quaternion());
  // Stable scratch objects — reused every frame to avoid per-frame GC pressure
  const _q = useRef(new THREE.Quaternion());
  const _dir = useRef(new THREE.Vector3());
  const _target = useRef(new THREE.Vector3());

  // Home button
  useEffect(() => {
    if (cameraHomeCounter === 0) return;
    const target = new THREE.Vector3(0, 0, 0);
    camera.position.set(50, 50, 50);
    camera.lookAt(target);
    const orbitControls = controls as any;
    if (orbitControls?.target) {
      orbitControls.target.copy(target);
      orbitControls.update();
    }
  }, [cameraHomeCounter, camera, controls]);

  // Start animation when a target quaternion is set (ViewCube click)
  useEffect(() => {
    if (!cameraTargetQuaternion) return;
    startQuatRef.current.copy(camera.quaternion);
    targetQuatRef.current.copy(cameraTargetQuaternion);
    animProgressRef.current = 0;
    animatingRef.current = true;
    setCameraTargetQuaternion(null);
  }, [cameraTargetQuaternion, camera, setCameraTargetQuaternion]);

  useFrame((_, delta) => {
    // Emit current quaternion every frame for the ViewCube overlay
    onQuaternionChange(camera.quaternion);

    // Smooth camera animation
    if (!animatingRef.current) return;
    animProgressRef.current = Math.min(animProgressRef.current + delta * 3.0, 1);
    const t = 1 - Math.pow(1 - animProgressRef.current, 3); // ease-out cubic

    // Slerp camera quaternion — reuse scratch refs, no per-frame allocation
    _q.current.slerpQuaternions(startQuatRef.current, targetQuatRef.current, t);

    // Compute new camera position: keep distance, new orientation
    const orbitControls = controls as any;
    if (orbitControls?.target) {
      _target.current.copy(orbitControls.target as THREE.Vector3);
    } else {
      _target.current.set(0, 0, 0);
    }
    const distance = camera.position.distanceTo(_target.current);
    _dir.current.set(0, 0, 1).applyQuaternion(_q.current).normalize();
    camera.position.copy(_target.current).add(_dir.current.multiplyScalar(distance));
    camera.quaternion.copy(_q.current);

    if (orbitControls?.update) {
      orbitControls.update();
    }

    if (animProgressRef.current >= 1) {
      animatingRef.current = false;
    }
  });

  return null;
}

export default function Viewport() {
  const viewMode = useCADStore((s) => s.viewMode);
  const gridVisible = useCADStore((s) => s.gridVisible);
  const activeSketch = useCADStore((s) => s.activeSketch);
  const showEnvironment = useCADStore((s) => s.showEnvironment);
  const showShadows = useCADStore((s) => s.showShadows);
  const showGroundPlane = useCADStore((s) => s.showGroundPlane);
  const setCameraTargetQuaternion = useCADStore((s) => s.setCameraTargetQuaternion);
  const themeColors = useThemeStore((s) => s.colors);

  // Camera quaternion state shared between the main Canvas and the ViewCube overlay
  const [camQuat, setCamQuat] = useState(() => new THREE.Quaternion());
  const quatRef = useRef(new THREE.Quaternion());

  const handleQuaternionChange = useCallback((q: THREE.Quaternion) => {
    // Only trigger a React re-render ~10 times per second to avoid excessive updates
    if (!quatRef.current.equals(q)) {
      quatRef.current.copy(q);
    }
  }, []);

  // Throttled sync from ref to state for the ViewCube overlay.
  // Uses functional setState so camQuat is NOT needed as a dep — avoids
  // the infinite loop: camQuat change → effect re-runs → new interval → camQuat changes…
  useEffect(() => {
    const id = setInterval(() => {
      setCamQuat((prev) =>
        quatRef.current.equals(prev) ? prev : quatRef.current.clone()
      );
    }, 100);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleViewCubeOrient = useCallback((targetQ: THREE.Quaternion) => {
    setCameraTargetQuaternion(targetQ);
  }, [setCameraTargetQuaternion]);

  return (
    <div style={{ width: '100%', height: '100%', background: themeColors.canvasBg, position: 'relative' }}>
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        camera={{
          position: [50, 50, 50],
          fov: 45,
          near: 0.1,
          far: 10000,
        }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => {
          gl.setClearColor(themeColors.canvasBg);
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.2;
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Sync scene background with theme */}
        <SceneTheme />

        {/* Lighting */}
        <ambientLight intensity={0.4} />
        <directionalLight
          position={[50, 80, 50]}
          intensity={1.2}
          castShadow
          shadow-mapSize={[2048, 2048]}
        />
        <directionalLight position={[-30, 40, -20]} intensity={0.5} />
        <hemisphereLight
          color={themeColors.hemisphereColor}
          groundColor={themeColors.hemisphereGround}
          intensity={0.3}
        />

        {/* Environment */}
        {showEnvironment && <Environment preset="studio" background={false} />}
        {showShadows && showGroundPlane && (
          <ContactShadows
            position={[0, -0.01, 0]}
            opacity={0.3}
            scale={100}
            blur={2}
          />
        )}

        {/* Axis lines — always visible (X=red, Y=blue, Z=green) */}
        <WorldAxes />

        {/* World grid — hidden during active sketch (replaced by sketch-plane grid) */}
        {gridVisible && !activeSketch && <GroundPlaneGrid />}

        {/* Sketch-plane grid — shown only while a sketch is active */}
        {activeSketch && <SketchPlaneGrid plane={activeSketch.plane} />}

        {/* Plane selection for Create Sketch */}
        <SketchPlaneSelector />

        {/* CAD Content */}
        <SketchRenderer />
        <ExtrudedBodies />
        <ImportedModels />
        <SketchPlaneIndicator />
        <SketchInteraction />

        {/* Camera controller — also feeds quaternion to ViewCube */}
        <CameraController onQuaternionChange={handleQuaternionChange} />

        {/* Controls */}
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.1}
          enabled={true}
          mouseButtons={{
            LEFT: viewMode === 'sketch' ? undefined : THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN,
          }}
        />

        {/* Shift + Middle-click pan (in addition to right-click pan) */}
        <ShiftMiddlePan />
      </Canvas>

      {/* ViewCube overlay (top-right) */}
      <ViewCube
        mainCameraQuaternion={camQuat}
        onOrient={handleViewCubeOrient}
        onHome={() => useCADStore.getState().triggerCameraHome()}
      />

      {/* Canvas Controls bar (bottom-right, Fusion 360 style) */}
      <CanvasControls />

      {/* ToolPanel removed — sketch options handled by SketchPalette */}

      {/* Sketch Palette (Fusion 360 style options panel) */}
      <SketchPalette />
    </div>
  );
}
