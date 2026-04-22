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
  // Retraction mode
  firmwareRetraction?: boolean; // use G10/G11 instead of E-move retraction
  // Heatup behaviour
  waitForBuildPlate?: boolean;  // true = M190 (blocking), false = M140 (non-blocking); default true
  waitForNozzle?: boolean;      // true = M109 (blocking), false = M104 (non-blocking); default true
  // Fan output scaling
  scaleFanSpeedTo01?: boolean;  // emit M106 S0.0–1.0 instead of S0–255 (some Klipper configs)
  // Per-axis machine limits — emitted as M203 (max speed) and M201 (max accel) in start G-code.
  // Undefined means "don't emit" — keeps existing firmware defaults.
  maxSpeedX?: number;     // mm/s — M203 X
  maxSpeedY?: number;     // mm/s — M203 Y
  maxSpeedZ?: number;     // mm/s — M203 Z
  maxSpeedE?: number;     // mm/s — M203 E
  maxAccelX?: number;     // mm/s² — M201 X
  maxAccelY?: number;     // mm/s² — M201 Y
  maxAccelZ?: number;     // mm/s² — M201 Z
  maxAccelE?: number;     // mm/s² — M201 E
  // Default acceleration (M204 S) and jerk (M205 X/Y)
  defaultAcceleration?: number; // mm/s² — M204 S
  defaultJerk?: number;         // mm/s  — M205 X Y
  // Time estimation
  printTimeEstimationFactor?: number; // multiply computed print time by this factor (default 1.0)
  // Build plate
  buildPlateShape?: 'rectangular' | 'elliptic';
  // Printhead clearance (gantry offsets from nozzle tip)
  printheadMinX?: number;   // X min (negative = left of nozzle)
  printheadMinY?: number;   // Y min (negative = towards back)
  printheadMaxX?: number;   // X max (positive = right of nozzle)
  printheadMaxY?: number;   // Y max (positive = towards front)
  gantryHeight?: number;    // mm — vertical clearance of the printhead
  // Multi-extruder
  applyExtruderOffsets?: boolean;
  startGCodeMustBeFirst?: boolean;
  extruderOffsetX?: number;    // mm — nozzle X offset from primary
  extruderOffsetY?: number;    // mm — nozzle Y offset from primary
  coolingFanNumber?: number;   // fan index (0-based)
  // Extruder G-code snippets
  extruderPrestartGCode?: string;
  extruderStartGCode?: string;
  extruderEndGCode?: string;
  extruderChangeDuration?: number;      // s
  extruderStartGCodeDuration?: number;  // s
  extruderEndGCodeDuration?: number;    // s
  // Start/end gcode templates
  startGCode: string;
  endGCode: string;
  // Fields whose values were imported from a connected printer (shown with
  // lock badge in UI; edit via the board's config.g + resync).
  machineSourcedFields?: string[];
}

// -----------------------------------------------------------------------------
// Material / Filament Profile
// -----------------------------------------------------------------------------

export interface MaterialProfile {
  id: string;
  printerId?: string;
  name: string;
  type: 'PLA' | 'ABS' | 'PETG' | 'TPU' | 'Nylon' | 'ASA' | 'PC' | 'PVA' | 'HIPS' | 'Custom';
  color: string; // hex color for preview
  // Temperatures
  nozzleTemp: number;
  nozzleTempFirstLayer: number;
  bedTemp: number;
  bedTempFirstLayer: number;
  chamberTemp: number;
  initialPrintingTemperature?: number; // preheat temp before bed reaches target (avoids ooze while waiting)
  finalPrintingTemperature?: number;   // cooldown temp emitted at end of print (before end G-code)
  // Fan
  fanSpeedMin: number; // 0-100%
  fanSpeedMax: number;
  fanDisableFirstLayers: number;
  // Retraction
  retractionDistance: number; // mm
  retractionSpeed: number; // mm/s — used as fallback for retract and prime
  retractionRetractSpeed?: number; // mm/s — retract (pull) speed; overrides retractionSpeed
  retractionPrimeSpeed?: number;   // mm/s — prime (push) speed; overrides retractionSpeed
  retractionZHop: number; // mm
  // Linear Advance (Marlin M900 / Klipper pressure_advance)
  linearAdvanceEnabled?: boolean; // emit M900 before print starts
  linearAdvanceFactor?: number;   // K value (Marlin) or pressure_advance (Klipper)

