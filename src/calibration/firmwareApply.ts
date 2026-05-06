export type FirmwareFlavor = 'reprap' | 'marlin' | 'klipper' | 'duet';

export type CalibrationApplyType =
  | 'pressure-advance'
  | 'input-shaper'
  | 'bed-mesh'
  | 'z-offset'
  | 'flow-rate';

export function buildPressureAdvanceCommands(flavor: FirmwareFlavor, value: number): string[] {
  const formattedValue = value.toFixed(4);

  switch (flavor) {
    case 'klipper':
      return [`SET_PRESSURE_ADVANCE EXTRUDER=extruder ADVANCE=${formattedValue}`];
    case 'marlin':
      return [`M900 K${formattedValue}`];
    case 'duet':
    case 'reprap':
      return [`M572 D0 S${formattedValue}`];
  }
}

export function buildInputShaperCommands(
  flavor: FirmwareFlavor,
  freqX: number,
  freqY: number,
  shaperType: string,
  dampingX: number,
  dampingY: number,
): string[] {
  if (flavor !== 'klipper') return [];

  return [
    `SET_INPUT_SHAPER SHAPER_FREQ_X=${freqX} SHAPER_FREQ_Y=${freqY} SHAPER_TYPE=${shaperType} DAMPING_RATIO_X=${dampingX.toFixed(3)} DAMPING_RATIO_Y=${dampingY.toFixed(3)}`,
  ];
}

export function buildZOffsetCommands(flavor: FirmwareFlavor, delta: number): string[] {
  void flavor;
  return [`M290 S${delta.toFixed(3)}`];
}

export function buildFlowRateCommands(flavor: FirmwareFlavor, flowPercent: number): string[] {
  const roundedFlow = Math.round(flowPercent);

  switch (flavor) {
    case 'klipper':
    case 'marlin':
      return [`M221 S${roundedFlow}`];
    case 'duet':
    case 'reprap':
      return [`M221 D-1 S${roundedFlow}`];
  }
}

export function buildSaveConfigCommands(flavor: FirmwareFlavor): string[] {
  switch (flavor) {
    case 'klipper':
      return ['SAVE_CONFIG'];
    case 'marlin':
      return ['M500'];
    case 'duet':
    case 'reprap':
      return [];
  }
}

export function getSaveConfigNote(flavor: FirmwareFlavor): string | null {
  switch (flavor) {
    case 'klipper':
    case 'marlin':
      return null;
    case 'duet':
      return 'To make this permanent, edit config.g via Duet Web Control.';
    case 'reprap':
      return 'To make this permanent, edit config.g via your web interface.';
  }
}

export function isFirmwareApplySupported(flavor: FirmwareFlavor, applyType: CalibrationApplyType): boolean {
  switch (applyType) {
    case 'pressure-advance':
    case 'bed-mesh':
    case 'z-offset':
    case 'flow-rate':
      return true;
    case 'input-shaper':
      return flavor === 'klipper';
  }
}

export function buildConfigSnapshotInstructions(flavor: FirmwareFlavor): string {
  switch (flavor) {
    case 'klipper':
      return 'Run SAVE_CONFIG to persist. Klipper writes the result block to printer.cfg.';
    case 'marlin':
      return 'Run M500 to save to EEPROM. Use M503 to verify saved values.';
    case 'duet':
      return 'Edit config.g in Duet Web Control before restarting. Back up first.';
    case 'reprap':
      return 'Edit config.g in your web interface before restarting. Back up first.';
  }
}
