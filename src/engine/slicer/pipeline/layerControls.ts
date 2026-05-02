import type {
  LayerControlOptions,
} from '../../../types/slicer-pipeline-layer-controls.types';
import { fanSpeedToCommandArg } from '../gcode/startEnd';

export function applyLayerStartControls({
  gcode,
  layerIndex: li,
  totalLayers,
  layerZ,
  previousLayerTime,
  printer,
  material: mat,
  print: pp,
  flags,
}: LayerControlOptions): void {
  const fanSArg = (pct: number): string => fanSpeedToCommandArg(printer.scaleFanSpeedTo01, pct);

  if (totalLayers > 0) {
    const pctDone = Math.round((li / totalLayers) * 100);
    // R = remaining minutes. Marlin / Klipper firmware show this on the
    // printer LCD as ETA. We don't know the total print time at emit
    // time, so we emit a per-layer placeholder and patch it in
    // `finalizeGCodeStats` once `totalTime` is known. Token format
    // matches the regex used by the patcher.
    gcode.push(`M73 P${pctDone} R{M73_REMAINING_MIN_PLACEHOLDER_${li}} ; Progress`);
  }

  if ((pp.smallLayerPrintingTemperature ?? 0) > 0 && li > mat.fanDisableFirstLayers) {
    const targetTemp = previousLayerTime < pp.minLayerTime
      ? pp.smallLayerPrintingTemperature!
      : mat.nozzleTemp;
    gcode.push(`M104 S${targetTemp} ; Small layer temp`);
  }

  if (li === 1 && mat.nozzleTemp !== mat.nozzleTempFirstLayer) {
    gcode.push(`M104 S${mat.nozzleTemp} ; Normal nozzle temp`);
  }
  if (li === 1 && printer.hasHeatedBed && mat.bedTemp !== mat.bedTempFirstLayer) {
    gcode.push(`M140 S${mat.bedTemp} ; Normal bed temp`);
  }

  if (pp.coolingFanEnabled === false) return;

  const maxFanPct = pp.maximumFanSpeed ?? mat.fanSpeedMax;
  if (li === 0 && (pp.initialFanSpeed ?? 0) > 0) {
    const initPct = Math.min(pp.initialFanSpeed ?? 0, maxFanPct);
    gcode.push(`M106 S${fanSArg(initPct)} ; Initial fan speed`);
  }
  if (li === mat.fanDisableFirstLayers) {
    gcode.push(`M106 S${fanSArg(mat.fanSpeedMin)} ; Enable fan`);
    if ((pp.initialLayersBuildVolumeFanSpeed ?? 0) > 0 && (pp.buildVolumeFanSpeed ?? 0) > 0) {
      gcode.push(`M106 P2 S${fanSArg(pp.buildVolumeFanSpeed!)} ; Build volume fan regular`);
    }
  }
  if (li > mat.fanDisableFirstLayers && li <= mat.fanDisableFirstLayers + 3) {
    const rampFraction = (li - mat.fanDisableFirstLayers) / 3;
    let fanPct = mat.fanSpeedMin + (mat.fanSpeedMax - mat.fanSpeedMin) * Math.min(rampFraction, 1);
    const thr = pp.regularMaxFanThreshold;
    if (thr && Number.isFinite(previousLayerTime) && previousLayerTime < thr) {
      fanPct = maxFanPct;
    }
    fanPct = Math.min(fanPct, maxFanPct);
    gcode.push(`M106 S${fanSArg(fanPct)} ; Ramp fan`);
  }
  if (!flags.regularFanHeightFired
    && (pp.regularFanSpeedAtHeight ?? 0) > 0
    && layerZ >= (pp.regularFanSpeedAtHeight ?? 0)) {
    flags.regularFanHeightFired = true;
    gcode.push(`M106 S${fanSArg(mat.fanSpeedMin)} ; Regular fan speed at height`);
  }
  if (!flags.buildVolumeFanHeightFired
    && (pp.buildVolumeFanSpeedAtHeight ?? 0) > 0
    && layerZ >= (pp.buildVolumeFanSpeedAtHeight ?? 0)) {
    flags.buildVolumeFanHeightFired = true;
    gcode.push(`M106 P2 S${fanSArg(pp.buildVolumeFanSpeed ?? 0)} ; Build vol fan at height`);
  }
}
