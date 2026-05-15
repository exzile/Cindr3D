import { useCallback, useMemo, useState, type MouseEvent } from 'react';
import { usePrinterStore } from '../../../store/printerStore';
import { useSlicerStore } from '../../../store/slicerStore';
import type { PlateObject, SliceMove } from '../../../types/slicer';
import { parseM486Labels } from '../../../services/gcode/m486Labels';
import { findMatchingObject, matchObjectNames } from '../../../services/gcode/objectNameMatch';
import {
  invertHomography,
  projectImagePointToBed,
  type HomographyMatrix,
} from '../../../services/vision/cameraMeasurement';
import type { CameraPoseCalibration } from '../../../services/vision/cameraPose';
import { ObjectContextMenu } from './meshPreview/ObjectContextMenu';

export type CameraOverlayMode = 'camera' | 'print' | 'both';

interface CameraOverlayPanelProps {
  pose?: CameraPoseCalibration;
  mode: CameraOverlayMode;
  frameTick: number;
  comparison?: boolean;
}

interface ProjectedMove {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  type: SliceMove['type'];
  current: boolean;
}

interface ContextMenuState {
  objectId: string;
  x: number;
  y: number;
}

const MAX_OVERLAY_MOVES = 1400;
const TYPE_COLORS: Record<SliceMove['type'], string> = {
  travel: '#60a5fa',
  'wall-outer': '#22c55e',
  'wall-inner': '#86efac',
  'gap-fill': '#facc15',
  infill: '#38bdf8',
  'top-bottom': '#f97316',
  support: '#a78bfa',
  'support-tree': '#2ec4b6',
  skirt: '#94a3b8',
  brim: '#eab308',
  raft: '#d946ef',
  bridge: '#f43f5e',
  ironing: '#f8fafc',
};

function clampLayer(layer: number | undefined, maxLayer: number): number {
  if (!Number.isFinite(layer)) return maxLayer;
  return Math.max(0, Math.min(maxLayer, Math.round(layer ?? maxLayer)));
}

function projectMove(move: SliceMove, key: string, inverseHomography: HomographyMatrix, current: boolean): ProjectedMove | null {
  const from = projectImagePointToBed(move.from, inverseHomography);
  const to = projectImagePointToBed(move.to, inverseHomography);
  if (!from || !to) return null;
  return {
    key,
    x1: from.x,
    y1: from.y,
    x2: to.x,
    y2: to.y,
    type: move.type,
    current,
  };
}

function objectContainsBedPoint(object: PlateObject, point: { x: number; y: number }): boolean {
  const scaleX = (object.mirrorX ? -1 : 1) * (object.scale.x || 1);
  const scaleY = (object.mirrorY ? -1 : 1) * (object.scale.y || 1);
  const rotation = -(object.rotation.z * Math.PI) / 180;
  const dx = point.x - object.position.x;
  const dy = point.y - object.position.y;
  const localX = (dx * Math.cos(rotation) - dy * Math.sin(rotation)) / scaleX;
  const localY = (dx * Math.sin(rotation) + dy * Math.cos(rotation)) / scaleY;
  return localX >= object.boundingBox.min.x
    && localX <= object.boundingBox.max.x
    && localY >= object.boundingBox.min.y
    && localY <= object.boundingBox.max.y;
}

function projectedObjectFootprint(object: PlateObject, inverseHomography: HomographyMatrix): string | null {
  const corners = [
    { x: object.boundingBox.min.x, y: object.boundingBox.min.y },
    { x: object.boundingBox.max.x, y: object.boundingBox.min.y },
    { x: object.boundingBox.max.x, y: object.boundingBox.max.y },
    { x: object.boundingBox.min.x, y: object.boundingBox.max.y },
  ].map((corner) => {
    const scaleX = (object.mirrorX ? -1 : 1) * object.scale.x;
    const scaleY = (object.mirrorY ? -1 : 1) * object.scale.y;
    const rotation = (object.rotation.z * Math.PI) / 180;
    const x = corner.x * scaleX;
    const y = corner.y * scaleY;
    return {
      x: object.position.x + x * Math.cos(rotation) - y * Math.sin(rotation),
      y: object.position.y + x * Math.sin(rotation) + y * Math.cos(rotation),
    };
  });
  const projected = corners.map((corner) => projectImagePointToBed(corner, inverseHomography));
  if (projected.some((corner) => corner === null)) return null;
  return projected.map((corner) => `${corner!.x},${corner!.y}`).join(' ');
}