  // Shrinkage compensation
  shrinkageCompensationXY?: number; // % — scale XY contours up to pre-compensate for material shrinkage (e.g. 0.2)
  shrinkageCompensationZ?: number;  // % — scale Z layer heights to pre-compensate for vertical shrinkage

  // Flow
  flowRate: number; // multiplier (1.0 default)
  // Density for weight estimation
  density: number; // g/cm³
  costPerKg: number; // $ per kg
  // Fields whose values were imported from a connected printer (shown with machine badge in UI)
  machineSourcedFields?: string[];
}

// -----------------------------------------------------------------------------
// Print Quality / Settings Profile
// -----------------------------------------------------------------------------

export interface PrintProfile {
  id: string;
  printerId?: string;
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
  skirtBrimLineWidth?: number;         // mm — line width for skirt/brim (defaults to wallLineWidth)
  supportLineWidth?: number;           // mm — line width for support infill (defaults to wallLineWidth)
  supportInterfaceLineWidth?: number;  // mm — line width for support interface (storage-only)
  supportRoofLineWidth?: number;       // mm — line width for support roof (storage-only)
  supportFloorLineWidth?: number;      // mm — line width for support floor (storage-only)

  // ADHESION — skirt minimum perimeter
  skirtBrimMinLength?: number;   // mm — keep adding skirt loops until total perimeter >= this

  // Wall behavior
  outerWallFirst: boolean;       // print outer before inner (better surface, less ooze)
  alternateExtraWall: boolean;   // add extra wall every other layer for stronger prints

  // Infill advanced
  infillWallCount: number;       // extra perimeters around infill regions
  gradualInfillSteps: number;    // reduce infill every N layers closer to top

  // Speed — per-zone overrides
  supportSpeed: number;          // mm/s for support structures (walls, interface)
  supportInfillSpeed?: number;   // mm/s for support infill lines (defaults to supportSpeed)
  supportInterfaceSpeed?: number; // mm/s for support interface layers (defaults to supportSpeed)
  maxFlowRate?: number;           // mm³/s — cap extrusion speed so volumetric flow ≤ this
  smallAreaSpeed: number;        // mm/s for small cross-sections
  bottomSpeed?: number;          // mm/s for bottom skin layers (defaults to topSpeed)
  numberOfSlowerLayers?: number; // ramp from firstLayerSpeed to full speed over this many layers
  initialLayerTravelSpeed?: number; // mm/s for travel moves on layer 0 only

  // Travel advanced
  retractionMinTravel: number;   // mm — don't retract on moves shorter than this
  minPrintSpeed: number;         // mm/s — slow down to this on very short layers

  // Cooling advanced
  fanFullLayer: number;          // layer number at which fan reaches full speed
  liftHeadEnabled: boolean;      // lift nozzle during min-layer-time wait

  // Support — tree-specific
  supportTreeAngle: number;         // max branch overhang angle (deg)
  supportTreeBranchDiameter: number; // mm — diameter at base
  supportTreeTipDiameter?: number;   // mm — diameter at model contact (default 0.8)
  supportTreeMaxBranchDiameter?: number; // mm — cap on branch growth
  supportTreeBranchDiameterAngle?: number; // deg — extra taper angle for branch diameter
  supportTreeMinHeight?: number;     // mm — min height for tree support to activate
  supportTreeBuildplateOnly?: boolean; // only root branches on build plate

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
  ironingPattern?: 'lines' | 'concentric' | 'zigzag'; // fill pattern for ironing pass
  ironingInset?: number;  // mm — keep ironing pass away from outer walls (default 0.35)

  // Infill — minimum area
  minInfillArea?: number;        // mm² — skip sparse infill in regions smaller than this

  // Special modes
  relativeExtrusion?: boolean;   // emit M83 + relative E values instead of M82 + absolute
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

  // ── Speed: Travel Acceleration/Jerk toggles ──────────────────────────────
  travelAccelerationEnabled?: boolean; // wired — gate M204/M205 on travel moves
  travelJerkEnabled?: boolean;         // wired — gate M205 on travel moves

