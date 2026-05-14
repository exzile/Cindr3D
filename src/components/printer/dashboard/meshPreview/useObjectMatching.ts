/**
 * useObjectMatching — turns plate-objects into status (queued / printing /
 * cancelled / risk / check) using the live build-object list (Duet), the
 * M486 labels parsed out of the slicer output, and the printability report.
 *
 * Also exposes the resolver helpers (matchByName, isCancelledObject,
 * isCurrentObject) so callers can wire up per-object cancel buttons.
 */
import { useCallback, useMemo } from 'react';
import type { PlateObject } from '../../../../types/slicer';
import { parseM486Labels } from '../../../../services/gcode/m486Labels';
import { findMatchingObject, matchObjectNames } from '../../../../services/gcode/objectNameMatch';
import type { ObjectStatus } from './helpers';

interface BuildObject { name: string; cancelled?: boolean }
interface PrintabilityIssue { severity: 'error' | 'warning' | 'info' }
interface PrintabilityEntry { objectId: string; issues: PrintabilityIssue[] }

export interface UseObjectMatchingDeps {
  boardType: string | undefined;
  buildObjects: BuildObject[];
  buildCurrentIdx: number;
  klipperMessage: string | null | undefined;
  gcode: string | null | undefined;
  printabilityObjects: PrintabilityEntry[] | undefined;
}

export function useObjectMatching(deps: UseObjectMatchingDeps) {
  const { boardType, buildObjects, buildCurrentIdx, klipperMessage, gcode, printabilityObjects } = deps;

  const m486Labels = useMemo(() => parseM486Labels(gcode ?? '').labels, [gcode]);

  const cancelledNames = useMemo(() => {
    const set = new Set<string>();
    for (const o of buildObjects) if (o.cancelled) set.add(o.name);
    return set;
  }, [buildObjects]);

  const printabilityByObjectId = useMemo(
    () => new Map((printabilityObjects ?? []).map((entry) => [entry.objectId, entry])),
    [printabilityObjects],
  );

  const matchByName = useCallback((plateObj: PlateObject) => {
    // Try the live build-object list first (Duet only); fall back to M486
    // labels parsed out of the slicer output. The shared name matcher
    // tolerates slicer-emitted suffixes like "_id_0_copy_1".
    const fromBuild = findMatchingObject(plateObj.name, buildObjects, (o) => o.name);
    if (fromBuild) return fromBuild.name;
    const fromLabels = findMatchingObject(plateObj.name, m486Labels, (l) => l.name);
    return fromLabels ? fromLabels.name : null;
  }, [buildObjects, m486Labels]);

  const isCurrentObject = useCallback((plateObj: PlateObject) => {
    if (boardType === 'duet' && buildCurrentIdx >= 0) {
      const cur = buildObjects[buildCurrentIdx];
      if (cur && matchObjectNames(plateObj.name, cur.name)) return true;
    }
    if (boardType === 'klipper' && klipperMessage) {
      // Klipper sets `message` to e.g. "Printing object Cube" — best-effort match.
      if (matchObjectNames(plateObj.name, klipperMessage)) return true;
    }
    return false;
  }, [boardType, buildCurrentIdx, buildObjects, klipperMessage]);

  const isCancelledObject = useCallback((plateObj: PlateObject) => {
    const matched = matchByName(plateObj);
    return matched ? cancelledNames.has(matched) : false;
  }, [matchByName, cancelledNames]);

  const objectStatus = useCallback((plateObj: PlateObject): ObjectStatus => {
    if (isCancelledObject(plateObj)) return { label: 'cancelled', color: '#ef4444' };
    if (isCurrentObject(plateObj)) return { label: 'printing', color: '#44aaff' };
    const report = printabilityByObjectId.get(plateObj.id);
    if (report?.issues.some((issue) => issue.severity === 'error')) return { label: 'risk', color: '#f97316' };
    if (report?.issues.some((issue) => issue.severity === 'warning')) return { label: 'check', color: '#facc15' };
    return { label: 'queued', color: '#a7f3d0' };
  }, [isCancelledObject, isCurrentObject, printabilityByObjectId]);

  return {
    m486Labels,
    printabilityByObjectId,
    matchByName,
    isCurrentObject,
    isCancelledObject,
    objectStatus,
  };
}
