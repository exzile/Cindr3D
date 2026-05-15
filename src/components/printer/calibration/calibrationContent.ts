import { Activity, Cpu, FlaskConical, Gauge, Layers, Ruler, Sparkles, Thermometer, TrendingUp, Undo2, Zap } from 'lucide-react';
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
import { CALIBRATION_STL_URLS } from '../../../calibration/calibrationModels';
import type { CalibrationItemId } from '../../../store/calibrationStore';
import type { MaterialProfile, PrinterProfile, PrintProfile } from '../../../types/slicer';

export const CATEGORY_ACCENT: Record<string, string> = {
  Geometry: '#3b82f6',
  Material: '#f97316',
  Motion:   '#10b981',
};

export type CalibrationPreset = {
  id: string;
  title: string;
  summary: string;
  category: 'Geometry' | 'Material' | 'Motion';
  filename: string;
  stlUrl: string;
  Icon: typeof FlaskConical;
  generator: (printer: PrinterProfile, material: MaterialProfile, print: PrintProfile) => string;
};

export const PRESETS: CalibrationPreset[] = [
  {
    id: 'cube',
    title: '20mm calibration cube',
    summary: 'Check X/Y/Z dimensional scale and basic extrusion consistency across all three axes.',
    category: 'Geometry',
    filename: 'calibration-cube-20mm.gcode',
    stlUrl: CALIBRATION_STL_URLS['dimensional-accuracy'],
    Icon: Ruler,
    generator: generateCalibrationCubeGCode,
  },
  {
    id: 'first-layer',
    title: 'First-layer test',
    summary: 'Five adhesion pads for dialling Z offset, mesh compensation, flow, and bed temperature.',
    category: 'Geometry',
    filename: 'calibration-first-layer-test.gcode',
    stlUrl: CALIBRATION_STL_URLS['first-layer'],
    Icon: Sparkles,
    generator: generateFirstLayerTestGCode,
  },
  {
    id: 'dimensional',
    title: 'Dimensional accuracy gauge',
    summary: '20 / 40 / 60 mm XY reference steps for shrinkage and compensation tuning.',
    category: 'Geometry',
    filename: 'calibration-dimensional-accuracy.gcode',
    stlUrl: CALIBRATION_STL_URLS['dimensional-accuracy'],
    Icon: Ruler,
    generator: generateDimensionalAccuracyGCode,
  },
  {
    id: 'temp',
    title: 'Temperature tower',
    summary: 'Bands nozzle temperature ±10 °C around the active material target for bonding and detail.',
    category: 'Material',
    filename: 'calibration-temperature-tower.gcode',
    stlUrl: CALIBRATION_STL_URLS['temperature-tower'],
    Icon: Thermometer,
    generator: generateTemperatureTowerGCode,
  },
  {
    id: 'retraction',
    title: 'Retraction tower',
    summary: 'Steps retraction distance by height so stringing changes are immediately visible.',
    category: 'Material',
    filename: 'calibration-retraction-tower.gcode',
    stlUrl: CALIBRATION_STL_URLS['retraction'],
    Icon: Undo2,
    generator: generateRetractionTowerGCode,
  },
  {
    id: 'flow',
    title: 'Flow rate tower',
    summary: 'Steps M221 from under- to over-extrusion to locate the ideal flow multiplier.',
    category: 'Material',
    filename: 'calibration-flow-tower.gcode',
    stlUrl: CALIBRATION_STL_URLS['flow-rate'],
    Icon: Gauge,
    generator: generateFlowTowerGCode,
  },
  {
    id: 'pa-pattern',
    title: 'Pressure advance pattern',
    summary: 'Flat-line pattern for fast K-factor screening without printing a full tower.',
    category: 'Motion',
    filename: 'calibration-pressure-advance-pattern.gcode',
    stlUrl: CALIBRATION_STL_URLS['pressure-advance'],
    Icon: TrendingUp,
    generator: generatePressureAdvancePatternGCode,
  },
  {
    id: 'pa-tower',
    title: 'Pressure advance tower',
    summary: 'Vertical PA bands for inspecting corner bulge and line-start gaps at speed.',
    category: 'Motion',
    filename: 'calibration-pressure-advance-tower.gcode',
    stlUrl: CALIBRATION_STL_URLS['pressure-advance'],
    Icon: TrendingUp,
    generator: generatePressureAdvanceTowerGCode,
  },
  {
    id: 'input-shaper',
    title: 'Input shaper tower',
    summary: 'Acceleration bands to visualise ringing and resonance for IS / MZV tuning.',
    category: 'Motion',
    filename: 'calibration-input-shaper-tower.gcode',
    stlUrl: CALIBRATION_STL_URLS['input-shaper'],
    Icon: Activity,
    generator: generateInputShaperTowerGCode,
  },
];

