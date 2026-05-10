import type { CalibrationItemId } from '../store/calibrationStore';
import type { PrinterProfile } from '../types/slicer';
import type { TuningWizardKind } from '../services/vision/tuningWizards';

/** Union of all calibration test identifiers across the UI store and vision service. */
export type CalibrationTestType = CalibrationItemId | TuningWizardKind;

export type GCodeFlavorType = PrinterProfile['gcodeFlavorType'];
