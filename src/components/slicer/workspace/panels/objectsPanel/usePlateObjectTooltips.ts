import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { computeMeshStats } from "../../../../../engine/meshStats";
import type { PlateObject } from "../../../../../types/slicer";

export function usePlateObjectTooltips(plateObjects: PlateObject[]) {
  const statsCacheRef = useRef(new Map<string, string>());

  useEffect(() => {
    const liveKeys = new Set(
      plateObjects.map((obj) => [
        obj.id,
        obj.geometry?.uuid ?? "no-geometry",
        obj.scale?.x ?? 1,
        obj.scale?.y ?? 1,
        obj.scale?.z ?? 1,
      ].join("|")),
    );
    for (const key of statsCacheRef.current.keys()) {
      if (!liveKeys.has(key)) statsCacheRef.current.delete(key);
    }
  }, [plateObjects]);

  return useCallback((obj: PlateObject): string => {
    const cacheKey = [
      obj.id,
      obj.geometry?.uuid ?? "no-geometry",
      obj.scale?.x ?? 1,
      obj.scale?.y ?? 1,
      obj.scale?.z ?? 1,
    ].join("|");
    const cached = statsCacheRef.current.get(cacheKey);
    if (cached) return cached;
    if (!(obj.geometry instanceof THREE.BufferGeometry)) return obj.name;
    try {
      const stats = computeMeshStats(obj.geometry);
      const sx = obj.scale?.x ?? 1;
      const sy = obj.scale?.y ?? 1;
      const sz = obj.scale?.z ?? 1;
      const volScale = Math.abs(sx * sy * sz);
      const volMl = (stats.volumeMm3 * volScale) / 1000;
      const surfaceCm2 =
        (stats.surfaceAreaMm2 * Math.cbrt(volScale * volScale)) / 100;
      const text = [
        obj.name,
        `Triangles: ${stats.triangleCount.toLocaleString()}`,
        `Volume: ${volMl.toFixed(2)} cm^3`,
        `Surface area: ${surfaceCm2.toFixed(1)} cm^2`,
      ].join("\n");
      statsCacheRef.current.set(cacheKey, text);
      return text;
    } catch {
      return obj.name;
    }
  }, []);
}
