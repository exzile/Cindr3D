export type CalibrationTestType =
  | 'firmware-health'
  | 'first-layer'
  | 'flow-rate'
  | 'temperature-tower'
  | 'retraction'
  | 'pressure-advance'
  | 'input-shaper'
  | 'dimensional-accuracy'
  | 'max-volumetric-speed';

export type FirmwareFlavor = 'reprap' | 'marlin' | 'klipper' | 'duet';
