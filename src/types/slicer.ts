// =============================================================================
// DesignCAD Slicer Types
// Comprehensive TypeScript types for the built-in slicer system
// =============================================================================

// -----------------------------------------------------------------------------
// Printer Profile
// -----------------------------------------------------------------------------

export interface PrinterProfile {
  id: string;
  name: string;
  // Build volume
  buildVolume: { x: number; y: number; z: number };
  // Nozzle
  nozzleDiameter: number; // mm (0.4 default)
  nozzleCount: number;
  // Filament
  filamentDiameter: number; // 1.75 or 2.85
  // Heated bed
  hasHeatedBed: boolean;
  hasHeatedChamber: boolean;
  // Limits
  maxNozzleTemp: number;
  maxBedTemp: number;
  maxSpeed: number; // mm/s
  maxAcceleration: number; // mm/s²
  // Origin
  originCenter: boolean; // center or front-left
  // G-code flavor
  gcodeFlavorType: 'reprap' | 'marlin' | 'klipper' | 'duet';
  // Start/end gcode templates
  startGCode: string;
  endGCode: string;
}

// -----------------------------------------------------------------------------
// Material / Filament Profile
// -----------------------------------------------------------------------------

export interface MaterialProfile {
  id: string;
  name: string;
  type: 'PLA' | 'ABS' | 'PETG' | 'TPU' | 'Nylon' | 'ASA' | 'PC' | 'PVA' | 'HIPS' | 'Custom';
  color: string; // hex color for preview
  // Temperatures
  nozzleTemp: number;
  nozzleTempFirstLayer: number;
  bedTemp: number;
  bedTempFirstLayer: number;
  chamberTemp: number;
  // Fan
  fanSpeedMin: number; // 0-100%
  fanSpeedMax: number;
  fanDisableFirstLayers: number;
  // Retraction
  retractionDistance: number; // mm
  retractionSpeed: number; // mm/s
  retractionZHop: number; // mm
  // Flow
  flowRate: number; // multiplier (1.0 default)
  // Density for weight estimation
  density: number; // g/cm³
  costPerKg: number; // $ per kg
}

// -----------------------------------------------------------------------------
// Print Quality / Settings Profile
// -----------------------------------------------------------------------------

export interface PrintProfile {
  id: string;
  name: string;

  // Layer settings
  layerHeight: number; // mm
  firstLayerHeight: number; // mm

  // Walls / perimeters
  wallCount: number; // number of perimeter loops
  wallSpeed: number; // mm/s
  outerWallSpeed: number; // mm/s (usually slower)
  wallLineWidth: number; // mm

  // Top/Bottom
  topLayers: number;
  bottomLayers: number;
  topBottomPattern: 'lines' | 'concentric' | 'zigzag';
  topSpeed: number;

  // Infill
  infillDensity: number; // 0-100%
  infillPattern: 'grid' | 'lines' | 'triangles' | 'cubic' | 'gyroid' | 'honeycomb' | 'lightning' | 'concentric' | 'cross' | 'cross3d' | 'quarter_cubic' | 'octet' | 'tri_hexagon' | 'zigzag' | 'tetrahedral' | 'cubicsubdiv';
  infillSpeed: number; // mm/s
  infillLineWidth: number;
  infillOverlap: number; // % overlap with walls

  // Speed
  printSpeed: number; // mm/s general
  travelSpeed: number; // mm/s
  firstLayerSpeed: number; // mm/s

  // Support
  supportEnabled: boolean;
  supportType: 'normal' | 'tree' | 'organic';
  supportAngle: number; // overhang threshold in degrees
  supportDensity: number; // %
  supportPattern: 'lines' | 'grid' | 'zigzag';
  supportZDistance: number; // mm gap between support and model
  supportXYDistance: number; // mm
  supportInterface: boolean; // dense interface layers
  supportInterfaceLayers: number;

  // Adhesion
  adhesionType: 'none' | 'skirt' | 'brim' | 'raft';
  skirtLines: number;
  skirtDistance: number; // mm from model
  brimWidth: number; // mm
  raftLayers: number;

  // Cooling
  enableBridgeFan: boolean;
  bridgeFanSpeed: number;
  minLayerTime: number; // seconds - slow down if layer is too fast

  // Line widths
  lineWidth: number;             // master line width (mm, usually = nozzle diameter)
  outerWallLineWidth: number;    // outer wall line width
  topBottomLineWidth: number;    // top/bottom surface line width
  initialLayerLineWidthFactor: number; // % of line width for first layer (e.g. 120%)

  // Wall behavior
  outerWallFirst: boolean;       // print outer before inner (better surface, less ooze)
  alternateExtraWall: boolean;   // add extra wall every other layer for stronger prints

  // Infill advanced
  infillWallCount: number;       // extra perimeters around infill regions
  gradualInfillSteps: number;    // reduce infill every N layers closer to top

  // Speed — per-zone overrides
  supportSpeed: number;          // mm/s for support structures
  smallAreaSpeed: number;        // mm/s for small cross-sections

  // Travel advanced
  retractionMinTravel: number;   // mm — don't retract on moves shorter than this
  minPrintSpeed: number;         // mm/s — slow down to this on very short layers

  // Cooling advanced
  fanFullLayer: number;          // layer number at which fan reaches full speed
  liftHeadEnabled: boolean;      // lift nozzle during min-layer-time wait

