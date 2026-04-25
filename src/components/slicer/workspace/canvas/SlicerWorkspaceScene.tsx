import { useCallback, useEffect, useMemo, useState } from 'react';
import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useSlicerStore } from '../../../../store/slicerStore';
import type { MoveHoverInfo } from '../../../../types/slicer-preview.types';
import { buildMoveTimeline } from './previewTimeline';
import { AxisIndicators, BuildPlateGrid, BuildVolumeWireframe, PlateObjectMesh } from './scenePrimitives';
import { computeRange, computeLayerTimeRange } from '../preview/utils';
import { Legend } from '../preview/Legend';
import { LayerHeightIndicator } from '../preview/BuildVolume';
import { SectionPlaneController } from './SectionPlaneController';
import { NozzleSimulator, NozzleTrail } from './NozzleSim';
import { InlineGCodePreview } from './GCodeTubePreview';
import { HoverTooltip } from './HoverTooltip';

export function SlicerWorkspaceScene() {
  const { invalidate } = useThree();

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
  const previewHiddenTypesArr = useSlicerStore((s) => s.previewHiddenTypes);
  const previewHiddenTypesKey = useMemo(
    () => previewHiddenTypesArr.join('|'),
    [previewHiddenTypesArr],
  );
  const hiddenTypes = useMemo(() => new Set(previewHiddenTypesArr), [previewHiddenTypesKey]);
  const previewSimEnabled = useSlicerStore((s) => s.previewSimEnabled);
  const previewSimPlaying = useSlicerStore((s) => s.previewSimPlaying);
  const previewSimSpeed = useSlicerStore((s) => s.previewSimSpeed);
  const previewSimTime = useSlicerStore((s) => s.previewSimTime);
  const advancePreviewSimTime = useSlicerStore((s) => s.advancePreviewSimTime);
  const printabilityReport = useSlicerStore((s) => s.printabilityReport);
  const printabilityHighlight = useSlicerStore((s) => s.printabilityHighlight);

  // Hover inspect state — set by LayerLines pointer events.
  const [hoverInfo, setHoverInfo] = useState<MoveHoverInfo | null>(null);
  const handleHoverMove = useCallback((info: MoveHoverInfo | null) => {
    setHoverInfo(info);
    invalidate();
  }, [invalidate]);

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
    invalidate, previewShowTravel, previewColorMode, previewHiddenTypesKey,
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
      moveCount: moveTimeline.moveWithinLayer[lo] + 1,
    };
  }, [previewSimEnabled, moveTimeline, previewSimTime, previewLayer]);

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

  const handleMiss = useCallback(() => {
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
      <BuildVolumeWireframe x={bv.x} y={bv.y} z={bv.z} />
      <AxisIndicators />

      {previewMode === 'model' && plateObjects.map((obj) => (
        <PlateObjectMesh
          key={obj.id}
          obj={obj}
          isSelected={obj.id === selectedId}
          materialColor={materialProfile?.color ?? '#4fc3f7'}
          highlightedTriangles={highlightByObject.get(obj.id)}
          onClick={() => selectPlateObject(obj.id)}
          transformMode={transformMode}
          onTransformCommit={handleTransformCommit}
        />
      ))}

      {previewMode === 'preview' && sliceResult && (
        <>
          <InlineGCodePreview
            sliceResult={sliceResult}
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
          />
          {hoverInfo && <HoverTooltip info={hoverInfo} />}
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
        minDistance={50}
        maxDistance={bv.x * 4}
        enableDamping
      />
    </>
  );
}
