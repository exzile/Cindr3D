import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import './DuetHeightMap.css';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import {
  RefreshCw,
  Crosshair,
  Loader2,
  BarChart3,
  Grid3x3,
  Download,
  Save,
  ToggleLeft,
  ToggleRight,
  FolderOpen,
  GitCompareArrows,
  X,
} from 'lucide-react';
import * as THREE from 'three';
import { usePrinterStore } from '../../store/printerStore';
import type { DuetHeightMap as HeightMapData } from '../../types/duet';

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function deviationColor(value: number, minVal: number, maxVal: number): string {
  // Clamp to range and normalize to -1..1
  const range = Math.max(Math.abs(minVal), Math.abs(maxVal), 0.001);
  const t = Math.max(-1, Math.min(1, value / range));

  if (t < 0) {
    // Negative: blue (low) -> green (0)
    const f = 1 + t; // 0..1
    const r = Math.round(0 * (1 - f) + 34 * f);
    const g = Math.round(100 * (1 - f) + 197 * f);
    const b = Math.round(255 * (1 - f) + 94 * f);
    return `rgb(${r},${g},${b})`;
  } else {
    // Positive: green (0) -> red (high)
    const f = t; // 0..1
    const r = Math.round(34 * (1 - f) + 239 * f);
    const g = Math.round(197 * (1 - f) + 68 * f);
    const b = Math.round(94 * (1 - f) + 68 * f);
    return `rgb(${r},${g},${b})`;
  }
}

function deviationColorThree(value: number, minVal: number, maxVal: number): THREE.Color {
  const range = Math.max(Math.abs(minVal), Math.abs(maxVal), 0.001);
  const t = Math.max(-1, Math.min(1, value / range));

  if (t < 0) {
    const f = 1 + t;
    return new THREE.Color(
      (0 * (1 - f) + 34 * f) / 255,
      (100 * (1 - f) + 197 * f) / 255,
      (255 * (1 - f) + 94 * f) / 255,
    );
  } else {
    const f = t;
    return new THREE.Color(
      (34 * (1 - f) + 239 * f) / 255,
      (197 * (1 - f) + 68 * f) / 255,
      (94 * (1 - f) + 68 * f) / 255,
    );
  }
}

// ---------------------------------------------------------------------------
// Diverging color scale for comparison (blue = lower, red = higher)
// ---------------------------------------------------------------------------

function divergingColor(value: number, minVal: number, maxVal: number): string {
  const range = Math.max(Math.abs(minVal), Math.abs(maxVal), 0.001);
  const t = Math.max(-1, Math.min(1, value / range));

  if (t < 0) {
    // Negative: white (0) -> blue (low)
    const f = -t; // 0..1
    const r = Math.round(255 * (1 - f) + 59 * f);
    const g = Math.round(255 * (1 - f) + 130 * f);
    const b = Math.round(255 * (1 - f) + 246 * f);
    return `rgb(${r},${g},${b})`;
  } else {
    // Positive: white (0) -> red (high)
    const f = t; // 0..1
    const r = Math.round(255 * (1 - f) + 239 * f);
    const g = Math.round(255 * (1 - f) + 68 * f);
    const b = Math.round(255 * (1 - f) + 68 * f);
    return `rgb(${r},${g},${b})`;
  }
}

function divergingColorThree(value: number, minVal: number, maxVal: number): THREE.Color {
  const range = Math.max(Math.abs(minVal), Math.abs(maxVal), 0.001);
  const t = Math.max(-1, Math.min(1, value / range));

  if (t < 0) {
    const f = -t;
    return new THREE.Color(
      (255 * (1 - f) + 59 * f) / 255,
      (255 * (1 - f) + 130 * f) / 255,
      (255 * (1 - f) + 246 * f) / 255,
    );
  } else {
    const f = t;
    return new THREE.Color(
      (255 * (1 - f) + 239 * f) / 255,
      (255 * (1 - f) + 68 * f) / 255,
      (255 * (1 - f) + 68 * f) / 255,
    );
  }
}

// ---------------------------------------------------------------------------
// Height map differencing
// ---------------------------------------------------------------------------

