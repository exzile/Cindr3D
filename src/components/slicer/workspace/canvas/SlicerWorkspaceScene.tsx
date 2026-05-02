import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { cameraPresetEvent, type CameraPreset } from '../overlays/CameraPresets';
import { useSlicerStore } from '../../../../store/slicerStore';
import type { MoveHoverInfo } from '../../../../types/slicer-preview.types';
import { buildMoveTimeline } from './previewTimeline';
import { AxisIndicators, BuildPlateGrid, BuildVolumeWireframe, PlateObjectMesh } from './scenePrimitives';
import { computeRange, computeLayerTimeRange } from '../preview/utils';
import { validatePlate } from '../../../../store/slicer/plateValidation';
import { MeasurementMarkers } from '../overlays/PickToolsOverlay';
import { Legend } from '../preview/Legend';
import { computeSliceStats, detectPrintIssues, extractZSeamPoints } from '../preview/sliceStats';
import { ZSeamMarkers } from '../preview/ZSeamMarkers';
import { RiskMarkers } from '../preview/RiskMarkers';
import { LayerHeightIndicator } from '../preview/BuildVolume';
import { SectionPlaneController } from './SectionPlaneController';
import { NozzleSimulator, NozzleTrail } from './NozzleSim';
import { InlineGCodePreview } from './GCodeTubePreview';
import { InlineGCodeWirePreview } from './GCodeWirePreview';
import { HoverTooltip } from './HoverTooltip';