export default function CameraOverlayPanel({ pose, mode, comparison = false }: CameraOverlayPanelProps) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const sliceResult = useSlicerStore((state) => state.sliceResult);
  const plateObjects = useSlicerStore((state) => state.plateObjects);
  const previewLayer = useSlicerStore((state) => state.previewLayer);
  const boardType = usePrinterStore((state) => state.config.boardType);
  const rawBuildObjects = usePrinterStore((state) => state.model.job?.build?.objects);
  const buildObjects = useMemo(() => rawBuildObjects ?? [], [rawBuildObjects]);
  const buildCurrentIdx = usePrinterStore((state) => state.model.job?.build?.currentObject ?? -1);
  const printerLayer = usePrinterStore((state) => state.model.job?.layer);
  const cancelObject = usePrinterStore((state) => state.cancelObject);
  const sendGCode = usePrinterStore((state) => state.sendGCode);
  const maxLayer = Math.max(0, (sliceResult?.layerCount ?? 1) - 1);
  const currentLayer = clampLayer(printerLayer === undefined ? previewLayer : printerLayer - 1, maxLayer);
  const m486Labels = useMemo(() => parseM486Labels(sliceResult?.gcode ?? '').labels, [sliceResult?.gcode]);
  const cancelledNames = useMemo(() => new Set(buildObjects.filter((object) => object.cancelled).map((object) => object.name)), [buildObjects]);
  const menuObject = menu ? plateObjects.find((object) => object.id === menu.objectId) ?? null : null;

  const matchByName = useCallback((object: PlateObject) => {
    const fromBuild = findMatchingObject(object.name, buildObjects, (candidate) => candidate.name);
    if (fromBuild) return fromBuild.name;
    const fromLabels = findMatchingObject(object.name, m486Labels, (label) => label.name);
    return fromLabels ? fromLabels.name : null;
  }, [buildObjects, m486Labels]);

  const isCurrentObject = useCallback((object: PlateObject) => {
    if (boardType === 'duet' && buildCurrentIdx >= 0) {
      const current = buildObjects[buildCurrentIdx];
      return Boolean(current && matchObjectNames(object.name, current.name));
    }
    return false;
  }, [boardType, buildCurrentIdx, buildObjects]);

  const isCancelledObject = useCallback((object: PlateObject) => {
    const matched = matchByName(object);
    return matched ? cancelledNames.has(matched) : false;
  }, [cancelledNames, matchByName]);

  const projectedMoves = useMemo(() => {
    if (!pose || !sliceResult || mode === 'camera') return [];
    const inverseHomography = invertHomography(pose.homography);
    if (!inverseHomography) return [];
    const layers = sliceResult.layers.filter((layer) => layer.layerIndex <= currentLayer);
    const allMoves = layers.flatMap((layer) => layer.moves.map((move, moveIndex) => ({ layerIndex: layer.layerIndex, moveIndex, move })));
    const stride = Math.max(1, Math.ceil(allMoves.length / MAX_OVERLAY_MOVES));
    return allMoves
      .filter((_, index) => index % stride === 0)
      .map(({ layerIndex, moveIndex, move }) => projectMove(move, `${layerIndex}-${moveIndex}`, inverseHomography, layerIndex === currentLayer))
      .filter((move): move is ProjectedMove => move !== null);
  }, [currentLayer, mode, pose, sliceResult]);

  const projectedFootprints = useMemo(() => {
    if (!pose) return [];
    const inverseHomography = invertHomography(pose.homography);
    if (!inverseHomography) return [];
    return plateObjects.map((object) => ({ object, points: projectedObjectFootprint(object, inverseHomography) })).filter((item) => item.points);
  }, [plateObjects, pose]);

  const handleContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!pose || mode === 'camera') return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const imagePoint = {
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    };
    const bedPoint = projectImagePointToBed(imagePoint, pose.homography);
    if (!bedPoint) return;
    const object = [...plateObjects].reverse().find((candidate) => objectContainsBedPoint(candidate, bedPoint));
    if (!object) {
      setMenu(null);
      return;
    }
    setMenu({
      objectId: object.id,
      x: Math.max(0, Math.min(event.clientX - rect.left, rect.width - 220)),
      y: Math.max(0, Math.min(event.clientY - rect.top, rect.height - 140)),
    });
  }, [mode, plateObjects, pose]);

  const handleCancelFromMenu = useCallback(async () => {
    if (!menuObject) return;
    const matched = matchByName(menuObject);
    try {
      if (boardType === 'duet' && matched) {
        const index = buildObjects.findIndex((object) => matchObjectNames(object.name, matched));
        if (index >= 0) await cancelObject(index);
      } else if (boardType === 'klipper' && matched) {
        await sendGCode(`EXCLUDE_OBJECT NAME=${matched}`);
      } else if (boardType === 'marlin' && matched) {
        const label = m486Labels.find((candidate) => matchObjectNames(candidate.name, matched));
        if (label) await sendGCode(`M486 P${label.id}`);
      }
    } finally {
      setMenu(null);
    }
  }, [boardType, buildObjects, cancelObject, m486Labels, matchByName, menuObject, sendGCode]);

  if (mode === 'camera') return null;

  if (!pose) {
    return (
      <div className="cam-panel__ar-overlay cam-panel__ar-overlay--empty" onContextMenu={handleContextMenu}>
        <span>Save camera pose to enable AR preview</span>
      </div>
    );
  }

  if (!sliceResult) {
    return (
      <div className="cam-panel__ar-overlay cam-panel__ar-overlay--empty" onContextMenu={handleContextMenu}>
        <span>Slice a model to show toolpath overlay</span>
      </div>
    );
  }

  return (
    <div className={`cam-panel__ar-overlay${comparison ? ' cam-panel__ar-overlay--comparison' : ''}`} onContextMenu={handleContextMenu}>
      <svg className="cam-panel__ar-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        {projectedFootprints.map(({ object, points }) => (
          <polygon
            key={object.id}
            points={points ?? ''}
            className={[
              'cam-panel__ar-object',
              isCurrentObject(object) ? 'cam-panel__ar-object--current' : '',
              comparison ? 'cam-panel__ar-object--comparison' : '',
            ].filter(Boolean).join(' ')}
          />
        ))}
        {projectedMoves.map((move) => (
          <line
            key={move.key}
            x1={move.x1}
            y1={move.y1}
            x2={move.x2}
            y2={move.y2}
            stroke={TYPE_COLORS[move.type]}
            className={move.current ? 'cam-panel__ar-line cam-panel__ar-line--current' : 'cam-panel__ar-line'}
          />
        ))}
      </svg>
      <span className="cam-panel__ar-badge">
        {comparison ? 'Post-print comparison' : `AR layer ${Math.min(currentLayer + 1, sliceResult.layerCount)} / ${sliceResult.layerCount}`}
      </span>
      {menu && menuObject && (
        <ObjectContextMenu
          obj={menuObject}
          position={{ x: menu.x, y: menu.y }}
          isCurrent={isCurrentObject(menuObject)}
          isCancelled={isCancelledObject(menuObject)}
          onCancel={() => void handleCancelFromMenu()}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
