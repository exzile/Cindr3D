/**
 * useCompareMode — owns the "load a CSV alongside the active map and view the
 * diff" workflow.
 *
 * Owns: compareMode flag, the loaded `compareMap`, the displayed CSV path,
 * the loading flag, and the derived `diffMap`. The `displayMap` exposed by
 * this hook is the value the renderer should actually display (diff if
 * comparing, otherwise the active height map).
 *
 * Cross-cuts: entering compare mode forces the diverging-color palette on,
 * exiting restores it. The caller provides the `setDiverging` setter so this
 * hook doesn't need to own the palette state.
 *
 * Extracted out of DuetHeightMap.tsx so the host doesn't carry this
 * workflow's 5 state slots + 2 callbacks + 1 memo inline.
 */

import { useCallback, useMemo, useState } from 'react';
import type { DuetService } from '../../../../services/DuetService';
import type { DuetHeightMap as HeightMapData } from '../../../../types/duet';
import { computeDiffMap } from '../utils';

export interface UseCompareModeDeps {
  service: DuetService | null;
  /** The currently loaded "primary" height map (or null). */
  heightMap: HeightMapData | null;
  /** Caller-owned diverging-palette setter — forced on while comparing. */
  setDiverging: (b: boolean) => void;
}

export interface UseCompareModeApi {
  /** True while a comparison map is being displayed. */
  compareMode: boolean;
  /** Path of the comparison CSV (empty when not comparing). */
  compareCsv: string;
  /** The loaded comparison height map (or null). */
  compareMap: HeightMapData | null;
  /** True while the comparison CSV is being fetched. */
  loadingCompare: boolean;
  /**
   * Computed diff (compareMap - heightMap) when both are present and the
   * grids align; null when not comparing or the grids don't match.
   */
  diffMap: HeightMapData | null;
  /** Load a CSV from the printer and enter compare mode. */
  loadCompare: (path: string) => Promise<void>;
  /** Tear down the comparison — clears state and restores palette. */
  exitCompare: () => void;
}

export function useCompareMode(deps: UseCompareModeDeps): UseCompareModeApi {
  const { service, heightMap, setDiverging } = deps;
  const [compareMode, setCompareMode] = useState(false);
  const [compareCsv, setCompareCsv] = useState('');
  const [compareMap, setCompareMap] = useState<HeightMapData | null>(null);
  const [loadingCompare, setLoadingCompare] = useState(false);

  const diffMap = useMemo(
    () => (compareMode && heightMap && compareMap ? computeDiffMap(heightMap, compareMap) : null),
    [compareMap, compareMode, heightMap],
  );

  const loadCompare = useCallback(async (path: string) => {
    if (!service || !path) return;
    setCompareCsv(path);
    setLoadingCompare(true);
    setDiverging(true);
    try {
      setCompareMap(await service.getHeightMap(path));
      setCompareMode(true);
    } catch {
      setCompareMap(null);
      setCompareMode(false);
      setDiverging(false);
    } finally {
      setLoadingCompare(false);
    }
  }, [service, setDiverging]);

  const exitCompare = useCallback(() => {
    setCompareMode(false);
    setCompareMap(null);
    setCompareCsv('');
    setDiverging(false);
  }, [setDiverging]);

  return { compareMode, compareCsv, compareMap, loadingCompare, diffMap, loadCompare, exitCompare };
}