  // ── Speed: Acceleration & Jerk ────────────────────────────────────────────
  accelerationEnabled: boolean;
  jerkEnabled: boolean;
  accelerationPrint: number;      // mm/s²
  accelerationTravel: number;     // mm/s²
  accelerationWall: number;       // mm/s²
  accelerationInfill: number;     // mm/s²
  accelerationTopBottom: number;  // mm/s²
  accelerationSupport: number;    // mm/s²
  accelerationOuterWall?: number; // mm/s² — outer wall only (overrides accelerationWall)
  accelerationInnerWall?: number; // mm/s² — inner walls only
  accelerationSkirtBrim?: number; // mm/s² — skirt/brim only
  accelerationInitialLayer?: number; // mm/s² — first layer only
  jerkPrint: number;              // mm/s
  jerkTravel: number;             // mm/s
  jerkWall: number;               // mm/s
  jerkInfill: number;             // mm/s
  jerkTopBottom: number;          // mm/s
  jerkOuterWall?: number;         // mm/s — outer wall only
  jerkInnerWall?: number;         // mm/s — inner walls only
  jerkSupport?: number;           // mm/s — support structures
  jerkSkirtBrim?: number;         // mm/s — skirt/brim
  jerkInitialLayer?: number;      // mm/s — first layer only
  skirtBrimSpeed: number;         // mm/s

  // ── Travel (advanced) ─────────────────────────────────────────────────────
  layerStartX?: number;           // mm — travel to this X at the start of every layer
  layerStartY?: number;           // mm — travel to this Y at the start of every layer
  retractAtLayerChange: boolean;
  maxRetractionCount: number;     // max retractions within minimumExtrusionWindow mm
  retractionExtraPrimeAmount: number; // mm³ — extra prime after long travel
  combingAvoidsSupports: boolean;
  travelRetractBeforeOuterWall: boolean;

  // ── Top/Bottom (advanced) — line directions ───────────────────────────────
  topBottomLineDirections?: number[]; // degrees list cycled per layer (overrides pattern angle)

  // ── Cooling (advanced) ────────────────────────────────────────────────────
  coolingFanEnabled: boolean;
  regularFanSpeedLayer: number;   // layer at which regular fan speed kicks in
  regularFanSpeedAtHeight?: number; // mm — switch to regular fan speed at this Z height
  fanKickstartTime: number;       // ms — kickstart time for fan PWM
  smallLayerPrintingTemperature?: number; // °C — reduce nozzle temp on very short layers

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
  // Cura/Orca-parity "slicing closing radius". Before classifying contours,
  // each boundary is inflated by r, unioned with its neighbours (merging
  // anything within 2r), then shrunk back. This seals sub-millimetre gaps
  // in imperfect STL exports (sculpting tools, CSG outputs) without
  // distorting clean meshes. 0 = disabled. Default ~0.049 matches Orca.
  slicingClosingRadius?: number; // mm

  // ─── Dimensional Compensation (Cura: Shell) ─────────────────────────────
  // Match Cura's horizontal expansion / elephant-foot controls so parts
  // print dimensionally accurate without post-processing.
  horizontalExpansion?: number;      // mm — shrink/expand XY contours (+ grows, - shrinks)
  initialLayerHorizontalExpansion?: number; // mm — separate value for first layer
  holeHorizontalExpansion?: number;  // mm — only applied to holes (positive enlarges, negative tightens)
  elephantFootCompensation?: number; // mm — shrink first few layers to undo squish

  // ─── Per-feature Flow (Cura: Material) ──────────────────────────────────
  // Each feature can override the global flow rate. `undefined` means "use
  // material.flowRate". Values are % (100 = nominal).
  wallFlow?: number;                 // % — outer + inner wall flow
  outerWallFlow?: number;            // % — outer wall only (overrides wallFlow)
  innerWallFlow?: number;            // % — inner walls only
  topBottomFlow?: number;            // % — top/bottom skin flow
  infillFlow?: number;               // % — sparse infill flow
  supportFlow?: number;              // % — support structure flow
  supportInterfaceFlow?: number;     // % — support interface flow
  skirtBrimFlow?: number;            // % — skirt/brim flow
  initialLayerFlow?: number;         // % — overrides flow on first layer
  prideMaterialFlow?: number;        // % — flow during standby retract (spillover)

