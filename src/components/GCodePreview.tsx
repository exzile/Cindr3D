import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html, Line, Grid } from '@react-three/drei';
import { useSlicerStore } from '../store/slicerStore';
import type { SliceLayer, SliceMove } from '../types/slicer';

// ---------------------------------------------------------------------------
// Color constants
// ---------------------------------------------------------------------------

const MOVE_TYPE_COLORS: Record<SliceMove['type'], string> = {
  'wall-outer': '#4fc3f7',
  'wall-inner': '#29b6f6',
  infill: '#ff9800',
  'top-bottom': '#ffeb3b',
  support: '#4caf50',
  skirt: '#9c27b0',
  brim: '#9c27b0',
  raft: '#795548',
  bridge: '#f44336',
  travel: '#444444',
  ironing: '#e91e63',
};

const MOVE_TYPE_LABELS: Record<SliceMove['type'], string> = {
  'wall-outer': 'Outer Wall',
  'wall-inner': 'Inner Wall',
  infill: 'Infill',
  'top-bottom': 'Top / Bottom',
  support: 'Support',
  skirt: 'Skirt',
  brim: 'Brim',
  raft: 'Raft',
  bridge: 'Bridge',
  travel: 'Travel',
  ironing: 'Ironing',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lerpColor(a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
  return a.clone().lerp(b, t);
}

const SPEED_LOW_COLOR = new THREE.Color('#2196f3');
const SPEED_HIGH_COLOR = new THREE.Color('#f44336');
const FLOW_LOW_COLOR = new THREE.Color('#2196f3');
const FLOW_HIGH_COLOR = new THREE.Color('#f44336');

/**
 * Compute the speed or flow range across all visible layers so gradient is
 * consistent.
 */
function computeRange(
  layers: SliceLayer[],
  maxLayer: number,
  field: 'speed' | 'extrusion',
): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i <= maxLayer && i < layers.length; i++) {
    for (const move of layers[i].moves) {
      if (move.type === 'travel') continue;
      const val = move[field];
      if (val < min) min = val;
      if (val > max) max = val;
    }
  }
  if (!isFinite(min)) return [0, 1];
  if (min === max) return [min, min + 1];
  return [min, max];
}

function getMoveColor(
  move: SliceMove,
  colorMode: 'type' | 'speed' | 'flow',
  range: [number, number],
): THREE.Color {
  if (colorMode === 'type') {
    return new THREE.Color(MOVE_TYPE_COLORS[move.type] ?? '#888888');
  }

  if (colorMode === 'speed') {
    const t = Math.max(0, Math.min(1, (move.speed - range[0]) / (range[1] - range[0])));
    return lerpColor(SPEED_LOW_COLOR, SPEED_HIGH_COLOR, t);
  }

  // flow
  const t = Math.max(0, Math.min(1, (move.extrusion - range[0]) / (range[1] - range[0])));
  return lerpColor(FLOW_LOW_COLOR, FLOW_HIGH_COLOR, t);
}

// ---------------------------------------------------------------------------
// Per-layer geometry builder: batches all moves of compatible types into a
// single BufferGeometry with vertex colors. Travel moves are built separately.
// ---------------------------------------------------------------------------

interface LayerGeometryData {
  /** Extrusion segments (non-travel) */
  extrusionPositions: Float32Array;
  extrusionColors: Float32Array;
  /** Travel segments */
  travelPositions: Float32Array;
  /** Retraction points (where extrusion is negative / travel with retraction) */
  retractionPoints: Float32Array;
}

function buildLayerGeometry(
  layer: SliceLayer,
  colorMode: 'type' | 'speed' | 'flow',
  range: [number, number],
): LayerGeometryData {
  const extPosArr: number[] = [];
  const extColArr: number[] = [];
  const travPosArr: number[] = [];
  const retractPts: number[] = [];

  const z = layer.z;

  for (const move of layer.moves) {
    if (move.type === 'travel') {
      travPosArr.push(move.from.x, move.from.y, z, move.to.x, move.to.y, z);
      // Detect retraction: travel move with negative or zero extrusion coming
      // after extrusion is a retraction point.
      if (move.extrusion < 0) {
        retractPts.push(move.from.x, move.from.y, z);
      }
    } else {
      const color = getMoveColor(move, colorMode, range);
      extPosArr.push(move.from.x, move.from.y, z, move.to.x, move.to.y, z);
      extColArr.push(color.r, color.g, color.b, color.r, color.g, color.b);
    }
  }

  return {
    extrusionPositions: new Float32Array(extPosArr),
    extrusionColors: new Float32Array(extColArr),
    travelPositions: new Float32Array(travPosArr),
    retractionPoints: new Float32Array(retractPts),
  };
}

