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
import type { ArachneGenerationContext } from '../../arachne/types';

export class SlicePipelineGeometry {
  public printProfile!: PrintProfile;
  private clipper2OffsetWarningShown = false;
  private spiralizeArachneWarningShown = false;
  private perimeterCache = new Map<string, GeneratedPerimeters>();
  private static readonly MAX_PERIMETER_CACHE_ENTRIES = 512;
  /** Debug toggle. `VITE_SLICER_DISABLE_CACHE=1` bypasses the per-slice
   *  Arachne perimeter cache so every contour is recomputed from
   *  scratch — useful when iterating on wall code so cached results
   *  from a previous slice run can't hide a code change. */
  private static readonly DISABLE_PERIMETER_CACHE = (() => {
    const env = (typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, unknown> }).env) || {};
    const raw = env.VITE_SLICER_DISABLE_CACHE;
    return raw === '1' || raw === 'true' || raw === true;
  })();

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
    void _offsetZ;

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
    topographySize: number = 0,
  ): number[] {
    return computeAdaptiveLayerZsFromModule(
      triangles,
      modelHeight,
      firstLayerHeight,
      baseLayerHeight,
      maxVariation,
      variationStep,
      zScale,
      topographySize,
    );
  }

  public closeContourGaps(contours: Contour[], r: number): Contour[] {
    return closeContourGapsFromModule(contours, r, {
      offsetContour: (contour, offset) => this.offsetContour(contour, offset),
      signedArea: (points) => this.signedArea(points),
    });
  }

  public filterPerimetersByMinOdd(
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

  private static quantizedPointKey(point: THREE.Vector2): string {
    return `${Math.round(point.x * 1000)},${Math.round(point.y * 1000)}`;
  }

  private static contourKey(contour: THREE.Vector2[]): string {
    return contour.map((point) => SlicePipelineGeometry.quantizedPointKey(point)).join(';');
  }

  private arachneProfileKey(): string {
    const pp = this.printProfile;
    return [
      pp.arachneBackend ?? 'wasm',
      pp.outerWallLineWidth ?? '',
      pp.innerWallLineWidth ?? '',
      pp.minWallLineWidth ?? '',
      pp.minEvenWallLineWidth ?? '',
      pp.minThinWallLineWidth ?? '',
      pp.minFeatureSize ?? '',
      pp.wallTransitionLength ?? '',
      pp.wallTransitionAngle ?? '',
      pp.wallTransitionFilterDistance ?? '',
      pp.wallTransitionFilterMargin ?? '',
      pp.wallDistributionCount ?? '',
      pp.minWallLengthFactor ?? '',
      pp.printThinWalls ?? '',
      pp.thinWallDetection ?? '',
      pp.fluidMotionEnable ?? '',
      pp.preciseOuterWall ?? '',
      pp.minOddWallLineWidth ?? '',
    ].join('|');
  }

  private perimeterCacheKey(
    outerContour: THREE.Vector2[],
    holeContours: THREE.Vector2[][],
    wallCount: number,
    lineWidth: number,
    outerWallInset: number,
    context: ArachneGenerationContext,
  ): string {
    return [
      wallCount,
      lineWidth,
      outerWallInset,
      context.sectionType ?? 'wall',
      context.isTopOrBottomLayer ? 1 : 0,
      context.isFirstLayer ? 1 : 0,
      this.arachneProfileKey(),
      SlicePipelineGeometry.contourKey(outerContour),
      ...holeContours.map((hole) => SlicePipelineGeometry.contourKey(hole)),
    ].join('#');
  }

  private rememberPerimeters(cacheKey: string, perimeters: GeneratedPerimeters): GeneratedPerimeters {
    if (this.perimeterCache.size >= SlicePipelineGeometry.MAX_PERIMETER_CACHE_ENTRIES) {
      const oldestKey = this.perimeterCache.keys().next().value;
      if (oldestKey) this.perimeterCache.delete(oldestKey);
    }
    this.perimeterCache.set(cacheKey, perimeters);
    return perimeters;
  }

  /**
   * Wall generator dispatcher — picks classic fixed-width offset (legacy)
   * or Arachne variable-width walls based on `printProfile.wallGenerator`.
   *
   * Both implementations return the same `GeneratedPerimeters` shape so
   * call sites don't need to know which generator ran. Arachne is the
   * production default via libArachne WASM; classic remains available as
   * an explicit fixed-width fallback and as an error recovery path.
   */
  public generatePerimeters(
    outerContour: THREE.Vector2[],
    holeContours: THREE.Vector2[][],
    wallCount: number,
    lineWidth: number,
    outerWallInset = 0,
    context: ArachneGenerationContext = {},
  ): GeneratedPerimeters {
    const deps = {
      offsetContour: (contour: THREE.Vector2[], offset: number) => this.offsetContourFast(contour, offset),
      signedArea: (points: THREE.Vector2[]) => this.signedArea(points),
      multiPolygonToRegions: (mp: PCMultiPolygon) => this.multiPolygonToRegions(mp),
    };
    // Default is Arachne via libArachne WASM (ARACHNE-9). Profile can opt
    // back to `wallGenerator: 'classic'` for fixed-width walls.
    //
    // Spiralize / vase mode INTENTIONALLY forces classic walls. Arachne's
    // variable-width pipeline produces branchy ExtrusionLines with gap-
    // fill medial-axis tips and short transition zones — none of which
    // can be wound into a continuous spiral. Cura/Orca apply the same
    // gating: if a user enables vase mode, walls are always single-pass
    // fixed-width concentric loops. Warn once so the choice is visible.
    if (this.printProfile.spiralizeContour && this.printProfile.wallGenerator === 'arachne') {
      if (!this.spiralizeArachneWarningShown) {
        console.warn(
          '[slicer] Spiralize / vase mode is incompatible with Arachne walls; '
          + 'falling back to classic fixed-width walls for this print.',
        );
        this.spiralizeArachneWarningShown = true;
      }
    } else if (this.printProfile.wallGenerator === 'arachne') {
      const cacheKey = this.perimeterCacheKey(
        outerContour,
        holeContours,
        wallCount,
        lineWidth,
        outerWallInset,
        context,
      );
      const cached = SlicePipelineGeometry.DISABLE_PERIMETER_CACHE ? undefined : this.perimeterCache.get(cacheKey);
      if (cached) return cached;
      return this.rememberPerimeters(cacheKey, generatePerimetersArachne(
        outerContour, holeContours, wallCount, lineWidth, outerWallInset,
        this.printProfile, deps, context,
      ));
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

  public pointInContour(pt: THREE.Vector2, contour: THREE.Vector2[]): boolean {
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
    void _contour;
    throw new Error('Implemented in SlicePipelineFill');
  }

  public multiPolygonToRegions(_mp: PCMultiPolygon): Array<{ contour: THREE.Vector2[]; holes: THREE.Vector2[][] }> {
    void _mp;
    throw new Error('Implemented in SlicePipelineFill');
  }
}