  // ─── Advanced Bridging (Cura: Experimental) ─────────────────────────────
  // Cura's Bridge settings are gated behind enable_bridge_settings. Users
  // often want fine control over multiple bridge layers + second fan.
  enableBridgeSettings?: boolean;    // master toggle for the settings below
  bridgeEnableMoreLayers?: boolean;  // apply bridge settings to layers above the first bridge
  bridgeFanSpeed2?: number;          // % — fan on 2nd bridge layer
  bridgeFanSpeed3?: number;          // % — fan on 3rd bridge layer
  bridgeMinWallLineWidth?: number;   // mm — minimum width below which bridge wall becomes a skin
  bridgeSparseInfillMaxDensity?: number; // % — treat as bridge when infill below this density

  // ─── Small Feature handling ─────────────────────────────────────────────
  smallFeatureMaxLength?: number;    // mm — features shorter than this get smallFeatureSpeedFactor
  smallFeatureSpeedFactor?: number;  // % — speed multiplier for small features (e.g. holes)
  smallFeatureInitialLayerSpeedFactor?: number; // % — small feature speed on first layer

  // ─── Prime Tower (Cura: Dual) ───────────────────────────────────────────
  // Multi-extruder support is scaffolded — settings persist but aren't wired
  // to the slicer worker yet. Keeping them here so the profile shape matches
  // a real Cura profile export/import.
  primeTowerEnable?: boolean;
  primeTowerSize?: number;           // mm — diameter/side of prime tower
  primeTowerPositionX?: number;      // mm — center X on build plate
  primeTowerPositionY?: number;      // mm — center Y on build plate
  primeTowerMinVolume?: number;      // mm³ — minimum purge volume per tool change
  primeTowerWipeEnable?: boolean;    // wipe on tower after tool change

  // =========================================================================
  // Cura-parity extension (see TaskLists.txt for wiring status). Fields marked
  // "wired" are honored by src/engine/Slicer.ts; fields marked "storage-only"
  // round-trip through save/load but don't yet affect generated G-code.
  // =========================================================================

  // ─── Walls (Cura: Shell) ────────────────────────────────────────────────
  wallLineCount?: number;              // wired — alias for wallCount
  minEvenWallLineWidth?: number;       // storage-only — mm; min width for even-count walls
  holeHorizontalExpansionMaxDiameter?: number; // wired — mm; holes > this skip hole expansion
  wallDistributionCount?: number;      // storage-only — Cura adaptive-width algorithm
  wallTransitionFilterDistance?: number; // storage-only — mm
  wallTransitionFilterMargin?: number;   // storage-only — mm
  innerWallLineWidth?: number;         // wired — inner perimeter line width
  groupOuterWalls?: boolean;           // wired — emit all outer walls together
  outerWallInset?: number;             // wired — mm; shift outer wall inward from contour
  printThinWalls?: boolean;            // storage-only — detect and print narrow gaps
  minFeatureSize?: number;             // storage-only — mm; skip contours narrower than this
  minThinWallLineWidth?: number;       // storage-only — mm; extrusion floor for thin walls
  alternateWallDirections?: boolean;   // wired — flip wall direction per layer
  overhangingWallAngle?: number;       // storage-only — degrees
  overhangingWallSpeed?: number;       // storage-only — % of wall speed
  minOddWallLineWidth?: number;        // wired — mm
  zSeamPosition?: 'shortest' | 'user_specified' | 'random' | 'sharpest_corner' | 'back'; // wired
  zSeamRelative?: boolean;             // wired — z seam X/Y relative to model
  zSeamOnVertex?: boolean;             // storage-only — snap seam to nearest vertex
  seamCornerPreference?: 'none' | 'hide_seam' | 'expose_seam' | 'hide_or_expose' | 'smart_hide'; // wired