function computeDiffMap(map1: HeightMapData, map2: HeightMapData): HeightMapData | null {
  // Maps must have the same grid dimensions
  if (map1.numX !== map2.numX || map1.numY !== map2.numY) return null;

  const diffPoints: number[][] = [];
  for (let y = 0; y < map1.numY; y++) {
    const row: number[] = [];
    for (let x = 0; x < map1.numX; x++) {
      const v1 = map1.points[y]?.[x] ?? 0;
      const v2 = map2.points[y]?.[x] ?? 0;
      row.push(v2 - v1);
    }
    diffPoints.push(row);
  }

  return {
    ...map1,
    points: diffPoints,
  };
}

// ---------------------------------------------------------------------------
// Statistics computation
// ---------------------------------------------------------------------------

interface HeightMapStats {
  min: number;
  max: number;
  mean: number;
  rms: number;
  probePoints: number;
  gridDimensions: string;
}

function computeStats(hm: HeightMapData): HeightMapStats {
  const allPoints: number[] = [];
  for (let y = 0; y < hm.numY; y++) {
    for (let x = 0; x < hm.numX; x++) {
      const val = hm.points[y]?.[x];
      if (val !== undefined && !isNaN(val)) {
        allPoints.push(val);
      }
    }
  }

  if (allPoints.length === 0) {
    return { min: 0, max: 0, mean: 0, rms: 0, probePoints: 0, gridDimensions: `${hm.numX}x${hm.numY}` };
  }

  const min = Math.min(...allPoints);
  const max = Math.max(...allPoints);
  const sum = allPoints.reduce((a, b) => a + b, 0);
  const mean = sum / allPoints.length;
  const rms = Math.sqrt(allPoints.reduce((a, b) => a + b * b, 0) / allPoints.length);

  return {
    min,
    max,
    mean,
    rms,
    probePoints: allPoints.length,
    gridDimensions: `${hm.numX} x ${hm.numY}`,
  };
}

// ---------------------------------------------------------------------------
// 3D Surface Mesh
// ---------------------------------------------------------------------------

