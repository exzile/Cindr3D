import type {
  MaterialProfile,
  PrinterProfile,
  PrintProfile,
  SliceMove,
} from '../../../types/slicer';
import type { GCodeEmitterOptions, ExtrusionMoveResult } from '../../../types/slicer-gcode-emitter.types';
import type { StartEndMachineState } from '../../../types/slicer-gcode.types';
import { fanSpeedToCommandArg } from './startEnd';
import { shouldRetractOnTravel } from './travel';

type TravelPoint = { x: number; y: number };
type CircleObstacle = { kind: 'circle'; cx: number; cy: number; r: number };
type SegmentObstacle = { kind: 'segment'; x1: number; y1: number; x2: number; y2: number; r: number };
type TravelObstacle = CircleObstacle | SegmentObstacle;
type TravelRouteOptions = {
  avoidPrintedParts?: boolean;
};

function createStartEndState(
  stateOwner: GCodeEmitter,
  relativeExtrusion: boolean,
): StartEndMachineState {
  return {
    get currentX(): number { return stateOwner.currentX; },
    set currentX(value: number) { stateOwner.currentX = value; },
    get currentY(): number { return stateOwner.currentY; },
    set currentY(value: number) { stateOwner.currentY = value; },
    get currentZ(): number { return stateOwner.currentZ; },
    set currentZ(value: number) { stateOwner.currentZ = value; },
    get currentE(): number { return stateOwner.currentE; },
    set currentE(value: number) { stateOwner.currentE = value; },
    get isRetracted(): boolean { return stateOwner.isRetracted; },
    set isRetracted(value: boolean) { stateOwner.isRetracted = value; },
    get extrudedSinceRetract(): number { return stateOwner.extrudedSinceRetract; },
    set extrudedSinceRetract(value: number) { stateOwner.extrudedSinceRetract = value; },
    templateUsesAbsolutePositioning: true,
    templateUsesAbsoluteExtrusion: !relativeExtrusion,
  };
}

export class GCodeEmitter {
  readonly gcode: string[];
  readonly printer: PrinterProfile;
  readonly material: MaterialProfile;
  readonly print: PrintProfile;
  readonly relativeExtrusion: boolean;

  currentE = 0;
  currentX = 0;
  currentY = 0;
  currentZ = 0;
  isRetracted = false;
  extrudedSinceRetract = 0;
  currentLayerFlow = 1.0;
  currentLayerTravelSpeed: number;
  totalExtruded = 0;
  /** Last `;WIDTH:` value emitted to gcode. Used to dedupe repeated
   *  width comments across same-width segments. -1 forces emission on
   *  the first extrude after a layer/feature change. */
  private currentEmittedLineWidth = -1;

  private readonly isRRF: boolean;
  private readonly isKlipper: boolean;
  private readonly flowCompFactor: number;
  private readonly maxFlowRate: number;
  private readonly hopEnabled: boolean;
  private readonly hopHeight: number;
  private readonly hopFeedPerMin: number;
  private readonly extraPrime: number;
  private readonly wipeDist: number;
  private readonly wipeExtraPrime: number;
  private currentAccel = -1;
  private currentJerk = -1;
  private lastExtrudeDx = 0;
  private lastExtrudeDy = 0;
  private readonly machineState: StartEndMachineState;

  /** Obstacle approximations (one per hole) used by avoidCrossingPerimeters
   *  to detour travel moves around the hole interior. Each obstacle is
   *  the hole's enclosing circle (centroid + max-radius) — adequate for
   *  the typical mounting-hole shape and cheap to test against. */
  private layerObstacles: CircleObstacle[] | null = null;
  private printedSegments: SegmentObstacle[] = [];