  // ─── Top/Bottom (Cura: Top/Bottom) ──────────────────────────────────────
  initialBottomLayers?: number;        // wired — extra solid bottom layers on the very first solid bottom
  connectTopBottomPolygons?: boolean;  // storage-only — connect top/bottom fill polygons
  monotonicIroningOrder?: boolean;     // storage-only — monotonic order for ironing passes
  topSurfaceSkinLayers?: number;       // storage-only — extra ultra-quality top layers
  bottomSurfaceSkinLayers?: number;    // storage-only — extra ultra-quality bottom layers
  topSkinRemovalWidth?: number;        // storage-only — mm; separate top skin removal width
  bottomSkinRemovalWidth?: number;     // storage-only — mm; separate bottom skin removal width
  smallTopBottomWidth?: number;        // storage-only — mm; min width to generate skin
  maxSkinAngleForExpansion?: number;   // storage-only — deg
  minSkinWidthForExpansion?: number;   // storage-only — mm
  layerStartAtSeam?: boolean;          // storage-only — start each layer at the seam
  minimumExtrusionDistanceWindow?: number; // wired — mm window for maxRetractionCount
  topThickness?: number;               // wired — mm; overrides topLayers when set
  bottomThickness?: number;            // wired — mm; overrides bottomLayers when set
  skinOverlapPercent?: number;         // wired — % overlap between skin and walls
  topSkinExpandDistance?: number;      // wired — mm — grow top skin outward
  bottomSkinExpandDistance?: number;   // wired — mm — grow bottom skin outward
  skinRemovalWidth?: number;           // wired — mm — shrink skin then regrow (fills noise)
  extraSkinWallCount?: number;         // wired — extra perimeter loops around skin
  noSkinInZGaps?: boolean;             // storage-only — skip skin when model has z-gaps
  bottomPatternInitialLayer?: 'lines' | 'concentric' | 'zigzag' | 'monotonic'; // wired
  ironOnlyHighestLayer?: boolean;      // storage-only — only iron last top-surface layer

  // ─── Infill ────────────────────────────────────────────────────────────
  infillLineDistance?: number;         // wired — mm — when set, overrides density-derived spacing
  infillLineDirections?: number[];     // wired — degrees; list cycled per layer
  infillLayerThickness?: number;       // wired — print infill every N layers thick
  connectInfillLines?: boolean;        // wired — chain infill polylines
  connectInfillPolygons?: boolean;     // wired — chain infill polygons
  infillWipeDistance?: number;         // storage-only — mm — wipe after infill pass
  infillOverhangAngle?: number;        // wired — degrees
  gradualInfillStepHeight?: number;    // storage-only — mm per gradual step
  lightningPruneAngle?: number;        // wired — degrees
  lightningStraighteningAngle?: number;// wired — degrees
  lightningInfillOverhangAngle?: number; // wired — deg — overhang angle for lightning infill (separate from supportAngle)
  infillXOffset?: number;              // wired — mm — shift infill pattern origin
  infillYOffset?: number;              // wired — mm — shift infill pattern origin

  // ─── Retraction & Z-Hop (Cura: Material/Travel) ─────────────────────────
  zHopWhenRetracted?: boolean;         // wired — emit Z lift on retract
  zHopHeight?: number;                 // wired — mm
  zHopSpeed?: number;                  // wired — mm/s
  zHopOnlyOverPrinted?: boolean;       // storage-only — only hop over printed parts
  // retractionExtraPrimeAmount declared as a required field in the Travel
  // section above — reused here, don't redeclare.
  wipeRetractionDistance?: number;     // wired — mm — wipe-while-retracting
  wipeRetractionExtraPrime?: number;   // wired — mm³ prime after wipe retract

  // ─── Cooling ───────────────────────────────────────────────────────────
  buildVolumeFanSpeedAtHeight?: number; // wired — mm — switch build vol fan at this Z
  initialLayersBuildVolumeFanSpeed?: number; // storage-only — % — build vol fan for first layers
  initialFanSpeed?: number;            // wired — % — fan at layer 0
  maximumFanSpeed?: number;            // wired — % — ramp ceiling
  regularMaxFanThreshold?: number;     // wired — seconds/layer — below this, fan ramps toward max
  minimumSpeed?: number;               // wired — mm/s — slowdown floor during min-layer-time
  buildVolumeFanSpeed?: number;        // wired — % — auxiliary chamber/build-volume fan