// ---------------------------------------------------------------------------
// LayerMesh -- renders a single layer's extrusion lines
// ---------------------------------------------------------------------------

interface LayerMeshProps {
  data: LayerGeometryData;
  opacity: number;
  showTravel: boolean;
  showRetractions: boolean;
}

const LayerMesh = React.memo(function LayerMesh({
  data,
  opacity,
  showTravel,
  showRetractions,
}: LayerMeshProps) {
  const extGeoRef = useRef<THREE.BufferGeometry>(null);
  const travGeoRef = useRef<THREE.BufferGeometry>(null);
  const retGeoRef = useRef<THREE.BufferGeometry>(null);

  // Build extrusion geometry
  const extGeo = useMemo(() => {
    if (data.extrusionPositions.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.extrusionPositions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(data.extrusionColors, 3));
    return geo;
  }, [data.extrusionPositions, data.extrusionColors]);

  // Build travel geometry
  const travGeo = useMemo(() => {
    if (data.travelPositions.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.travelPositions, 3));
    return geo;
  }, [data.travelPositions]);

  // Build retraction points geometry
  const retGeo = useMemo(() => {
    if (data.retractionPoints.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.retractionPoints, 3));
    return geo;
  }, [data.retractionPoints]);

  return (
    <group>
      {/* Extrusion lines */}
      {extGeo && (
        <lineSegments geometry={extGeo}>
          <lineBasicMaterial
            vertexColors
            transparent={opacity < 1}
            opacity={opacity}
            depthWrite={opacity >= 1}
            linewidth={1}
          />
        </lineSegments>
      )}

      {/* Travel lines */}
      {showTravel && travGeo && (
        <lineSegments geometry={travGeo}>
          <lineDashedMaterial
            color="#444444"
            dashSize={1}
            gapSize={0.5}
            transparent
            opacity={opacity * 0.5}
            depthWrite={false}
            linewidth={1}
          />
        </lineSegments>
      )}

      {/* Retraction points */}
      {showRetractions && retGeo && (
        <points geometry={retGeo}>
          <pointsMaterial
            color="#f44336"
            size={0.6}
            sizeAttenuation
            transparent
            opacity={opacity}
            depthWrite={false}
          />
        </points>
      )}
    </group>
  );
});

// ---------------------------------------------------------------------------
// Build plate and build volume wireframe
// ---------------------------------------------------------------------------

interface BuildPlateProps {
  volumeX: number;
  volumeY: number;
  volumeZ: number;
  originCenter: boolean;
}

function BuildPlate({ volumeX, volumeY, volumeZ, originCenter }: BuildPlateProps) {
  const offsetX = originCenter ? 0 : volumeX / 2;
  const offsetY = originCenter ? 0 : volumeY / 2;

  return (
    <group position={[offsetX, offsetY, 0]}>
      {/* Grid on bed */}
      <Grid
        args={[volumeX, volumeY]}
        cellSize={10}
        cellThickness={0.5}
        cellColor="#555555"
        sectionSize={50}
        sectionThickness={1}
        sectionColor="#888888"
        fadeDistance={1000}
        fadeStrength={0}
        infiniteGrid={false}
        position={[0, 0, 0]}
        rotation={[0, 0, 0]}
      />

      {/* Build volume wireframe */}
      <lineSegments>
        <edgesGeometry
          args={[new THREE.BoxGeometry(volumeX, volumeY, volumeZ)]}
        />
        <lineBasicMaterial color="#666666" transparent opacity={0.3} />
      </lineSegments>
      {/* Shift box so bottom is at z=0 */}
      <mesh visible={false}>
        <boxGeometry args={[volumeX, volumeY, volumeZ]} />
      </mesh>
    </group>
  );
}