  constructor({
    gcode,
    printer,
    material,
    print,
    flavor,
    relativeExtrusion,
  }: GCodeEmitterOptions) {
    this.gcode = gcode;
    this.printer = printer;
    this.material = material;
    this.print = print;
    this.relativeExtrusion = relativeExtrusion;
    this.currentLayerTravelSpeed = print.travelSpeed;
    this.isRRF = flavor === 'duet' || flavor === 'reprap';
    this.isKlipper = flavor === 'klipper';
    this.flowCompFactor = print.flowRateCompensationFactor ?? 1.0;
    this.maxFlowRate = print.maxFlowRate ?? 0;
    this.hopEnabled = print.zHopWhenRetracted ?? (material.retractionZHop > 0);
    this.hopHeight = print.zHopWhenRetracted ? (print.zHopHeight ?? 0.4) : material.retractionZHop;
    this.hopFeedPerMin = ((print.zHopSpeed ?? print.travelSpeed) * 60);
    this.extraPrime = print.retractionExtraPrimeAmount ?? 0;
    this.wipeDist = print.wipeRetractionDistance ?? 0;
    this.wipeExtraPrime = print.wipeRetractionExtraPrime ?? 0;
    this.machineState = createStartEndState(this, relativeExtrusion);
  }

  get startEndState(): StartEndMachineState {
    return this.machineState;
  }

  fanSpeedArg(pct: number): string {
    return fanSpeedToCommandArg(this.printer.scaleFanSpeedTo01, pct);
  }

  calculateExtrusion(distance: number, lineWidth: number, layerHeight: number): number {
    const filamentArea = Math.PI * (this.printer.filamentDiameter / 2) ** 2;
    const volumePerMm = lineWidth * layerHeight;
    return (volumePerMm / filamentArea)
      * distance
      * this.material.flowRate
      * this.currentLayerFlow
      * this.flowCompFactor;
  }

  setAccel(val: number | undefined, fallback: number): void {
    if (!this.print.accelerationEnabled) return;
    const v = Math.round(val ?? fallback);
    if (v === this.currentAccel) return;
    this.gcode.push(`M204 S${v} ; Accel`);
    this.currentAccel = v;
  }

  setJerk(val: number | undefined, fallback: number): void {
    if (!this.print.jerkEnabled) return;
    const v = Number((val ?? fallback).toFixed(2));
    if (v === this.currentJerk) return;
    if (this.isRRF) {
      const mmPerMin = Math.round(v * 60);
      this.gcode.push(`M566 X${mmPerMin} Y${mmPerMin} ; Jerk (RRF instantaneous speed change)`);
    } else if (this.isKlipper) {
      this.gcode.push(`SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=${v} ; Jerk (Klipper SCV)`);
    } else {
      this.gcode.push(`M205 X${v} Y${v} ; Jerk`);
    }
    this.currentJerk = v;
  }

  retract(): void {
    if (this.isRetracted || this.material.retractionDistance <= 0) return;

    if (this.wipeDist > 0) {
      const dirLen = Math.sqrt(
        this.lastExtrudeDx * this.lastExtrudeDx + this.lastExtrudeDy * this.lastExtrudeDy,
      );
      if (dirLen > 1e-6) {
        const ux = this.lastExtrudeDx / dirLen;
        const uy = this.lastExtrudeDy / dirLen;
        const wx = this.currentX + ux * this.wipeDist;
        const wy = this.currentY + uy * this.wipeDist;
        this.gcode.push(`G0 X${wx.toFixed(3)} Y${wy.toFixed(3)} F${(this.print.travelSpeed * 60).toFixed(0)} ; Wipe`);
        this.currentX = wx;
        this.currentY = wy;
      }
    }

    if (this.printer.firmwareRetraction) {
      this.gcode.push('G10 ; Firmware retract');
    } else {
      const retractF = ((this.material.retractionRetractSpeed ?? this.material.retractionSpeed) * 60).toFixed(0);
      if (this.relativeExtrusion) {
        this.gcode.push(`G1 E${(-this.material.retractionDistance).toFixed(5)} F${retractF}`);
      } else {
        this.currentE -= this.material.retractionDistance;
        this.gcode.push(`G1 E${this.currentE.toFixed(5)} F${retractF}`);
      }
    }

    if (this.hopEnabled && this.hopHeight > 0) {
      const hopZ = this.currentZ + this.hopHeight;
      this.gcode.push(`G1 Z${hopZ.toFixed(3)} F${this.hopFeedPerMin.toFixed(0)}`);
      this.currentZ = hopZ;
    }

    this.isRetracted = true;
    this.extrudedSinceRetract = 0;
  }