function HeightMapMesh({ heightMap, diverging = false }: { heightMap: HeightMapData; diverging?: boolean }) {
  const { geometry } = useMemo(() => {
    const s = computeStats(heightMap);
    const geo = new THREE.BufferGeometry();

    const vertices: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    const xRange = heightMap.xMax - heightMap.xMin;
    const yRange = heightMap.yMax - heightMap.yMin;
    const scaleXY = 1 / Math.max(xRange, yRange, 1);
    // Exaggerate Z for visibility (scale relative to XY range)
    const zScale = (1 / Math.max(Math.abs(s.max), Math.abs(s.min), 0.01)) * 0.3;

    const colorFn = diverging ? divergingColorThree : deviationColorThree;

    for (let yi = 0; yi < heightMap.numY; yi++) {
      for (let xi = 0; xi < heightMap.numX; xi++) {
        const val = heightMap.points[yi]?.[xi] ?? 0;
        const x = (heightMap.xMin + xi * heightMap.xSpacing) * scaleXY - 0.5;
        const y = (heightMap.yMin + yi * heightMap.ySpacing) * scaleXY - 0.5;
        const z = val * zScale;

        vertices.push(x, z, -y); // Y-up coordinate system

        const color = colorFn(val, s.min, s.max);
        colors.push(color.r, color.g, color.b);
      }
    }

    for (let yi = 0; yi < heightMap.numY - 1; yi++) {
      for (let xi = 0; xi < heightMap.numX - 1; xi++) {
        const a = yi * heightMap.numX + xi;
        const b = a + 1;
        const c = a + heightMap.numX;
        const d = c + 1;
        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    return { geometry: geo, stats: s };
  }, [heightMap, diverging]);

  // Dispose previous BufferGeometry when heightMap data changes (re-upload) or
  // when the component unmounts. Without this each re-bed-mesh leaks one geo.
  useEffect(() => () => { geometry.dispose(); }, [geometry]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} flatShading />
    </mesh>
  );
}

function GridOverlay({ heightMap }: { heightMap: HeightMapData }) {
  const lines = useMemo(() => {
    const xRange = heightMap.xMax - heightMap.xMin;
    const yRange = heightMap.yMax - heightMap.yMin;
    const scale = 1 / Math.max(xRange, yRange, 1);
    const pts: THREE.Vector3[] = [];

    // X-direction lines
    for (let yi = 0; yi < heightMap.numY; yi++) {
      for (let xi = 0; xi < heightMap.numX; xi++) {
        const x = (heightMap.xMin + xi * heightMap.xSpacing) * scale - 0.5;
        const y = (heightMap.yMin + yi * heightMap.ySpacing) * scale - 0.5;
        pts.push(new THREE.Vector3(x, -0.001, -y));
        if (xi < heightMap.numX - 1) {
          const nx = (heightMap.xMin + (xi + 1) * heightMap.xSpacing) * scale - 0.5;
          pts.push(new THREE.Vector3(nx, -0.001, -y));
        }
      }
    }
    // Y-direction lines
    for (let xi = 0; xi < heightMap.numX; xi++) {
      for (let yi = 0; yi < heightMap.numY; yi++) {
        const x = (heightMap.xMin + xi * heightMap.xSpacing) * scale - 0.5;
        const y = (heightMap.yMin + yi * heightMap.ySpacing) * scale - 0.5;
        pts.push(new THREE.Vector3(x, -0.001, -y));
        if (yi < heightMap.numY - 1) {
          const ny = (heightMap.yMin + (yi + 1) * heightMap.ySpacing) * scale - 0.5;
          pts.push(new THREE.Vector3(x, -0.001, -ny));
        }
      }
    }

    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    return geo;
  }, [heightMap]);

  // Same disposal contract as HeightMapMesh — drop the prior grid geometry
  // when heightMap reloads or the component unmounts.
  useEffect(() => () => { lines.dispose(); }, [lines]);

  return (
    <lineSegments geometry={lines}>
      <lineBasicMaterial color="#666" opacity={0.3} transparent />
    </lineSegments>
  );
}

function AxisLabels() {
  return (
    <group>
      <Text position={[0.6, 0, 0]} fontSize={0.05} color="#ef4444">
        X
      </Text>
      <Text position={[0, 0, 0.6]} fontSize={0.05} color="#22c55e">
        Y
      </Text>
      <Text position={[0, 0.4, 0]} fontSize={0.05} color="#3b82f6">
        Z
      </Text>
    </group>
  );
}

function Scene3D({ heightMap, diverging = false }: { heightMap: HeightMapData; diverging?: boolean }) {
  return (
    <Canvas
      camera={{ position: [0.8, 0.6, 0.8], fov: 50 }}
      style={{ width: '100%', height: '100%' }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 5, 5]} intensity={0.8} />
      <directionalLight position={[-3, 2, -3]} intensity={0.3} />
      <HeightMapMesh heightMap={heightMap} diverging={diverging} />
      <GridOverlay heightMap={heightMap} />
      <AxisLabels />
      <OrbitControls enableDamping dampingFactor={0.1} />
    </Canvas>
  );
}

// ---------------------------------------------------------------------------
// 2D Heatmap View
// ---------------------------------------------------------------------------