export function SlicerWorkspaceScene() {
  const three = useThree();
  const invalidate = three.invalidate;
  const camera = three.camera;
  // useThree's type includes `controls` but typed as unknown; the
  // OrbitControls registers itself via makeDefault and exposes a target +
  // update() method we use to retarget on a camera-preset change.
  const controls = (three as unknown as { controls: { target: THREE.Vector3; update: () => void } | null }).controls;

  const printerProfile = useSlicerStore((s) => s.getActivePrinterProfile());
  const materialProfile = useSlicerStore((s) => s.getActiveMaterialProfile());
  const printProfile = useSlicerStore((s) => s.getActivePrintProfile());
  const plateObjects = useSlicerStore((s) => s.plateObjects);
  const selectedId = useSlicerStore((s) => s.selectedPlateObjectId);
  const selectPlateObject = useSlicerStore((s) => s.selectPlateObject);
  const updatePlateObject = useSlicerStore((s) => s.updatePlateObject);
  const transformMode = useSlicerStore((s) => s.transformMode);
  const previewMode = useSlicerStore((s) => s.previewMode);
  const sliceResult = useSlicerStore((s) => s.sliceResult);
  const previewLayer = useSlicerStore((s) => s.previewLayer);
  const previewLayerStart = useSlicerStore((s) => s.previewLayerStart);
  const previewShowTravel = useSlicerStore((s) => s.previewShowTravel);
  const previewShowRetractions = useSlicerStore((s) => s.previewShowRetractions);
  const previewSectionEnabled = useSlicerStore((s) => s.previewSectionEnabled);
  const previewSectionZ = useSlicerStore((s) => s.previewSectionZ);
  const previewColorMode = useSlicerStore((s) => s.previewColorMode);
  const previewRenderMode = useSlicerStore((s) => s.previewRenderMode);
  const previewHiddenTypesArr = useSlicerStore((s) => s.previewHiddenTypes);
  const hiddenTypes = useMemo(() => new Set(previewHiddenTypesArr), [previewHiddenTypesArr]);
  const previewSimEnabled = useSlicerStore((s) => s.previewSimEnabled);
  const previewSimPlaying = useSlicerStore((s) => s.previewSimPlaying);
  const previewSimSpeed = useSlicerStore((s) => s.previewSimSpeed);
  const previewSimTime = useSlicerStore((s) => s.previewSimTime);
  const advancePreviewSimTime = useSlicerStore((s) => s.advancePreviewSimTime);
  const printabilityReport = useSlicerStore((s) => s.printabilityReport);
  const printabilityHighlight = useSlicerStore((s) => s.printabilityHighlight);

  // Hover inspect state — set by LayerLines pointer events.
  const [hoverInfo, setHoverInfo] = useState<MoveHoverInfo | null>(null);
  // Track whether the user is actively dragging the camera (orbit/pan/zoom).
  // While dragging we suppress hover events: each pointermove on a tube
  // mesh would otherwise allocate a Vector3, set state, and trigger a
  // full R3F re-render — so panning a dense G-code preview pegged the
  // frame budget. The OrbitControls fires `start` on drag begin and
  // `end` on release; we flip a ref-flag in between.
  const cameraDraggingRef = useRef(false);
  const handleHoverMove = useCallback((info: MoveHoverInfo | null) => {
    if (cameraDraggingRef.current) return;
    setHoverInfo(info);
    invalidate();
  }, [invalidate]);
  const handleControlsStart = useCallback(() => {
    cameraDraggingRef.current = true;
    if (hoverInfo !== null) setHoverInfo(null);
  }, [hoverInfo]);
  const handleControlsEnd = useCallback(() => {
    cameraDraggingRef.current = false;
  }, []);

  const highlightByObject = useMemo(() => {
    const map = new Map<string, Set<number>>();
    if (!printabilityReport || !printabilityHighlight) return map;
    for (const o of printabilityReport.objects) {
      if (o.highlightedTriangles.size > 0) map.set(o.objectId, o.highlightedTriangles);
    }
    return map;
  }, [printabilityReport, printabilityHighlight]);

  // When any visible state changes, ask R3F to render one new frame.
  // Without this, frameloop="demand" would never repaint after store updates.
  useEffect(() => { invalidate(); }, [invalidate, plateObjects, selectedId, transformMode]);
  useEffect(() => { invalidate(); }, [
    invalidate, previewMode, sliceResult, previewLayer, previewLayerStart,
  ]);
  useEffect(() => { invalidate(); }, [
    invalidate, previewShowTravel, previewColorMode, previewRenderMode, previewHiddenTypesArr,
  ]);
  useEffect(() => { invalidate(); }, [
    invalidate, previewSimEnabled, previewSimPlaying, previewSimTime,
  ]);
  useEffect(() => { invalidate(); }, [
    invalidate, printabilityReport, printabilityHighlight,
  ]);
  useEffect(() => { invalidate(); }, [
    invalidate, previewSectionEnabled, previewSectionZ,
  ]);

  const bv = printerProfile?.buildVolume ?? { x: 220, y: 220, z: 250 };

  // Camera-preset listener. Snaps the camera to a fixed offset around the
  // bed centre. The OrbitControls picks up the new target via its update().
  useEffect(() => {
    const handler = (ev: Event) => {
      const preset = (ev as CustomEvent<CameraPreset>).detail;
      const target = new THREE.Vector3(bv.x / 2, bv.y / 2, 0);
      const dist = Math.max(bv.x, bv.y) * 1.5;
      let pos: THREE.Vector3;
      switch (preset) {
        case 'top':
          pos = target.clone().add(new THREE.Vector3(0, 0, dist));
          break;
        case 'front':
          pos = target.clone().add(new THREE.Vector3(0, -dist, bv.z * 0.5));
          break;
        case 'right':
          pos = target.clone().add(new THREE.Vector3(dist, 0, bv.z * 0.5));
          break;
        case 'iso':
        default:
          pos = target.clone().add(new THREE.Vector3(dist * 0.6, -dist * 0.6, dist * 0.5));
      }
      camera.position.copy(pos);
      camera.up.set(0, 0, 1);
      camera.lookAt(target);
      if (controls) {
        controls.target.copy(target);
        controls.update();
      }
      invalidate();
    };
    window.addEventListener(cameraPresetEvent, handler);
    return () => window.removeEventListener(cameraPresetEvent, handler);
  }, [camera, controls, invalidate, bv.x, bv.y, bv.z]);

  // Build the full move timeline once per slice result. Shared by
  // NozzleSimulator and the sim-state lookup below so we pay the O(n) build
  // cost only once.
  const moveTimeline = useMemo(
    () => (sliceResult
      ? buildMoveTimeline(
        sliceResult,
        {
          filamentDiameter: printerProfile?.filamentDiameter ?? 1.75,
          travelSpeed: printProfile?.travelSpeed ?? 150,
          initialLayerTravelSpeed: printProfile?.initialLayerTravelSpeed,
          retractionDistance: materialProfile?.retractionDistance ?? 0,
          retractionSpeed: materialProfile?.retractionSpeed ?? 0,
          retractionRetractSpeed: materialProfile?.retractionRetractSpeed,
          retractionPrimeSpeed: materialProfile?.retractionPrimeSpeed,
          retractionMinTravel: printProfile?.retractionMinTravel ?? 0,
          minimumExtrusionDistanceWindow: printProfile?.minimumExtrusionDistanceWindow ?? 0,
          maxCombDistanceNoRetract: printProfile?.maxCombDistanceNoRetract ?? 0,
          travelAvoidDistance: printProfile?.travelAvoidDistance ?? 0,
          insideTravelAvoidDistance: printProfile?.insideTravelAvoidDistance ?? 0,
          avoidPrintedParts: printProfile?.avoidPrintedParts ?? false,
          avoidSupports: printProfile?.avoidSupports ?? false,
          zHopWhenRetracted: printProfile?.zHopWhenRetracted ?? ((materialProfile?.retractionZHop ?? 0) > 0),
          zHopHeight: printProfile?.zHopWhenRetracted ? (printProfile?.zHopHeight ?? 0.4) : (materialProfile?.retractionZHop ?? 0),
          zHopSpeed: printProfile?.zHopSpeed,
        },
      )
      : null),
    [
      sliceResult,
      printerProfile?.filamentDiameter,
      materialProfile?.retractionDistance,
      materialProfile?.retractionSpeed,
      materialProfile?.retractionRetractSpeed,
      materialProfile?.retractionPrimeSpeed,
      materialProfile?.retractionZHop,
      printProfile?.travelSpeed,
      printProfile?.initialLayerTravelSpeed,
      printProfile?.retractionMinTravel,
      printProfile?.minimumExtrusionDistanceWindow,
      printProfile?.maxCombDistanceNoRetract,
      printProfile?.travelAvoidDistance,
      printProfile?.insideTravelAvoidDistance,
      printProfile?.avoidPrintedParts,
      printProfile?.avoidSupports,
      printProfile?.zHopWhenRetracted,
      printProfile?.zHopHeight,
      printProfile?.zHopSpeed,
    ],
  );

  // Map simTime → { layerIndex, moveCount } so InlineGCodePreview reveals
  // moves one at a time instead of entire layers at once.
  const simState = useMemo(() => {
    if (!previewSimEnabled || !moveTimeline || moveTimeline.moves.length === 0) {
      return { layerIndex: previewLayer, moveCount: undefined as number | undefined };
    }
    const cum = moveTimeline.cumulative;
    const clampedT = Math.max(0, Math.min(previewSimTime, moveTimeline.total));
    if (clampedT <= 0) {
      return {
        layerIndex: moveTimeline.layerIndices[0] ?? previewLayer,
        moveCount: 0,
      };
    }
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < clampedT) lo = mid + 1;
      else hi = mid;
    }
    return {
      layerIndex: moveTimeline.layerIndices[lo],
      moveCount: Math.max(0, moveTimeline.moveWithinLayer[lo] + 1),
    };
  }, [previewSimEnabled, moveTimeline, previewSimTime, previewLayer]);

  // Aggregated slice statistics — drives sparklines, issues panel, and
  // the per-feature breakdown. Memoised on the slice result identity.
  const sliceStats = useMemo(() => {
    if (!sliceResult) return null;
    return computeSliceStats(sliceResult, {
      diameterMm: printerProfile?.filamentDiameter ?? 1.75,
      densityGPerCm3: materialProfile?.density ?? 1.24,
      costPerKg: materialProfile?.costPerKg,
    });
  }, [sliceResult, printerProfile?.filamentDiameter, materialProfile?.density, materialProfile?.costPerKg]);

  const printIssues = useMemo(() => {
    if (!sliceResult || !sliceStats) return [];
    return detectPrintIssues(sliceResult, sliceStats);
  }, [sliceResult, sliceStats]);

  const seamPointsAtCurrentLayer = useMemo(() => {
    if (previewColorMode !== 'seam') return [];
    const layer = sliceResult?.layers[simState.layerIndex];
    return layer ? extractZSeamPoints(layer) : [];
  }, [previewColorMode, sliceResult, simState.layerIndex]);

  // Legend props — computed once per layer scrub, not per frame.
  const currentLayerData = sliceResult?.layers[simState.layerIndex] ?? null;
  const legendRange = useMemo<[number, number]>(() => {
    if (!sliceResult) return [0, 1];
    if (previewColorMode === 'flow')       return computeRange(sliceResult.layers, simState.layerIndex, 'extrusion');
    if (previewColorMode === 'speed')      return computeRange(sliceResult.layers, simState.layerIndex, 'speed');
    if (previewColorMode === 'width')      return computeRange(sliceResult.layers, simState.layerIndex, 'width');
    if (previewColorMode === 'layer-time') return computeLayerTimeRange(sliceResult.layers, simState.layerIndex);
    return [0, 1];
  }, [sliceResult, simState.layerIndex, previewColorMode]);

  // Passed to InlineGCodePreview for layer-time normalisation across the
  // visible layer window (different from legendRange which spans 0→current).
  const visibleLayerTimeRange = useMemo<[number, number]>(() => {
    if (!sliceResult || previewColorMode !== 'layer-time') return [0, 1];
    return computeLayerTimeRange(sliceResult.layers, simState.layerIndex, previewLayerStart);
  }, [sliceResult, simState.layerIndex, previewLayerStart, previewColorMode]);

  const handleMiss = useCallback((e?: { point?: { x: number; y: number; z: number } }) => {
    const store = useSlicerStore.getState();
    if (store.viewportPickMode === 'measure' && e?.point) {
      store.pushMeasurePoint({ x: e.point.x, y: e.point.y, z: e.point.z });
      return;
    }
    selectPlateObject(null);
  }, [selectPlateObject]);

  const handleTransformCommit = useCallback((
    id: string,
    pos: { x: number; y: number; z: number },
    rot: { x: number; y: number; z: number },
    scl: { x: number; y: number; z: number },
  ) => {
    updatePlateObject(id, { position: pos, rotation: rot, scale: scl });
  }, [updatePlateObject]);

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[bv.x, bv.y, bv.z * 1.5]} intensity={0.8} />
      <directionalLight position={[-bv.x / 2, -bv.y / 2, bv.z]} intensity={0.3} />

      <SectionPlaneController
        enabled={previewMode === 'preview' && previewSectionEnabled}
        z={previewSectionZ}
      />

      <BuildPlateGrid sizeX={bv.x} sizeY={bv.y} />
      <BuildVolumeWireframe
        x={bv.x}
        y={bv.y}
        z={bv.z}
        warning={previewMode === 'model' && validatePlate(plateObjects, bv, { originCenter: printerProfile?.originCenter }).hasIssues}
      />
      <AxisIndicators />
      <MeasurementMarkers />

      {previewMode === 'model' && plateObjects.map((obj) => {
        if (obj.hidden) return null;
        return (
          <PlateObjectMesh
            key={obj.id}
            obj={obj}
            isSelected={obj.id === selectedId}
            materialColor={obj.color ?? materialProfile?.color ?? '#4fc3f7'}
            highlightedTriangles={highlightByObject.get(obj.id)}
            onClick={() => selectPlateObject(obj.id)}
            transformMode={transformMode}
            onTransformCommit={handleTransformCommit}
          />
        );
      })}

      {previewMode === 'preview' && sliceResult && (
        <>
          {previewRenderMode === 'wireframe' ? (
            <InlineGCodeWirePreview
              sliceResult={sliceResult}
              filamentDiameter={printerProfile?.filamentDiameter ?? 1.75}
              startLayer={previewLayerStart}
              currentLayer={simState.layerIndex}
              currentLayerMoveCount={simState.moveCount}
              showTravel={previewShowTravel}
              showRetractions={previewShowRetractions}
              colorMode={previewColorMode}
              hiddenTypes={hiddenTypes}
              layerTimeRange={visibleLayerTimeRange}
            />
          ) : (
            <InlineGCodePreview
              sliceResult={sliceResult}
              filamentDiameter={printerProfile?.filamentDiameter ?? 1.75}
              startLayer={previewLayerStart}
              currentLayer={simState.layerIndex}
              currentLayerMoveCount={simState.moveCount}
              showTravel={previewShowTravel}
              showRetractions={previewShowRetractions}
              colorMode={previewColorMode}
              hiddenTypes={hiddenTypes}
              layerTimeRange={visibleLayerTimeRange}
              onHoverMove={handleHoverMove}
            />
          )}
          <LayerHeightIndicator
            z={currentLayerData?.z ?? 0}
            sizeX={bv.x}
            sizeY={bv.y}
            originCenter={false}
          />
          <Legend
            colorMode={previewColorMode}
            currentLayer={simState.layerIndex}
            currentZ={currentLayerData?.z ?? 0}
            layerTime={currentLayerData?.layerTime ?? 0}
            range={legendRange}
            totalLayers={sliceResult?.layers.length}
            layerTimeSeries={sliceResult?.layers.map((l) => l.layerTime)}
            layerFilamentSeries={sliceStats?.perLayerFilamentMm}
            layerTravelRatioSeries={sliceStats
              ? sliceStats.perLayerExtrudeMm.map((ext, i) => {
                  const trv = sliceStats.perLayerTravelMm[i];
                  const total = ext + trv;
                  return total > 0 ? trv / total : 0;
                })
              : undefined}
            widthSamples={previewColorMode === 'width' && currentLayerData
              ? currentLayerData.moves
                  .filter((m) => m.type !== 'travel' && m.lineWidth > 0)
                  .map((m) => m.lineWidth)
              : undefined}
            layerMoveCounts={currentLayerData ? {
              extrude: currentLayerData.moves.filter((m) => m.type !== 'travel').length,
              travel:  currentLayerData.moves.filter((m) => m.type === 'travel').length,
            } : undefined}
          />
          {seamPointsAtCurrentLayer.length > 0 && (
            <ZSeamMarkers
              points={seamPointsAtCurrentLayer}
              z={currentLayerData?.z ?? 0}
            />
          )}
          {currentLayerData && printIssues.length > 0 && (
            <RiskMarkers
              issues={printIssues.filter((i) => i.layerIndex === simState.layerIndex)}
              z={currentLayerData.z}
            />
          )}
          {hoverInfo && (
            <HoverTooltip
              info={hoverInfo}
              filamentDiameter={printerProfile?.filamentDiameter ?? 1.75}
              layerHeight={(() => {
                // Adaptive layers vary per layer — compute from z-diff
                // when neighbouring layers exist, else fall back to the
                // profile default. The flow% is approximate either way
                // (it's a hover-debug aid, not metrology).
                const layerIdx = simState.layerIndex;
                const cur = sliceResult?.layers[layerIdx];
                const prev = layerIdx > 0 ? sliceResult?.layers[layerIdx - 1] : null;
                if (cur && prev) return Math.max(0.02, cur.z - prev.z);
                return printProfile?.layerHeight ?? 0.2;
              })()}
            />
          )}
        </>
      )}

      {previewMode === 'preview' && sliceResult && previewSimEnabled && moveTimeline && (
        <>
          <NozzleSimulator
            timeline={moveTimeline}
            simTime={previewSimTime}
            playing={previewSimPlaying}
            speed={previewSimSpeed}
            onAdvance={advancePreviewSimTime}
          />
          <NozzleTrail timeline={moveTimeline} simTime={previewSimTime} />
        </>
      )}

      <mesh position={[bv.x / 2, bv.y / 2, -0.1]} onClick={handleMiss} visible={false}>
        <planeGeometry args={[bv.x * 2, bv.y * 2]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      <OrbitControls
        makeDefault
        target={[bv.x / 2, bv.y / 2, 0]}
        minDistance={2}
        maxDistance={bv.x * 4}
        enableDamping
        onStart={handleControlsStart}
        onEnd={handleControlsEnd}
      />
    </>
  );
}
