/**
 * MeshPreviewPanel — dashboard 3D preview of the active print.
 *
 * Composes:
 *   • The Canvas + BuildVolumeScene + InlineGCodeWirePreview (slicer scene)
 *   • Plate-object silhouettes / status badges (meshPreview/scene)
 *   • Nozzle marker + trail (meshPreview/scene)
 *   • Overlay controls — view presets, color mode, layer scrubber
 *   • Hover tooltip + right-click context menu for per-object cancel
 *
 * Source of the live current-layer index by firmware:
 *   Duet     → model.job.layer (RRF object model)
 *   Klipper  → useKlipperPrintStatus() (Moonraker print_stats / display_status)
 *   Marlin   → model.job.layer populated by DuetService.handleSerialLine
 *              parsing M73 P/Q/R/S and "echo:Layer N/M" off the WebSerial
 *              line stream
 *   Other    → slicerStore.previewLayer; else "all layers"
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ThreeEvent } from 'react';
import { Canvas } from '@react-three/fiber';
import { usePrinterStore } from '../../../store/printerStore';
import { useSlicerStore } from '../../../store/slicerStore';
import { computeSliceStats, detectPrintIssues } from '../../slicer/workspace/preview/sliceStats';
import { RiskMarkers } from '../../slicer/workspace/preview/RiskMarkers';
import { PrintSpaceLights } from '../../canvas/PrintSpaceLights';
import { BuildVolumeScene } from '../../canvas/BuildVolumeScene';
import { LayeredGCodePreview } from '../../canvas/LayeredGCodePreview';
import { matchObjectNames } from '../../../services/gcode/objectNameMatch';
import { panelStyle, sectionTitleStyle as labelStyle } from '../../../utils/printerPanelStyles';
import { colors as COLORS } from '../../../utils/theme';
import type { PlateObject } from '../../../types/slicer';
import {
  axisPosition,
  clampLayerIndex,
  colorModeForPreview,
  computePreviewBounds,
  readStoredPreviewSettings,
  type ContextMenuState,
  type DashboardPreviewColorMode,
  type HoverState,
  type PreviewViewPreset,
} from './meshPreview/helpers';
import { NozzleMarker, ObjectSilhouette, ObjectStatusBadge, PreviewCameraControls } from './meshPreview/scene';
import { ObjectContextMenu } from './meshPreview/ObjectContextMenu';
import { PreviewViewControls } from './meshPreview/PreviewViewControls';
import { PreviewColorMode } from './meshPreview/PreviewColorMode';
import { LayerScrubber } from './meshPreview/LayerScrubber';
import { ObjectHoverTooltip } from './meshPreview/ObjectHoverTooltip';
import { useCurrentLayer } from './meshPreview/useCurrentLayer';
import { useObjectMatching } from './meshPreview/useObjectMatching';

export default function MeshPreviewPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverFrameRef = useRef<number | null>(null);
  const pendingHoverRef = useRef<HoverState | null>(null);
  const activePrinterId = usePrinterStore((s) => s.activePrinterId);
  const boardType = usePrinterStore((s) => s.config.boardType);
  const model = usePrinterStore((s) => s.model);
  const cancelObject = usePrinterStore((s) => s.cancelObject);
  const sendGCode = usePrinterStore((s) => s.sendGCode);

  const plateObjects = useSlicerStore((s) => s.plateObjects);
  const sliceResult = useSlicerStore((s) => s.sliceResult);
  const previewLayer = useSlicerStore((s) => s.previewLayer);
  const printerProfile = useSlicerStore((s) => s.getActivePrinterProfile());
  const materialProfile = useSlicerStore((s) => s.getActiveMaterialProfile());
  const printabilityReport = useSlicerStore((s) => s.printabilityReport);

  const bv = useMemo(() => printerProfile?.buildVolume ?? { x: 220, y: 220, z: 250 }, [printerProfile?.buildVolume]);
  const previewBounds = useMemo(() => computePreviewBounds(plateObjects, bv), [plateObjects, bv]);
  const hiddenTypes = useMemo(() => new Set<string>(), []);
  const storageScope = activePrinterId || boardType || 'default';
  const storageKey = `cindr3d:dashboard-print-preview:${storageScope}`;
  const initialStoredSettings = useMemo(() => readStoredPreviewSettings(storageKey), [storageKey]);
  const [viewPreset, setViewPreset] = useState<PreviewViewPreset>(() => initialStoredSettings.view);
  const [colorMode, setColorMode] = useState<DashboardPreviewColorMode>(() => initialStoredSettings.color);
  const [loadedStorageKey, setLoadedStorageKey] = useState(storageKey);
  const [viewRevision, setViewRevision] = useState(0);
  const [layerOverride, setLayerOverride] = useState<number | null>(null);
  const [nozzleTrail, setNozzleTrail] = useState<Array<{ x: number; y: number; z: number }>>([]);

  const buildObjects = useMemo(() => model.job?.build?.objects ?? [], [model.job?.build?.objects]);
  const buildCurrentIdx = model.job?.build?.currentObject ?? -1;
  const totalLayers = sliceResult?.layerCount ?? 0;

  const { currentLayer, klipperStatus } = useCurrentLayer({
    boardType,
    modelJobLayer: model.job?.layer,
    previewLayer,
    totalLayers,
  });

  const displayedLayer = layerOverride ?? currentLayer;
  const isLiveLayer = layerOverride === null;
  const displayedLayerData = sliceResult?.layers[displayedLayer];

  const layerTimeRange = useMemo<[number, number]>(() => {
    const times = sliceResult?.layers.map((layer) => layer.layerTime).filter((time) => Number.isFinite(time)) ?? [];
    if (times.length === 0) return [0, 1];
    return [Math.min(...times), Math.max(...times)];
  }, [sliceResult?.layers]);

  const sliceStats = useMemo(() => {
    if (!sliceResult) return null;
    return computeSliceStats(sliceResult, {
      diameterMm: printerProfile?.filamentDiameter ?? 1.75,
      densityGPerCm3: materialProfile?.density ?? 1.24,
      costPerKg: materialProfile?.costPerKg,
    });
  }, [materialProfile?.costPerKg, materialProfile?.density, printerProfile?.filamentDiameter, sliceResult]);

  const printIssues = useMemo(
    () => (sliceResult && sliceStats ? detectPrintIssues(sliceResult, sliceStats) : []),
    [sliceResult, sliceStats],
  );

  const currentLayerIssues = useMemo(
    () => printIssues.filter((issue) => issue.layerIndex === displayedLayer),
    [displayedLayer, printIssues],
  );

  const matching = useObjectMatching({
    boardType,
    buildObjects,
    buildCurrentIdx,
    klipperMessage: klipperStatus?.message,
    gcode: sliceResult?.gcode,
    printabilityObjects: printabilityReport?.objects,
  });
  const {
    m486Labels, printabilityByObjectId,
    matchByName, isCurrentObject, isCancelledObject, objectStatus,
  } = matching;

  const nozzlePosition = useMemo(() => axisPosition(model), [model]);
  const progressPercent = boardType === 'klipper' && klipperStatus
    ? klipperStatus.progress * 100
    : model.job?.filePosition !== undefined && model.job?.file?.size
      ? (model.job.filePosition / model.job.file.size) * 100
      : totalLayers > 0
        ? ((currentLayer + 1) / totalLayers) * 100
        : null;
  const elapsedSeconds = boardType === 'klipper' && klipperStatus ? klipperStatus.printDuration : model.job?.duration;
  const remainingSeconds = model.job?.timesLeft?.file;
  const activeObjectName = useMemo(() => {
    if (boardType === 'duet' && model.job?.build && buildCurrentIdx >= 0) {
      return model.job.build.objects[buildCurrentIdx]?.name ?? null;
    }
    if (boardType === 'klipper' && klipperStatus?.message) return klipperStatus.message;
    return null;
  }, [boardType, buildCurrentIdx, klipperStatus?.message, model.job?.build]);

  useEffect(() => {
    if (totalLayers <= 0) {
      setLayerOverride(null);
      return;
    }
    setLayerOverride((layer) => layer === null ? null : Math.max(0, Math.min(totalLayers - 1, layer)));
  }, [totalLayers]);

  useEffect(() => {
    const saved = readStoredPreviewSettings(storageKey);
    setLoadedStorageKey(storageKey);
    setViewPreset(saved.view);
    setColorMode(saved.color);
    setViewRevision((revision) => revision + 1);
  }, [storageKey]);

  useEffect(() => {
    if (loadedStorageKey !== storageKey) return;
    try {
      window.localStorage.setItem(`${storageKey}:view`, viewPreset);
      window.localStorage.setItem(`${storageKey}:color`, colorMode);
    } catch {
      /* ignore */
    }
  }, [colorMode, loadedStorageKey, storageKey, viewPreset]);

  useEffect(() => {
    if (!nozzlePosition) return;
    setNozzleTrail((trail) => {
      const previous = trail.at(-1);
      if (previous && Math.hypot(previous.x - nozzlePosition.x, previous.y - nozzlePosition.y, previous.z - nozzlePosition.z) < 0.1) return trail;
      return [...trail, nozzlePosition].slice(-16);
    });
  }, [nozzlePosition]);

  // Context menu + hover state
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  useEffect(() => () => {
    if (hoverFrameRef.current !== null) {
      window.cancelAnimationFrame(hoverFrameRef.current);
    }
  }, []);

  const setPreviewView = useCallback((view: PreviewViewPreset) => {
    setViewPreset(view);
    setViewRevision((revision) => revision + 1);
  }, []);

  const setManualLayer = useCallback((layer: number) => {
    if (totalLayers <= 0) return;
    setLayerOverride(clampLayerIndex(layer, totalLayers));
  }, [totalLayers]);

  const syncCameraOverlay = useCallback(() => {
    window.dispatchEvent(new CustomEvent('cindr3d:print-preview-sync-camera', {
      detail: {
        layer: displayedLayer,
        objectName: activeObjectName,
        view: viewPreset,
        bounds: { center: previewBounds.center.toArray(), radius: previewBounds.radius },
      },
    }));
  }, [activeObjectName, displayedLayer, previewBounds.center, previewBounds.radius, viewPreset]);

  const handleObjectContextMenu = (objectId: string) => (e: ThreeEvent<MouseEvent>) => {
    e.nativeEvent.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenu({
      objectId,
      // Clamp to [0, max] so the menu stays inside the panel even when the
      // panel is narrower than the menu itself.
      x: Math.max(0, Math.min(e.nativeEvent.clientX - rect.left, rect.width - 220)),
      y: Math.max(0, Math.min(e.nativeEvent.clientY - rect.top, rect.height - 140)),
    });
  };

  const clearObjectHover = useCallback(() => {
    pendingHoverRef.current = null;
    if (hoverFrameRef.current !== null) {
      window.cancelAnimationFrame(hoverFrameRef.current);
      hoverFrameRef.current = null;
    }
    setHover(null);
  }, []);

  const handleObjectHover = (objectId: string) => (e: ThreeEvent<PointerEvent>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    pendingHoverRef.current = {
      objectId,
      x: Math.max(8, Math.min(e.nativeEvent.clientX - rect.left + 10, rect.width - 210)),
      y: Math.max(8, Math.min(e.nativeEvent.clientY - rect.top + 10, rect.height - 92)),
    };
    if (hoverFrameRef.current !== null) return;
    hoverFrameRef.current = window.requestAnimationFrame(() => {
      hoverFrameRef.current = null;
      const nextHover = pendingHoverRef.current;
      if (!nextHover) return;
      setHover((previous) => {
        if (
          previous
          && previous.objectId === nextHover.objectId
          && Math.abs(previous.x - nextHover.x) < 4
          && Math.abs(previous.y - nextHover.y) < 4
        ) {
          return previous;
        }
        return nextHover;
      });
    });
  };

  const menuObj = menu ? plateObjects.find((p) => p.id === menu.objectId) : null;
  const hoverObj = hover ? plateObjects.find((p) => p.id === hover.objectId) : null;
  const hoverReport = hoverObj ? printabilityByObjectId.get(hoverObj.id) : null;

  const handleCancelFromMenu = useCallback(async () => {
    if (!menuObj) return;
    const matched = matchByName(menuObj);
    try {
      if (boardType === 'duet' && matched) {
        const idx = buildObjects.findIndex((o) => matchObjectNames(o.name, matched));
        if (idx >= 0) await cancelObject(idx);
      } else if (boardType === 'klipper' && matched) {
        await sendGCode(`EXCLUDE_OBJECT NAME=${matched}`);
      } else if (boardType === 'marlin' && matched) {
        const label = m486Labels.find((l: { id: number; name: string }) => matchObjectNames(l.name, matched));
        if (label) await sendGCode(`M486 P${label.id}`);
      }
    } finally {
      setMenu(null);
    }
  }, [menuObj, matchByName, boardType, buildObjects, cancelObject, sendGCode, m486Labels]);

  const hasContent = plateObjects.length > 0 || (sliceResult && sliceResult.layers.length > 0);

  return (
    <div style={panelStyle({ display: 'flex', flexDirection: 'column', minHeight: 220, padding: 0 })} ref={containerRef}>
      <div style={{ ...labelStyle({ padding: '8px 10px 4px' }), display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        <span style={{ fontSize: 10, color: COLORS.textDim ?? '#666', display: 'flex', gap: 6 }}>
          {totalLayers > 0 && (
            <span>{isLiveLayer ? 'Live' : 'Preview'} L{Math.min(displayedLayer + 1, totalLayers)} / {totalLayers}</span>
          )}
          {boardType === 'klipper' && klipperStatus && klipperStatus.progress > 0 && (
            <span>{(klipperStatus.progress * 100).toFixed(0)}%</span>
          )}
        </span>
      </div>

      <div style={{ flex: 1, position: 'relative', minHeight: 180, background: 'var(--bg-secondary, #0d0d1a)' }}>
        {!hasContent ? (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: COLORS.textDim ?? '#666', fontSize: 11, padding: 16, textAlign: 'center',
          }}>
            Slice a model in the Prepare workspace to populate the preview.
          </div>
        ) : (
          <>
            <Canvas
              camera={{
                position: [bv.x * 1.2, -bv.y * 0.8, bv.z * 1.4],
                fov: 45,
                near: 0.5,
                far: Math.max(bv.x, bv.y, bv.z) * 12,
                up: [0, 0, 1],
              }}
              frameloop="demand"
              style={{ width: '100%', height: '100%' }}
              onContextMenu={(e) => e.preventDefault()}
            >
              <PrintSpaceLights />
              <BuildVolumeScene bv={bv} />

              {plateObjects.map((obj: PlateObject) => (
                <ObjectSilhouette
                  key={obj.id}
                  obj={obj}
                  isCurrent={isCurrentObject(obj)}
                  isCancelled={isCancelledObject(obj)}
                  colorMode={colorMode}
                  onContextMenu={handleObjectContextMenu(obj.id)}
                  onHover={handleObjectHover(obj.id)}
                  onHoverEnd={clearObjectHover}
                />
              ))}

              {plateObjects.map((obj: PlateObject) => (
                <ObjectStatusBadge key={`${obj.id}:status`} obj={obj} status={objectStatus(obj)} />
              ))}

              <NozzleMarker position={nozzlePosition} trail={nozzleTrail} />

              {sliceResult && (
                <LayeredGCodePreview
                  sliceResult={sliceResult}
                  displayedLayer={displayedLayer}
                  colorMode={colorModeForPreview(colorMode)}
                  hiddenTypes={hiddenTypes}
                  layerTimeRange={layerTimeRange}
                />
              )}

              {displayedLayerData && currentLayerIssues.length > 0 && (
                <RiskMarkers issues={currentLayerIssues} z={displayedLayerData.z} />
              )}

              <PreviewCameraControls
                buildVolume={bv}
                bounds={previewBounds}
                revision={viewRevision}
                view={viewPreset}
              />
            </Canvas>

            <PreviewViewControls
              viewPreset={viewPreset}
              onSelectView={setPreviewView}
              onSyncCameraOverlay={syncCameraOverlay}
            />

            <PreviewColorMode colorMode={colorMode} onChange={setColorMode} />

            {totalLayers > 0 && (
              <LayerScrubber
                totalLayers={totalLayers}
                displayedLayer={displayedLayer}
                isLiveLayer={isLiveLayer}
                layerZ={sliceResult?.layers[displayedLayer]?.z}
                progressPercent={progressPercent}
                activeObjectName={activeObjectName}
                elapsedSeconds={elapsedSeconds}
                remainingSeconds={remainingSeconds}
                currentLayerIssues={currentLayerIssues}
                onManualLayer={setManualLayer}
                onReturnToLive={() => setLayerOverride(null)}
              />
            )}
          </>
        )}

        {hover && hoverObj && !menu && (
          <ObjectHoverTooltip
            obj={hoverObj}
            position={{ x: hover.x, y: hover.y }}
            filamentWeight={sliceResult?.filamentWeight}
            plateObjectCount={plateObjects.length}
            isCurrent={isCurrentObject(hoverObj)}
            isCancelled={isCancelledObject(hoverObj)}
            status={objectStatus(hoverObj)}
            report={hoverReport ?? null}
          />
        )}

        {menu && menuObj && (
          <ObjectContextMenu
            obj={menuObj}
            position={{ x: menu.x, y: menu.y }}
            isCurrent={isCurrentObject(menuObj)}
            isCancelled={isCancelledObject(menuObj)}
            onCancel={() => void handleCancelFromMenu()}
            onClose={() => setMenu(null)}
          />
        )}
      </div>
    </div>
  );
}