  // Support — tree-specific
  supportTreeAngle: number;      // max branch overhang angle (deg)
  supportTreeBranchDiameter: number; // mm

  // Adhesion — detailed
  brimGap: number;               // mm gap between brim and model
  brimLocation: 'outside' | 'inside' | 'everywhere';
  raftMargin: number;            // mm border around raft footprint

  // Advanced
  zSeamAlignment: 'random' | 'aligned' | 'sharpest_corner' | 'shortest';
  combingMode: 'off' | 'all' | 'noskin' | 'infill';
  avoidCrossingPerimeters: boolean;
  thinWallDetection: boolean;

  // Ironing (top surface smoothing)
  ironingEnabled: boolean;
  ironingSpeed: number;
  ironingFlow: number; // very low flow %
  ironingSpacing: number; // line spacing

  // Special modes
  spiralizeContour: boolean;     // vase mode — single continuous wall
  printSequence: 'all_at_once' | 'one_at_a_time';

  // Experimental
  draftShieldEnabled: boolean;   // enclose print with single-wall draft shield
  draftShieldDistance: number;   // mm from model
  coastingEnabled: boolean;      // coast (stop extruding) before end of move
  coastingVolume: number;        // mm³ of filament to coast

  // ── Quality / Adaptive Layers ─────────────────────────────────────────────
  adaptiveLayersEnabled: boolean;
  adaptiveLayersMaxVariation: number;    // mm — max layer height change between layers
  adaptiveLayersVariationStep: number;   // mm — step size for adaptive layer calculation

  // ── Walls (advanced) ─────────────────────────────────────────────────────
  wallTransitionLength: number;   // mm — distance over which wall count transitions
  wallTransitionAngle: number;    // deg — overhang angle to trigger wall count transition
  minWallLineWidth: number;       // mm — minimum computed wall line width
  outerWallWipeDistance: number;  // mm — wipe distance after outer wall
  zSeamX: number | null;          // mm — custom seam X (null = automatic)
  zSeamY: number | null;          // mm — custom seam Y

  // ── Top / Bottom (advanced) ───────────────────────────────────────────────
  roofingLayers: number;          // extra top surface-only layers (printed last)
  roofingPattern: 'lines' | 'concentric' | 'zigzag' | 'monotonic';
  monotonicTopBottomOrder: boolean;  // fill top/bottom in monotonic order (no crossings)
  bridgeSkinSpeed: number;        // mm/s — speed for bridge skin lines
  bridgeSkinFlow: number;         // % — flow for bridge skin
  bridgeAngle: number;            // deg — 0 = auto-detect bridge angle
  bridgeWallSpeed: number;        // mm/s — speed for bridge wall lines
  skinEdgeSupportLayers: number;  // number of support layers for skin edges

  // ── Infill (advanced) ─────────────────────────────────────────────────────
  infillBeforeWalls: boolean;     // print infill before walls (vice versa = stronger walls)
  multiplyInfill: number;         // repeat infill lines N times (1 = normal)
  randomInfillStart: boolean;     // randomize infill start position each layer
  lightningInfillSupportAngle: number; // deg — angle for lightning infill support branches

  // ── Speed: Acceleration & Jerk ────────────────────────────────────────────
  accelerationEnabled: boolean;
  jerkEnabled: boolean;
  accelerationPrint: number;      // mm/s²
  accelerationTravel: number;     // mm/s²
  accelerationWall: number;       // mm/s²
  accelerationInfill: number;     // mm/s²
  accelerationTopBottom: number;  // mm/s²
  accelerationSupport: number;    // mm/s²
  jerkPrint: number;              // mm/s
  jerkTravel: number;             // mm/s
  jerkWall: number;               // mm/s
  jerkInfill: number;             // mm/s
  jerkTopBottom: number;          // mm/s
  skirtBrimSpeed: number;         // mm/s

  // ── Travel (advanced) ─────────────────────────────────────────────────────
  retractAtLayerChange: boolean;
  maxRetractionCount: number;     // max retractions within minimumExtrusionWindow mm
  retractionExtraPrimeAmount: number; // mm³ — extra prime after long travel
  combingAvoidsSupports: boolean;
  travelRetractBeforeOuterWall: boolean;

  // ── Cooling (advanced) ────────────────────────────────────────────────────
  coolingFanEnabled: boolean;
  regularFanSpeedLayer: number;   // layer at which regular fan speed kicks in
  fanKickstartTime: number;       // ms — kickstart time for fan PWM

  // ── Support (advanced) ────────────────────────────────────────────────────
  supportBuildplateOnly: boolean; // only generate support touching buildplate
  supportRoofEnable: boolean;
  supportFloorEnable: boolean;
  supportBottomDistance: number;  // mm — gap under support (to model below)
  supportWallCount: number;       // walls around support
  supportInterfacePattern: 'lines' | 'grid' | 'concentric' | 'zigzag';
  supportInterfaceDensity: number; // %

  // ── Adhesion (detailed) ───────────────────────────────────────────────────
  skirtHeight: number;            // layers for skirt
  brimReplacesSupportEnabled: boolean; // merge brim with support base
  raftBaseThickness: number;      // mm
  raftBaseLineWidth: number;      // mm
  raftBaseSpeed: number;          // mm/s
  raftInterfaceThickness: number; // mm
  raftInterfaceLineWidth: number; // mm
  raftInterfaceSpeed: number;     // mm/s
  raftSurfaceThickness: number;   // mm
  raftSurfaceLineWidth: number;   // mm
  raftSurfaceSpeed: number;       // mm/s
  raftAirGap: number;             // mm — gap between raft and model

