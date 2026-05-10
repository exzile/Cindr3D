// ── Layer-aware post-processor types ─────────────────────────────────────────

/** Which post-processor behaviour to apply. */
export type LayerProcessorKind =
  | 'change-at-z'       // change temperature / fan / speed / flow at a Z height
  | 'pause-at-z'        // M0 / M25 pause at a Z height
  | 'filament-change'   // M600 colour/filament change at a Z height
  | 'tuning-tower'      // ramp a parameter linearly over a Z range
  | 'search-replace'    // regex find-and-replace on the full G-code string
  | 'timelapse'         // inject camera-shutter gcode at every layer change
  | 'custom-gcode-at-z' // inject arbitrary gcode block at a Z height
  | 'print-from-height'; // skip all layers below a given Z

export interface LayerProcessor {
  id: string;
  enabled: boolean;
  kind: LayerProcessorKind;

  // ── Trigger (used by change-at-z, pause-at-z, filament-change, custom-gcode-at-z)
  triggerMode?: 'z' | 'layer';   // default: 'z'
  triggerZ?: number;              // mm — inject once when Z crosses this value
  triggerLayer?: number;          // 0-based layer index (used when triggerMode='layer')

  // ── change-at-z: which settings to modify ────────────────────────────────
  changeTemperature?: boolean;
  changeTemperatureValue?: number;       // °C  (M104 Sxxx)
  changeBedTemperature?: boolean;
  changeBedTemperatureValue?: number;    // °C  (M140 Sxxx)
  changeFanSpeed?: boolean;
  changeFanSpeedValue?: number;          // 0–255 (M106 Sxxx)
  changePrintSpeed?: boolean;
  changePrintSpeedValue?: number;        // mm/s → stored as feed-rate percent (M220 Sxxx)
  changeFlowRate?: boolean;
  changeFlowRateValue?: number;          // % (M221 Sxxx)

  // ── pause-at-z ────────────────────────────────────────────────────────────
  pauseCommand?: 'M0' | 'M25' | 'M600'; // default: 'M0'
  parkX?: number;                        // optional nozzle-park X (mm)
  parkY?: number;                        // optional nozzle-park Y (mm)
  displayText?: string;                  // message shown on LCD (M117)

  // ── tuning-tower ─────────────────────────────────────────────────────────
  tuningParameter?: 'temperature' | 'bed-temperature' | 'fan' | 'speed' | 'flow' | 'pressure-advance';
  tuningStartZ?: number;                 // mm — ramp start
  tuningEndZ?: number;                   // mm — ramp end
  tuningStartValue?: number;             // value at tuningStartZ
  tuningEndValue?: number;               // value at tuningEndZ
  tuningStepSize?: number;               // mm — inject command every N mm (0 = every layer)

  // ── search-replace ────────────────────────────────────────────────────────
  searchPattern?: string;                // regex pattern string
  searchFlags?: string;                  // regex flags (g, i, m, …)  default: 'g'
  replaceWith?: string;                  // replacement string (supports $1 back-refs)

  // ── timelapse ─────────────────────────────────────────────────────────────
  timelapseCommand?: string;             // G-code to inject (default: 'M240')
  timelapseStartLayer?: number;          // first layer to capture (default: 0)

  // ── custom-gcode-at-z ─────────────────────────────────────────────────────
  customGcode?: string;                  // multi-line G-code block to inject

  // ── print-from-height ─────────────────────────────────────────────────────
  printFromZ?: number;                   // mm — discard all content below this Z
}

