import * as THREE from 'three';
import { type MultiPolygon as PCMultiPolygon, type Ring as PCRing } from 'polygon-clipping';
import type { PrintProfile } from '../../../../../types/slicer';
import {
  contourBBox as contourBBoxFromUtils,
  lineContourIntersections as lineContourIntersectionsFromUtils,
  pointInContour as pointInContourFromUtils,
  reorderFromIndex as reorderFromIndexFromUtils,
  signedArea as signedAreaFromUtils,
} from '../../../geometry/contourUtils';
import {
  classifyContours as classifyContoursFromSegments,
  computeBBox as computeTriangleBBox,
  connectSegments as connectSegmentLoops,
  extractTriangles as extractTrianglesFromGeometries,
  sliceTrianglesAtZ as sliceTriangleSegmentsAtZ,
} from '../../../geometry/coreGeometry';
import {
  closeContourGaps as closeContourGapsFromModule,
  filterPerimetersByMinOdd as filterPerimetersByMinOddFromModule,
  generatePerimetersEx as generatePerimetersExFromModule,
} from '../../perimeters';
import { generatePerimetersArachne } from '../../arachne';
import {
  offsetContour as offsetContourFromModule,
  simplifyClosedContour as simplifyClosedContourFromModule,
} from '../../../geometry/pathGeometry';
import {
  loadClipper2Module,
  offsetPathsClipper2Sync,
} from '../../../geometry/clipper2Wasm';
import { findSeamPosition as findSeamPositionFromModule } from '../../../geometry/seams';
import {
  pointInRing as pointInRingFromModule,
  segmentInsideMaterial as segmentInsideMaterialFromModule,
} from '../../../geometry/regionQueries';
import { computeAdaptiveLayerZs as computeAdaptiveLayerZsFromModule } from '../../adaptiveLayers';
import type { BBox2, Contour, GeneratedPerimeters, Segment, Triangle } from '../../../../../types/slicer-pipeline.types';

export class SlicePipelineGeometry {
  protected printProfile!: PrintProfile;
  private clipper2OffsetWarningShown = false;

  protected extractTriangles(
    geometries: { geometry: THREE.BufferGeometry; transform: THREE.Matrix4 }[],
  ): Triangle[] {
    return extractTrianglesFromGeometries(geometries);
  }

  protected computeBBox(triangles: Triangle[]): THREE.Box3 {
    return computeTriangleBBox(triangles);
  }

  protected sliceTrianglesAtZ(
    triangles: Triangle[],
    z: number,
    offsetX: number,
    offsetY: number,
    _offsetZ: number,
  ): Segment[] {
    return sliceTriangleSegmentsAtZ(triangles, z, offsetX, offsetY);
  }

  protected connectSegments(segments: Segment[]): THREE.Vector2[][] {
    return connectSegmentLoops(segments);
  }

  public classifyContours(rawContours: THREE.Vector2[][]): Contour[] {
    return classifyContoursFromSegments(
      rawContours,
      (contour) => this.contourBBox(contour),
      (point, contour) => this.pointInContour(point, contour),
      (points) => this.signedArea(points),
    );
  }

  public signedArea(points: THREE.Vector2[]): number {
    return signedAreaFromUtils(points);
  }

  protected computeAdaptiveLayerZs(
    triangles: Triangle[],
    modelHeight: number,
    firstLayerHeight: number,
    baseLayerHeight: number,
    maxVariation: number,
    variationStep: number,
    zScale: number,
  ): number[] {
    return computeAdaptiveLayerZsFromModule(
      triangles,
      modelHeight,
      firstLayerHeight,
      baseLayerHeight,
      maxVariation,
      variationStep,
      zScale,
    );
  }

  public closeContourGaps(contours: Contour[], r: number): Contour[] {
    return closeContourGapsFromModule(contours, r, {
      offsetContour: (contour, offset) => this.offsetContour(contour, offset),
      signedArea: (points) => this.signedArea(points),
    });
  }

  protected filterPerimetersByMinOdd(
    p: GeneratedPerimeters,
    minOdd: number,
  ): GeneratedPerimeters {
    return filterPerimetersByMinOddFromModule(p, minOdd, this.printProfile.wallLineWidth);
  }

  protected generatePerimetersEx(
    outerContour: THREE.Vector2[],
    holeContours: THREE.Vector2[][],
    wallCount: number,
    lineWidth: number,
    outerWallInset = 0,
  ): GeneratedPerimeters {
    return generatePerimetersExFromModule(
      outerContour,
      holeContours,
      wallCount,
      lineWidth,
      outerWallInset,
      this.printProfile,
      {
        offsetContour: (contour, offset) => this.offsetContourFast(contour, offset),
        signedArea: (points) => this.signedArea(points),
        multiPolygonToRegions: (mp) => this.multiPolygonToRegions(mp),
      },
    );
  }

