import * as THREE from 'three';
import { type MultiPolygon as PCMultiPolygon, type Ring as PCRing } from 'polygon-clipping';
import type { Contour } from '../../../../../types/slicer-pipeline.types';
import type { PrintProfile, SliceMove } from '../../../../../types/slicer';
import {
  contourToClosedPCRing,
  generateLinearInfill as generateLinearInfillFromModule,
  generateScanLines as generateScanLinesFromModule,
  multiPolygonToRegions,
  sortInfillLines as sortInfillLinesFromModule,
  sortInfillLinesNN as sortInfillLinesNNFromModule,
} from '../../infill';
import { generateSupportForLayer as generateSupportForLayerFromModule } from '../../support';
import { generateAdhesion as generateAdhesionFromModule } from '../../adhesion';
import type { Triangle } from '../../../../../types/slicer-pipeline.types';
import { SlicePipelineGeometry } from './SlicePipelineGeometry';

export class SlicePipelineFill extends SlicePipelineGeometry {
  protected generateLinearInfill(
    contour: THREE.Vector2[],
    density: number,
    lineWidth: number,
    layerIndex: number,
    pattern: string,
    holes: THREE.Vector2[][] = [],
  ): { from: THREE.Vector2; to: THREE.Vector2 }[] {
    return generateLinearInfillFromModule(
      contour,
      density,
      lineWidth,
      layerIndex,
      pattern,
      holes,
      this.printProfile,
      {
        contourBBox: (pts) => this.contourBBox(pts),
        pointInContour: (point, pts) => this.pointInContour(point, pts),
        lineContourIntersections: (from, to, pts) => this.lineContourIntersections(from, to, pts),
        offsetContour: (pts, offset) => this.offsetContourFast(pts, offset),
      },
    );
  }

  public contourToClosedPCRing(contour: THREE.Vector2[]): PCRing {
    return contourToClosedPCRing(contour);
  }

  public multiPolygonToRegions(mp: PCMultiPolygon): Array<{ contour: THREE.Vector2[]; holes: THREE.Vector2[][] }> {
    return multiPolygonToRegions(mp);
  }

  public generateScanLines(
    contour: THREE.Vector2[],
    density: number,
    lineWidth: number,
    angle: number,
    phaseOffset = 0,
    holes: THREE.Vector2[][] = [],
  ): { from: THREE.Vector2; to: THREE.Vector2 }[] {
    return generateScanLinesFromModule(
      contour,
      density,
      lineWidth,
      angle,
      phaseOffset,
      holes,
      this.printProfile,
      {
        contourBBox: (pts) => this.contourBBox(pts),
        pointInContour: (point, pts) => this.pointInContour(point, pts),
        lineContourIntersections: (from, to, pts) => this.lineContourIntersections(from, to, pts),
        offsetContour: (pts, offset) => this.offsetContourFast(pts, offset),
      },
    );
  }

  protected generateSupportForLayer(
    triangles: Triangle[],
    sliceZ: number,
    layerZ: number,
    layerIndex: number,
    offsetX: number,
    offsetY: number,
    _offsetZ: number,
    modelHeight: number,
    modelContours: Contour[],
  ): { moves: SliceMove[]; flowOverride?: number } {
    return generateSupportForLayerFromModule(
      triangles,
      sliceZ,
      layerZ,
      layerIndex,
      offsetX,
      offsetY,
      modelHeight,
      modelContours,
      this.printProfile,
      {
        pointInContour: (pt, contour) => this.pointInContour(pt, contour),
        pointsBBox: (points) => this.pointsBBox(points),
        generateScanLines: (contour, density, lineWidth, angle, phaseOffset, holes) =>
          this.generateScanLines(contour, density, lineWidth, angle, phaseOffset, holes),
      },
    );
  }

  public generateAdhesion(
    contours: Contour[],
    pp: PrintProfile,
    _layerH: number,
    _offsetX: number,
    _offsetY: number,
  ): SliceMove[] {
    void _layerH;
    void _offsetX;
    void _offsetY;

    return generateAdhesionFromModule(contours, pp, {
      simplifyClosedContour: (points, tolerance) => this.simplifyClosedContour(points, tolerance),
      offsetContour: (contour, offset) => this.offsetContour(contour, offset),
      generateScanLines: (contour, density, lineWidth, angle, phaseOffset, holes) =>
        this.generateScanLines(contour, density, lineWidth, angle, phaseOffset, holes),
      sortInfillLines: (lines) => this.sortInfillLines(lines),
    });
  }

  protected sortInfillLines<T extends { from: THREE.Vector2; to: THREE.Vector2 }>(
    lines: T[],
  ): T[] {
    return sortInfillLinesFromModule(lines);
  }

  protected sortInfillLinesNN<T extends { from: THREE.Vector2; to: THREE.Vector2 }>(
    lines: T[],
    startX: number,
    startY: number,
  ): T[] {
    return sortInfillLinesNNFromModule(lines, startX, startY);
  }
}
