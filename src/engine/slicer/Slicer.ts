import * as THREE from 'three';
import type { MultiPolygon as PCMultiPolygon, Ring as PCRing } from 'polygon-clipping';

import type {
  MaterialProfile,
  PrinterProfile,
  PrintProfile,
  SliceProgress,
  SliceMove,
  SliceResult,
} from '../../types/slicer';
import { SlicerEngine } from './SlicerEngine';
import type { Contour } from './types';

export class Slicer {
  private readonly engine: SlicerEngine;

  constructor(
    printer: PrinterProfile,
    material: MaterialProfile,
    print: PrintProfile,
  ) {
    this.engine = new SlicerEngine(printer, material, print);
  }

  setProgressCallback(cb: (progress: SliceProgress) => void): void {
    this.engine.setProgressCallback(cb);
  }

  cancel(): void {
    this.engine.cancel();
  }

  slice(
    geometries: { geometry: THREE.BufferGeometry; transform: THREE.Matrix4 }[],
  ): Promise<SliceResult> {
    return this.engine.slice(geometries);
  }

  // Compatibility surface for tests and transitional internal callers while
  // the large implementation continues moving behind SlicerEngine.
  signedArea(points: THREE.Vector2[]): number {
    return (this.engine as unknown as { signedArea: (points: THREE.Vector2[]) => number }).signedArea(points);
  }

  classifyContours(rawContours: THREE.Vector2[][]): Contour[] {
    return (this.engine as unknown as { classifyContours: (rawContours: THREE.Vector2[][]) => Contour[] }).classifyContours(rawContours);
  }

  closeContourGaps(contours: Contour[], r: number): Contour[] {
    return (this.engine as unknown as { closeContourGaps: (contours: Contour[], r: number) => Contour[] }).closeContourGaps(contours, r);
  }

  shouldRetractOnTravel(distance: number, extrudedSinceRetract: number, pp: PrintProfile): boolean {
    return (this.engine as unknown as {
      shouldRetractOnTravel: (distance: number, extrudedSinceRetract: number, pp: PrintProfile) => boolean;
    }).shouldRetractOnTravel(distance, extrudedSinceRetract, pp);
  }

  simplifyClosedContour(points: THREE.Vector2[], tolerance: number): THREE.Vector2[] {
    return (this.engine as unknown as {
      simplifyClosedContour: (points: THREE.Vector2[], tolerance: number) => THREE.Vector2[];
    }).simplifyClosedContour(points, tolerance);
  }

  contourToClosedPCRing(contour: THREE.Vector2[]): PCRing {
    return (this.engine as unknown as {
      contourToClosedPCRing: (contour: THREE.Vector2[]) => PCRing;
    }).contourToClosedPCRing(contour);
  }

  multiPolygonToRegions(mp: PCMultiPolygon): Array<{ contour: THREE.Vector2[]; holes: THREE.Vector2[][] }> {
    return (this.engine as unknown as {
      multiPolygonToRegions: (mp: PCMultiPolygon) => Array<{ contour: THREE.Vector2[]; holes: THREE.Vector2[][] }>;
    }).multiPolygonToRegions(mp);
  }

  generateScanLines(
    contour: THREE.Vector2[],
    density: number,
    lineWidth: number,
    angle: number,
    phaseOffset = 0,
    holes: THREE.Vector2[][] = [],
  ): { from: THREE.Vector2; to: THREE.Vector2 }[] {
    return (this.engine as unknown as {
      generateScanLines: (
        contour: THREE.Vector2[],
        density: number,
        lineWidth: number,
        angle: number,
        phaseOffset?: number,
        holes?: THREE.Vector2[][],
      ) => { from: THREE.Vector2; to: THREE.Vector2 }[];
    }).generateScanLines(contour, density, lineWidth, angle, phaseOffset, holes);
  }

  segmentInsideMaterial(
    from: THREE.Vector2,
    to: THREE.Vector2,
    contour: THREE.Vector2[],
    holes: THREE.Vector2[][] = [],
  ): boolean {
    return (this.engine as unknown as {
      segmentInsideMaterial: (
        from: THREE.Vector2,
        to: THREE.Vector2,
        contour: THREE.Vector2[],
        holes?: THREE.Vector2[][],
      ) => boolean;
    }).segmentInsideMaterial(from, to, contour, holes);
  }

  generateAdhesion(
    outerContours: Contour[],
    pp: PrintProfile,
    layerHeight: number,
    offsetX: number,
    offsetY: number,
  ): SliceMove[] {
    return (this.engine as unknown as {
      generateAdhesion: (
        outerContours: Contour[],
        pp: PrintProfile,
        layerHeight: number,
        offsetX: number,
        offsetY: number,
      ) => SliceMove[];
    }).generateAdhesion(outerContours, pp, layerHeight, offsetX, offsetY);
  }
}
