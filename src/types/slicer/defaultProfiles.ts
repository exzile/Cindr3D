import type { MaterialProfile, PrintProfile, PrinterProfile } from './profiles';

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
    // Matches OrcaSlicer 'Generic PETG' filament profile
    // (resources/profiles/OrcaFilamentLibrary/filament/Generic PETG.json).
    // PETG-specific deltas vs PLA defaults: hotter nozzle, cooler bed
    // (PETG warps less than ABS but doesn't need PLA's 60-65°C),
    // restricted fan ceiling (max 50% — full fan delaminates PETG
    // layers), longer Z-hop and slower retraction to fight PETG's
    // characteristic stringing, and a 0.95 flow-ratio that compensates
    // for PETG's slight over-extrusion at standard E-steps.
    id: 'petg-generic',
    name: 'PETG Generic',
    type: 'PETG',
    color: '#81c784',
    nozzleTemp: 240,                    // OrcaSlicer: nozzle_temperature = 240
    nozzleTempFirstLayer: 240,          // nozzle_temperature_initial_layer = 240
    bedTemp: 70,                        // hot_plate_temp = 70
    bedTempFirstLayer: 70,              // hot_plate_temp_initial_layer = 70
    chamberTemp: 0,
    fanSpeedMin: 0,                     // fan_min_speed = 0 (PETG runs cooler)
    fanSpeedMax: 50,                    // fan_max_speed = 50 — DON'T max cooling
    fanDisableFirstLayers: 1,           // close_fan_the_first_x_layers = 1
    retractionDistance: 1.5,            // filament_retraction_length = 1.5
    retractionSpeed: 30,                // filament_retraction_speed = 30
    retractionZHop: 0.4,                // filament_z_hop = 0.4 (auto-lift)
    flowRate: 0.95,                     // filament_flow_ratio = 0.95
    density: 1.27,                      // filament_density = 1.27
    costPerKg: 30,                      // filament_cost = 30
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
];