  unretract(): void {
    if (!this.isRetracted || this.material.retractionDistance <= 0) return;

    if (this.hopEnabled && this.hopHeight > 0) {
      const baseZ = this.currentZ - this.hopHeight;
      this.gcode.push(`G1 Z${baseZ.toFixed(3)} F${this.hopFeedPerMin.toFixed(0)}`);
      this.currentZ = baseZ;
    }

    if (this.printer.firmwareRetraction) {
      this.gcode.push('G11 ; Firmware unretract');
    } else {
      const primeDelta = this.material.retractionDistance
        + this.extraPrime
        + (this.wipeDist > 0 ? this.wipeExtraPrime : 0);
      const primeF = ((this.material.retractionPrimeSpeed ?? this.material.retractionSpeed) * 60).toFixed(0);
      if (this.relativeExtrusion) {
        this.gcode.push(`G1 E${primeDelta.toFixed(5)} F${primeF}`);
      } else {
        this.currentE += primeDelta;
        this.gcode.push(`G1 E${this.currentE.toFixed(5)} F${primeF}`);
      }
    }

    this.isRetracted = false;
  }

  rawTravelTo(x: number, y: number, speed: number, comment?: string): void {
    const suffix = comment ? ` ; ${comment}` : '';
    this.gcode.push(`G0 X${x.toFixed(3)} Y${y.toFixed(3)} F${(speed * 60).toFixed(0)}${suffix}`);
    this.currentX = x;
    this.currentY = y;
  }

  /** Set the obstacle list for avoidCrossingPerimeters routing. Holes
   *  are approximated as enclosing circles (centroid + max-radius). */
  setLayerObstacles(holes: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>): void {
    this.printedSegments = [];
    if (!holes || holes.length === 0) {
      this.layerObstacles = null;
      return;
    }
    this.layerObstacles = holes.map((h) => {
      let cx = 0;
      let cy = 0;
      for (const p of h) { cx += p.x; cy += p.y; }
      cx /= h.length;
      cy /= h.length;
      let r = 0;
      for (const p of h) {
        const d = Math.hypot(p.x - cx, p.y - cy);
        if (d > r) r = d;
      }
      return { kind: 'circle' as const, cx, cy, r };
    });
  }

  /**
   * Travel (non-extruding) move to (x, y).
   *
   * If `moves` is provided, a corresponding `travel` SliceMove is pushed onto
   * it so the preview can:
   *   (a) correctly split extrusion chains at wall-loop boundaries (otherwise
   *       the preview's chain detection sees consecutive wall-inner moves
   *       from *different* loops and strings them into one tube, creating
   *       radial-connector "teeth" at the loop boundaries);
   *   (b) optionally render the travel line and any retraction dot that the
   *       travel triggered.
   *
   * Callers emitting extrusion features should pass their layer's `moves`
   * array so loop boundaries round-trip through the preview correctly.
   *
   * If `print.avoidCrossingPerimeters` is on AND `setLayerObstacles` has
   * been called for this layer, the travel is routed around hole obstacles
   * (each hole approximated as its enclosing circle). The detour passes
   * `obstacleMargin` outside the circle on whichever side gives the
   * shorter total path. Prevents the "infill jumping straight across the
   * layer crosses through walls and holes" artifact that's visible as
   * white travel lines passing through wall geometry in the preview.
   */
  travelTo(x: number, y: number, moves?: SliceMove[], options: TravelRouteOptions = {}): void {
    const path = this.routeTravelAroundObstacles(x, y, options);
    for (const wp of path) {
      this.rawTravelMove(wp.x, wp.y, moves);
    }
  }