  // ─── Support advanced ──────────────────────────────────────────────────
  supportTopDistance?: number;         // wired — mm — gap above support (to model below next layer)
  supportFanSpeedOverride?: number;    // wired — % — fan speed during support printing (0 = disabled)
  supportInfillLineDirections?: number[]; // wired — degrees list cycled per layer for support scan angle
  initialLayerSupportLineDistance?: number; // wired — mm — override support spacing on layer 0
  gradualSupportSteps?: number;        // wired — reduce support density every N layers from the top
  gradualSupportStepHeight?: number;   // wired — mm — height of each gradual support step
  minSupportXYDistance?: number;       // wired — mm — hard minimum XY gap (on top of supportXYDistance)
  supportWallLineCount?: number;       // wired — perimeter walls around support infill
  supportDistancePriority?: 'xy_overrides_z' | 'z_overrides_xy'; // storage-only
  supportStairStepMaxWidth?: number;   // storage-only — mm
  supportInterfaceThickness?: number;  // storage-only — mm
  supportRoofThickness?: number;       // storage-only — mm
  supportFloorThickness?: number;      // storage-only — mm
  supportRoofDensity?: number;         // storage-only — %
  supportFloorDensity?: number;        // storage-only — %
  supportRoofLineDistance?: number;    // storage-only — mm
  supportFloorLineDistance?: number;   // storage-only — mm
  supportRoofPattern?: 'lines' | 'grid' | 'concentric' | 'zigzag'; // storage-only
  supportFloorPattern?: 'lines' | 'grid' | 'concentric' | 'zigzag'; // storage-only
  minSupportInterfaceArea?: number;    // storage-only — mm²
  supportInterfaceHorizontalExpansion?: number; // storage-only — mm
  supportInterfaceLineDirections?: number[]; // storage-only — degrees
  useTowers?: boolean;                 // storage-only
  towerDiameter?: number;              // storage-only — mm
  towerRoofAngle?: number;             // storage-only — degrees
  supportHorizontalExpansion?: number; // wired — mm — inflate support regions
  enableConicalSupport?: boolean;      // storage-only
  conicalSupportAngle?: number;        // storage-only — degrees
  connectSupportLines?: boolean;       // storage-only — chain support infill
  connectSupportZigZags?: boolean;     // storage-only — chain zigzag support
  supportInfillLayerThickness?: number;// storage-only — mm
  supportJoinDistance?: number;        // wired — mm — merge support polygons closer than this
  enableSupportBrim?: boolean;         // storage-only — emit brim around support on layer 0
  supportBrimLineCount?: number;       // storage-only
  supportBrimWidth?: number;           // storage-only — mm
  supportStairStepHeight?: number;     // storage-only — mm
  supportStairStepMinSlope?: number;   // storage-only — degrees
  supportLineDistance?: number;        // wired — mm — overrides density-derived spacing
  minimumSupportArea?: number;         // wired — mm² — drop support islands smaller than this

  // ─── Travel ────────────────────────────────────────────────────────────
  avoidPrintedParts?: boolean;         // wired — travel reroutes around printed regions
  avoidSupports?: boolean;             // wired — travel reroutes around support regions
  maxCombDistanceNoRetract?: number;   // wired — mm — comb up to this before forcing a retract
  travelAvoidDistance?: number;        // wired — mm — buffer around parts
  insideTravelAvoidDistance?: number;  // wired — mm — buffer for inside-part travel