export type CalibrationCard = {
  id: string;
  testType: string;
  category: string;
  categoryClass: 'system' | 'geometry' | 'material' | 'motion';
  title: string;
  description: string;
  linkedItemIds: CalibrationItemId[];
  Icon: typeof Cpu;
};

export const CALIBRATION_CARDS: CalibrationCard[] = [
  {
    id: 'firmware-health',
    testType: 'firmware-health',
    category: 'System',
    categoryClass: 'system',
    title: 'Firmware health',
    description: 'Baseline command, heater, motion, and sensor checks before deeper tuning.',
    linkedItemIds: [],
    Icon: Cpu,
  },
  {
    id: 'first-layer',
    testType: 'first-layer',
    category: 'Geometry',
    categoryClass: 'geometry',
    title: 'First layer',
    description: 'Bed adhesion, mesh quality, and Z-offset confirmation across the build surface.',
    linkedItemIds: ['first-layer', 'z-offset'],
    Icon: Layers,
  },
  {
    id: 'flow-rate',
    testType: 'flow-rate',
    category: 'Material',
    categoryClass: 'material',
    title: 'Flow rate',
    description: 'Extrusion multiplier check for wall thickness and surface consistency.',
    linkedItemIds: [],
    Icon: Gauge,
  },
  {
    id: 'temperature-tower',
    testType: 'temperature-tower',
    category: 'Material',
    categoryClass: 'material',
    title: 'Temperature tower',
    description: 'Temperature bands for layer bonding, gloss, bridging, and detail quality.',
    linkedItemIds: [],
    Icon: Thermometer,
  },
  {
    id: 'retraction',
    testType: 'retraction',
    category: 'Material',
    categoryClass: 'material',
    title: 'Retraction',
    description: 'Stringing and travel cleanup across distance and speed changes.',
    linkedItemIds: [],
    Icon: Undo2,
  },
  {
    id: 'pressure-advance',
    testType: 'pressure-advance',
    category: 'Motion',
    categoryClass: 'motion',
    title: 'Pressure advance',
    description: 'Corner bulge and line-start tuning for faster, cleaner extrusion.',
    linkedItemIds: ['pressure-advance'],
    Icon: TrendingUp,
  },
  {
    id: 'input-shaper',
    testType: 'input-shaper',
    category: 'Motion',
    categoryClass: 'motion',
    title: 'Input shaper',
    description: 'Ringing and resonance review for acceleration-safe print profiles.',
    linkedItemIds: ['input-shaper'],
    Icon: Activity,
  },
  {
    id: 'dimensional-accuracy',
    testType: 'dimensional-accuracy',
    category: 'Geometry',
    categoryClass: 'geometry',
    title: 'Dimensional accuracy',
    description: 'Scale, shrinkage, and fit checks against measured reference dimensions.',
    linkedItemIds: [],
    Icon: Ruler,
  },
  {
    id: 'max-volumetric-speed',
    testType: 'max-volumetric-speed',
    category: 'Material',
    categoryClass: 'material',
    title: 'Max volumetric speed',
    description: 'Throughput ceiling test for reliable high-flow slicing limits.',
    linkedItemIds: [],
    Icon: Zap,
  },
];

export const WIZARD_STEP_LABELS = [
  'Pick filament',
  'Setup checks',
  'Load model',
  'Slice preview',
  'Send to printer',
  'Monitor',
  'Inspect',
  'Apply result',
];

