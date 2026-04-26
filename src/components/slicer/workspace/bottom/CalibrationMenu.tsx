import { useCallback, useEffect, useRef, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import {
  generateFlowTowerGCode,
  generatePressureAdvancePatternGCode,
  generateRetractionTowerGCode,
  generateTemperatureTowerGCode,
} from '../../../../engine/calibration';
import type { MaterialProfile, PrinterProfile, PrintProfile } from '../../../../types/slicer';

export function CalibrationMenu({
  activePrinter,
  activeMaterial,
  activePrint,
}: {
  activePrinter: PrinterProfile | null;
  activeMaterial: MaterialProfile | null;
  activePrint: PrintProfile | null;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const canGenerate = activePrinter !== null && activeMaterial !== null && activePrint !== null;

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const downloadCalibration = useCallback((filename: string, gcode: string) => {
    const blob = new Blob([gcode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    setOpen(false);
  }, []);

  const generateCalibration = useCallback((
    filename: string,
    generator: (printer: PrinterProfile, material: MaterialProfile, print: PrintProfile) => string,
  ) => {
    if (!activePrinter || !activeMaterial || !activePrint) return;
    downloadCalibration(filename, generator(activePrinter, activeMaterial, activePrint));
  }, [activeMaterial, activePrint, activePrinter, downloadCalibration]);

  return (
    <div className="slicer-bottom-bar__calibration" ref={menuRef}>
      <button
        className={`slicer-bottom-bar__btn${open ? ' is-active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        title="Generate calibration G-code"
      >
        <FlaskConical size={14} /> Calibration
      </button>
      {open && (
        <div className="slicer-bottom-bar__calibration-menu">
          <button
            className="slicer-bottom-bar__calibration-item"
            disabled={!canGenerate}
            onClick={() => generateCalibration(
              'calibration-retraction-tower.gcode',
              generateRetractionTowerGCode,
            )}
          >
            Retraction tower
          </button>
          <button
            className="slicer-bottom-bar__calibration-item"
            disabled={!canGenerate}
            onClick={() => generateCalibration(
              'calibration-temperature-tower.gcode',
              generateTemperatureTowerGCode,
            )}
          >
            Temperature tower
          </button>
          <button
            className="slicer-bottom-bar__calibration-item"
            disabled={!canGenerate}
            onClick={() => generateCalibration(
              'calibration-flow-tower.gcode',
              generateFlowTowerGCode,
            )}
          >
            Flow tower
          </button>
          <button
            className="slicer-bottom-bar__calibration-item"
            disabled={!canGenerate}
            onClick={() => generateCalibration(
              'calibration-pressure-advance-pattern.gcode',
              generatePressureAdvancePatternGCode,
            )}
          >
            Pressure advance pattern
          </button>
        </div>
      )}
    </div>
  );
}