export interface PaintedZSeamHint {
  x: number;
  y: number;
  z?: number;
  radius?: number;
  weight?: number;
  coordinateSpace?: 'world' | 'object';
}

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
  infillPattern: 'grid' | 'lines' | 'triangles' | 'cubic' | 'gyroid' | 'honeycomb' | 'lightning' | 'organic' | 'concentric' | 'cross' | 'cross3d' | 'quarter_cubic' | 'octet' | 'tri_hexagon' | 'zigzag' | 'tetrahedral' | 'cubicsubdiv';
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
  outerWallFirst: boolean;       // wired — print outer before inner (better surface, less ooze)
  alternateExtraWall: boolean;   // add extra wall every other layer for stronger prints

  // Infill advanced
  infillWallCount: number;       // extra perimeters around infill regions
  gradualInfillSteps: number;    // reduce infill every N layers closer to top

  // Speed — per-zone overrides
  supportSpeed: number;          // mm/s for support structures (walls, interface)
  supportInfillSpeed?: number;   // mm/s for support infill lines (defaults to supportSpeed)
  supportInterfaceSpeed?: number; // mm/s for support interface layers (defaults to supportSpeed)
  maxFlowRate?: number;           // mm³/s — cap extrusion speed so volumetric flow = this
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
  /** Wall generator. `'classic'` = fixed-width offset fallback. `'arachne'`
   *  = production default variable-width walls via libArachne WASM, matching
   *  Cura's narrow-feature wall strategy. */
  wallGenerator?: 'classic' | 'arachne';
  /** Backend used when `wallGenerator` is `'arachne'`. `'wasm'` is the
   *  production backend; `'js'` remains as a legacy-compatible registry alias. */
  arachneBackend?: 'js' | 'wasm';

  // Ironing (top surface smoothing)
  ironingEnabled: boolean;
  ironingSpeed: number;
  ironingFlow: number; // very low flow %
  ironingSpacing: number; // line spacing
  ironingPattern?: 'lines' | 'concentric' | 'zigzag'; // fill pattern for ironing pass
  ironingInset?: number;  // mm — keep ironing pass away from outer walls (default 0.35)
  nonPlanarIroningEnabled?: boolean; // wired — let ironing Z follow local top surface
  nonPlanarIroningMaxOffset?: number; // wired — max Z lift above planar layer during ironing
  nonPlanarIroningSampleSpacing?: number; // wired — max XY distance between sampled ironing Z points

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

  // -- Quality / Adaptive Layers ---------------------------------------------
  adaptiveLayersEnabled: boolean;
  adaptiveLayersMaxVariation: number;    // mm — max layer height change between layers
  adaptiveLayersVariationStep: number;   // mm — step size for adaptive layer calculation

  adaptiveLayersMinHeight?: number;      // wired - minimum adaptive layer height
  adaptiveLayersMaxHeight?: number;      // wired - maximum adaptive layer height

  // -- Walls (advanced) -----------------------------------------------------
  wallTransitionLength: number;   // mm — distance over which wall count transitions
  wallTransitionAngle: number;    // deg — overhang angle to trigger wall count transition
  minWallLineWidth: number;       // mm — minimum computed wall line width
  outerWallWipeDistance: number;  // mm — wipe distance after outer wall
  zSeamX: number | null;          // mm — custom seam X (null = automatic)
  zSeamY: number | null;          // mm — custom seam Y

  // -- Top / Bottom (advanced) -----------------------------------------------
  roofingLayers: number;          // extra top surface-only layers (printed last)
  roofingPattern: 'lines' | 'concentric' | 'zigzag' | 'monotonic';
  monotonicTopBottomOrder: boolean;  // fill top/bottom in monotonic order (no crossings)
  bridgeSkinSpeed: number;        // mm/s — speed for bridge skin lines
  bridgeSkinFlow: number;         // % — flow for bridge skin
  bridgeAngle: number;            // deg — 0 = auto-detect bridge angle
  bridgeWallSpeed: number;        // mm/s — speed for bridge wall lines
  skinEdgeSupportLayers: number;  // number of support layers for skin edges

  // -- Infill (advanced) -----------------------------------------------------
  infillBeforeWalls: boolean;     // print infill before walls (vice versa = stronger walls)
  multiplyInfill: number;         // repeat infill lines N times (1 = normal)
  randomInfillStart: boolean;     // randomize infill start position each layer
  lightningInfillSupportAngle: number; // deg — angle for lightning infill support branches

  // -- Speed: Travel Acceleration/Jerk toggles ------------------------------
  travelAccelerationEnabled?: boolean; // wired — gate M204/M205 on travel moves
  travelJerkEnabled?: boolean;         // wired — gate M205 on travel moves

  // -- Speed: Acceleration & Jerk --------------------------------------------
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

  // -- Travel (advanced) -----------------------------------------------------
  layerStartX?: number;           // mm — travel to this X at the start of every layer
  layerStartY?: number;           // mm — travel to this Y at the start of every layer
  retractAtLayerChange: boolean;
  maxRetractionCount: number;     // max retractions within minimumExtrusionWindow mm
  retractionExtraPrimeAmount: number; // mm³ — extra prime after long travel
  combingAvoidsSupports: boolean;
  travelRetractBeforeOuterWall: boolean;

  // -- Top/Bottom (advanced) — line directions -------------------------------
  topBottomLineDirections?: number[]; // degrees list cycled per layer (overrides pattern angle)

  // -- Cooling (advanced) ----------------------------------------------------
  coolingFanEnabled: boolean;
  regularFanSpeedLayer: number;   // layer at which regular fan speed kicks in
  regularFanSpeedAtHeight?: number; // mm — switch to regular fan speed at this Z height
  fanKickstartTime: number;       // ms — kickstart time for fan PWM
  smallLayerPrintingTemperature?: number; // °C — reduce nozzle temp on very short layers

  // -- Support (advanced) ----------------------------------------------------
  supportBuildplateOnly: boolean; // only generate support touching buildplate
  supportRoofEnable: boolean;
  supportFloorEnable: boolean;
  supportBottomDistance: number;  // mm — gap under support (to model below)
  supportWallCount: number;       // walls around support
  supportInterfacePattern: 'lines' | 'grid' | 'concentric' | 'zigzag';
  supportInterfaceDensity: number; // %

  // -- Adhesion (detailed) ---------------------------------------------------
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

  // -- Mesh Fixes ------------------------------------------------------------
  unionOverlappingVolumes: boolean;
  removeAllHoles: boolean;
  extensiveStitching: boolean;
  keepDisconnectedFaces: boolean;
  maxResolution: number;          // mm — merge vertices closer than this
  maxDeviation: number;           // mm — max deviation from original surface
  maxTravelResolution: number;    // mm — resolution for travel moves

  // -- Special Modes (expanded) ----------------------------------------------
  surfaceMode: 'normal' | 'surface' | 'both';
  moldEnabled: boolean;           // generate mold geometry around model
  moldAngle: number;              // deg — mold draft angle
  moldRoofHeight: number;         // mm — height above model to close mold

  // -- Experimental (expanded) -----------------------------------------------
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

  // --- Dimensional Compensation (Cura: Shell) -----------------------------
  // Match Cura's horizontal expansion / elephant-foot controls so parts
  // print dimensionally accurate without post-processing.
  horizontalExpansion?: number;      // mm — shrink/expand XY contours (+ grows, - shrinks)
  initialLayerHorizontalExpansion?: number; // mm — separate value for first layer
  holeHorizontalExpansion?: number;  // mm — only applied to holes (positive enlarges, negative tightens)
  elephantFootCompensation?: number; // mm — shrink first few layers to undo squish

  // --- Per-feature Flow (Cura: Material) ----------------------------------
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

  // --- Advanced Bridging (Cura: Experimental) -----------------------------
  // Cura's Bridge settings are gated behind enable_bridge_settings. Users
  // often want fine control over multiple bridge layers + second fan.
  enableBridgeSettings?: boolean;    // master toggle for the settings below
  bridgeEnableMoreLayers?: boolean;  // apply bridge settings to layers above the first bridge
  bridgeFanSpeed2?: number;          // % — fan on 2nd bridge layer
  bridgeFanSpeed3?: number;          // % — fan on 3rd bridge layer
  bridgeMinWallLineWidth?: number;   // mm — minimum width below which bridge wall becomes a skin
  bridgeSparseInfillMaxDensity?: number; // % — treat as bridge when infill below this density

  // --- Small Feature handling ---------------------------------------------
  smallFeatureMaxLength?: number;    // mm — features shorter than this get smallFeatureSpeedFactor
  smallFeatureSpeedFactor?: number;  // % — speed multiplier for small features (e.g. holes)
  smallFeatureInitialLayerSpeedFactor?: number; // % — small feature speed on first layer

  // --- Prime Tower (Cura: Dual) -------------------------------------------
  // Multi-extruder support is scaffolded — settings persist but aren't wired
  // to the slicer worker yet. Keeping them here so the profile shape matches
  // a real Cura profile export/import.
  primeTowerEnable?: boolean;
  primeTowerSize?: number;           // mm — diameter/side of prime tower
  primeTowerPositionX?: number;      // mm — center X on build plate
  primeTowerPositionY?: number;      // mm — center Y on build plate
  primeTowerMinVolume?: number;      // mm³ — minimum purge volume per tool change
  primeTowerWipeEnable?: boolean;    // wipe on tower after tool change
  extruderIndex?: number;            // wired — active tool/extruder for this print or object group
  toolChangeGCode?: string;          // wired — optional tool-change snippet, supports {tool}

  // =========================================================================
  // Cura-parity extension (see TaskLists.txt for wiring status). Fields marked
  // "wired" are honored by src/engine/Slicer.ts; fields marked "storage-only"
  // round-trip through save/load but don't yet affect generated G-code.
  // =========================================================================

  // --- Walls (Cura: Shell) ------------------------------------------------
  wallLineCount?: number;              // wired — alias for wallCount
  minEvenWallLineWidth?: number;       // storage-only — mm; min width for even-count walls
  holeHorizontalExpansionMaxDiameter?: number; // wired — mm; holes > this skip hole expansion
  wallDistributionCount?: number;      // wired to Arachne WASM — Cura adaptive-width algorithm
  wallTransitionFilterDistance?: number; // wired to Arachne WASM — mm
  wallTransitionFilterMargin?: number;   // wired to Arachne WASM — mm
  /** Smallest segment libArachne's wall simplifier preserves. In mm.
   *  Default 0.5 — matches OrcaSlicer's permissive setting that
   *  collapses sub-mm medial-axis branches at this scale, eliminating
   *  the visible inner-wall gaps thinner annular features otherwise
   *  show. Lower values preserve more detail at the cost of branch
   *  artifacts in narrow regions. */
  wallMaximumResolution?: number;
  /** Maximum deviation the wall simplifier may introduce. In mm.
   *  Default 0.025. */
  wallMaximumDeviation?: number;
  innerWallLineWidth?: number;         // wired — inner perimeter line width
  groupOuterWalls?: boolean;           // wired — emit all outer walls together
  outerWallInset?: number;             // wired — mm; shift outer wall inward from contour
  printThinWalls?: boolean;            // wired to Arachne WASM — detect and print narrow gaps
  minFeatureSize?: number;             // wired to Arachne WASM — mm; skip contours narrower than this
  minThinWallLineWidth?: number;       // wired to Arachne WASM — mm; extrusion floor for thin walls
  minWallLengthFactor?: number;        // wired to Arachne WASM — Orca-style min odd open-line length multiplier
  preciseOuterWall?: boolean;          // wired — keep outer/inner wall spacing dimensionally exact
  alternateWallDirections?: boolean;   // wired — flip wall direction per layer
  overhangingWallAngle?: number;       // storage-only — degrees
  overhangingWallSpeed?: number;       // storage-only — % of wall speed
  minOddWallLineWidth?: number;        // wired — mm
  zSeamPosition?: 'shortest' | 'user_specified' | 'random' | 'sharpest_corner' | 'back' | 'painted'; // wired
  zSeamRelative?: boolean;             // wired — z seam X/Y relative to model
  zSeamOnVertex?: boolean;             // storage-only — snap seam to nearest vertex
  zSeamUserSpecifiedRadius?: number;   // wired — mm tolerance around user X/Y target
  zSeamContinuityDistance?: number;    // wired — mm, prefer previous-layer seam if nearby
  seamCornerPreference?: 'none' | 'hide_seam' | 'expose_seam' | 'hide_or_expose' | 'smart_hide'; // wired
  zSeamPaintHints?: PaintedZSeamHint[]; // wired — per-object painted seam hints from the viewport

  // --- Top/Bottom (Cura: Top/Bottom) --------------------------------------
  initialBottomLayers?: number;        // wired — extra solid bottom layers on the very first solid bottom
  connectTopBottomPolygons?: boolean;  // storage-only — connect top/bottom fill polygons
  monotonicIroningOrder?: boolean;     // wired — monotonic order for ironing passes
  topSurfaceSkinLayers?: number;       // wired — number of topmost solid layers that use topSurfaceSkin* overrides
  bottomSurfaceSkinLayers?: number;    // wired — symmetric flag for bottommost N layers (currently exposed via isBottomSurfaceLayer)
  topSkinRemovalWidth?: number;        // wired — mm; separate top skin removal width
  bottomSkinRemovalWidth?: number;     // wired — mm; separate bottom skin removal width
  smallTopBottomWidth?: number;        // wired — mm; skip skin on regions narrower than this
  maxSkinAngleForExpansion?: number;   // storage-only — deg (deferred — needs surrounding-overhang slope detection)
  minSkinWidthForExpansion?: number;   // wired — mm; suppress skin expansion for regions narrower than this
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
  ironOnlyHighestLayer?: boolean;      // wired — only iron last top-surface layer

  // --- Infill ------------------------------------------------------------
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

  // --- Retraction & Z-Hop (Cura: Material/Travel) -------------------------
  zHopWhenRetracted?: boolean;         // wired — emit Z lift on retract
  zHopHeight?: number;                 // wired — mm
  zHopSpeed?: number;                  // wired — mm/s
  zHopOnlyOverPrinted?: boolean;       // storage-only — only hop over printed parts
  // retractionExtraPrimeAmount declared as a required field in the Travel
  // section above — reused here, don't redeclare.
  wipeRetractionDistance?: number;     // wired — mm — wipe-while-retracting
  wipeRetractionExtraPrime?: number;   // wired — mm³ prime after wipe retract

  // --- Cooling -----------------------------------------------------------
  buildVolumeFanSpeedAtHeight?: number; // wired — mm — switch build vol fan at this Z
  initialLayersBuildVolumeFanSpeed?: number; // storage-only — % — build vol fan for first layers
  initialFanSpeed?: number;            // wired — % — fan at layer 0
  maximumFanSpeed?: number;            // wired — % — ramp ceiling
  regularMaxFanThreshold?: number;     // wired — seconds/layer — below this, fan ramps toward max
  minimumSpeed?: number;               // wired — mm/s — slowdown floor during min-layer-time
  buildVolumeFanSpeed?: number;        // wired — % — auxiliary chamber/build-volume fan

  // --- Support advanced --------------------------------------------------
  supportTopDistance?: number;         // wired — mm — gap above support (to model below next layer)
  supportFanSpeedOverride?: number;    // wired — % — fan speed during support printing (0 = disabled)
  supportInfillLineDirections?: number[]; // wired — degrees list cycled per layer for support scan angle
  initialLayerSupportLineDistance?: number; // wired — mm — override support spacing on layer 0
  supportInfillDensityMultiplierInitialLayer?: number; // wired — % multiplier for support density on layer 0
  gradualSupportSteps?: number;        // wired — reduce support density every N layers from the top
  gradualSupportStepHeight?: number;   // wired — mm — height of each gradual support step
  minSupportXYDistance?: number;       // wired — mm — hard minimum XY gap (on top of supportXYDistance)
  supportWallLineCount?: number;       // wired — perimeter walls around support infill
  supportDistancePriority?: 'xy_overrides_z' | 'z_overrides_xy'; // wired — z_overrides_xy relaxes XY clearance in roof/floor interface zones
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
  minSupportInterfaceArea?: number;    // wired — mm² — demote interface to body density when bbox area falls below this
  supportInterfaceHorizontalExpansion?: number; // storage-only — mm
  supportInterfaceLineDirections?: number[]; // storage-only — degrees
  useTowers?: boolean;                 // wired — emit small overhang islands as circular towers
  towerDiameter?: number;              // wired — mm — tower column diameter (also the tiny-island threshold)
  towerRoofAngle?: number;             // wired — deg — angle from horizontal of the tower's roof flare
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

  // --- Travel ------------------------------------------------------------
  avoidPrintedParts?: boolean;         // wired — travel reroutes around printed regions
  avoidSupports?: boolean;             // wired — travel reroutes around support regions
  maxCombDistanceNoRetract?: number;   // wired — mm — comb up to this before forcing a retract
  travelAvoidDistance?: number;        // wired — mm — buffer around parts
  insideTravelAvoidDistance?: number;  // wired — mm — buffer for inside-part travel

  // --- Experimental ------------------------------------------------------
  smoothSpiralizedContours?: boolean;  // wired — subdivide outer-wall segments to smooth Z ramp
  flowEqualizationRatio?: number;      // wired — 0.0–1.0 adjust speed to equalize flow volume
  flowRateCompensationFactor?: number; // wired — multiplier on all extrusion E values
  primeBlobEnable?: boolean;           // wired — deposit purge blob before print starts
  primeBlobSize?: number;              // wired — mm³ of material to purge
  fuzzySkinOutsideOnly?: boolean;      // wired — only outer walls fuzzed (current implementation is outer-only by default)
  minVolumeBeforeCoasting?: number;    // wired — mm³ — don't coast if total wall extrusion < this
  draftShieldLimitation?: 'full' | 'limited'; // wired — cap draft shield height
  draftShieldHeight?: number;          // wired — mm — max Z for draft shield when limitation = limited
  infillTravelOptimization?: boolean;  // storage-only — reorder infill to minimize travel (already default behavior)
  breakUpSupportInChunks?: boolean;    // wired — chunk support scanlines (body only; interface stays continuous)
  breakUpSupportChunkSize?: number;    // wired — mm — gap inserted between chunks
  breakUpSupportChunkLineCount?: number; // wired — number of consecutive scanlines per chunk before the gap
  conicalSupportMinWidth?: number;     // storage-only — mm (companion to conicalSupportAngle)
  adaptiveLayersTopographySize?: number; // wired — mm; caps layer height to keep visible step ≤ this on slopes
  minLayerTimeWithOverhang?: number;   // wired — seconds
  keepRetractingDuringTravel?: boolean; // storage-only
  primeDuringTravel?: boolean;         // storage-only
  // smallHoleMaxSize already declared as required above — don't redeclare.
  brimAvoidMargin?: number;            // wired — mm — keep brim this far from other parts
  smartBrim?: boolean;                 // storage-only — only generate brim where needed
  initialLayerZOverlap?: number;       // wired — mm — first-layer over-extrusion to improve adhesion
  minMoldWidth?: number;               // wired — mm; mold ring thickness around model footprint
  fluidMotionEnable?: boolean;         // storage-only
  fluidMotionAngle?: number;           // storage-only — degrees
  fluidMotionSmallDistance?: number;   // storage-only — mm
  coastingSpeed?: number;              // wired — % of wall speed during coasting
  scarfSeamLength?: number;            // wired — mm
  scarfSeamStepLength?: number;        // wired — mm
  scarfSeamStartHeight?: number;       // wired — mm
  enableOozeShield?: boolean;          // storage-only
  oozeShieldAngle?: number;            // storage-only — degrees
  oozeShieldDistance?: number;         // storage-only — mm

  // --- Raft advanced -----------------------------------------------------
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

  // --- Top Surface Skin -------------------------------------------------
  topSurfaceSkinLineWidth?: number;    // wired — mm
  topSurfaceSkinPattern?: 'lines' | 'concentric' | 'zigzag'; // wired
  topSurfaceSkinExpansion?: number;    // wired — mm
  topSurfaceSkinFlow?: number;         // wired — %

  // --- Initial Layer Per-Feature Flow Overrides -------------------------
  initialLayerOuterWallFlow?: number;  // wired — % override for first layer outer wall
  initialLayerInnerWallFlow?: number;  // wired — % override for first layer inner walls
  initialLayerBottomFlow?: number;     // wired — % override for first layer solid fill

  // --- Infill Line Move-Inwards -----------------------------------------
  infillStartMoveInwardsLength?: number; // wired — mm — extend scan-line start outward
  infillEndMoveInwardsLength?: number;   // wired — mm — extend scan-line end outward

  // --- Scarf Seam Speed Ratio -------------------------------------------
  scarfSeamStartSpeedRatio?: number;   // wired — 0.0–1.0 — speed fraction at seam start

  // --- Wall Order Optimisation ------------------------------------------
  optimizeWallOrder?: boolean;         // storage-only — reorder walls to minimize travel

  // --- Cubic Subdivision ------------------------------------------------
  cubicSubdivisionShell?: number;      // storage-only — mm shell excluded from cubic subdivision

  // --- Support Roof / Floor Speeds & Flow -------------------------------
  supportRoofSpeed?: number;           // storage-only — mm/s
  supportFloorSpeed?: number;          // storage-only — mm/s
  supportRoofFlow?: number;            // storage-only — %
  supportFloorFlow?: number;           // storage-only — %

  // flowEqualizationRatio declared above in Experimental section.
  // bridgeFanSpeed2 / bridgeFanSpeed3 declared above in Bridging section.

  // --- Bridge Extras ----------------------------------------------------
  bridgeSkinDensity?: number;          // wired — %; proportionally drops bridge lines (50 = every other)
  interlaceBridgeLines?: boolean;      // wired — alternates bridge layers to cross prior bridge direction
  bridgeHasMultipleLayers?: boolean;   // wired — legacy alias for bridgeEnableMoreLayers

  // --- Support Interface Wall Count -------------------------------------
  supportInterfaceWallCount?: number;  // storage-only

  // --- Post Processing ---------------------------------------------------
  postProcessingScripts?: string[];     // wired — simple G-code post-processing hooks
  layerProcessors?: LayerProcessor[];   // wired — layer-aware post-processors (ChangeAtZ, pause, tuning tower…)
  embedGCodeThumbnails?: boolean;       // wired — embed 32x32 + 300x300 PNG thumbnails in exported G-code

  // --- Non-Planar --------------------------------------------------------
  nonPlanarSlicingEnabled?: boolean;    // wired guard — planar slicer rejects unsupported mode

  // Fields whose values were imported from a connected printer (shown with machine badge in UI)
  machineSourcedFields?: string[];
}