function Heatmap2D({ heightMap, diverging = false }: { heightMap: HeightMapData; diverging?: boolean }) {
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    y: number;
    value: number;
    screenX: number;
    screenY: number;
  } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const stats = useMemo(() => computeStats(heightMap), [heightMap]);

  const padding = 40;
  const svgWidth = 500;
  const svgHeight = 400;
  const gridWidth = svgWidth - padding * 2;
  const gridHeight = svgHeight - padding * 2;
  const cellWidth = gridWidth / heightMap.numX;
  const cellHeight = gridHeight / heightMap.numY;

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGRectElement>, xi: number, yi: number, val: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      setHoverInfo({
        x: heightMap.xMin + xi * heightMap.xSpacing,
        y: heightMap.yMin + yi * heightMap.ySpacing,
        value: val,
        screenX: e.clientX - rect.left,
        screenY: e.clientY - rect.top,
      });
    },
    [heightMap],
  );

  const handleMouseLeave = useCallback(() => setHoverInfo(null), []);

  return (
    <div className="heatmap-2d-container" style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        style={{ width: '100%', maxWidth: svgWidth, height: 'auto' }}
      >
        {/* Cells */}
        {Array.from({ length: heightMap.numY }, (_, yi) =>
          Array.from({ length: heightMap.numX }, (_, xi) => {
            const val = heightMap.points[yi]?.[xi] ?? 0;
            const fill = diverging
              ? divergingColor(val, stats.min, stats.max)
              : deviationColor(val, stats.min, stats.max);
            return (
              <rect
                key={`${xi}-${yi}`}
                x={padding + xi * cellWidth}
                y={padding + (heightMap.numY - 1 - yi) * cellHeight}
                width={cellWidth}
                height={cellHeight}
                fill={fill}
                stroke="#333"
                strokeWidth={0.5}
                onMouseMove={(e) => handleMouseMove(e, xi, yi, val)}
                onMouseLeave={handleMouseLeave}
                style={{ cursor: 'crosshair' }}
              />
            );
          }),
        )}

        {/* X axis labels */}
        {Array.from({ length: heightMap.numX }, (_, xi) => {
          const xVal = heightMap.xMin + xi * heightMap.xSpacing;
          return (
            <text
              key={`x-${xi}`}
              x={padding + xi * cellWidth + cellWidth / 2}
              y={svgHeight - padding / 3}
              textAnchor="middle"
              fontSize={10}
              fill="#aaa"
            >
              {xVal.toFixed(0)}
            </text>
          );
        })}

        {/* Y axis labels */}
        {Array.from({ length: heightMap.numY }, (_, yi) => {
          const yVal = heightMap.yMin + yi * heightMap.ySpacing;
          return (
            <text
              key={`y-${yi}`}
              x={padding / 2}
              y={padding + (heightMap.numY - 1 - yi) * cellHeight + cellHeight / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={10}
              fill="#aaa"
            >
              {yVal.toFixed(0)}
            </text>
          );
        })}

        {/* Axis titles */}
        <text x={svgWidth / 2} y={svgHeight - 4} textAnchor="middle" fontSize={12} fill="#ccc">
          X (mm)
        </text>
        <text
          x={10}
          y={svgHeight / 2}
          textAnchor="middle"
          fontSize={12}
          fill="#ccc"
          transform={`rotate(-90, 10, ${svgHeight / 2})`}
        >
          Y (mm)
        </text>
      </svg>

      {/* Hover tooltip */}
      {hoverInfo && (
        <div
          className="heatmap-tooltip"
          style={{
            position: 'absolute',
            left: hoverInfo.screenX + 12,
            top: hoverInfo.screenY - 30,
            background: '#1e1e2e',
            border: '1px solid #444',
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: 12,
            color: '#eee',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 10,
          }}
        >
          X: {hoverInfo.x.toFixed(1)} / Y: {hoverInfo.y.toFixed(1)} / Z: {hoverInfo.value.toFixed(4)} mm
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Color Scale Legend
// ---------------------------------------------------------------------------

function ColorScaleLegend({ min, max, diverging = false }: { min: number; max: number; diverging?: boolean }) {
  const steps = 11;
  const colorFn = diverging ? divergingColor : deviationColor;
  const labels: { value: number; color: string }[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const val = min + t * (max - min);
    labels.push({ value: val, color: colorFn(val, min, max) });
  }

  return (
    <div className="heightmap-legend">
      <span className="legend-label">{min.toFixed(3)}</span>
      <div className="legend-bar">
        {labels.map((l, i) => (
          <div
            key={i}
            className="legend-segment"
            style={{ background: l.color, flex: 1 }}
            title={`${l.value.toFixed(3)} mm`}
          />
        ))}
      </div>
      <span className="legend-label">{max.toFixed(3)}</span>
      <span className="legend-unit">mm</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Statistics Panel
// ---------------------------------------------------------------------------

function StatsPanel({ stats }: { stats: HeightMapStats }) {
  return (
    <div className="heightmap-stats">
      <div className="stat-row">
        <span className="stat-label">Min Deviation</span>
        <span className="stat-value">{stats.min.toFixed(4)} mm</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Max Deviation</span>
        <span className="stat-value">{stats.max.toFixed(4)} mm</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Mean Deviation</span>
        <span className="stat-value">{stats.mean.toFixed(4)} mm</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">RMS Deviation</span>
        <span className="stat-value">{stats.rms.toFixed(4)} mm</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Probe Points</span>
        <span className="stat-value">{stats.probePoints}</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Grid Dimensions</span>
        <span className="stat-value">{stats.gridDimensions}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CSV Export
// ---------------------------------------------------------------------------

function exportHeightMapCSV(hm: HeightMapData): void {
  const lines: string[] = [];
  // Header comment matching Duet heightmap.csv format
  lines.push(
    `RepRapFirmware height map file v2 generated at ${new Date().toISOString()}`,
  );
  lines.push(
    `xmin,xmax,ymin,ymax,radius,xspacing,yspacing,num_x,num_y`,
  );
  lines.push(
    `${hm.xMin},${hm.xMax},${hm.yMin},${hm.yMax},${hm.radius},${hm.xSpacing.toFixed(2)},${hm.ySpacing.toFixed(2)},${hm.numX},${hm.numY}`,
  );

  for (let yi = 0; yi < hm.numY; yi++) {
    const row: string[] = [];
    for (let xi = 0; xi < hm.numX; xi++) {
      const val = hm.points[yi]?.[xi];
      row.push(val !== undefined && !isNaN(val) ? val.toFixed(3) : '0');
    }
    lines.push(row.join(','));
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'heightmap.csv';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function DuetHeightMap() {
  const heightMap = usePrinterStore((s) => s.heightMap);
  const loadHeightMap = usePrinterStore((s) => s.loadHeightMap);
  const probeGrid = usePrinterStore((s) => s.probeGrid);
  const sendGCode = usePrinterStore((s) => s.sendGCode);
  const service = usePrinterStore((s) => s.service);
  const connected = usePrinterStore((s) => s.connected);
  const compensationType = usePrinterStore(
    (s) => s.model.move?.compensation?.type,
  );

  const [loading, setLoading] = useState(false);
  const [probing, setProbing] = useState(false);
  const [viewMode, setViewMode] = useState<'3d' | '2d'>('3d');

  // CSV file selector state
  const [csvFiles, setCsvFiles] = useState<string[]>([]);
  const [selectedCsv, setSelectedCsv] = useState('0:/sys/heightmap.csv');
  const [loadingCsvList, setLoadingCsvList] = useState(false);

  // Compare mode state
  const [compareMode, setCompareMode] = useState(false);
  const [compareCsv, setCompareCsv] = useState('');
  const [compareMap, setCompareMap] = useState<HeightMapData | null>(null);
  const [loadingCompare, setLoadingCompare] = useState(false);

  // Fetch CSV list from 0:/sys/
  const refreshCsvList = useCallback(async () => {
    if (!service) return;
    setLoadingCsvList(true);
    try {
      const entries = await service.listFiles('0:/sys');
      const csvNames = entries
        .filter((e) => e.type === 'f' && e.name.toLowerCase().endsWith('.csv'))
        .map((e) => e.name)
        .sort();
      setCsvFiles(csvNames);
    } catch {
      setCsvFiles([]);
    } finally {
      setLoadingCsvList(false);
    }
  }, [service]);

  // Load CSV file list when connected
  useEffect(() => {
    if (connected) {
      void refreshCsvList();
    }
  }, [connected, refreshCsvList]);

  const isCompensationEnabled =
    !!compensationType && compensationType !== 'none';

  // Computed difference map
  const diffMap = useMemo(() => {
    if (!compareMode || !heightMap || !compareMap) return null;
    return computeDiffMap(heightMap, compareMap);
  }, [compareMode, heightMap, compareMap]);

  // Which map to display: diffMap in compare mode, otherwise the raw heightMap
  const displayMap = diffMap ?? heightMap;

  const stats = useMemo(() => (displayMap ? computeStats(displayMap) : null), [displayMap]);

  const handleLoad = useCallback(async () => {
    setLoading(true);
    try {
      await loadHeightMap(selectedCsv);
    } finally {
      setLoading(false);
    }
  }, [loadHeightMap, selectedCsv]);

  const handleProbe = useCallback(async () => {
    if (!confirm('Run bed mesh probing (G29)? Make sure the bed is clear and the nozzle is clean.')) {
      return;
    }
    setProbing(true);
    try {
      await probeGrid();
    } finally {
      setProbing(false);
    }
  }, [probeGrid]);

  const handleExportCSV = useCallback(() => {
    if (heightMap) {
      exportHeightMapCSV(heightMap);
    }
  }, [heightMap]);

  const handleSaveAs = useCallback(async () => {
    const filename = prompt('Save height map as (filename without path/extension):', 'heightmap_backup');
    if (!filename) return;
    const sanitized = filename.replace(/[^a-zA-Z0-9_-]/g, '_');
    await sendGCode(`M374 P"0:/sys/${sanitized}.csv"`);
    void refreshCsvList();
  }, [sendGCode, refreshCsvList]);

  const handleToggleCompensation = useCallback(() => {
    sendGCode(isCompensationEnabled ? 'G29 S2' : 'G29 S1');
  }, [sendGCode, isCompensationEnabled]);

  // Load second height map for comparison
  const handleLoadCompare = useCallback(async (path: string) => {
    if (!service || !path) return;
    setCompareCsv(path);
    setLoadingCompare(true);
    try {
      const hm = await service.getHeightMap(path);
      setCompareMap(hm);
      setCompareMode(true);
    } catch {
      setCompareMap(null);
      setCompareMode(false);
    } finally {
      setLoadingCompare(false);
    }
  }, [service]);

  const handleExitCompare = useCallback(() => {
    setCompareMode(false);
    setCompareMap(null);
    setCompareCsv('');
  }, []);

  return (
    <div className="duet-heightmap">
      {/* Controls bar */}
      <div className="heightmap-controls">
        {/* CSV file selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <FolderOpen size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <select
            value={selectedCsv}
            onChange={(e) => setSelectedCsv(e.target.value)}
            disabled={loadingCsvList || csvFiles.length === 0}
            style={{
              fontSize: 12, padding: '3px 6px',
              background: 'var(--bg-elevated)', color: 'var(--text-primary)',
              border: '1px solid var(--border)', borderRadius: 4,
              fontFamily: 'inherit', maxWidth: 180,
            }}
            title="Select a CSV height map file from 0:/sys/"
          >
            {csvFiles.length === 0 && (
              <option value="0:/sys/heightmap.csv">heightmap.csv</option>
            )}
            {csvFiles.map((f) => (
              <option key={f} value={`0:/sys/${f}`}>{f}</option>
            ))}
          </select>
          <button
            className="btn btn-sm"
            onClick={() => void refreshCsvList()}
            disabled={loadingCsvList}
            title="Refresh CSV file list"
            style={{ padding: '3px 5px', minWidth: 0 }}
          >
            {loadingCsvList ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
          </button>
        </div>
        <button
          className="btn btn-sm"
          onClick={handleLoad}
          disabled={loading || probing}
          title="Load selected height map from printer"
        >
          {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
          <span>Load Height Map</span>
        </button>
        <button
          className="btn btn-sm"
          onClick={handleProbe}
          disabled={loading || probing}
          title="Probe bed mesh (G29)"
        >
          {probing ? <Loader2 size={14} className="spin" /> : <Crosshair size={14} />}
          <span>Probe Bed</span>
        </button>
        <button
          className="btn btn-sm"
          onClick={handleExportCSV}
          disabled={!heightMap}
          title="Export height map as CSV file"
        >
          <Download size={14} />
          <span>Export CSV</span>
        </button>
        <button
          className="btn btn-sm"
          onClick={() => void handleSaveAs()}
          disabled={!heightMap || !connected}
          title="Save height map to a custom filename on the printer"
        >
          <Save size={14} />
          <span>Save As</span>
        </button>
        <button
          className="btn btn-sm"
          onClick={handleToggleCompensation}
          title={
            isCompensationEnabled
              ? 'Disable bed compensation (G29 S2)'
              : 'Enable bed compensation (G29 S1)'
          }
        >
          {isCompensationEnabled ? (
            <ToggleRight size={14} />
          ) : (
            <ToggleLeft size={14} />
          )}
          <span>{isCompensationEnabled ? 'Disable Comp' : 'Enable Comp'}</span>
        </button>

        {/* Compare mode controls */}
        {!compareMode ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <GitCompareArrows size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) void handleLoadCompare(e.target.value);
              }}
              disabled={!heightMap || loadingCompare || csvFiles.length === 0}
              style={{
                fontSize: 12, padding: '3px 6px',
                background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                border: '1px solid var(--border)', borderRadius: 4,
                fontFamily: 'inherit', maxWidth: 160,
              }}
              title="Compare with another height map"
            >
              <option value="">Compare with...</option>
              {csvFiles
                .filter((f) => `0:/sys/${f}` !== selectedCsv)
                .map((f) => (
                  <option key={f} value={`0:/sys/${f}`}>{f}</option>
                ))}
            </select>
            {loadingCompare && <Loader2 size={12} className="spin" />}
          </div>
        ) : (
          <button
            className="btn btn-sm"
            onClick={handleExitCompare}
            title="Exit compare mode"
            style={{ borderColor: 'var(--warning)', color: 'var(--warning)' }}
          >
            <X size={14} />
            <span>Exit Compare</span>
          </button>
        )}

        <div className="heightmap-view-toggle">
          <button
            className={`toggle-btn ${viewMode === '3d' ? 'active' : ''}`}
            onClick={() => setViewMode('3d')}
            title="3D Surface View"
          >
            <BarChart3 size={14} />
            <span>3D</span>
          </button>
          <button
            className={`toggle-btn ${viewMode === '2d' ? 'active' : ''}`}
            onClick={() => setViewMode('2d')}
            title="2D Heatmap View"
          >
            <Grid3x3 size={14} />
            <span>2D</span>
          </button>
        </div>
      </div>

      {!heightMap ? (
        <div className="duet-heightmap-empty">
          <p>No height map data. Click "Load Height Map" or "Probe Bed" to get started.</p>
        </div>
      ) : compareMode && !diffMap ? (
        <div className="duet-heightmap-empty">
          <p>
            {loadingCompare
              ? 'Loading comparison map...'
              : 'Grid dimensions do not match. Cannot compare these height maps.'}
          </p>
        </div>
      ) : (
        <div className="heightmap-content">
          {/* Compare mode banner */}
          {compareMode && (
            <div style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 500,
              background: 'rgba(59,130,246,0.08)',
              borderBottom: '1px solid rgba(59,130,246,0.2)',
              color: 'var(--accent)',
            }}>
              Showing difference: {compareCsv.split('/').pop()} minus {selectedCsv.split('/').pop()}
              &nbsp;(red = higher, blue = lower)
            </div>
          )}

          {/* Visualization */}
          <div className="heightmap-viz">
            {viewMode === '3d' ? (
              <div className="heightmap-3d">
                <Scene3D heightMap={displayMap!} diverging={compareMode} />
              </div>
            ) : (
              <Heatmap2D heightMap={displayMap!} diverging={compareMode} />
            )}
          </div>

          {/* Color legend */}
          {stats && <ColorScaleLegend min={stats.min} max={stats.max} diverging={compareMode} />}

          {/* Stats panel */}
          {stats && <StatsPanel stats={stats} />}
        </div>
      )}

      {/* Probing indicator */}
      {probing && (
        <div className="heightmap-probing-indicator">
          <Loader2 size={16} className="spin" />
          <span>Probing bed mesh... This may take a few minutes.</span>
        </div>
      )}
    </div>
  );
}