  // ── Mesh Fixes ────────────────────────────────────────────────────────────
  unionOverlappingVolumes: boolean;
  removeAllHoles: boolean;
  extensiveStitching: boolean;
  keepDisconnectedFaces: boolean;
  maxResolution: number;          // mm — merge vertices closer than this
  maxDeviation: number;           // mm — max deviation from original surface
  maxTravelResolution: number;    // mm — resolution for travel moves

  // ── Special Modes (expanded) ──────────────────────────────────────────────
  surfaceMode: 'normal' | 'surface' | 'both';
  moldEnabled: boolean;           // generate mold geometry around model
  moldAngle: number;              // deg — mold draft angle
  moldRoofHeight: number;         // mm — height above model to close mold

  // ── Experimental (expanded) ───────────────────────────────────────────────
  fuzzySkinsEnabled: boolean;     // add random noise to outer surface
  fuzzySkinThickness: number;     // mm — amount of random displacement
  fuzzySkinPointDist: number;     // mm — distance between fuzzy points
  makeOverhangPrintable: boolean; // rotate/split model to eliminate overhangs
  makeOverhangPrintableMaxAngle: number; // deg
  slicingTolerance: 'middle' | 'inclusive' | 'exclusive';
  flowRateCompensationMaxExtrusion: number; // mm — max extra extrusion for flow compensation
  smallHoleMaxSize: number;       // mm — holes smaller than this are considered small
  minimumPolygonCircumference: number; // mm — ignore polygons smaller than this
}

// -----------------------------------------------------------------------------
// Plate Object - a model placed on the build plate
// -----------------------------------------------------------------------------

export interface PlateObject {
  id: string;
  name: string;
  featureId?: string; // reference to CAD feature (optional — may be a file import)
  geometry?: any; // THREE.BufferGeometry — avoid importing Three.js in types
  // Transform on build plate (3D)
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number }; // degrees
  scale: { x: number; y: number; z: number };
  // Mirror
  mirrorX?: boolean;
  mirrorY?: boolean;
  mirrorZ?: boolean;
  // Per-object colour override
  color?: string;
  // Flags
  locked?: boolean; // prevent accidental moves/transforms
  // Computed
  boundingBox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
  selected?: boolean;
  // Per-object settings override (null keys inherit global print profile)
  perObjectSettings?: Record<string, any>;
}

// -----------------------------------------------------------------------------
// Slicing Progress
// -----------------------------------------------------------------------------

export interface SliceProgress {
  stage: 'idle' | 'preparing' | 'slicing' | 'generating' | 'complete' | 'error';
  percent: number;
  currentLayer: number;
  totalLayers: number;
  message: string;
}

// -----------------------------------------------------------------------------
// Slice Result
// -----------------------------------------------------------------------------

export interface SliceResult {
  gcode: string;
  // Stats
  layerCount: number;
  printTime: number; // seconds
  filamentUsed: number; // mm
  filamentWeight: number; // grams
  filamentCost: number; // $
  // Per-layer data for preview
  layers: SliceLayer[];
}

// -----------------------------------------------------------------------------
// Single Layer Data for G-code Preview
// -----------------------------------------------------------------------------

export interface SliceLayer {
  z: number;
  layerIndex: number;
  moves: SliceMove[];
  layerTime: number; // seconds
}

// -----------------------------------------------------------------------------
// Individual Move in a Layer
// -----------------------------------------------------------------------------

export interface SliceMove {
  type: 'travel' | 'wall-outer' | 'wall-inner' | 'infill' | 'top-bottom' | 'support' | 'skirt' | 'brim' | 'raft' | 'bridge' | 'ironing';
  from: { x: number; y: number };
  to: { x: number; y: number };
  speed: number; // mm/s
  extrusion: number; // mm of filament
  lineWidth: number;
}

// =============================================================================
// Default Profiles
// =============================================================================