  /**
   * Wall generator dispatcher — picks classic fixed-width offset (legacy)
   * or Arachne variable-width walls based on `printProfile.wallGenerator`.
   *
   * Both implementations return the same `GeneratedPerimeters` shape so
   * call sites don't need to know which generator ran. Until Arachne is
   * fully implemented (TaskLists.txt § ARACHNE-*) it falls through to
   * classic, so the toggle is safe to flip on but produces identical
   * output for now.
   */
  public generatePerimeters(
    outerContour: THREE.Vector2[],
    holeContours: THREE.Vector2[][],
    wallCount: number,
    lineWidth: number,
    outerWallInset = 0,
  ): GeneratedPerimeters {
    const deps = {
      offsetContour: (contour: THREE.Vector2[], offset: number) => this.offsetContourFast(contour, offset),
      signedArea: (points: THREE.Vector2[]) => this.signedArea(points),
      multiPolygonToRegions: (mp: PCMultiPolygon) => this.multiPolygonToRegions(mp),
    };
    // Default to classic. The Arachne implementation here is correct on
    // simple geometries (23 unit tests) but incomplete: it lacks proper
    // bead-to-bead transition zones and graph traversal at branch points,
    // which means dense / non-convex polygons produce visible wall
    // artifacts. Opt in per-profile via `wallGenerator: 'arachne'` until
    // the remaining work is done — see TaskLists.txt § ARACHNE-8.
    if (this.printProfile.wallGenerator === 'arachne') {
      return generatePerimetersArachne(
        outerContour, holeContours, wallCount, lineWidth, outerWallInset,
        this.printProfile, deps,
      );
    }
    return generatePerimetersExFromModule(
      outerContour, holeContours, wallCount, lineWidth, outerWallInset,
      this.printProfile, deps,
    );
  }

  protected offsetContour(contour: THREE.Vector2[], offset: number): THREE.Vector2[] {
    return offsetContourFromModule(contour, offset, (points) => this.signedArea(points));
  }

  public async prepareClipper2Offsets(): Promise<void> {
    try {
      await loadClipper2Module();
    } catch (err) {
      if (!this.clipper2OffsetWarningShown) {
        console.warn('Clipper2 WASM offsets unavailable; falling back to JS offsets.', err);
        this.clipper2OffsetWarningShown = true;
      }
    }
  }

  public offsetContourFast(contour: THREE.Vector2[], offset: number): THREE.Vector2[] {
    const clipperContour = this.tryOffsetContourClipper2(contour, offset);
    return clipperContour ?? this.offsetContour(contour, offset);
  }

  private tryOffsetContourClipper2(contour: THREE.Vector2[], offset: number): THREE.Vector2[] | null {
    if (contour.length < 3) return null;
    const windingDelta = this.signedArea(contour) >= 0 ? -offset : offset;
    try {
      const paths = offsetPathsClipper2Sync([contour], windingDelta, { joinType: 'miter' });
      if (!paths || paths.length === 0) return null;
      return paths
        .filter((path) => path.length >= 3)
        .sort((a, b) => Math.abs(this.signedArea(b)) - Math.abs(this.signedArea(a)))[0] ?? null;
    } catch (err) {
      if (!this.clipper2OffsetWarningShown) {
        console.warn('Clipper2 WASM offset failed; falling back to JS offsets.', err);
        this.clipper2OffsetWarningShown = true;
      }
      return null;
    }
  }

  public simplifyClosedContour(points: THREE.Vector2[], tolerance: number): THREE.Vector2[] {
    return simplifyClosedContourFromModule(points, tolerance);
  }

  protected findSeamPosition(
    contour: THREE.Vector2[],
    pp: PrintProfile,
    layerIndex: number,
    nozzleX?: number,
    nozzleY?: number,
    options?: Parameters<typeof findSeamPositionFromModule>[5],
  ): number {
    return findSeamPositionFromModule(contour, pp, layerIndex, nozzleX, nozzleY, options);
  }

  protected reorderFromIndex(contour: THREE.Vector2[], startIdx: number): THREE.Vector2[] {
    return reorderFromIndexFromUtils(contour, startIdx);
  }

  protected lineContourIntersections(
    p1: THREE.Vector2,
    p2: THREE.Vector2,
    contour: THREE.Vector2[],
  ): number[] {
    return lineContourIntersectionsFromUtils(p1, p2, contour);
  }

  protected pointInContour(pt: THREE.Vector2, contour: THREE.Vector2[]): boolean {
    return pointInContourFromUtils(pt, contour);
  }

  protected pointInRing(x: number, y: number, ring: PCRing): boolean {
    return pointInRingFromModule(x, y, ring);
  }

  public segmentInsideMaterial(
    from: THREE.Vector2,
    to: THREE.Vector2,
    contour: THREE.Vector2[],
    holes: THREE.Vector2[][] = [],
  ): boolean {
    return segmentInsideMaterialFromModule(
      from,
      to,
      contour,
      holes,
      (pt, loop) => this.pointInContour(pt, loop),
    );
  }

  protected contourBBox(contour: THREE.Vector2[]): BBox2 {
    return contourBBoxFromUtils(contour);
  }

  protected pointsBBox(points: THREE.Vector2[]): BBox2 {
    return this.contourBBox(points);
  }

  public contourToClosedPCRing(_contour: THREE.Vector2[]): PCMultiPolygon[0][0] {
    throw new Error('Implemented in SlicePipelineFill');
  }

  public multiPolygonToRegions(_mp: PCMultiPolygon): Array<{ contour: THREE.Vector2[]; holes: THREE.Vector2[][] }> {
    throw new Error('Implemented in SlicePipelineFill');
  }
}