  /** Internal — performs a single straight-line travel and pushes the
   *  preview move. Factored out so `travelTo` can emit multiple sub-moves
   *  when routing around obstacles. */
  private rawTravelMove(x: number, y: number, moves?: SliceMove[]): void {
    const dx = x - this.currentX;
    const dy = y - this.currentY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1e-4) return;
    const fromX = this.currentX;
    const fromY = this.currentY;
    const wasRetracted = this.isRetracted;
    if (shouldRetractOnTravel(dist, this.extrudedSinceRetract, this.print)) {
      this.retract();
    }
    if (this.print.travelAccelerationEnabled ?? this.print.accelerationEnabled) {
      this.setAccel(this.print.accelerationTravel, this.print.accelerationPrint);
    }
    if (this.print.travelJerkEnabled ?? this.print.jerkEnabled) {
      this.setJerk(this.print.jerkTravel, this.print.jerkPrint);
    }
    this.rawTravelTo(x, y, this.currentLayerTravelSpeed);
    if (moves) {
      const retractExtrusion = (!wasRetracted && this.isRetracted)
        ? -(this.material.retractionDistance ?? 0)
        : 0;
      moves.push({
        type: 'travel',
        from: { x: fromX, y: fromY },
        to: { x, y },
        speed: this.currentLayerTravelSpeed,
        extrusion: retractExtrusion,
        lineWidth: 0,
      });
    }
  }

  /** Returns a list of waypoints for the travel from current position
   *  to (toX, toY). If avoidCrossingPerimeters is off or no obstacles
   *  block the path, this is just `[{toX, toY}]`. Otherwise the list
   *  includes detour waypoints that route around blocking obstacles.
   *  Uses an iterative loop with bounded iterations rather than true
   *  recursion to avoid stack overflows on degenerate geometry. */
  private routeTravelAroundObstacles(toX: number, toY: number, options: TravelRouteOptions = {}): TravelPoint[] {
    const obstacles = this.getTravelObstacles(options.avoidPrintedParts ?? true);
    if (!this.print.avoidCrossingPerimeters || obstacles.length === 0) {
      return [{ x: toX, y: toY }];
    }

    const path: TravelPoint[] = [];
    let cursorX = this.currentX;
    let cursorY = this.currentY;
    const margin = 0.5;
    const visited = new Set<number>();
    // Bound the loop — no realistic layer has > 10 holes blocking a single
    // travel path. The cap protects against degenerate geometry where a
    // detour point lands inside another obstacle's blocking corridor and
    // would otherwise loop forever.
    for (let iteration = 0; iteration < 10; iteration++) {
      const dx = toX - cursorX;
      const dy = toY - cursorY;
      const len = Math.hypot(dx, dy);
      if (len < 1e-4) break;
      const nx = dx / len;
      const ny = dy / len;

      let blockingT = Infinity;
      let blockerIdx = -1;
      let blocker: TravelObstacle | null = null;
      let blockPoint: TravelPoint | null = null;
      for (let i = 0; i < obstacles.length; i++) {
        if (visited.has(i)) continue;
        const ob = obstacles[i];
        const hit = ob.kind === 'circle'
          ? this.findCircleTravelBlock(cursorX, cursorY, nx, ny, len, ob, margin)
          : this.findSegmentTravelBlock(cursorX, cursorY, toX, toY, ob, margin);
        if (!hit || hit.t < margin) continue;
        if (hit.t < blockingT) {
          blockingT = hit.t;
          blocker = ob;
          blockerIdx = i;
          blockPoint = hit.point;
        }
      }
      if (!blocker) break;
      visited.add(blockerIdx);

      const avoidDist = blocker.r + margin;
      const perpX = -ny;
      const perpY = nx;
      const center = blocker.kind === 'circle'
        ? { x: blocker.cx, y: blocker.cy }
        : (blockPoint ?? {
            x: (blocker.x1 + blocker.x2) * 0.5,
            y: (blocker.y1 + blocker.y2) * 0.5,
          });
      const leftX = center.x + perpX * avoidDist;
      const leftY = center.y + perpY * avoidDist;
      const rightX = center.x - perpX * avoidDist;
      const rightY = center.y - perpY * avoidDist;
      const distLeft = Math.hypot(cursorX - leftX, cursorY - leftY) + Math.hypot(leftX - toX, leftY - toY);
      const distRight = Math.hypot(cursorX - rightX, cursorY - rightY) + Math.hypot(rightX - toX, rightY - toY);
      const detour = distLeft <= distRight ? { x: leftX, y: leftY } : { x: rightX, y: rightY };
      path.push(detour);
      cursorX = detour.x;
      cursorY = detour.y;
    }
    path.push({ x: toX, y: toY });
    return path;
  }

  private getTravelObstacles(includePrintedSegments: boolean): TravelObstacle[] {
    const obstacles: TravelObstacle[] = [];
    if (this.layerObstacles) obstacles.push(...this.layerObstacles);
    if (includePrintedSegments && ((this.print.avoidPrintedParts ?? true) || this.print.avoidSupports)) {
      obstacles.push(...this.printedSegments);
    }
    return obstacles;
  }

  private findCircleTravelBlock(
    fromX: number,
    fromY: number,
    nx: number,
    ny: number,
    len: number,
    obstacle: CircleObstacle,
    margin: number,
  ): { t: number; point: TravelPoint } | null {
    const fcx = obstacle.cx - fromX;
    const fcy = obstacle.cy - fromY;
    const t = fcx * nx + fcy * ny;
    if (t < -obstacle.r || t > len + obstacle.r) return null;
    const px = fromX + nx * t;
    const py = fromY + ny * t;
    const clearance = obstacle.r + margin;
    const perpDist = Math.hypot(obstacle.cx - px, obstacle.cy - py);
    if (perpDist >= clearance) return null;
    const enterT = t - Math.sqrt(Math.max(0, clearance * clearance - perpDist * perpDist));
    if (enterT > len - margin || !Number.isFinite(enterT)) return null;
    return { t: Math.max(0, enterT), point: { x: obstacle.cx, y: obstacle.cy } };
  }

  private findSegmentTravelBlock(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    obstacle: SegmentObstacle,
    margin: number,
  ): { t: number; point: TravelPoint } | null {
    const ax = fromX;
    const ay = fromY;
    const bx = toX;
    const by = toY;
    const cx = obstacle.x1;
    const cy = obstacle.y1;
    const dx = obstacle.x2;
    const dy = obstacle.y2;
    const ux = bx - ax;
    const uy = by - ay;
    const vx = dx - cx;
    const vy = dy - cy;
    const uu = ux * ux + uy * uy;
    const vv = vx * vx + vy * vy;
    if (uu < 1e-8 || vv < 1e-8) return null;
    const wx = ax - cx;
    const wy = ay - cy;
    const uv = ux * vx + uy * vy;
    const uw = ux * wx + uy * wy;
    const vw = vx * wx + vy * wy;
    const denom = uu * vv - uv * uv;
    let s = denom > 1e-8 ? (uv * vw - vv * uw) / denom : 0;
    s = Math.max(0, Math.min(1, s));
    let q = (uv * s + vw) / vv;
    q = Math.max(0, Math.min(1, q));
    s = Math.max(0, Math.min(1, (uv * q - uw) / uu));

    const px = ax + ux * s;
    const py = ay + uy * s;
    const ox = cx + vx * q;
    const oy = cy + vy * q;
    const clearance = obstacle.r + margin;
    if (Math.hypot(px - ox, py - oy) >= clearance) return null;
    return { t: Math.sqrt(uu) * s, point: { x: ox, y: oy } };
  }

  /** Reset the cached `;WIDTH:` value so the next `extrudeTo` re-emits
   *  the width comment. Call when a new feature/section starts so the
   *  width is asserted into the gcode even if it matches the previous
   *  feature's last width. */
  resetEmittedLineWidth(): void {
    this.currentEmittedLineWidth = -1;
  }

  extrudeTo(
    x: number,
    y: number,
    speed: number,
    lineWidth: number,
    layerHeight: number,
    z?: number,
  ): ExtrusionMoveResult {
    this.unretract();
    if (lineWidth > 0 && Math.abs(lineWidth - this.currentEmittedLineWidth) > 1e-4) {
      this.gcode.push(`;WIDTH:${lineWidth.toFixed(6)}`);
      this.currentEmittedLineWidth = lineWidth;
    }
    const fromX = this.currentX;
    const fromY = this.currentY;
    const dx = x - this.currentX;
    const dy = y - this.currentY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const extrusion = this.calculateExtrusion(dist, lineWidth, layerHeight);
    this.currentE += extrusion;
    this.totalExtruded += extrusion;
    this.extrudedSinceRetract += extrusion;
    let clampedSpeed = speed;
    if (this.maxFlowRate > 0 && lineWidth > 0 && layerHeight > 0) {
      const flowSpeedCap = this.maxFlowRate / (lineWidth * layerHeight);
      if (clampedSpeed > flowSpeedCap) clampedSpeed = flowSpeedCap;
    }
    const flowEqualizationRatio = Math.max(0, Math.min(1, this.print.flowEqualizationRatio ?? 0));
    const nominalLineWidth = this.print.wallLineWidth > 0 ? this.print.wallLineWidth : lineWidth;
    if (flowEqualizationRatio > 0 && lineWidth > nominalLineWidth && nominalLineWidth > 0) {
      const equalizedSpeed = speed * (nominalLineWidth / lineWidth);
      const blendedSpeed = speed + (equalizedSpeed - speed) * flowEqualizationRatio;
      if (clampedSpeed > blendedSpeed) clampedSpeed = blendedSpeed;
    }
    // Vase / spiralize mode passes a per-segment Z so the outer wall climbs
    // continuously instead of stepping per-layer. Emit Z only when the
    // requested Z differs from the current Z (avoids spurious Z words on
    // every regular move).
    const zChanged = z !== undefined && Math.abs(z - this.currentZ) > 1e-4;
    if (zChanged) {
      this.gcode.push(
        `G1 X${x.toFixed(3)} Y${y.toFixed(3)} Z${z!.toFixed(3)} E${this.relativeExtrusion ? extrusion.toFixed(5) : this.currentE.toFixed(5)} F${(clampedSpeed * 60).toFixed(0)}`,
      );
      this.currentZ = z!;
    } else {
      this.gcode.push(
        `G1 X${x.toFixed(3)} Y${y.toFixed(3)} E${this.relativeExtrusion ? extrusion.toFixed(5) : this.currentE.toFixed(5)} F${(clampedSpeed * 60).toFixed(0)}`,
      );
    }
    if (dist > 1e-6) {
      this.lastExtrudeDx = dx;
      this.lastExtrudeDy = dy;
      if (lineWidth > 0) {
        this.printedSegments.push({
          kind: 'segment',
          x1: fromX,
          y1: fromY,
          x2: x,
          y2: y,
          r: lineWidth * 0.5,
        });
      }
    }
    this.currentX = x;
    this.currentY = y;
    return {
      time: dist / clampedSpeed,
      extrusion,
      speed: clampedSpeed,
      distance: dist,
    };
  }
}
