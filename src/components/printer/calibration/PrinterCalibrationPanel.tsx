import { Download, ExternalLink, FlaskConical, Gauge, Ruler, Sparkles } from 'lucide-react';
import {
  generateCalibrationCubeGCode,
  generateDimensionalAccuracyGCode,
  generateFirstLayerTestGCode,
  generateFlowTowerGCode,
  generateInputShaperTowerGCode,
  generatePressureAdvancePatternGCode,
  generatePressureAdvanceTowerGCode,
  generateRetractionTowerGCode,
  generateTemperatureTowerGCode,
} from '../../../engine/calibration';
import { useSlicerStore } from '../../../store/slicerStore';
import type { MaterialProfile, PrinterProfile, PrintProfile } from '../../../types/slicer';
import './PrinterCalibrationPanel.css';

type CalibrationPreset = {
  id: string;
  title: string;
  summary: string;
  category: 'Geometry' | 'Material' | 'Motion';
  filename: string;
  Icon: typeof FlaskConical;
  generator: (printer: PrinterProfile, material: MaterialProfile, print: PrintProfile) => string;
};

const PRESETS: CalibrationPreset[] = [
  {
    id: 'cube',
    title: '20mm calibration cube',
    summary: 'Check X/Y/Z scale and basic extrusion consistency.',
    category: 'Geometry',
    filename: 'calibration-cube-20mm.gcode',
    Icon: Ruler,
    generator: generateCalibrationCubeGCode,
  },
  {
    id: 'first-layer',
    title: 'First-layer test',
    summary: 'Five pads for Z offset, mesh, flow, and bed temperature.',
    category: 'Geometry',
    filename: 'calibration-first-layer-test.gcode',
    Icon: Sparkles,
    generator: generateFirstLayerTestGCode,
  },
  {
    id: 'dimensional',
    title: 'Dimensional accuracy gauge',
    summary: '20/40/60mm XY references for shrinkage compensation.',
    category: 'Geometry',
    filename: 'calibration-dimensional-accuracy.gcode',
    Icon: Ruler,
    generator: generateDimensionalAccuracyGCode,
  },
  {
    id: 'temp',
    title: 'Temperature tower',
    summary: 'Bands nozzle temperature around the active material target.',
    category: 'Material',
    filename: 'calibration-temperature-tower.gcode',
    Icon: FlaskConical,
    generator: generateTemperatureTowerGCode,
  },
  {
    id: 'retraction',
    title: 'Retraction tower',
    summary: 'Tune stringing by stepping retraction distance by height.',
    category: 'Material',
    filename: 'calibration-retraction-tower.gcode',
    Icon: FlaskConical,
    generator: generateRetractionTowerGCode,
  },
  {
    id: 'flow',
    title: 'Flow tower',
    summary: 'Steps M221 flow from under to over extrusion.',
    category: 'Material',
    filename: 'calibration-flow-tower.gcode',
    Icon: Gauge,
    generator: generateFlowTowerGCode,
  },
  {
    id: 'pa-pattern',
    title: 'Pressure advance pattern',
    summary: 'Flat-line pattern for fast K-factor screening.',
    category: 'Motion',
    filename: 'calibration-pressure-advance-pattern.gcode',
    Icon: Gauge,
    generator: generatePressureAdvancePatternGCode,
  },
  {
    id: 'pa-tower',
    title: 'Pressure advance tower',
    summary: 'Vertical PA bands for corner bulge and gap inspection.',
    category: 'Motion',
    filename: 'calibration-pressure-advance-tower.gcode',
    Icon: Gauge,
    generator: generatePressureAdvanceTowerGCode,
  },
  {
    id: 'input-shaper',
    title: 'Input shaper tower',
    summary: 'Acceleration bands for ringing and resonance tuning.',
    category: 'Motion',
    filename: 'calibration-input-shaper-tower.gcode',
    Icon: Gauge,
    generator: generateInputShaperTowerGCode,
  },
];

function downloadGCode(filename: string, gcode: string): void {
  const blob = new Blob([gcode], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export default function PrinterCalibrationPanel() {
  const activePrinter = useSlicerStore((s) => s.getActivePrinterProfile());
  const activeMaterial = useSlicerStore((s) => s.getActiveMaterialProfile());
  const activePrint = useSlicerStore((s) => s.getActivePrintProfile());
  const ready = activePrinter !== null && activeMaterial !== null && activePrint !== null;

  const runPreset = (preset: CalibrationPreset) => {
    if (!activePrinter || !activeMaterial || !activePrint) return;
    downloadGCode(preset.filename, preset.generator(activePrinter, activeMaterial, activePrint));
  };

  const openPrepare = () => {
    window.history.pushState({}, '', '/prepare');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <div className="printer-calibration-panel">
      <header className="printer-calibration-panel__header">
        <div>
          <h2>Calibration Library</h2>
          <p>{activePrinter.name} / {activeMaterial.name} / {activePrint.name}</p>
        </div>
        <button type="button" className="printer-calibration-panel__prepare" onClick={openPrepare}>
          <ExternalLink size={14} /> Prepare
        </button>
      </header>

      <div className="printer-calibration-panel__grid">
        {PRESETS.map((preset) => {
          const Icon = preset.Icon;
          return (
            <button
              type="button"
              key={preset.id}
              className="printer-calibration-panel__preset"
              disabled={!ready}
              onClick={() => runPreset(preset)}
              title={ready ? `Download ${preset.title}` : 'Choose printer, material, and print profiles in Prepare first'}
            >
              <span className="printer-calibration-panel__icon"><Icon size={17} /></span>
              <span className="printer-calibration-panel__body">
                <span className="printer-calibration-panel__category">{preset.category}</span>
                <span className="printer-calibration-panel__title">{preset.title}</span>
                <span className="printer-calibration-panel__summary">{preset.summary}</span>
              </span>
              <Download size={15} className="printer-calibration-panel__download" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
