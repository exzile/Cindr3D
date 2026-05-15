import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Wand2, RotateCcw, Code2, ChevronDown, Info } from 'lucide-react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useSlicerStore } from '../../../store/slicerStore';
import { CALIBRATION_STL_URLS, getCalibrationModels } from '../../calibrationModels';
import { LayeredGCodePreview } from '../../../components/canvas/LayeredGCodePreview';
import { PrintSpaceLights } from '../../../components/canvas/PrintSpaceLights';
import { BuildVolumeScene } from '../../../components/canvas/BuildVolumeScene';
import type { PrintProfile, MaterialProfile } from '../../../types/slicer';
import {
  getCalibrationSlicePreset,
  getAutoSetKeys,
  PA_DRIVE_PRESETS,
  detectPaDriveType,
} from '../../calibrationSlicePresets';
import {
  EMPTY_PROCESSORS,
  FIELD_LABELS,
  MODEL_FOOTPRINTS,
  fmtPresetValue,
  fmtStepValue,
  type PlaneHoverInfo,
} from './stepSlicePreviewHelpers';
import { TuningPlaneMarkers } from './TuningPlaneMarkers';

interface StepSlicePreviewProps {
  testType: string;
  filamentMaterial: string;
}


export function StepSlicePreview({ testType, filamentMaterial }: StepSlicePreviewProps) {
  const sliceResult             = useSlicerStore((s) => s.sliceResult);
  const sliceProgress           = useSlicerStore((s) => s.sliceProgress);
  const startSlice              = useSlicerStore((s) => s.startSlice);
  const printerProfile          = useSlicerStore((s) => s.getActivePrinterProfile());
  const printProfile            = useSlicerStore((s) => s.getActivePrintProfile());
  const materialProfile         = useSlicerStore((s) => s.getActiveMaterialProfile());
  const activePrintProfileId    = useSlicerStore((s) => s.activePrintProfileId);
  const activeMaterialProfileId = useSlicerStore((s) => s.activeMaterialProfileId);
  const updatePrintProfile      = useSlicerStore((s) => s.updatePrintProfile);
  const updateMaterialProfile   = useSlicerStore((s) => s.updateMaterialProfile);
  const importFileToPlate       = useSlicerStore((s) => s.importFileToPlate);
  const clearPlate              = useSlicerStore((s) => s.clearPlate);
  const centerPlateObject       = useSlicerStore((s) => s.centerPlateObject);

  const modelEntry    = useMemo(() => getCalibrationModels().find((m) => m.testType === testType), [testType]);
  const defaultStlUrl = CALIBRATION_STL_URLS[testType] as string | undefined;

  // Filament context for preset parameterization — nozzle comes from the active printer profile.
  const filament = useMemo(
    () => ({ material: filamentMaterial, nozzleDiameterMm: printerProfile?.nozzleDiameter ?? 0.4 }),
    [filamentMaterial, printerProfile?.nozzleDiameter],
  );

  const bv = useMemo(
    () => printerProfile?.buildVolume ?? { x: 220, y: 220, z: 250 },
    [printerProfile?.buildVolume],
  );

  // ── Tuning-plane sizing (model footprint + 30% padding, centred on plate) ──
  const [planeW, planeD] = useMemo(() => {
    const [fw, fd] = MODEL_FOOTPRINTS[testType] ?? [
      modelEntry?.baseDimMm ?? 60,
      modelEntry?.baseDimMm ?? 60,
    ];
    return [fw * 1.3, fd * 1.3] as [number, number];
  }, [testType, modelEntry?.baseDimMm]);

  // Whether any enabled tuning-tower processor is active (drives the info button).
  const hasTuningPlanes = useMemo(
    () => (printProfile?.layerProcessors ?? EMPTY_PROCESSORS).some(
      (p) => p.enabled && p.kind === 'tuning-tower',
    ),
    [printProfile?.layerProcessors],
  );

  // Human-readable description of what the planes represent, shown in the info popup.
  const tuningPlaneDesc = useMemo(() => {
    const procs = (printProfile?.layerProcessors ?? EMPTY_PROCESSORS).filter(
      (p) => p.enabled && p.kind === 'tuning-tower',
    );
    if (procs.length === 0) return '';
    const proc = procs[0];
    const steps = computeTuningSteps(proc);
    const paramLabel: Record<string, string> = {
      'temperature':      'nozzle temperature',
      'bed-temperature':  'bed temperature',
      'fan':              'fan speed',
      'speed':            'print speed',
      'flow':             'flow rate',
      'pressure-advance': 'pressure advance',
    };
    const label = paramLabel[proc.tuningParameter ?? ''] ?? 'a setting';
    const zList = steps.map((s) => `${s.z} mm`).join(', ');
    return `Each orange plane marks a Z height where the post-processor injects a ${label} change command. `
      + `${steps.length} change${steps.length !== 1 ? 's' : ''} at: ${zList}.`;
  }, [printProfile?.layerProcessors]);

  const [showPlaneInfo,  setShowPlaneInfo]  = useState(false);
  const [hoveredPlane,   setHoveredPlane]   = useState<PlaneHoverInfo | null>(null);
  const [tooltipPos,     setTooltipPos]     = useState({ x: 0, y: 0 });
  const canvasWrapperRef = useRef<HTMLDivElement>(null);

  const handleCanvasPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!canvasWrapperRef.current) return;
    const rect = canvasWrapperRef.current.getBoundingClientRect();
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  // Format the hovered-plane info into tooltip lines.
  const planeTooltip = useMemo(() => {
    if (!hoveredPlane) return null;
    const { z, param, value, prevValue } = hoveredPlane;
    const PARAM_LABELS: Record<string, string> = {
      'temperature':      'Temp',
      'bed-temperature':  'Bed temp',
      'fan':              'Fan',
      'speed':            'Speed',
      'flow':             'Flow',
      'pressure-advance': 'PA',
    };
    const label = PARAM_LABELS[param ?? ''] ?? 'Value';
    const fmt   = (v: number) => fmtStepValue(param, v);
    const valueStr = prevValue !== null
      ? `${fmt(prevValue)} → ${fmt(value)}`
      : fmt(value);
    return { z, label, valueStr };
  }, [hoveredPlane]);

  const totalLayers = sliceResult?.layerCount ?? 0;
  const [localLayer, setLocalLayer] = useState(0);

  // Jump to last layer when a fresh slice lands.
  useEffect(() => {
    if (totalLayers > 0) setLocalLayer(totalLayers - 1);
  }, [totalLayers]);

  const displayedLayer = Math.min(localLayer, Math.max(0, totalLayers - 1));

  const layerTimeRange = useMemo<[number, number]>(() => {
    if (!sliceResult) return [0, 1];
    const times = sliceResult.layers
      .map((l) => l.layerTime)
      .filter((t): t is number => Number.isFinite(t));
    if (times.length === 0) return [0, 1];
    return [Math.min(...times), Math.max(...times)];
  }, [sliceResult]);

  // Camera centred on the model, not on the build plate origin.
  const modelMaxZ = sliceResult?.layers[sliceResult.layerCount - 1]?.z ?? bv.z * 0.25;
  const targetX   = bv.x / 2;
  const targetY   = bv.y / 2;
  const targetZ   = modelMaxZ / 2;
  const distance  = Math.max(bv.x, bv.y) * 1.4;
  const lift      = targetZ + Math.max(modelMaxZ * 0.4, 30);
  const camFar    = Math.max(bv.x, bv.y, bv.z) * 12;

  // Stable patch helpers.
  const patchPrint = useCallback(
    (patch: Partial<PrintProfile>) => updatePrintProfile(activePrintProfileId, patch),
    [updatePrintProfile, activePrintProfileId],
  );
  const patchMaterial = useCallback(
    (patch: Partial<MaterialProfile>) => updateMaterialProfile(activeMaterialProfileId, patch),
    [updateMaterialProfile, activeMaterialProfileId],
  );

  // ── Calibration preset auto-apply ─────────────────────────────────────────
  // Track which field keys were set by the preset so they can be highlighted.
  const [autoKeys, setAutoKeys] = useState<ReadonlySet<string>>(() => getAutoSetKeys(testType, filament));

  // Snapshot of original profile values — used by the Undo button.
  const printSnapshotRef   = useRef<Partial<PrintProfile>>({});
  const materialSnapshotRef = useRef<Partial<MaterialProfile>>({});

  useEffect(() => {
    const preset = getCalibrationSlicePreset(testType, filament);
    if (!preset) {
      setAutoKeys(new Set());
      return;
    }

    // Read current values for every key the preset will touch.
    const currentPrint    = useSlicerStore.getState().getActivePrintProfile();
    const currentMaterial = useSlicerStore.getState().getActiveMaterialProfile();

    if (currentPrint) {
      printSnapshotRef.current = Object.fromEntries(
        Object.keys(preset.print).map((k) => [k, (currentPrint as unknown as Record<string, unknown>)[k]]),
      ) as Partial<PrintProfile>;
    }
    if (currentMaterial) {
      materialSnapshotRef.current = Object.fromEntries(
        Object.keys(preset.material).map((k) => [k, (currentMaterial as unknown as Record<string, unknown>)[k]]),
      ) as Partial<MaterialProfile>;
    }

    // Apply the preset.
    if (Object.keys(preset.print).length > 0)    patchPrint(preset.print);
    if (Object.keys(preset.material).length > 0) patchMaterial(preset.material);

    setAutoKeys(getAutoSetKeys(testType, filament));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testType, filamentMaterial, printerProfile?.nozzleDiameter]);

  /** Restore the values that were in the profile before the preset was applied. */
  const handleUndo = useCallback(() => {
    if (Object.keys(printSnapshotRef.current).length > 0)    patchPrint(printSnapshotRef.current);
    if (Object.keys(materialSnapshotRef.current).length > 0) patchMaterial(materialSnapshotRef.current);
    setPresetApplied(false);
    // autoKeys intentionally kept — bar stays visible with the full field list
  }, [patchPrint, patchMaterial]);

  const handleReapply = useCallback(() => {
    const p = getCalibrationSlicePreset(testType, filament);
    if (!p) return;
    if (Object.keys(p.print).length > 0)    patchPrint(p.print);
    if (Object.keys(p.material).length > 0) patchMaterial(p.material);
    setPresetApplied(true);
  }, [testType, filament, patchPrint, patchMaterial]);

  /** Patch a single LayerProcessor inside printProfile.layerProcessors by index. */
  const updateProcessor = useCallback(
    (index: number, patch: Partial<LayerProcessor>) => {
      const processors = [...(printProfile?.layerProcessors ?? [])];
      processors[index] = { ...processors[index], ...patch };
      patchPrint({ layerProcessors: processors });
    },
    // printProfile intentionally omitted — we read from store snapshot inside callback
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [patchPrint],
  );

  /** Whether the post-processing scripts panel is expanded in the PP bar. */
  const [ppExpanded, setPpExpanded] = useState(false);
  /** Whether the auto-configured overrides list is expanded in the preset bar. */
  const [presetExpanded, setPresetExpanded] = useState(false);
  /** Whether the calibration preset overrides are currently applied. */
  const [presetApplied, setPresetApplied] = useState(true);
  /** Custom STL chosen by the user; null = use the built-in calibration model. */
  const [customFile, setCustomFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelRunRef  = useRef(0);

  // ── Model loading ─────────────────────────────────────────────────────────
  // Mirrors StepLoadModel: fetches the default STL (or the user's custom file),
  // loads it onto the slicer plate, and kicks off an automatic slice.
  useEffect(() => {
    if (!customFile && !defaultStlUrl) return;
    const myRun = ++modelRunRef.current;
    let disposed = false;
    const cancelled = () => disposed || modelRunRef.current !== myRun;

    (async () => {
      try {
        let blob: Blob;
        let name: string;
        if (customFile) {
          blob = customFile;
          name = customFile.name;
        } else {
          const r = await fetch(defaultStlUrl!);
          blob = await r.blob();
          name = `${testType}.stl`;
        }
        if (cancelled()) return;
        clearPlate();
        const plateFile = new File([blob], name, { type: 'model/stl' });
        // Pre-warm dynamic imports so autoArrange can finish before we center.
        await Promise.all([
          import('../../../engine/binPacker'),
          import('../../../utils/bedMeshArrange'),
        ]);
        const plateId = await importFileToPlate(plateFile);
        await new Promise<void>((r) => setTimeout(r, 50));
        if (plateId && !cancelled()) centerPlateObject(plateId);
        if (!cancelled()) startSlice();
      } catch {
        // Slice errors surface through sliceProgress.stage === 'error'
      }
    })();

    return () => { disposed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultStlUrl, testType, customFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (file) setCustomFile(file);
    e.target.value = '';
  };
  const handleUseDefault = useCallback(() => setCustomFile(null), []);

  /** CSS class helper — adds `--auto` modifier only while preset overrides are applied. */
  const f = useCallback(
    (key: string) => `calib-slice-field${presetApplied && autoKeys.has(key) ? ' calib-slice-field--auto' : ''}`,
    [autoKeys, presetApplied],
  );

  const preset = getCalibrationSlicePreset(testType, filament);

  const sliceStage = sliceProgress.stage;
  const isSlicing  = sliceStage === 'slicing' || sliceStage === 'preparing' || sliceStage === 'generating';

  /** Model source row — always visible so the user can swap the STL at any time. */
  const modelSourceRow = (
    <div className="calib-step__model-source">
      <div className="calib-step__model-source-info">
        {customFile ? (
          <>
            <span className="calib-step__model-source-name">{customFile.name}</span>
            <span className="calib-step__muted">(custom)</span>
          </>
        ) : (
          <span className="calib-step__model-source-name">
            {modelEntry?.filename ?? testType}
            {' '}<span className="calib-step__muted">(default)</span>
          </span>
        )}
      </div>
      <div className="calib-step__model-source-actions">
        {customFile && (
          <button type="button" onClick={handleUseDefault}>Use default</button>
        )}
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          {customFile ? 'Replace STL…' : 'Custom STL…'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".stl"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>
    </div>
  );

  if (!sliceResult) {
    return (
      <div className="calib-step">
        {modelSourceRow}
        {isSlicing ? (
          <p>Slicing… {Math.round(sliceProgress.percent)}%</p>
        ) : sliceStage === 'error' ? (
          <>
            <p>Slice error: {sliceProgress.message}</p>
            <button type="button" onClick={startSlice}>Retry slice</button>
          </>
        ) : (
          <p>Loading model…</p>
        )}
      </div>
    );
  }

  return (
    <div className="calib-step">
      {modelSourceRow}

      <div className="calib-step__slice-layout">

        {/* ── Left: 3-D toolpath canvas ──────────────────────────────────── */}
        <div
          className="calib-step__slice-canvas"
          ref={canvasWrapperRef}
          onPointerMove={handleCanvasPointerMove}
          onPointerLeave={() => setHoveredPlane(null)}
        >

          {/* Plane hover tooltip */}
          {planeTooltip && (
            <div
              className="calib-step__plane-tooltip"
              style={{ left: tooltipPos.x + 14, top: tooltipPos.y - 44 }}
            >
              <span className="calib-step__plane-tooltip__z">Z: {planeTooltip.z} mm</span>
              <span>{planeTooltip.label}: {planeTooltip.valueStr}</span>
            </div>
          )}

          {/* Info button — only visible when tuning planes are active */}
          {hasTuningPlanes && (
            <div className="calib-step__plane-info">
              <button
                type="button"
                className="calib-step__plane-info-btn"
                onClick={() => setShowPlaneInfo((v) => !v)}
                title="About the orange layer-change planes"
              >
                <Info size={12} />
                Layer changes
              </button>
              {showPlaneInfo && (
                <div className="calib-step__plane-info-popup" role="tooltip">
                  <p>{tuningPlaneDesc}</p>
                </div>
              )}
            </div>
          )}

          <Canvas
            frameloop="demand"
            camera={{
              position: [targetX, targetY - distance, lift],
              up: [0, 0, 1],
              fov: 45,
              near: 0.5,
              far: camFar,
            }}
            style={{ width: '100%', height: '100%' }}
          >
            <PrintSpaceLights />
            <BuildVolumeScene bv={bv} />

            <TuningPlaneMarkers
              processors={printProfile?.layerProcessors ?? EMPTY_PROCESSORS}
              cx={bv.x / 2}
              cy={bv.y / 2}
              planeW={planeW}
              planeD={planeD}
              onHoverChange={setHoveredPlane}
            />

            <LayeredGCodePreview
              sliceResult={sliceResult}
              displayedLayer={displayedLayer}
              colorMode="type"
              layerTimeRange={layerTimeRange}
            />

            <OrbitControls
              target={[targetX, targetY, targetZ]}
              enableDamping
              dampingFactor={0.12}
            />
          </Canvas>
        </div>

        {/* ── Right: advanced settings panel ────────────────────────────── */}
        <div className="calib-step__slice-settings">

          <div className="calib-step__slice-settings-scroll">

            {/* Scripts section lives in the expandable PP bar below the layout */}

            {/* ── Quality ───────────────────────────────────────────────── */}
            <details className="calib-slice-section" open>
              <summary className="calib-slice-section__header">Quality</summary>
              <div className={f('layerHeight')}>
                <span className="calib-slice-field__label">Layer height</span>
                <input className="calib-slice-field__input" type="number" step={0.05} min={0.05} max={0.6}
                  value={printProfile.layerHeight}
                  onChange={(e) => patchPrint({ layerHeight: Number(e.target.value) })} />
                <span className="calib-slice-field__unit">mm</span>
              </div>
              <div className={f('firstLayerHeight')}>
                <span className="calib-slice-field__label">First layer</span>
                <input className="calib-slice-field__input" type="number" step={0.05} min={0.05} max={0.6}
                  value={printProfile.firstLayerHeight}
                  onChange={(e) => patchPrint({ firstLayerHeight: Number(e.target.value) })} />
                <span className="calib-slice-field__unit">mm</span>
              </div>
              <div className={f('topLayers')}>
                <span className="calib-slice-field__label">Top layers</span>
                <input className="calib-slice-field__input" type="number" step={1} min={0} max={20}
                  value={printProfile.topLayers}
                  onChange={(e) => patchPrint({ topLayers: Math.round(Number(e.target.value)) })} />
                <span className="calib-slice-field__unit">layers</span>
              </div>
              <div className={f('bottomLayers')}>
                <span className="calib-slice-field__label">Bottom layers</span>
                <input className="calib-slice-field__input" type="number" step={1} min={0} max={20}
                  value={printProfile.bottomLayers}
                  onChange={(e) => patchPrint({ bottomLayers: Math.round(Number(e.target.value)) })} />
                <span className="calib-slice-field__unit">layers</span>
              </div>
              <div className={f('adaptiveLayersEnabled')}>
                <span className="calib-slice-field__label">Adaptive layers</span>
                <input className="calib-slice-field__check" type="checkbox"
                  checked={printProfile.adaptiveLayersEnabled}
                  onChange={(e) => patchPrint({ adaptiveLayersEnabled: e.target.checked })} />
                <span className="calib-slice-field__unit" />
              </div>
              {printProfile.adaptiveLayersEnabled && (
                <div className={f('adaptiveLayersMaxVariation')}>
                  <span className="calib-slice-field__label">Max variation</span>
                  <input className="calib-slice-field__input" type="number" step={0.02} min={0.02} max={0.3}
                    value={printProfile.adaptiveLayersMaxVariation}
                    onChange={(e) => patchPrint({ adaptiveLayersMaxVariation: Number(e.target.value) })} />
                  <span className="calib-slice-field__unit">mm</span>
                </div>
              )}
            </details>

            {/* ── Walls & Infill ────────────────────────────────────────── */}
            <details className="calib-slice-section" open>
              <summary className="calib-slice-section__header">Walls &amp; Infill</summary>
              <div className={f('wallCount')}>
                <span className="calib-slice-field__label">Wall count</span>
                <input className="calib-slice-field__input" type="number" step={1} min={1} max={20}
                  value={printProfile.wallCount}
                  onChange={(e) => patchPrint({ wallCount: Math.round(Number(e.target.value)) })} />
                <span className="calib-slice-field__unit" />
              </div>
              <div className={f('lineWidth')}>
                <span className="calib-slice-field__label">Line width</span>
                <input className="calib-slice-field__input" type="number" step={0.05} min={0.1} max={1.5}
                  value={printProfile.lineWidth}
                  onChange={(e) => patchPrint({ lineWidth: Number(e.target.value) })} />
                <span className="calib-slice-field__unit">mm</span>
              </div>
              <div className={f('outerWallFirst')}>
                <span className="calib-slice-field__label">Outer wall first</span>
                <input className="calib-slice-field__check" type="checkbox"
                  checked={printProfile.outerWallFirst}
                  onChange={(e) => patchPrint({ outerWallFirst: e.target.checked })} />
                <span className="calib-slice-field__unit" />
              </div>
              <div className={f('infillDensity')}>
                <span className="calib-slice-field__label">Infill density</span>
                <input className="calib-slice-field__input" type="number" step={5} min={0} max={100}
                  value={printProfile.infillDensity}
                  onChange={(e) => patchPrint({ infillDensity: Number(e.target.value) })} />
                <span className="calib-slice-field__unit">%</span>
              </div>
              <div className={f('infillPattern')}>
                <span className="calib-slice-field__label">Infill pattern</span>
                <select className="calib-slice-field__input calib-slice-field__input--select"
                  value={printProfile.infillPattern}
                  onChange={(e) => patchPrint({ infillPattern: e.target.value as PrintProfile['infillPattern'] })}>
                  <option value="grid">Grid</option>
                  <option value="lines">Lines</option>
                  <option value="triangles">Triangles</option>
                  <option value="gyroid">Gyroid</option>
                  <option value="honeycomb">Honeycomb</option>
                  <option value="cubic">Cubic</option>
                  <option value="lightning">Lightning</option>
                  <option value="concentric">Concentric</option>
                  <option value="cross">Cross</option>
                </select>
              </div>
              <div className={f('infillOverlap')}>
                <span className="calib-slice-field__label">Infill overlap</span>
                <input className="calib-slice-field__input" type="number" step={1} min={0} max={50}
                  value={printProfile.infillOverlap}
                  onChange={(e) => patchPrint({ infillOverlap: Number(e.target.value) })} />
                <span className="calib-slice-field__unit">%</span>
              </div>
              <div className={f('topBottomPattern')}>
                <span className="calib-slice-field__label">Top/bottom</span>
                <select className="calib-slice-field__input calib-slice-field__input--select"
                  value={printProfile.topBottomPattern}
                  onChange={(e) => patchPrint({ topBottomPattern: e.target.value as PrintProfile['topBottomPattern'] })}>
                  <option value="lines">Lines</option>
                  <option value="concentric">Concentric</option>
                  <option value="zigzag">Zigzag</option>
                </select>
              </div>
            </details>

            {/* ── Speed ─────────────────────────────────────────────────── */}
            <details className="calib-slice-section" open>
              <summary className="calib-slice-section__header">Speed</summary>
              <div className={f('printSpeed')}>
                <span className="calib-slice-field__label">Print</span>
                <input className="calib-slice-field__input" type="number" step={5} min={1} max={500}
                  value={printProfile.printSpeed}
                  onChange={(e) => patchPrint({ printSpeed: Number(e.target.value) })} />
                <span className="calib-slice-field__unit">mm/s</span>
              </div>
              <div className={f('firstLayerSpeed')}>
                <span className="calib-slice-field__label">First layer</span>
                <input className="calib-slice-field__input" type="number" step={5} min={1} max={100}
                  value={printProfile.firstLayerSpeed}
                  onChange={(e) => patchPrint({ firstLayerSpeed: Number(e.target.value) })} />
                <span className="calib-slice-field__unit">mm/s</span>
              </div>
              <div className={f('outerWallSpeed')}>
                <span className="calib-slice-field__label">Outer wall</span>
                <input className="calib-slice-field__input" type="number" step={5} min={1} max={300}
                  value={printProfile.outerWallSpeed}
                  onChange={(e) => patchPrint({ outerWallSpeed: Number(e.target.value) })} />
                <span className="calib-slice-field__unit">mm/s</span>
              </div>
              <div className={f('infillSpeed')}>
                <span className="calib-slice-field__label">Infill</span>
                <input className="calib-slice-field__input" type="number" step={5} min={1} max={500}
                  value={printProfile.infillSpeed}
                  onChange={(e) => patchPrint({ infillSpeed: Number(e.target.value) })} />
                <span className="calib-slice-field__unit">mm/s</span>
              </div>
              <div className={f('travelSpeed')}>
                <span className="calib-slice-field__label">Travel</span>
                <input className="calib-slice-field__input" type="number" step={10} min={10} max={800}
                  value={printProfile.travelSpeed}
                  onChange={(e) => patchPrint({ travelSpeed: Number(e.target.value) })} />
                <span className="calib-slice-field__unit">mm/s</span>
              </div>
            </details>

            {/* ── Cooling ───────────────────────────────────────────────── */}
            <details className="calib-slice-section" open>
              <summary className="calib-slice-section__header">Cooling</summary>
              <div className={f('coolingFanEnabled')}>
                <span className="calib-slice-field__label">Fan enable</span>
                <input className="calib-slice-field__check" type="checkbox"
                  checked={printProfile.coolingFanEnabled}
                  onChange={(e) => patchPrint({ coolingFanEnabled: e.target.checked })} />
                <span className="calib-slice-field__unit" />
              </div>
              <div className={f('fanSpeedMin')}>
                <span className="calib-slice-field__label">Fan min</span>
                <input className="calib-slice-field__input" type="number" step={5} min={0} max={100}
                  value={materialProfile.fanSpeedMin}
                  onChange={(e) => patchMaterial({ fanSpeedMin: Number(e.target.value) })} />
                <span className="calib-slice-field__unit">%</span>
              </div>
              <div className={f('fanSpeedMax')}>
                <span className="calib-slice-field__label">Fan max</span>
                <input className="calib-slice-field__input" type="number" step={5} min={0} max={100}
                  value={materialProfile.fanSpeedMax}
                  onChange={(e) => patchMaterial({ fanSpeedMax: Number(e.target.value) })} />
                <span className="calib-slice-field__unit">%</span>
              </div>
              <div className={f('fanFullLayer')}>
                <span className="calib-slice-field__label">Full fan at layer</span>
                <input className="calib-slice-field__input" type="number" step={1} min={0} max={20}
                  value={printProfile.fanFullLayer}
                  onChange={(e) => patchPrint({ fanFullLayer: Math.round(Number(e.target.value)) })} />
                <span className="calib-slice-field__unit" />
              </div>
              <div className={f('fanDisableFirstLayers')}>
                <span className="calib-slice-field__label">Disable first N layers</span>
                <input className="calib-slice-field__input" type="number" step={1} min={0} max={10}
                  value={materialProfile.fanDisableFirstLayers}
                  onChange={(e) => patchMaterial({ fanDisableFirstLayers: Math.round(Number(e.target.value)) })} />
                <span className="calib-slice-field__unit" />
              </div>
              <div className={f('minLayerTime')}>
                <span className="calib-slice-field__label">Min layer time</span>
                <input className="calib-slice-field__input" type="number" step={1} min={0} max={120}
                  value={printProfile.minLayerTime}
                  onChange={(e) => patchPrint({ minLayerTime: Number(e.target.value) })} />
                <span className="calib-slice-field__unit">s</span>
              </div>
            </details>

            {/* ── Material ──────────────────────────────────────────────── */}
            <details className="calib-slice-section" open>
              <summary className="calib-slice-section__header">Material</summary>
              <div className={f('nozzleTemp')}>
                <span className="calib-slice-field__label">Nozzle temp</span>
                <input className="calib-slice-field__input" type="number" step={1} min={150} max={350}
                  value={materialProfile.nozzleTemp}
                  onChange={(e) => patchMaterial({ nozzleTemp: Number(e.target.value) })} />
                <span className="calib-slice-field__unit">°C</span>
              </div>
              <div className={f('nozzleTempFirstLayer')}>
                <span className="calib-slice-field__label">First layer temp</span>
                <input className="calib-slice-field__input" type="number" step={1} min={150} max={350}
                  value={materialProfile.nozzleTempFirstLayer}
                  onChange={(e) => patchMaterial({ nozzleTempFirstLayer: Number(e.target.value) })} />
                <span className="calib-slice-field__unit">°C</span>
              </div>
              <div className={f('bedTemp')}>
                <span className="calib-slice-field__label">Bed temp</span>
                <input className="calib-slice-field__input" type="number" step={1} min={0} max={150}
                  value={materialProfile.bedTemp}
                  onChange={(e) => patchMaterial({ bedTemp: Number(e.target.value) })} />
                <span className="calib-slice-field__unit">°C</span>
              </div>
              <div className={f('retractionDistance')}>
                <span className="calib-slice-field__label">Retraction</span>
                <input className="calib-slice-field__input" type="number" step={0.1} min={0} max={10}
                  value={materialProfile.retractionDistance}
                  onChange={(e) => patchMaterial({ retractionDistance: Number(e.target.value) })} />
                <span className="calib-slice-field__unit">mm</span>
              </div>
              <div className={f('retractionSpeed')}>
                <span className="calib-slice-field__label">Retract speed</span>
                <input className="calib-slice-field__input" type="number" step={5} min={1} max={120}
                  value={materialProfile.retractionSpeed}
                  onChange={(e) => patchMaterial({ retractionSpeed: Number(e.target.value) })} />
                <span className="calib-slice-field__unit">mm/s</span>
              </div>
              <div className={f('retractionZHop')}>
                <span className="calib-slice-field__label">Z-hop</span>
                <input className="calib-slice-field__input" type="number" step={0.1} min={0} max={5}
                  value={materialProfile.retractionZHop}
                  onChange={(e) => patchMaterial({ retractionZHop: Number(e.target.value) })} />
                <span className="calib-slice-field__unit">mm</span>
              </div>
              <div className={f('flowRate')}>
                <span className="calib-slice-field__label">Flow rate</span>
                <input className="calib-slice-field__input" type="number" step={1} min={50} max={200}
                  value={Math.round(materialProfile.flowRate * 100)}
                  onChange={(e) => patchMaterial({ flowRate: Number(e.target.value) / 100 })} />
                <span className="calib-slice-field__unit">%</span>
              </div>
            </details>

            {/* ── Supports ──────────────────────────────────────────────── */}
            <details className="calib-slice-section">
              <summary className="calib-slice-section__header">Supports</summary>
              <div className={f('supportEnabled')}>
                <span className="calib-slice-field__label">Enable supports</span>
                <input className="calib-slice-field__check" type="checkbox"
                  checked={printProfile.supportEnabled}
                  onChange={(e) => patchPrint({ supportEnabled: e.target.checked })} />
                <span className="calib-slice-field__unit" />
              </div>
              {printProfile.supportEnabled && (
                <>
                  <div className={f('supportType')}>
                    <span className="calib-slice-field__label">Type</span>
                    <select className="calib-slice-field__input calib-slice-field__input--select"
                      value={printProfile.supportType}
                      onChange={(e) => patchPrint({ supportType: e.target.value as PrintProfile['supportType'] })}>
                      <option value="normal">Normal</option>
                      <option value="tree">Tree</option>
                      <option value="organic">Organic</option>
                    </select>
                  </div>
                  <div className={f('supportAngle')}>
                    <span className="calib-slice-field__label">Overhang angle</span>
                    <input className="calib-slice-field__input" type="number" step={1} min={20} max={90}
                      value={printProfile.supportAngle}
                      onChange={(e) => patchPrint({ supportAngle: Number(e.target.value) })} />
                    <span className="calib-slice-field__unit">°</span>
                  </div>
                  <div className={f('supportDensity')}>
                    <span className="calib-slice-field__label">Density</span>
                    <input className="calib-slice-field__input" type="number" step={5} min={5} max={100}
                      value={printProfile.supportDensity}
                      onChange={(e) => patchPrint({ supportDensity: Number(e.target.value) })} />
                    <span className="calib-slice-field__unit">%</span>
                  </div>
                  <div className={f('supportZDistance')}>
                    <span className="calib-slice-field__label">Z distance</span>
                    <input className="calib-slice-field__input" type="number" step={0.05} min={0} max={2}
                      value={printProfile.supportZDistance}
                      onChange={(e) => patchPrint({ supportZDistance: Number(e.target.value) })} />
                    <span className="calib-slice-field__unit">mm</span>
                  </div>
                  <div className={f('supportBuildplateOnly')}>
                    <span className="calib-slice-field__label">Buildplate only</span>
                    <input className="calib-slice-field__check" type="checkbox"
                      checked={printProfile.supportBuildplateOnly}
                      onChange={(e) => patchPrint({ supportBuildplateOnly: e.target.checked })} />
                    <span className="calib-slice-field__unit" />
                  </div>
                  <div className={f('supportInterface')}>
                    <span className="calib-slice-field__label">Interface layers</span>
                    <input className="calib-slice-field__check" type="checkbox"
                      checked={printProfile.supportInterface}
                      onChange={(e) => patchPrint({ supportInterface: e.target.checked })} />
                    <span className="calib-slice-field__unit" />
                  </div>
                </>
              )}
            </details>

            {/* ── Adhesion ──────────────────────────────────────────────── */}
            <details className="calib-slice-section">
              <summary className="calib-slice-section__header">Adhesion</summary>
              <div className={f('adhesionType')}>
                <span className="calib-slice-field__label">Type</span>
                <select className="calib-slice-field__input calib-slice-field__input--select"
                  value={printProfile.adhesionType}
                  onChange={(e) => patchPrint({ adhesionType: e.target.value as PrintProfile['adhesionType'] })}>
                  <option value="none">None</option>
                  <option value="skirt">Skirt</option>
                  <option value="brim">Brim</option>
                  <option value="raft">Raft</option>
                </select>
              </div>
              {printProfile.adhesionType === 'brim' && (
                <>
                  <div className={f('brimWidth')}>
                    <span className="calib-slice-field__label">Brim width</span>
                    <input className="calib-slice-field__input" type="number" step={1} min={1} max={30}
                      value={printProfile.brimWidth}
                      onChange={(e) => patchPrint({ brimWidth: Number(e.target.value) })} />
                    <span className="calib-slice-field__unit">mm</span>
                  </div>
                  <div className={f('brimGap')}>
                    <span className="calib-slice-field__label">Brim gap</span>
                    <input className="calib-slice-field__input" type="number" step={0.1} min={0} max={3}
                      value={printProfile.brimGap}
                      onChange={(e) => patchPrint({ brimGap: Number(e.target.value) })} />
                    <span className="calib-slice-field__unit">mm</span>
                  </div>
                </>
              )}
              {printProfile.adhesionType === 'skirt' && (
                <>
                  <div className={f('skirtLines')}>
                    <span className="calib-slice-field__label">Skirt lines</span>
                    <input className="calib-slice-field__input" type="number" step={1} min={1} max={20}
                      value={printProfile.skirtLines}
                      onChange={(e) => patchPrint({ skirtLines: Math.round(Number(e.target.value)) })} />
                    <span className="calib-slice-field__unit" />
                  </div>
                  <div className={f('skirtDistance')}>
                    <span className="calib-slice-field__label">Skirt distance</span>
                    <input className="calib-slice-field__input" type="number" step={0.5} min={0} max={20}
                      value={printProfile.skirtDistance}
                      onChange={(e) => patchPrint({ skirtDistance: Number(e.target.value) })} />
                    <span className="calib-slice-field__unit">mm</span>
                  </div>
                </>
              )}
            </details>

            {/* ── Advanced ──────────────────────────────────────────────── */}
            <details className="calib-slice-section">
              <summary className="calib-slice-section__header">Advanced</summary>
              <div className={f('zSeamAlignment')}>
                <span className="calib-slice-field__label">Z-seam</span>
                <select className="calib-slice-field__input calib-slice-field__input--select"
                  value={printProfile.zSeamAlignment}
                  onChange={(e) => patchPrint({ zSeamAlignment: e.target.value as PrintProfile['zSeamAlignment'] })}>
                  <option value="shortest">Shortest</option>
                  <option value="aligned">Aligned</option>
                  <option value="random">Random</option>
                  <option value="sharpest_corner">Sharpest corner</option>
                </select>
              </div>
              <div className={f('combingMode')}>
                <span className="calib-slice-field__label">Combing</span>
                <select className="calib-slice-field__input calib-slice-field__input--select"
                  value={printProfile.combingMode}
                  onChange={(e) => patchPrint({ combingMode: e.target.value as PrintProfile['combingMode'] })}>
                  <option value="off">Off</option>
                  <option value="all">All</option>
                  <option value="noskin">No skin</option>
                  <option value="infill">Infill only</option>
                </select>
              </div>
              <div className={f('ironingEnabled')}>
                <span className="calib-slice-field__label">Ironing</span>
                <input className="calib-slice-field__check" type="checkbox"
                  checked={printProfile.ironingEnabled}
                  onChange={(e) => patchPrint({ ironingEnabled: e.target.checked })} />
                <span className="calib-slice-field__unit" />
              </div>
              {printProfile.ironingEnabled && (
                <>
                  <div className={f('ironingSpeed')}>
                    <span className="calib-slice-field__label">Ironing speed</span>
                    <input className="calib-slice-field__input" type="number" step={1} min={1} max={100}
                      value={printProfile.ironingSpeed}
                      onChange={(e) => patchPrint({ ironingSpeed: Number(e.target.value) })} />
                    <span className="calib-slice-field__unit">mm/s</span>
                  </div>
                  <div className={f('ironingFlow')}>
                    <span className="calib-slice-field__label">Ironing flow</span>
                    <input className="calib-slice-field__input" type="number" step={1} min={1} max={30}
                      value={printProfile.ironingFlow}
                      onChange={(e) => patchPrint({ ironingFlow: Number(e.target.value) })} />
                    <span className="calib-slice-field__unit">%</span>
                  </div>
                </>
              )}
              <div className={f('wallGenerator')}>
                <span className="calib-slice-field__label">Wall generator</span>
                <select className="calib-slice-field__input calib-slice-field__input--select"
                  value={printProfile.wallGenerator ?? 'arachne'}
                  onChange={(e) => patchPrint({ wallGenerator: e.target.value as PrintProfile['wallGenerator'] })}>
                  <option value="arachne">Arachne</option>
                  <option value="classic">Classic</option>
                </select>
              </div>
              <div className={f('spiralizeContour')}>
                <span className="calib-slice-field__label">Spiral / vase</span>
                <input className="calib-slice-field__check" type="checkbox"
                  checked={printProfile.spiralizeContour}
                  onChange={(e) => patchPrint({ spiralizeContour: e.target.checked })} />
                <span className="calib-slice-field__unit" />
              </div>
            </details>

          </div>{/* end scroll area */}

          <div className="calib-step__slice-settings-footer">
            <button
              type="button"
              className="calib-wizard__next"
              disabled={isSlicing}
              onClick={startSlice}
              style={{ width: '100%' }}
            >
              {isSlicing ? `Slicing… ${Math.round(sliceProgress.percent)}%` : '↺ Reslice'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Pre-configured settings bar (expandable, persists after undo) ──────── */}
      {preset && autoKeys.size > 0 && (
        <div className={`calib-step__preset-bar${presetApplied ? '' : ' calib-step__preset-bar--undone'}`}>
          {/* Header row: toggle + action button are siblings so buttons don't nest */}
          <div className="calib-step__preset-bar__header">
            <button
              type="button"
              className="calib-step__preset-bar__toggle"
              onClick={() => setPresetExpanded((v) => !v)}
              aria-expanded={presetExpanded}
            >
              <Wand2 size={11} className="calib-step__preset-bar__icon" />
              <span className="calib-step__preset-bar__text">
                {presetApplied ? (
                  <><strong>{autoKeys.size}</strong> settings auto-configured</>
                ) : (
                  <><strong>{autoKeys.size}</strong> calibration overrides available</>
                )}
              </span>
              <ChevronDown
                size={12}
                className={`calib-step__preset-bar__chevron${presetExpanded ? ' calib-step__preset-bar__chevron--open' : ''}`}
              />
            </button>
            {presetApplied ? (
              <button
                type="button"
                className="calib-step__preset-bar__undo"
                onClick={handleUndo}
                title="Restore your original profile values"
              >
                <RotateCcw size={10} />
                Undo
              </button>
            ) : (
              <button
                type="button"
                className="calib-step__preset-bar__undo calib-step__preset-bar__reapply"
                onClick={handleReapply}
                title="Re-apply the calibration preset overrides"
              >
                <Wand2 size={10} />
                Re-apply
              </button>
            )}
          </div>

          {/* Expanded: rationale + two-column list of each overridden field → value */}
          {presetExpanded && (
            <div className="calib-step__preset-details">
              <p className="calib-step__preset-bar__reason">
                {presetApplied
                  ? preset.rationale
                  : 'Settings restored to your profile — click Re-apply to reactivate the calibration overrides.'}
              </p>
              <div className="calib-step__preset-items">
                {[...autoKeys].map((key) => {
                  const val =
                    (preset.print    as Record<string, unknown>)[key] ??
                    (preset.material as Record<string, unknown>)[key];
                  return (
                    <div key={key} className="calib-step__preset-item">
                      <span className="calib-step__preset-item__label">
                        {FIELD_LABELS[key] ?? key}
                      </span>
                      <span className="calib-step__preset-item__value">
                        {fmtPresetValue(key, val)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Post-processing indicator (expandable) ──────────────────────────── */}
      {(() => {
        const allProcs    = printProfile?.layerProcessors ?? [];
        if (allProcs.length === 0) return null;                    // hide only when NO processors at all
        const activeProcs = allProcs.filter((p) => p.enabled);
        const labels      = activeProcs.map((p) => preset?.processorNotes?.[p.id]?.title ?? p.kind);
        const summaryText = activeProcs.length === 0 ? 'all paused' : labels.join(', ');
        return (
          <div className="calib-step__pp-bar">
            {/* Toggle row */}
            <button
              type="button"
              className="calib-step__pp-bar__toggle"
              onClick={() => setPpExpanded((v) => !v)}
              aria-expanded={ppExpanded}
            >
              <Code2 size={11} className="calib-step__pp-bar__icon" />
              <span className="calib-step__pp-bar__text">
                <strong>{activeProcs.length}</strong>
                {activeProcs.length !== allProcs.length && ` / ${allProcs.length}`}
                &nbsp;{allProcs.length === 1 ? 'post-processing script' : 'post-processing scripts'}&nbsp;active
                &ensp;·&ensp;
                {summaryText}
              </span>
              <ChevronDown
                size={12}
                className={`calib-step__pp-bar__chevron${ppExpanded ? ' calib-step__pp-bar__chevron--open' : ''}`}
              />
            </button>

            {/* Expanded script cards */}
            {ppExpanded && (
              <div className="calib-step__pp-scripts">
                {allProcs.map((proc, idx) => {
                  const notes    = preset?.processorNotes?.[proc.id];
                  const isTuning = proc.kind === 'tuning-tower';
                  const isPA     = proc.tuningParameter === 'pressure-advance';
                  const steps    = isTuning ? computeTuningSteps(proc) : [];

                  const driveType = isPA
                    ? detectPaDriveType(
                        proc.tuningStartValue ?? 0,
                        proc.tuningEndValue   ?? 0,
                        proc.tuningStepSize   ?? 5,
                      )
                    : 'custom';

                  const bandsCount =
                    isPA && (proc.tuningStepSize ?? 0) > 0
                      ? Math.ceil(
                          ((proc.tuningEndZ ?? 0) - (proc.tuningStartZ ?? 0)) /
                            (proc.tuningStepSize ?? 1),
                        )
                      : 0;

                  return (
                    <div
                      key={proc.id}
                      className={`calib-script-card${proc.enabled ? '' : ' calib-script-card--disabled'}`}
                    >
                      <div className="calib-script-card__header">
                        <div className="calib-script-card__title-group">
                          <span className="calib-script-card__title">
                            {notes?.title ?? proc.id}
                          </span>
                          <span className="calib-script-card__kind">{proc.kind}</span>
                        </div>
                        {/* Toggle button — not a checkbox so it stays in the list */}
                        <button
                          type="button"
                          className={`calib-script-card__enable-btn${proc.enabled ? ' calib-script-card__enable-btn--on' : ''}`}
                          onClick={() => updateProcessor(idx, { enabled: !proc.enabled })}
                          aria-pressed={proc.enabled}
                        >
                          {proc.enabled ? 'Active' : 'Paused'}
                        </button>
                      </div>

                      {notes?.detail && <p className="calib-script-card__detail">{notes.detail}</p>}
                      {notes?.hint   && <p className="calib-script-card__hint">{notes.hint}</p>}

                      {isTuning && (
                        <>
                          {/* PA drive-type preset buttons */}
                          {isPA && (
                            <div className="calib-script-card__drive-row">
                              <div className="calib-script-card__drive-btns">
                                {(Object.entries(PA_DRIVE_PRESETS) as [string, typeof PA_DRIVE_PRESETS[keyof typeof PA_DRIVE_PRESETS]][]).map(([key, p]) => (
                                  <button
                                    key={key}
                                    type="button"
                                    title={p.description}
                                    className={[
                                      'calib-script-card__drive-btn',
                                      driveType === key ? 'calib-script-card__drive-btn--active' : '',
                                    ].join(' ').trim()}
                                    onClick={() =>
                                      updateProcessor(idx, {
                                        tuningStartValue: p.startValue,
                                        tuningEndValue:   p.endValue,
                                        tuningStepSize:   p.stepSize,
                                      })
                                    }
                                  >
                                    {p.label}
                                  </button>
                                ))}
                                {driveType === 'custom' && (
                                  <span className="calib-script-card__drive-btn calib-script-card__drive-btn--custom">
                                    Custom
                                  </span>
                                )}
                              </div>
                              {bandsCount > 0 && (
                                <span className="calib-script-card__band-info">
                                  {bandsCount} band{bandsCount !== 1 ? 's' : ''}&ensp;·&ensp;
                                  {(
                                    ((proc.tuningEndValue ?? 0) - (proc.tuningStartValue ?? 0)) /
                                    bandsCount
                                  ).toFixed(4)}{' '}
                                  PA/band
                                </span>
                              )}
                            </div>
                          )}

                          {/* Range inputs */}
                          <div className="calib-script-card__fields">
                            <div className="calib-script-card__field">
                              <span className="calib-script-card__field-label">Start value</span>
                              <input
                                type="number"
                                className="calib-script-card__field-input"
                                step={isPA ? 0.001 : 1}
                                value={proc.tuningStartValue ?? 0}
                                onChange={(e) =>
                                  updateProcessor(idx, { tuningStartValue: Number(e.target.value) })
                                }
                              />
                            </div>
                            <span className="calib-script-card__arrow">→</span>
                            <div className="calib-script-card__field">
                              <span className="calib-script-card__field-label">End value</span>
                              <input
                                type="number"
                                className="calib-script-card__field-input"
                                step={isPA ? 0.001 : 1}
                                value={proc.tuningEndValue ?? 0}
                                onChange={(e) =>
                                  updateProcessor(idx, { tuningEndValue: Number(e.target.value) })
                                }
                              />
                            </div>
                            <div className="calib-script-card__field">
                              <span className="calib-script-card__field-label">Step (mm)</span>
                              <input
                                type="number"
                                className="calib-script-card__field-input"
                                step={1}
                                min={0}
                                value={proc.tuningStepSize ?? 5}
                                onChange={(e) =>
                                  updateProcessor(idx, { tuningStepSize: Number(e.target.value) })
                                }
                              />
                            </div>
                          </div>

                          {/* Step-sequence chips */}
                          {steps.length > 0 && (
                            <div className="calib-script-card__steps">
                              {steps.map((s) => (
                                <div key={s.z} className="calib-script-card__step-chip">
                                  <span className="calib-script-card__step-z">Z{s.z}</span>
                                  <span className="calib-script-card__step-val">
                                    {fmtStepValue(proc.tuningParameter, s.value)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Layer slider ────────────────────────────────────────────────────── */}
      <div className="calib-step__layer-controls">
        <input
          type="range"
          min={0}
          max={Math.max(0, totalLayers - 1)}
          value={displayedLayer}
          aria-label="Preview layer"
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setLocalLayer(Number(e.currentTarget.value))}
          style={{ width: '100%' }}
        />
        <div className="calib-step__layer-info">
          <span>Layer {displayedLayer + 1} / {totalLayers}</span>
          <span>Z {sliceResult.layers[displayedLayer]?.z?.toFixed(2) ?? '--'} mm</span>
          <span>{Math.round(sliceResult.printTime / 60)} min · {sliceResult.filamentWeight.toFixed(1)} g</span>
        </div>
      </div>
    </div>
  );
}