  // ─── Experimental ──────────────────────────────────────────────────────
  smoothSpiralizedContours?: boolean;  // storage-only — round corners in vase mode
  flowEqualizationRatio?: number;      // storage-only — 0.0–1.0 adjust speed to equalize flow volume
  flowRateCompensationFactor?: number; // wired — multiplier on all extrusion E values
  primeBlobEnable?: boolean;           // wired — deposit purge blob before print starts
  primeBlobSize?: number;              // wired — mm³ of material to purge
  fuzzySkinOutsideOnly?: boolean;      // storage-only — only apply fuzzy skin to outer walls
  minVolumeBeforeCoasting?: number;    // wired — mm³ — don't coast if total wall extrusion < this
  draftShieldLimitation?: 'full' | 'limited'; // wired — cap draft shield height
  draftShieldHeight?: number;          // wired — mm — max Z for draft shield when limitation = limited
  infillTravelOptimization?: boolean;  // storage-only — reorder infill to minimize travel (already default behavior)
  breakUpSupportInChunks?: boolean;    // storage-only
  breakUpSupportChunkSize?: number;    // storage-only — mm
  breakUpSupportChunkLineCount?: number; // storage-only
  conicalSupportMinWidth?: number;     // storage-only — mm (companion to conicalSupportAngle)
  adaptiveLayersTopographySize?: number; // storage-only — mm
  minLayerTimeWithOverhang?: number;   // storage-only — seconds
  keepRetractingDuringTravel?: boolean; // storage-only
  primeDuringTravel?: boolean;         // storage-only
  // smallHoleMaxSize already declared as required above — don't redeclare.
  brimAvoidMargin?: number;            // wired — mm — keep brim this far from other parts
  smartBrim?: boolean;                 // storage-only — only generate brim where needed
  initialLayerZOverlap?: number;       // wired — mm — first-layer over-extrusion to improve adhesion
  minMoldWidth?: number;               // storage-only — mm
  fluidMotionEnable?: boolean;         // storage-only
  fluidMotionAngle?: number;           // storage-only — degrees
  fluidMotionSmallDistance?: number;   // storage-only — mm
  coastingSpeed?: number;              // storage-only — % of wall speed during coasting
  scarfSeamLength?: number;            // storage-only — mm
  scarfSeamStepLength?: number;        // storage-only — mm
  scarfSeamStartHeight?: number;       // storage-only — mm
  enableOozeShield?: boolean;          // storage-only
  oozeShieldAngle?: number;            // storage-only — degrees
  oozeShieldDistance?: number;         // storage-only — mm

  // ─── Raft advanced ─────────────────────────────────────────────────────
  raftMiddleLayers?: number;           // storage-only — count of middle layers
  raftMiddleThickness?: number;        // storage-only — mm per middle layer
  raftMiddleLineWidth?: number;        // storage-only — mm
  raftMiddleLineSpacing?: number;      // storage-only — mm
  raftInterfaceZOffset?: number;       // storage-only — mm
  raftTopLayers?: number;              // storage-only — count of top surface layers
  raftTopThickness?: number;           // storage-only — mm
  raftTopLineWidth?: number;           // storage-only — mm
  raftTopLineSpacing?: number;         // storage-only — mm
  raftTopSurfaceZOffset?: number;      // storage-only — mm
  raftBaseLineSpacing?: number;        // storage-only — mm
  raftBaseInfillOverlap?: number;      // storage-only — %
  raftPrintAcceleration?: number;      // storage-only — mm/s²
  raftPrintJerk?: number;              // storage-only — mm/s
  raftFanSpeed?: number;               // storage-only — %
  raftFlow?: number;                   // storage-only — %
  monotonicRaftTopSurface?: boolean;   // storage-only
  removeRaftInsideCorners?: boolean;   // storage-only
  raftSmoothing?: number;              // storage-only — mm — outline smoothing radius
  raftExtraMargin?: number;            // storage-only — mm — extra padding around model
  raftWallCount?: number;              // storage-only

  // ─── Top Surface Skin ─────────────────────────────────────────────────
  topSurfaceSkinLineWidth?: number;    // storage-only — mm
  topSurfaceSkinPattern?: 'lines' | 'concentric' | 'zigzag'; // storage-only
  topSurfaceSkinExpansion?: number;    // storage-only — mm
  topSurfaceSkinFlow?: number;         // storage-only — %

  // ─── Initial Layer Per-Feature Flow Overrides ─────────────────────────
  initialLayerOuterWallFlow?: number;  // wired — % override for first layer outer wall
  initialLayerInnerWallFlow?: number;  // wired — % override for first layer inner walls
  initialLayerBottomFlow?: number;     // wired — % override for first layer solid fill

  // ─── Infill Line Move-Inwards ─────────────────────────────────────────
  infillStartMoveInwardsLength?: number; // wired — mm — extend scan-line start outward
  infillEndMoveInwardsLength?: number;   // wired — mm — extend scan-line end outward

  // ─── Scarf Seam Speed Ratio ───────────────────────────────────────────
  scarfSeamStartSpeedRatio?: number;   // wired — 0.0–1.0 — speed fraction at seam start

  // ─── Wall Order Optimisation ──────────────────────────────────────────
  optimizeWallOrder?: boolean;         // storage-only — reorder walls to minimize travel

  // ─── Cubic Subdivision ────────────────────────────────────────────────
  cubicSubdivisionShell?: number;      // storage-only — mm shell excluded from cubic subdivision