export const DEFAULT_PRINTER_PROFILES: PrinterProfile[] = [
  {
    id: 'duet3d-generic',
    name: 'Duet3D Generic',
    buildVolume: { x: 300, y: 300, z: 300 },
    nozzleDiameter: 0.4,
    nozzleCount: 1,
    filamentDiameter: 1.75,
    hasHeatedBed: true,
    hasHeatedChamber: false,
    maxNozzleTemp: 300,
    maxBedTemp: 120,
    maxSpeed: 300,
    maxAcceleration: 3000,
    originCenter: false,
    gcodeFlavorType: 'duet',
    startGCode:
      '; Start G-code for Duet3D\n' +
      'G28 ; Home all axes\n' +
      'G29 S1 ; Load height map\n' +
      'M116 ; Wait for temperatures\n' +
      'G1 Z5 F3000 ; Lift nozzle\n' +
      'G1 X0 Y0 F3000 ; Move to start position\n' +
      'G92 E0 ; Reset extruder\n',
    endGCode:
      '; End G-code for Duet3D\n' +
      'G91 ; Relative positioning\n' +
      'G1 E-2 F2700 ; Retract\n' +
      'G1 Z10 F3000 ; Lift\n' +
      'G90 ; Absolute positioning\n' +
      'G1 X0 Y300 F3000 ; Present print\n' +
      'M104 S0 ; Heater off\n' +
      'M140 S0 ; Bed off\n' +
      'M106 S0 ; Fan off\n' +
      'M84 ; Motors off\n',
  },
  {
    id: 'marlin-generic',
    name: 'Marlin Generic',
    buildVolume: { x: 220, y: 220, z: 250 },
    nozzleDiameter: 0.4,
    nozzleCount: 1,
    filamentDiameter: 1.75,
    hasHeatedBed: true,
    hasHeatedChamber: false,
    maxNozzleTemp: 260,
    maxBedTemp: 110,
    maxSpeed: 200,
    maxAcceleration: 2000,
    originCenter: false,
    gcodeFlavorType: 'marlin',
    startGCode:
      '; Start G-code for Marlin\n' +
      'G90 ; Absolute positioning\n' +
      'M82 ; Absolute extrusion\n' +
      'M104 S{nozzleTemp} ; Set nozzle temp\n' +
      'M140 S{bedTemp} ; Set bed temp\n' +
      'M190 S{bedTemp} ; Wait for bed temp\n' +
      'M109 S{nozzleTemp} ; Wait for nozzle temp\n' +
      'G28 ; Home all axes\n' +
      'G29 ; Auto bed leveling\n' +
      'G92 E0 ; Reset extruder\n' +
      'G1 Z5 F3000 ; Lift nozzle\n' +
      'G1 X0.1 Y20 F5000 ; Move to prime position\n' +
      'G1 Z0.3 F3000 ; Lower nozzle\n' +
      'G1 X0.1 Y150 E15 F1500 ; Prime line\n' +
      'G1 X0.4 Y150 F5000 ; Move over\n' +
      'G1 X0.4 Y20 E30 F1500 ; Second prime line\n' +
      'G92 E0 ; Reset extruder\n' +
      'G1 Z2 F3000 ; Lift nozzle\n',
    endGCode:
      '; End G-code for Marlin\n' +
      'G91 ; Relative positioning\n' +
      'G1 E-2 F2700 ; Retract\n' +
      'G1 Z10 F3000 ; Lift nozzle\n' +
      'G90 ; Absolute positioning\n' +
      'G1 X0 Y200 F3000 ; Move bed forward\n' +
      'M104 S0 ; Turn off nozzle\n' +
      'M140 S0 ; Turn off bed\n' +
      'M107 ; Turn off fan\n' +
      'M84 ; Disable steppers\n',
  },
  {
    id: 'klipper-generic',
    name: 'Klipper Generic',
    buildVolume: { x: 250, y: 250, z: 300 },
    nozzleDiameter: 0.4,
    nozzleCount: 1,
    filamentDiameter: 1.75,
    hasHeatedBed: true,
    hasHeatedChamber: false,
    maxNozzleTemp: 300,
    maxBedTemp: 120,
    maxSpeed: 500,
    maxAcceleration: 5000,
    originCenter: false,
    gcodeFlavorType: 'klipper',
    startGCode:
      '; Start G-code for Klipper\n' +
      'START_PRINT BED_TEMP={bedTemp} EXTRUDER_TEMP={nozzleTemp}\n',
    endGCode:
      '; End G-code for Klipper\n' +
      'END_PRINT\n',
  },
];