export const DEFAULT_PRINT_PROFILES: PrintProfile[] = [
  {
    // Matches OrcaSlicer 'Generic PETG' + '0.20mm Standard @ 0.4 nozzle'
    // process defaults. Where OrcaSlicer uses a thickness-based field
    // (top_shell_thickness 1.0 mm, bottom_shell_thickness 0.6 mm) we
    // translate to layer counts at 0.20 mm: 1.0/0.2=5 top, 0.6/0.2=3
    // bottom. Speeds reflect the PETG ceiling — PETG strings at the
    // PLA-grade 100-150 mm/s sparse infill rates, so the OrcaSlicer
    // PETG profile lowers them.
    id: 'standard-quality',
    name: 'Standard Quality (0.2mm)',
    layerHeight: 0.2,
    firstLayerHeight: 0.2,         // initial_layer_print_height = 0.2 (Orca)
    wallCount: 3,                  // wall_loops = 3 (Orca PETG default)
    wallSpeed: 60,                 // inner_wall_speed = 60 (PETG ceiling)
    outerWallSpeed: 30,            // outer_wall_speed = 30
    wallLineWidth: 0.45,           // line_width = 0.45 (PETG nominal)
    topLayers: 5,                  // top_shell_thickness 1.0 / 0.2 = 5
    bottomLayers: 3,               // bottom_shell_thickness 0.6 / 0.2 = 3
    topBottomPattern: 'lines',     // top_surface_pattern = 'monotonic'
    // monotonicTopBottomOrder set below — Orca defaults monotonic ON.
    topSpeed: 30,                  // top_surface_speed = 30
    infillDensity: 15,             // sparse_infill_density = 15 (Orca std)
    infillPattern: 'grid',         // sparse_infill_pattern = 'grid'
    infillSpeed: 80,               // sparse_infill_speed = 80 (PETG)
    infillLineWidth: 0.45,         // matches wall to keep flow uniform
    infillOverlap: 15,             // infill_wall_overlap = 15 (Orca std)
    printSpeed: 80,                // default print speed (PETG ceiling)
    travelSpeed: 150,              // travel_speed = 150 (PETG conservative)
    firstLayerSpeed: 30,           // initial_layer_speed = 30
    supportEnabled: false,
    supportType: 'normal',         // support_type = 'normal(auto)'
    supportAngle: 30,              // support_threshold_angle = 30 (Orca)
    supportDensity: 15,            // support_infill_density = 15
    supportPattern: 'zigzag',
    supportZDistance: 0.2,         // support_top_z_distance = 0.2
    supportXYDistance: 0.4,        // support_object_xy_distance = 0.4
    supportInterface: false,
    supportInterfaceLayers: 5,
    adhesionType: 'skirt',         // brim_type = 'no_brim' (Orca PETG default)
    skirtLines: 1,                 // skirt_loops = 1
    skirtDistance: 2,              // skirt_distance = 2
    brimWidth: 5,                  // brim_width = 5 (when used)
    raftLayers: 0,
    enableBridgeFan: true,
    bridgeFanSpeed: 100,           // bridge_fan_speed = 100
    minLayerTime: 6,               // slow_down_layer_time = 6 (Orca)
    lineWidth: 0.45,               // line_width = 0.45
    outerWallLineWidth: 0.45,      // outer_wall_line_width = 0.45
    topBottomLineWidth: 0.45,      // top_surface_line_width = 0.45
    initialLayerLineWidthFactor: 100,
    outerWallFirst: false,         // wall_sequence = inner-outer (Orca std)
    alternateExtraWall: false,
    infillWallCount: 0,
    gradualInfillSteps: 0,
    supportSpeed: 50,              // support_speed = 50 (Orca PETG)
    smallAreaSpeed: 30,            // small_perimeter_speed = 30
    retractionMinTravel: 1.5,
    minPrintSpeed: 20,             // slow_down_min_speed = 20 (Orca)
    fanFullLayer: 1,               // close_fan_the_first_x_layers = 1
    liftHeadEnabled: false,
    supportTreeAngle: 60,          // support_tree_angle = 60
    supportTreeBranchDiameter: 5,  // support_tree_branch_diameter = 5
    brimGap: 0.1,                  // brim_object_gap = 0.1 (Orca PETG)
    brimLocation: 'outside',
    raftMargin: 15,
    zSeamAlignment: 'aligned',     // z_seam_position = 'aligned' (Orca default)
    combingMode: 'all',            // reduce_infill_retraction = true (≈combing-all)
    avoidCrossingPerimeters: true, // travel_avoid_other_parts = true
    avoidPrintedParts: true,
    thinWallDetection: true,       // detect_thin_wall = true
    wallGenerator: 'arachne',      // OrcaSlicer ships Arachne by default
    arachneBackend: 'wasm',
    minWallLengthFactor: 0.5,      // Orca-style tiny open wall filter
    preciseOuterWall: false,       // precise_outer_wall = false
    ironingEnabled: false,         // ironing_enabled = false
    ironingSpeed: 15,
    ironingFlow: 10.0,             // ironing_flow = 10
    ironingSpacing: 0.1,           // ironing_line_spacing = 0.1
    spiralizeContour: false,       // magic_spiralize = false
    printSequence: 'all_at_once',  // print_sequence = 'all_at_once'
    draftShieldEnabled: false,     // draft_shield_enabled = false
    draftShieldDistance: 10,       // draft_shield_dist = 10
    coastingEnabled: false,        // coasting_enable = false
    coastingVolume: 0.064,         // coasting_volume = 0.064
    adaptiveLayersEnabled: false,  // adaptive_layer_height_enabled = false
    adaptiveLayersMaxVariation: 0.1,   // adaptive_layer_height_variation = 0.1
    adaptiveLayersVariationStep: 0.01, // adaptive_layer_height_variation_step = 0.01
    wallTransitionLength: 0.4,     // wall_transition_length = 0.4
    wallTransitionAngle: 10,       // wall_transition_angle = 10
    minWallLineWidth: 0.3,         // min_wall_line_width = 0.3
    outerWallWipeDistance: 0.0,
    zSeamX: null,
    zSeamY: null,
    zSeamUserSpecifiedRadius: 0,
    zSeamContinuityDistance: 2,
    roofingLayers: 0,              // roofing_layer_count = 0
    roofingPattern: 'lines',       // roofing_pattern = 'lines'
    skinOverlapPercent: 23,         // infill_wall_overlap = 23% (Orca std)
    monotonicTopBottomOrder: true,  // top_surface_pattern = 'monotonic'
    bridgeSkinSpeed: 25,            // bridge_speed = 25 (Orca PETG)
    bridgeSkinFlow: 100,            // bridge_flow = 1.0
    bridgeAngle: 0,
    bridgeWallSpeed: 25,            // bridge_speed = 25
    skinEdgeSupportLayers: 0,
    infillBeforeWalls: false,       // infill_before_walls = false (Orca std)
    multiplyInfill: 1,
    randomInfillStart: false,      // random_infill_start = false
    lightningInfillSupportAngle: 40, // lightning_infill_support_angle = 40
    accelerationEnabled: true,     // OrcaSlicer ships per-feature accel ON
    jerkEnabled: false,            // jerk_enabled = false (Marlin-only)
    accelerationPrint: 6000,       // default_acceleration = 6000 (Orca std)
    accelerationTravel: 10000,     // travel_acceleration = 10000
    accelerationWall: 1500,        // inner_wall_acceleration ≈ default/4
    accelerationInfill: 6000,      // sparse_infill_acceleration = default
    accelerationTopBottom: 500,    // top_surface_acceleration = 500
    accelerationSupport: 6000,
    jerkPrint: 20,
    jerkTravel: 30,
    jerkWall: 20,
    jerkInfill: 20,
    jerkTopBottom: 20,
    skirtBrimSpeed: 30,            // skirt_speed = 30
    retractAtLayerChange: false,   // retract_at_layer_change = false
    maxRetractionCount: 90,        // retraction_count_max = 90
    retractionExtraPrimeAmount: 0,
    combingAvoidsSupports: false,
    travelRetractBeforeOuterWall: false, // travel_retract_before_outer_wall = false
    coolingFanEnabled: true,       // cool_fan_enabled = true
    regularFanSpeedLayer: 2,       // cool_fan_full_layer = 2
    fanKickstartTime: 100,
    supportBuildplateOnly: false,  // support_type = 'everywhere'
    supportRoofEnable: false,      // support_roof_enable = false
    supportFloorEnable: false,     // support_bottom_enable = false
    supportBottomDistance: 0.1,    // support_bottom_distance = 0.1
    supportWallCount: 1,           // support_wall_count = 1
    supportInterfacePattern: 'concentric', // support_interface_pattern = 'concentric'
    supportInterfaceDensity: 100,  // support_interface_density = 100
    supportInfillDensityMultiplierInitialLayer: 100,
    skirtHeight: 3,                // skirt_height = 3
    brimReplacesSupportEnabled: true, // brim_replaces_support = true
    raftBaseThickness: 0.3,        // raft_base_thickness = 0.3
    raftBaseLineWidth: 0.8,        // raft_base_line_width = 0.8
    raftBaseSpeed: 15,             // raft_base_speed = 15
    raftInterfaceThickness: 0.15,  // raft_interface_thickness = 0.15
    raftInterfaceLineWidth: 0.7,   // raft_interface_line_width = 0.7
    raftInterfaceSpeed: 15,        // raft_interface_speed = 15
    raftSurfaceThickness: 0.1,     // raft_surface_thickness = 0.1
    raftSurfaceLineWidth: 0.4,     // raft_surface_line_width = 0.4
    raftSurfaceSpeed: 20,          // raft_surface_speed = 20
    raftAirGap: 0.3,               // raft_airgap = 0.3
    unionOverlappingVolumes: true, // union_overlapping_volumes = true
    removeAllHoles: false,
    extensiveStitching: false,     // meshfix_extensive_stitching = false
    keepDisconnectedFaces: false,  // meshfix_keep_open_polygons = false
    maxResolution: 0.5,            // meshfix_maximum_resolution = 0.5
    maxDeviation: 0.025,           // meshfix_maximum_deviation = 0.025
    maxTravelResolution: 1.0,      // meshfix_maximum_travel_resolution = 1.0
    surfaceMode: 'normal',         // magic_mesh_surface_mode = 'normal'
    moldEnabled: false,            // mold_enabled = false
    moldAngle: 40,                 // mold_angle = 40
    moldRoofHeight: 0.5,           // mold_roof_height = 0.5
    fuzzySkinsEnabled: false,      // magic_fuzzy_skin_enabled = false
    fuzzySkinThickness: 0.3,       // magic_fuzzy_skin_thickness = 0.3
    fuzzySkinPointDist: 0.8,       // magic_fuzzy_skin_point_dist = 0.8
    makeOverhangPrintable: false,  // make_overhang_printable = false
    makeOverhangPrintableMaxAngle: 50, // make_overhang_printable_angle = 50
    slicingTolerance: 'middle',    // slicing_tolerance = 'middle'
    flowRateCompensationMaxExtrusion: 0.0, // flow_rate_max_extrusion_offset = 0
    smallHoleMaxSize: 0.0,         // small_hole_max_size = 0
    minimumPolygonCircumference: 1.0, // minimum_polygon_circumference = 1.0
    slicingClosingRadius: 0,
    extruderIndex: 0,
    postProcessingScripts: [],
    nonPlanarSlicingEnabled: false,
  },
];