  // ─── Support Roof / Floor Speeds & Flow ───────────────────────────────
  supportRoofSpeed?: number;           // storage-only — mm/s
  supportFloorSpeed?: number;          // storage-only — mm/s
  supportRoofFlow?: number;            // storage-only — %
  supportFloorFlow?: number;           // storage-only — %

  // flowEqualizationRatio declared above in Experimental section.
  // bridgeFanSpeed2 / bridgeFanSpeed3 declared above in Bridging section.

  // ─── Bridge Extras ────────────────────────────────────────────────────
  bridgeSkinDensity?: number;          // storage-only — %
  interlaceBridgeLines?: boolean;      // storage-only
  bridgeHasMultipleLayers?: boolean;   // storage-only

  // ─── Support Interface Wall Count ─────────────────────────────────────
  supportInterfaceWallCount?: number;  // storage-only

  // Fields whose values were imported from a connected printer (shown with machine badge in UI)
  machineSourcedFields?: string[];
}

// -----------------------------------------------------------------------------
// Plate Object - a model placed on the build plate
// -----------------------------------------------------------------------------

export interface PlateObject {
  id: string;
  name: string;
  featureId?: string; // reference to CAD feature (optional — may be a file import)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  perObjectSettings?: Record<string, any>;
  // Modifier mesh role — when set this object modifies slicing of other meshes
  // rather than being printed itself. Storage-only until engine support lands.
  modifierMeshRole?: ModifierMeshRole;
  modifierMeshSettings?: ModifierMeshSettings;
}

// -----------------------------------------------------------------------------
// Modifier Meshes (per-object mesh roles — storage scaffold)
// -----------------------------------------------------------------------------

export type ModifierMeshRole =
  | 'normal'          // regular printable object
  | 'infill_mesh'     // forces infill settings inside volume
  | 'cutting_mesh'    // subtracts geometry from overlapping objects
  | 'support_mesh'    // forces support generation inside volume
  | 'anti_overhang_mesh'; // prevents support generation inside volume

export interface ModifierMeshSettings {
  // Infill mesh overrides (active when role === 'infill_mesh')
  infillDensity?: number;
  infillPattern?: PrintProfile['infillPattern'];
  // Support mesh overrides (active when role === 'support_mesh')
  supportEnabled?: boolean;
  // Anti-overhang: no additional settings needed — volume defines blocked region
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
  layerHeight?: number; // override extrusion layer height (raft sub-layers use per-section heights)
}

// =============================================================================
// Default Profiles
// =============================================================================

export const DEFAULT_PRINTER_PROFILES: PrinterProfile[] = [
  {
    id: 'custom-fff',
    name: 'Custom FFF Printer',
    buildVolume: { x: 100, y: 100, z: 100 },
    nozzleDiameter: 0.4,
    nozzleCount: 1,
    filamentDiameter: 2.85,
    hasHeatedBed: true,
    hasHeatedChamber: false,
    maxNozzleTemp: 300,
    maxBedTemp: 120,
    maxSpeed: 200,
    maxAcceleration: 3000,
    originCenter: false,
    gcodeFlavorType: 'marlin',
    buildPlateShape: 'rectangular',
    printheadMinX: -20,
    printheadMinY: -10,
    printheadMaxX: 10,
    printheadMaxY: 10,
    gantryHeight: 100,
    applyExtruderOffsets: true,
    startGCodeMustBeFirst: false,
    extruderOffsetX: 0,
    extruderOffsetY: 0,
    coolingFanNumber: 0,
    printTimeEstimationFactor: 1.0,
    startGCode:
      'G28 ;Home\n' +
      'G1 Z15.0 F6000 ;Move the platform down 15mm\n' +
      ';Prime the extruder\n' +
      'G92 E0\n' +
      'G1 F200 E3\n' +
      'G92 E0\n',
    endGCode:
      'M104 S0\n' +
      'M140 S0\n' +
      ';Retract the filament\n' +
      'G92 E1\n' +
      'G1 E-1 F300\n' +
      'G28 X0 Y0\n' +
      'M84\n',
  },
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
    startGCodeMustBeFirst: true,
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
    slicingClosingRadius: 0.049,
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
    slicingClosingRadius: 0.049,
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
    slicingClosingRadius: 0.049,
  },
];