export const DEFAULT_MATERIAL_PROFILES: MaterialProfile[] = [
  {
    id: 'pla-generic',
    name: 'PLA Generic',
    type: 'PLA',
    color: '#4fc3f7',
    nozzleTemp: 210,
    nozzleTempFirstLayer: 215,
    bedTemp: 60,
    bedTempFirstLayer: 65,
    chamberTemp: 0,
    fanSpeedMin: 100,
    fanSpeedMax: 100,
    fanDisableFirstLayers: 1,
    retractionDistance: 0.8,
    retractionSpeed: 45,
    retractionZHop: 0.2,
    flowRate: 1.0,
    density: 1.24,
    costPerKg: 20,
  },
  {
    id: 'abs-generic',
    name: 'ABS Generic',
    type: 'ABS',
    color: '#e0e0e0',
    nozzleTemp: 240,
    nozzleTempFirstLayer: 245,
    bedTemp: 100,
    bedTempFirstLayer: 105,
    chamberTemp: 50,
    fanSpeedMin: 0,
    fanSpeedMax: 30,
    fanDisableFirstLayers: 3,
    retractionDistance: 0.8,
    retractionSpeed: 40,
    retractionZHop: 0.2,
    flowRate: 1.0,
    density: 1.04,
    costPerKg: 22,
  },
  {
    id: 'petg-generic',
    name: 'PETG Generic',
    type: 'PETG',
    color: '#81c784',
    nozzleTemp: 230,
    nozzleTempFirstLayer: 235,
    bedTemp: 80,
    bedTempFirstLayer: 85,
    chamberTemp: 0,
    fanSpeedMin: 50,
    fanSpeedMax: 70,
    fanDisableFirstLayers: 2,
    retractionDistance: 1.0,
    retractionSpeed: 40,
    retractionZHop: 0.2,
    flowRate: 1.0,
    density: 1.27,
    costPerKg: 25,
  },
  {
    id: 'tpu-generic',
    name: 'TPU Generic',
    type: 'TPU',
    color: '#ff8a65',
    nozzleTemp: 225,
    nozzleTempFirstLayer: 230,
    bedTemp: 50,
    bedTempFirstLayer: 55,
    chamberTemp: 0,
    fanSpeedMin: 50,
    fanSpeedMax: 70,
    fanDisableFirstLayers: 2,
    retractionDistance: 0.5,
    retractionSpeed: 25,
    retractionZHop: 0.1,
    flowRate: 1.05,
    density: 1.21,
    costPerKg: 35,
  },
  {
    id: 'asa-generic',
    name: 'ASA Generic',
    type: 'ASA',
    color: '#b0bec5',
    nozzleTemp: 250,
    nozzleTempFirstLayer: 255,
    bedTemp: 100,
    bedTempFirstLayer: 105,
    chamberTemp: 40,
    fanSpeedMin: 0,
    fanSpeedMax: 40,
    fanDisableFirstLayers: 3,
    retractionDistance: 0.8,
    retractionSpeed: 40,
    retractionZHop: 0.2,
    flowRate: 1.0,
    density: 1.07,
    costPerKg: 30,
  },
  {
    id: 'nylon-generic',
    name: 'Nylon Generic',
    type: 'Nylon',
    color: '#ffe082',
    nozzleTemp: 260,
    nozzleTempFirstLayer: 265,
    bedTemp: 80,
    bedTempFirstLayer: 85,
    chamberTemp: 40,
    fanSpeedMin: 0,
    fanSpeedMax: 30,
    fanDisableFirstLayers: 3,
    retractionDistance: 1.2,
    retractionSpeed: 40,
    retractionZHop: 0.2,
    flowRate: 1.0,
    density: 1.14,
    costPerKg: 40,
  },
  {
    id: 'pc-generic',
    name: 'Polycarbonate Generic',
    type: 'PC',
    color: '#ce93d8',
    nozzleTemp: 270,
    nozzleTempFirstLayer: 275,
    bedTemp: 110,
    bedTempFirstLayer: 115,
    chamberTemp: 50,
    fanSpeedMin: 0,
    fanSpeedMax: 20,
    fanDisableFirstLayers: 4,
    retractionDistance: 0.8,
    retractionSpeed: 35,
    retractionZHop: 0.2,
    flowRate: 1.0,
    density: 1.20,
    costPerKg: 45,
  },
  {
    id: 'pva-generic',
    name: 'PVA Support',
    type: 'PVA',
    color: '#a5d6a7',
    nozzleTemp: 200,
    nozzleTempFirstLayer: 205,
    bedTemp: 55,
    bedTempFirstLayer: 60,
    chamberTemp: 0,
    fanSpeedMin: 100,
    fanSpeedMax: 100,
    fanDisableFirstLayers: 1,
    retractionDistance: 1.0,
    retractionSpeed: 35,
    retractionZHop: 0.2,
    flowRate: 1.0,
    density: 1.23,
    costPerKg: 50,
  },
  {
    id: 'hips-generic',
    name: 'HIPS Generic',
    type: 'HIPS',
    color: '#fff9c4',
    nozzleTemp: 235,
    nozzleTempFirstLayer: 240,
    bedTemp: 100,
    bedTempFirstLayer: 105,
    chamberTemp: 0,
    fanSpeedMin: 20,
    fanSpeedMax: 50,
    fanDisableFirstLayers: 2,
    retractionDistance: 0.8,
    retractionSpeed: 40,
    retractionZHop: 0.2,
    flowRate: 1.0,
    density: 1.04,
    costPerKg: 25,
  },
];

