import dimensionalAccuracyUrl from '../../assets/calibration-models/dimensional-accuracy.stl?url';
import firmwareHealthUrl from '../../assets/calibration-models/firmware-health.stl?url';
import firstLayerUrl from '../../assets/calibration-models/first-layer.stl?url';
import flowRateUrl from '../../assets/calibration-models/flow-rate.stl?url';
import inputShaperUrl from '../../assets/calibration-models/input-shaper.stl?url';
import maxVolumetricSpeedUrl from '../../assets/calibration-models/max-volumetric-speed.stl?url';
import pressureAdvanceUrl from '../../assets/calibration-models/pressure-advance.stl?url';
import retractionUrl from '../../assets/calibration-models/retraction.stl?url';
import temperatureTowerUrl from '../../assets/calibration-models/temperature-tower.stl?url';

export type CalibrationModelEntry = {
  id: string;
  testType: string;
  filename: string;
  baseDimMm: number;
  baseNozzleDiameter: number;
  baseLayerHeight: number;
  description: string;
};

export type CalibrationModelScale = {
  nozzleScale: number;
  layerScale: number;
  uniformScale: number;
};

const calibrationModels: CalibrationModelEntry[] = [
  {
    id: 'firmware-health',
    testType: 'firmware-health',
    filename: 'firmware-health.stl',
    baseDimMm: 20,
    baseNozzleDiameter: 0.4,
    baseLayerHeight: 0.2,
    description: 'Compact reference print for firmware motion, extrusion, and thermal sanity checks.',
  },
  {
    id: 'first-layer',
    testType: 'first-layer',
    filename: 'first-layer.stl',
    baseDimMm: 60,
    baseNozzleDiameter: 0.4,
    baseLayerHeight: 0.2,
    description: 'Flat first-layer patch for bed mesh, Z offset, and adhesion inspection.',
  },
  {
    id: 'flow-rate',
    testType: 'flow-rate',
    filename: 'flow-rate.stl',
    baseDimMm: 30,
    baseNozzleDiameter: 0.4,
    baseLayerHeight: 0.2,
    description: 'Single-wall flow reference for extrusion multiplier calibration.',
  },
  {
    id: 'temperature-tower',
    testType: 'temperature-tower',
    filename: 'temperature-tower.stl',
    baseDimMm: 40,
    baseNozzleDiameter: 0.4,
    baseLayerHeight: 0.2,
    description: 'Tower stub for temperature band comparisons across a filament profile.',
  },
  {
    id: 'retraction',
    testType: 'retraction',
    filename: 'retraction.stl',
    baseDimMm: 35,
    baseNozzleDiameter: 0.4,
    baseLayerHeight: 0.2,
    description: 'Stringing reference for retraction distance and speed tuning.',
  },
  {
    id: 'pressure-advance',
    testType: 'pressure-advance',
    filename: 'pressure-advance.stl',
    baseDimMm: 50,
    baseNozzleDiameter: 0.4,
    baseLayerHeight: 0.2,
    description: 'Corner and line-pressure reference for pressure advance tuning.',
  },
  {
    id: 'input-shaper',
    testType: 'input-shaper',
    filename: 'input-shaper.stl',
    baseDimMm: 45,
    baseNozzleDiameter: 0.4,
    baseLayerHeight: 0.2,
    description: 'Ringing tower stub for input shaper and acceleration validation.',
  },
  {
    id: 'dimensional-accuracy',
    testType: 'dimensional-accuracy',
    filename: 'dimensional-accuracy.stl',
    baseDimMm: 20,
    baseNozzleDiameter: 0.4,
    baseLayerHeight: 0.2,
    description: 'Dimensional reference for checking axis scale, shrinkage, and compensation.',
  },
  {
    id: 'max-volumetric-speed',
    testType: 'max-volumetric-speed',
    filename: 'max-volumetric-speed.stl',
    baseDimMm: 50,
    baseNozzleDiameter: 0.4,
    baseLayerHeight: 0.2,
    description: 'Throughput tower stub for finding maximum reliable volumetric speed.',
  },
];

const modelUrls: Record<string, string> = {
  'dimensional-accuracy.stl': dimensionalAccuracyUrl,
  'firmware-health.stl': firmwareHealthUrl,
  'first-layer.stl': firstLayerUrl,
  'flow-rate.stl': flowRateUrl,
  'input-shaper.stl': inputShaperUrl,
  'max-volumetric-speed.stl': maxVolumetricSpeedUrl,
  'pressure-advance.stl': pressureAdvanceUrl,
  'retraction.stl': retractionUrl,
  'temperature-tower.stl': temperatureTowerUrl,
};

export function getCalibrationModels(): CalibrationModelEntry[] {
  return calibrationModels.map((entry) => ({ ...entry }));
}

export function getModelScale(
  entry: CalibrationModelEntry,
  nozzleDiameter: number,
  layerHeight: number,
): CalibrationModelScale {
  const nozzleScale = nozzleDiameter / entry.baseNozzleDiameter;
  const layerScale = layerHeight / entry.baseLayerHeight;

  return {
    nozzleScale,
    layerScale,
    uniformScale: Math.sqrt(nozzleScale * layerScale),
  };
}

export function getModelUrl(entry: CalibrationModelEntry): string {
  const url = modelUrls[entry.filename];
  if (!url) {
    throw new Error(`Missing calibration model URL for ${entry.filename}`);
  }

  return url;
}
