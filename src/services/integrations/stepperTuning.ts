import type { PrinterBoardType } from '../../types/duet';
import type { StepperAxisTuning } from '../../store/stepperTuningStore';

export function buildStepperTuningCommands(
  boardType: PrinterBoardType | undefined,
  axis: string,
  tuning: StepperAxisTuning,
): string[] {
  const letter = axis.toUpperCase();
  if (boardType === 'klipper') {
    const stepper = `stepper_${letter.toLowerCase()}`;
    return [
      `SET_TMC_CURRENT STEPPER=${stepper} CURRENT=${(tuning.currentMa / 1000).toFixed(2)}`,
      `SET_TMC_FIELD STEPPER=${stepper} FIELD=en_spreadCycle VALUE=${tuning.mode === 'spreadcycle' ? 1 : 0}`,
    ];
  }

  const modeCommand = boardType === 'marlin'
    ? `M569 S${tuning.mode === 'stealthchop' ? 1 : 0} ${letter}`
    : `M569 P${tuning.driverIndex} S${tuning.mode === 'stealthchop' ? 1 : 0}`;

  return [
    `M906 ${letter}${tuning.currentMa}`,
    `M350 ${letter}${tuning.microsteps}`,
    modeCommand,
  ];
}

export function buildStepperWiggleCommands(axis: string, distanceMm = 1, feedrate = 1200): string[] {
  const letter = axis.toUpperCase();
  const distance = Math.max(0.01, Math.min(10, Math.abs(distanceMm)));
  return [
    'G91',
    `G1 ${letter}${distance} F${feedrate}`,
    `G1 ${letter}-${distance} F${feedrate}`,
    'G90',
  ];
}
