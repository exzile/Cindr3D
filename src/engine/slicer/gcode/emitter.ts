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
    const emitter = this;
    this.machineState = {
      get currentX(): number { return emitter.currentX; },
      set currentX(value: number) { emitter.currentX = value; },
      get currentY(): number { return emitter.currentY; },
      set currentY(value: number) { emitter.currentY = value; },
      get currentZ(): number { return emitter.currentZ; },
      set currentZ(value: number) { emitter.currentZ = value; },
      get currentE(): number { return emitter.currentE; },
      set currentE(value: number) { emitter.currentE = value; },
      get isRetracted(): boolean { return emitter.isRetracted; },
      set isRetracted(value: boolean) { emitter.isRetracted = value; },
      get extrudedSinceRetract(): number { return emitter.extrudedSinceRetract; },
      set extrudedSinceRetract(value: number) { emitter.extrudedSinceRetract = value; },
      templateUsesAbsolutePositioning: true,
      templateUsesAbsoluteExtrusion: !relativeExtrusion,
    };
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
   */
  travelTo(x: number, y: number, moves?: SliceMove[]): void {
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
      // A travel that triggered a retraction carries the retraction distance
      // as a negative `extrusion` value — the preview renders those as
      // retraction dots.
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

  extrudeTo(
    x: number,
    y: number,
    speed: number,
    lineWidth: number,
    layerHeight: number,
  ): ExtrusionMoveResult {
    this.unretract();
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
    this.gcode.push(
      `G1 X${x.toFixed(3)} Y${y.toFixed(3)} E${this.relativeExtrusion ? extrusion.toFixed(5) : this.currentE.toFixed(5)} F${(clampedSpeed * 60).toFixed(0)}`,
    );
    if (dist > 1e-6) {
      this.lastExtrudeDx = dx;
      this.lastExtrudeDy = dy;
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
