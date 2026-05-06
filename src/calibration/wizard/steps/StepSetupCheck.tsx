import { useMemo } from 'react';
import { usePrinterStore } from '../../../store/printerStore';
import { useSlicerStore } from '../../../store/slicerStore';
import { getFirmwareIncompatibilities } from '../../../utils/firmwareCompatibility';
import type { PrinterProfile } from '../../../types/slicer';

type FirmwareFlavor = PrinterProfile['gcodeFlavorType'];
type CalibrationApplyType = 'pressure-advance' | 'input-shaper' | 'bed-mesh' | 'z-offset' | 'flow-rate';

interface StepSetupCheckProps {
  printerId: string;
  testType: string;
}

function normalizeFirmware(value: string | undefined, fallback: FirmwareFlavor): FirmwareFlavor {
  if (value === 'marlin' || value === 'klipper' || value === 'duet') return value;
  if (value === 'reprap') return value;
  return fallback;
}

function applyTypeForTest(testType: string): CalibrationApplyType | null {
  if (testType === 'pressure-advance') return 'pressure-advance';
  if (testType === 'input-shaper') return 'input-shaper';
  if (testType === 'bed-mesh') return 'bed-mesh';
  if (testType === 'first-layer') return 'z-offset';
  if (testType === 'flow-rate') return 'flow-rate';
  return null;
}

function isApplySupported(flavor: FirmwareFlavor, applyType: CalibrationApplyType | null): boolean {
  if (!applyType) return true;
  return applyType !== 'input-shaper' || flavor === 'klipper';
}

export function StepSetupCheck({ printerId, testType }: StepSetupCheckProps) {
  const printers = usePrinterStore((state) => state.printers);
  const activeProfile = useSlicerStore((state) => state.getActivePrinterProfile());
  const selectedPrinter = printers.find((printer) => printer.id === printerId);
  const firmware = normalizeFirmware(selectedPrinter?.config.boardType, activeProfile.gcodeFlavorType);
  const incompatibilities = useMemo(() => Array.from(getFirmwareIncompatibilities(firmware)), [firmware]);
  const applyType = applyTypeForTest(testType);
  const supported = isApplySupported(firmware, applyType);

  return (
    <div className="calib-step">
      <h3>Setup checks</h3>
      <div className="calib-step__checklist">
        <span>Firmware type: {firmware}</span>
        <span>Nozzle size: {activeProfile.nozzleDiameter.toFixed(2)} mm</span>
        <span>Bed temperature limit: {activeProfile.maxBedTemp} C</span>
        <span>Compatibility warnings: {incompatibilities.length}</span>
      </div>
      {!supported && (
        <div className="calib-step__warning">
          Input shaper apply requires Klipper - commands will be shown for manual entry.
        </div>
      )}
    </div>
  );
}