export const DEFAULT_PRINT_PROFILES: PrintProfile[] = [
  {
    id: 'standard-quality',
    name: 'Standard Quality (0.2mm)',
    layerHeight: 0.2,
    firstLayerHeight: 0.3,
    wallCount: 3,
    wallSpeed: 45,
    outerWallSpeed: 30,
    wallLineWidth: 0.45,
    topLayers: 4,
    bottomLayers: 4,
    topBottomPattern: 'lines',
    topSpeed: 40,
    infillDensity: 20,
    infillPattern: 'grid',
    infillSpeed: 60,
    infillLineWidth: 0.45,
    infillOverlap: 10,
    printSpeed: 50,
    travelSpeed: 150,
    firstLayerSpeed: 25,
    supportEnabled: false,
    supportType: 'normal',
    supportAngle: 50,
    supportDensity: 15,
    supportPattern: 'zigzag',
    supportZDistance: 0.2,
    supportXYDistance: 0.7,
    supportInterface: true,
    supportInterfaceLayers: 2,
    adhesionType: 'skirt',
    skirtLines: 3,
    skirtDistance: 5,
    brimWidth: 8,
    raftLayers: 3,
    enableBridgeFan: true,
    bridgeFanSpeed: 100,
    minLayerTime: 10,
    lineWidth: 0.4,
    outerWallLineWidth: 0.4,
    topBottomLineWidth: 0.4,
    initialLayerLineWidthFactor: 120,
    outerWallFirst: false,
    alternateExtraWall: false,
    infillWallCount: 0,
    gradualInfillSteps: 0,
    supportSpeed: 40,
    smallAreaSpeed: 20,
    retractionMinTravel: 1.5,
    minPrintSpeed: 10,
    fanFullLayer: 4,
    liftHeadEnabled: false,
    supportTreeAngle: 60,
    supportTreeBranchDiameter: 5,
    brimGap: 0,
    brimLocation: 'outside',
    raftMargin: 5,
    zSeamAlignment: 'sharpest_corner',
    combingMode: 'noskin',
    avoidCrossingPerimeters: false,
    thinWallDetection: true,
    ironingEnabled: false,
    ironingSpeed: 15,
    ironingFlow: 10,
    ironingSpacing: 0.1,
    spiralizeContour: false,
    printSequence: 'all_at_once',
    draftShieldEnabled: false,
    draftShieldDistance: 10,
    coastingEnabled: false,
    coastingVolume: 0.064,
    // Adaptive layers
    adaptiveLayersEnabled: false,
    adaptiveLayersMaxVariation: 0.1,
    adaptiveLayersVariationStep: 0.05,
    // Walls advanced
    wallTransitionLength: 1.0,
    wallTransitionAngle: 10,
    minWallLineWidth: 0.2,
    outerWallWipeDistance: 0.0,
    zSeamX: null,
    zSeamY: null,
    // Top/Bottom advanced
    roofingLayers: 0,
    roofingPattern: 'lines' as const,
    monotonicTopBottomOrder: false,
    bridgeSkinSpeed: 25,
    bridgeSkinFlow: 60,
    bridgeAngle: 0,
    bridgeWallSpeed: 25,
    skinEdgeSupportLayers: 0,
    // Infill advanced
    infillBeforeWalls: false,
    multiplyInfill: 1,
    randomInfillStart: false,
    lightningInfillSupportAngle: 40,
    // Speed: acceleration & jerk
    accelerationEnabled: false,
    jerkEnabled: false,
    accelerationPrint: 3000,
    accelerationTravel: 3000,
    accelerationWall: 1000,
    accelerationInfill: 3000,
    accelerationTopBottom: 1000,
    accelerationSupport: 2000,
    jerkPrint: 10,
    jerkTravel: 10,
    jerkWall: 8,
    jerkInfill: 10,
    jerkTopBottom: 8,
    skirtBrimSpeed: 30,
    // Travel advanced
    retractAtLayerChange: true,
    maxRetractionCount: 90,
    retractionExtraPrimeAmount: 0,
    combingAvoidsSupports: false,
    travelRetractBeforeOuterWall: false,
    // Cooling advanced
    coolingFanEnabled: true,
    regularFanSpeedLayer: 1,
    fanKickstartTime: 100,
    // Support advanced
    supportBuildplateOnly: false,
    supportRoofEnable: false,
    supportFloorEnable: false,
    supportBottomDistance: 0.2,
    supportWallCount: 0,
    supportInterfacePattern: 'lines' as const,
    supportInterfaceDensity: 100,
    // Adhesion detailed
    skirtHeight: 1,
    brimReplacesSupportEnabled: false,
    raftBaseThickness: 0.3,
    raftBaseLineWidth: 0.8,
    raftBaseSpeed: 20,
    raftInterfaceThickness: 0.27,
    raftInterfaceLineWidth: 0.4,
    raftInterfaceSpeed: 40,
    raftSurfaceThickness: 0.27,
    raftSurfaceLineWidth: 0.4,
    raftSurfaceSpeed: 40,
    raftAirGap: 0.3,
    // Mesh fixes
    unionOverlappingVolumes: true,
    removeAllHoles: false,
    extensiveStitching: false,
    keepDisconnectedFaces: false,
    maxResolution: 0.5,
    maxDeviation: 0.025,
    maxTravelResolution: 0.8,
    // Special modes
    surfaceMode: 'normal' as const,
    moldEnabled: false,
    moldAngle: 40,
    moldRoofHeight: 0.5,
    // Experimental
    fuzzySkinsEnabled: false,
    fuzzySkinThickness: 0.3,
    fuzzySkinPointDist: 0.8,
    makeOverhangPrintable: false,
    makeOverhangPrintableMaxAngle: 50,
    slicingTolerance: 'middle' as const,
    flowRateCompensationMaxExtrusion: 0.0,
    smallHoleMaxSize: 0.0,
    minimumPolygonCircumference: 1.0,
  },
  {
    id: 'draft-quality',
    name: 'Draft Quality (0.3mm)',
    layerHeight: 0.3,
    firstLayerHeight: 0.35,
    wallCount: 2,
    wallSpeed: 60,
    outerWallSpeed: 40,
    wallLineWidth: 0.45,
    topLayers: 3,
    bottomLayers: 3,
    topBottomPattern: 'lines',
    topSpeed: 50,
    infillDensity: 15,
    infillPattern: 'lines',
    infillSpeed: 80,
    infillLineWidth: 0.5,
    infillOverlap: 10,
    printSpeed: 70,
    travelSpeed: 150,
    firstLayerSpeed: 30,
    supportEnabled: false,
    supportType: 'normal',
    supportAngle: 50,
    supportDensity: 10,
    supportPattern: 'lines',
    supportZDistance: 0.3,
    supportXYDistance: 0.8,
    supportInterface: false,
    supportInterfaceLayers: 0,
    adhesionType: 'skirt',
    skirtLines: 2,
    skirtDistance: 5,
    brimWidth: 8,
    raftLayers: 3,
    enableBridgeFan: true,
    bridgeFanSpeed: 100,
    minLayerTime: 8,
    lineWidth: 0.4,
    outerWallLineWidth: 0.4,
    topBottomLineWidth: 0.4,
    initialLayerLineWidthFactor: 120,
    outerWallFirst: false,
    alternateExtraWall: false,
    infillWallCount: 0,
    gradualInfillSteps: 0,
    supportSpeed: 50,
    smallAreaSpeed: 30,
    retractionMinTravel: 1.5,
    minPrintSpeed: 15,
    fanFullLayer: 3,
    liftHeadEnabled: false,
    supportTreeAngle: 60,
    supportTreeBranchDiameter: 5,
    brimGap: 0,
    brimLocation: 'outside',
    raftMargin: 5,
    zSeamAlignment: 'random',
    combingMode: 'all',
    avoidCrossingPerimeters: false,
    thinWallDetection: false,
    ironingEnabled: false,
    ironingSpeed: 15,
    ironingFlow: 10,
    ironingSpacing: 0.1,
    spiralizeContour: false,
    printSequence: 'all_at_once',
    draftShieldEnabled: false,
    draftShieldDistance: 10,
    coastingEnabled: false,
    coastingVolume: 0.064,
    // Adaptive layers
    adaptiveLayersEnabled: false,
    adaptiveLayersMaxVariation: 0.1,
    adaptiveLayersVariationStep: 0.05,
    // Walls advanced
    wallTransitionLength: 1.0,
    wallTransitionAngle: 10,
    minWallLineWidth: 0.2,
    outerWallWipeDistance: 0.0,
    zSeamX: null,
    zSeamY: null,
    // Top/Bottom advanced
    roofingLayers: 0,
    roofingPattern: 'lines' as const,
    monotonicTopBottomOrder: false,
    bridgeSkinSpeed: 25,
    bridgeSkinFlow: 60,
    bridgeAngle: 0,
    bridgeWallSpeed: 25,
    skinEdgeSupportLayers: 0,
    // Infill advanced
    infillBeforeWalls: false,
    multiplyInfill: 1,
    randomInfillStart: false,
    lightningInfillSupportAngle: 40,
    // Speed: acceleration & jerk
    accelerationEnabled: false,
    jerkEnabled: false,
    accelerationPrint: 3000,
    accelerationTravel: 3000,
    accelerationWall: 1000,
    accelerationInfill: 3000,
    accelerationTopBottom: 1000,
    accelerationSupport: 2000,
    jerkPrint: 10,
    jerkTravel: 10,
    jerkWall: 8,
    jerkInfill: 10,
    jerkTopBottom: 8,
    skirtBrimSpeed: 30,
    // Travel advanced
    retractAtLayerChange: true,
    maxRetractionCount: 90,
    retractionExtraPrimeAmount: 0,
    combingAvoidsSupports: false,
    travelRetractBeforeOuterWall: false,
    // Cooling advanced
    coolingFanEnabled: true,
    regularFanSpeedLayer: 1,
    fanKickstartTime: 100,
    // Support advanced
    supportBuildplateOnly: false,
    supportRoofEnable: false,
    supportFloorEnable: false,
    supportBottomDistance: 0.2,
    supportWallCount: 0,
    supportInterfacePattern: 'lines' as const,
    supportInterfaceDensity: 100,
    // Adhesion detailed
    skirtHeight: 1,
    brimReplacesSupportEnabled: false,
    raftBaseThickness: 0.3,
    raftBaseLineWidth: 0.8,
    raftBaseSpeed: 20,
    raftInterfaceThickness: 0.27,
    raftInterfaceLineWidth: 0.4,
    raftInterfaceSpeed: 40,
    raftSurfaceThickness: 0.27,
    raftSurfaceLineWidth: 0.4,
    raftSurfaceSpeed: 40,
    raftAirGap: 0.3,
    // Mesh fixes
    unionOverlappingVolumes: true,
    removeAllHoles: false,
    extensiveStitching: false,
    keepDisconnectedFaces: false,
    maxResolution: 0.5,
    maxDeviation: 0.025,
    maxTravelResolution: 0.8,
    // Special modes
    surfaceMode: 'normal' as const,
    moldEnabled: false,
    moldAngle: 40,
    moldRoofHeight: 0.5,
    // Experimental
    fuzzySkinsEnabled: false,
    fuzzySkinThickness: 0.3,
    fuzzySkinPointDist: 0.8,
    makeOverhangPrintable: false,
    makeOverhangPrintableMaxAngle: 50,
    slicingTolerance: 'middle' as const,
    flowRateCompensationMaxExtrusion: 0.0,
    smallHoleMaxSize: 0.0,
    minimumPolygonCircumference: 1.0,
  },
  {
    id: 'fine-quality',
    name: 'Fine Quality (0.1mm)',
    layerHeight: 0.1,
    firstLayerHeight: 0.2,
    wallCount: 4,
    wallSpeed: 35,
    outerWallSpeed: 20,
    wallLineWidth: 0.42,
    topLayers: 6,
    bottomLayers: 6,
    topBottomPattern: 'lines',
    topSpeed: 30,
    infillDensity: 20,
    infillPattern: 'grid',
    infillSpeed: 50,
    infillLineWidth: 0.42,
    infillOverlap: 10,
    printSpeed: 40,
    travelSpeed: 150,
    firstLayerSpeed: 20,
    supportEnabled: false,
    supportType: 'normal',
    supportAngle: 50,
    supportDensity: 15,
    supportPattern: 'zigzag',
    supportZDistance: 0.1,
    supportXYDistance: 0.6,
    supportInterface: true,
    supportInterfaceLayers: 3,
    adhesionType: 'skirt',
    skirtLines: 3,
    skirtDistance: 5,
    brimWidth: 8,
    raftLayers: 3,
    enableBridgeFan: true,
    bridgeFanSpeed: 100,
    minLayerTime: 15,
    lineWidth: 0.38,
    outerWallLineWidth: 0.35,
    topBottomLineWidth: 0.38,
    initialLayerLineWidthFactor: 120,
    outerWallFirst: true,
    alternateExtraWall: true,
    infillWallCount: 1,
    gradualInfillSteps: 0,
    supportSpeed: 30,
    smallAreaSpeed: 15,
    retractionMinTravel: 1.5,
    minPrintSpeed: 5,
    fanFullLayer: 5,
    liftHeadEnabled: false,
    supportTreeAngle: 50,
    supportTreeBranchDiameter: 4,
    brimGap: 0,
    brimLocation: 'outside',
    raftMargin: 5,
    zSeamAlignment: 'sharpest_corner',
    combingMode: 'noskin',
    avoidCrossingPerimeters: true,
    thinWallDetection: true,
    ironingEnabled: false,
    ironingSpeed: 15,
    ironingFlow: 10,
    ironingSpacing: 0.1,
    spiralizeContour: false,
    printSequence: 'all_at_once',
    draftShieldEnabled: false,
    draftShieldDistance: 10,
    coastingEnabled: false,
    coastingVolume: 0.064,
    // Adaptive layers
    adaptiveLayersEnabled: true,
    adaptiveLayersMaxVariation: 0.05,
    adaptiveLayersVariationStep: 0.05,
    // Walls advanced
    wallTransitionLength: 1.0,
    wallTransitionAngle: 10,
    minWallLineWidth: 0.2,
    outerWallWipeDistance: 0.0,
    zSeamX: null,
    zSeamY: null,
    // Top/Bottom advanced
    roofingLayers: 0,
    roofingPattern: 'lines' as const,
    monotonicTopBottomOrder: true,
    bridgeSkinSpeed: 20,
    bridgeSkinFlow: 60,
    bridgeAngle: 0,
    bridgeWallSpeed: 25,
    skinEdgeSupportLayers: 0,
    // Infill advanced
    infillBeforeWalls: false,
    multiplyInfill: 1,
    randomInfillStart: false,
    lightningInfillSupportAngle: 40,
    // Speed: acceleration & jerk
    accelerationEnabled: false,
    jerkEnabled: false,
    accelerationPrint: 3000,
    accelerationTravel: 3000,
    accelerationWall: 1000,
    accelerationInfill: 3000,
    accelerationTopBottom: 1000,
    accelerationSupport: 2000,
    jerkPrint: 10,
    jerkTravel: 10,
    jerkWall: 8,
    jerkInfill: 10,
    jerkTopBottom: 8,
    skirtBrimSpeed: 30,
    // Travel advanced
    retractAtLayerChange: true,
    maxRetractionCount: 90,
    retractionExtraPrimeAmount: 0,
    combingAvoidsSupports: false,
    travelRetractBeforeOuterWall: false,
    // Cooling advanced
    coolingFanEnabled: true,
    regularFanSpeedLayer: 1,
    fanKickstartTime: 100,
    // Support advanced
    supportBuildplateOnly: false,
    supportRoofEnable: false,
    supportFloorEnable: false,
    supportBottomDistance: 0.2,
    supportWallCount: 0,
    supportInterfacePattern: 'lines' as const,
    supportInterfaceDensity: 100,
    // Adhesion detailed
    skirtHeight: 1,
    brimReplacesSupportEnabled: false,
    raftBaseThickness: 0.3,
    raftBaseLineWidth: 0.8,
    raftBaseSpeed: 20,
    raftInterfaceThickness: 0.27,
    raftInterfaceLineWidth: 0.4,
    raftInterfaceSpeed: 40,
    raftSurfaceThickness: 0.27,
    raftSurfaceLineWidth: 0.4,
    raftSurfaceSpeed: 40,
    raftAirGap: 0.3,
    // Mesh fixes
    unionOverlappingVolumes: true,
    removeAllHoles: false,
    extensiveStitching: false,
    keepDisconnectedFaces: false,
    maxResolution: 0.5,
    maxDeviation: 0.025,
    maxTravelResolution: 0.8,
    // Special modes
    surfaceMode: 'normal' as const,
    moldEnabled: false,
    moldAngle: 40,
    moldRoofHeight: 0.5,
    // Experimental
    fuzzySkinsEnabled: false,
    fuzzySkinThickness: 0.3,
    fuzzySkinPointDist: 0.8,
    makeOverhangPrintable: false,
    makeOverhangPrintableMaxAngle: 50,
    slicingTolerance: 'middle' as const,
    flowRateCompensationMaxExtrusion: 0.0,
    smallHoleMaxSize: 0.0,
    minimumPolygonCircumference: 1.0,
  },
];