// Rewrite BuildPlate to position the wireframe box correctly (bottom at z=0):
function BuildVolume({ volumeX, volumeY, volumeZ, originCenter }: BuildPlateProps) {
  const offsetX = originCenter ? 0 : volumeX / 2;
  const offsetY = originCenter ? 0 : volumeY / 2;

  const boxGeo = useMemo(
    () => new THREE.BoxGeometry(volumeX, volumeY, volumeZ),
    [volumeX, volumeY, volumeZ],
  );

  return (
    <group position={[offsetX, offsetY, 0]}>
      {/* Grid on bed */}
      <Grid
        args={[volumeX, volumeY]}
        cellSize={10}
        cellThickness={0.5}
        cellColor="#555555"
        sectionSize={50}
        sectionThickness={1}
        sectionColor="#888888"
        fadeDistance={1000}
        fadeStrength={0}
        infiniteGrid={false}
      />

      {/* Build volume wireframe -- shifted up so bottom = z 0 */}
      <group position={[0, 0, volumeZ / 2]}>
        <lineSegments>
          <edgesGeometry args={[boxGeo]} />
          <lineBasicMaterial color="#666666" transparent opacity={0.25} />
        </lineSegments>
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Current layer height indicator
// ---------------------------------------------------------------------------

function LayerHeightIndicator({
  z,
  sizeX,
  sizeY,
  originCenter,
}: {
  z: number;
  sizeX: number;
  sizeY: number;
  originCenter: boolean;
}) {
  const offsetX = originCenter ? 0 : sizeX / 2;
  const offsetY = originCenter ? 0 : sizeY / 2;

  const points = useMemo(
    () => [
      new THREE.Vector3(-sizeX / 2 + offsetX, -sizeY / 2 + offsetY, z),
      new THREE.Vector3(sizeX / 2 + offsetX, -sizeY / 2 + offsetY, z),
      new THREE.Vector3(sizeX / 2 + offsetX, sizeY / 2 + offsetY, z),
      new THREE.Vector3(-sizeX / 2 + offsetX, sizeY / 2 + offsetY, z),
      new THREE.Vector3(-sizeX / 2 + offsetX, -sizeY / 2 + offsetY, z),
    ],
    [z, sizeX, sizeY, offsetX, offsetY],
  );

  return (
    <Line
      points={points}
      color="#ff5722"
      lineWidth={1}
      transparent
      opacity={0.5}
      dashed={false}
    />
  );
}

// ---------------------------------------------------------------------------
// Legend overlay (HTML)
// ---------------------------------------------------------------------------

interface LegendProps {
  colorMode: 'type' | 'speed' | 'flow';
  currentLayer: number;
  currentZ: number;
  layerTime: number;
  range: [number, number];
}

function Legend({ colorMode, currentLayer, currentZ, layerTime, range }: LegendProps) {
  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds.toFixed(0)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  return (
    <Html
      position={[0, 0, 0]}
      style={{
        position: 'fixed',
        bottom: '16px',
        left: '16px',
        pointerEvents: 'none',
        zIndex: 10,
      }}
      transform={false}
      calculatePosition={() => [16, 16]}
    >
      <div
        style={{
          background: 'rgba(30, 30, 30, 0.9)',
          borderRadius: '8px',
          padding: '12px 16px',
          color: '#e0e0e0',
          fontFamily: 'monospace',
          fontSize: '12px',
          minWidth: '160px',
          userSelect: 'none',
          border: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        {/* Layer info */}
        <div style={{ marginBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.15)', paddingBottom: '6px' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>
            Layer {currentLayer}
          </div>
          <div>Z: {currentZ.toFixed(2)} mm</div>
          <div>Layer time: {formatTime(layerTime)}</div>
        </div>

        {/* Color legend */}
        {colorMode === 'type' && (
          <div>
            {(Object.keys(MOVE_TYPE_COLORS) as SliceMove['type'][]).map((type) => (
              <div
                key={type}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginBottom: '2px',
                }}
              >
                <div
                  style={{
                    width: '12px',
                    height: '3px',
                    backgroundColor: MOVE_TYPE_COLORS[type],
                    borderRadius: '1px',
                    flexShrink: 0,
                  }}
                />
                <span>{MOVE_TYPE_LABELS[type]}</span>
              </div>
            ))}
          </div>
        )}

        {colorMode === 'speed' && (
          <div>
            <div style={{ marginBottom: '4px', fontWeight: 'bold' }}>Speed</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>{range[0].toFixed(0)}</span>
              <div
                style={{
                  flex: 1,
                  height: '8px',
                  borderRadius: '4px',
                  background: `linear-gradient(to right, #2196f3, #f44336)`,
                }}
              />
              <span>{range[1].toFixed(0)}</span>
            </div>
            <div style={{ textAlign: 'center', fontSize: '10px', opacity: 0.7 }}>mm/s</div>
          </div>
        )}

        {colorMode === 'flow' && (
          <div>
            <div style={{ marginBottom: '4px', fontWeight: 'bold' }}>Flow (extrusion)</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>{range[0].toFixed(3)}</span>
              <div
                style={{
                  flex: 1,
                  height: '8px',
                  borderRadius: '4px',
                  background: `linear-gradient(to right, #2196f3, #f44336)`,
                }}
              />
              <span>{range[1].toFixed(3)}</span>
            </div>
            <div style={{ textAlign: 'center', fontSize: '10px', opacity: 0.7 }}>mm</div>
          </div>
        )}
      </div>
    </Html>
  );
}

// ---------------------------------------------------------------------------
// Main GCodePreview component
// ---------------------------------------------------------------------------

export function GCodePreview() {
  const sliceResult = useSlicerStore((s) => s.sliceResult);
  const previewLayer = useSlicerStore((s) => s.previewLayer);
  const showTravel = useSlicerStore((s) => s.previewShowTravel);
  const showRetractions = useSlicerStore((s) => s.previewShowRetractions);
  const colorMode = useSlicerStore((s) => s.previewColorMode);
  const getActivePrinterProfile = useSlicerStore((s) => s.getActivePrinterProfile);

  const printer = getActivePrinterProfile();
  const buildX = printer?.buildVolume?.x ?? 220;
  const buildY = printer?.buildVolume?.y ?? 220;
  const buildZ = printer?.buildVolume?.z ?? 250;
  const originCenter = printer?.originCenter ?? false;

  const layers = sliceResult?.layers ?? [];

  // Compute range for speed/flow color modes across all visible layers
  const colorRange = useMemo<[number, number]>(() => {
    if (colorMode === 'type') return [0, 1];
    const field = colorMode === 'speed' ? 'speed' : 'extrusion';
    return computeRange(layers, previewLayer, field);
  }, [layers, previewLayer, colorMode]);

  // Build per-layer geometry data. Memoize per layer + colorMode + range so
  // geometry does not rebuild every frame. We cache ALL layers up to the max
  // layer count so scrolling through layers is cheap.
  const layerGeometries = useMemo(() => {
    return layers.map((layer) => buildLayerGeometry(layer, colorMode, colorRange));
  }, [layers, colorMode, colorRange]);

  // Current layer info for legend
  const currentLayerData = layers[previewLayer];
  const currentZ = currentLayerData?.z ?? 0;
  const layerTime = currentLayerData?.layerTime ?? 0;

  if (!sliceResult || layers.length === 0) {
    return (
      <group>
        <BuildVolume
          volumeX={buildX}
          volumeY={buildY}
          volumeZ={buildZ}
          originCenter={originCenter}
        />
      </group>
    );
  }

  return (
    <group>
      {/* Build plate and volume */}
      <BuildVolume
        volumeX={buildX}
        volumeY={buildY}
        volumeZ={buildZ}
        originCenter={originCenter}
      />

      {/* Layer height indicator */}
      <LayerHeightIndicator
        z={currentZ}
        sizeX={buildX}
        sizeY={buildY}
        originCenter={originCenter}
      />

      {/* Rendered layers */}
      {layerGeometries.map((data, idx) => {
        if (idx > previewLayer) return null;
        const isCurrentLayer = idx === previewLayer;
        const opacity = isCurrentLayer ? 1.0 : 0.3;

        return (
          <LayerMesh
            key={idx}
            data={data}
            opacity={opacity}
            showTravel={showTravel && isCurrentLayer}
            showRetractions={showRetractions && isCurrentLayer}
          />
        );
      })}

      {/* Legend overlay */}
      <Legend
        colorMode={colorMode}
        currentLayer={previewLayer}
        currentZ={currentZ}
        layerTime={layerTime}
        range={colorRange}
      />
    </group>
  );
}

export default GCodePreview;
