// Help content for slicer settings
// Each setting can have: brief (hover tooltip), detailed (modal description), and imageUrl (optional)

import type { SettingHelp } from '../types/settings-help.types';
export type { SettingHelp } from '../types/settings-help.types';

export const SETTINGS_HELP: Record<string, SettingHelp> = {
  // Layer Height
  layerHeight: {
    brief: 'Vertical distance between layers',
    detailed:
      'Layer height controls the thickness of each printed layer. Smaller values (0.1mm) produce finer details and better surface quality but take longer to print. Larger values (0.3mm) print faster but with less detail. Typical range is 0.1-0.3mm depending on your nozzle diameter.',
    whenToChange: [
      'Use a smaller value for visible curves, miniature details, or mating faces.',
      'Use a larger value for drafts, fixtures, and parts where print time matters more than finish.',
    ],
    commonValues: ['0.12mm fine detail', '0.20mm general PLA/PETG', '0.28mm fast draft with a 0.4mm nozzle'],
    relatedSettings: ['First Layer Height', 'Line Width', 'Adaptive Layers'],
    references: ['Layer Height setting guide'],
    imageUrl: 'https://example.com/images/layer-height.png',
  },

  // Wall Count
  wallCount: {
    brief: 'Number of perimeter loops',
    detailed:
      'Wall count determines how many outer perimeter lines surround your print. More walls (3-4) create stronger, more durable prints with better surface finish. Fewer walls (1-2) print faster but are less durable. Each additional wall adds significant strength.',
    imageUrl: 'https://example.com/images/wall-count.png',
  },

  // Infill Density
  infillDensity: {
    brief: 'Percentage of internal material fill',
    detailed:
      'Infill density controls how much of the interior is filled. 0% creates a hollow shell (light, fast), 20% is typical for general prints, 50% for stronger parts, and 100% for solid prints. Higher density = stronger but uses more material and takes longer.',
    whenToChange: [
      'Increase when parts crush, flex too much, or need screw retention.',
      'Decrease for display models, prototypes, and large parts where shells carry the load.',
    ],
    commonValues: ['0-8% display models', '15-25% general parts', '35-60% brackets and fixtures'],
    relatedSettings: ['Infill Pattern', 'Wall Count', 'Top Layers', 'Bottom Layers'],
    references: ['Infill Density setting guide'],
    imageUrl: 'https://example.com/images/infill-density.png',
  },

  // Print Speed
  printSpeed: {
    brief: 'Default movement speed during printing',
    detailed:
      'Print speed is the travel velocity while extruding. Faster speeds (60+ mm/s) reduce print time but may reduce quality and cause layer shifting on complex prints. Slower speeds (30-40 mm/s) improve quality. The optimal speed depends on your printer\'s capabilities and the material.',
    whenToChange: [
      'Lower speed when corners ring, walls under-extrude, or details look melted.',
      'Raise speed after temperature, flow, acceleration, and cooling are stable.',
    ],
    commonValues: ['35-45mm/s detail', '50-70mm/s general bedslinger', '120mm/s+ tuned CoreXY'],
    relatedSettings: ['Outer Wall Speed', 'Travel Speed', 'Acceleration', 'Minimum Layer Time'],
    references: ['Print Speed setting guide'],
    imageUrl: 'https://example.com/images/print-speed.png',
  },

  // Nozzle Temperature
  nozzleTemp: {
    brief: 'Hotend temperature in degrees Celsius',
    detailed:
      'Nozzle temperature affects filament flow and print quality. Too low: filament won\'t flow smoothly, leading to under-extrusion and weak prints. Too high: filament degrades, creates stringing, and may cause heat creep. Optimal temperature varies by material (PLA: 200-210°C, PETG: 230-250°C, ABS: 240-260°C).',
    imageUrl: 'https://example.com/images/nozzle-temp.png',
  },

  // Travel Speed
  travelSpeed: {
    brief: 'Speed during moves without extrusion',
    detailed:
      'Travel speed is how fast the nozzle moves between print areas without depositing material. Faster travel speeds (150-200 mm/s) reduce print time by skipping empty space quickly. Should be faster than print speed to save time without affecting print quality.',
    imageUrl: 'https://example.com/images/travel-speed.png',
  },

  // Retraction Distance
  retractionDistance: {
    brief: 'Filament pulled back to prevent stringing',
    detailed:
      'Retraction pulls the filament back when the nozzle moves between unconnected areas, preventing ooze and stringing artifacts. 0.8-1.0mm is typical for direct drive, 4-6mm for Bowden tubes. Too much retraction causes under-extrusion; too little causes stringing.',
    whenToChange: [
      'Increase slightly when travel moves leave wisps or blobs between islands.',
      'Decrease when prints show gaps after travel, heat creep, or filament grinding.',
    ],
    commonValues: ['0.4-1.2mm direct drive', '3-6mm Bowden', '0mm for flexible materials only when needed'],
    relatedSettings: ['Retraction Speed', 'Z-Hop When Retracted', 'Combing Mode', 'Travel Avoid Distance'],
    references: ['Retraction Distance setting guide'],
    imageUrl: 'https://example.com/images/retraction-distance.png',
  },

  // Support Angle
  supportAngle: {
    brief: 'Minimum overhang angle requiring support',
    detailed:
      'Support angle determines when the slicer generates support structures. 45° is the steepest angle that typically prints unsupported. Lower angles (35-40°) generate more support (safer but uses more material). Higher angles (50-60°) use less support but risk failed prints on steep overhangs.',
    whenToChange: [
      'Lower the angle for soft materials, poor cooling, or cosmetic underside requirements.',
      'Raise the angle for tuned printers, chamfered designs, or support removal issues.',
    ],
    commonValues: ['35-40 deg conservative', '45 deg general', '55-60 deg tuned PLA with good cooling'],
    relatedSettings: ['Support Type', 'Support Z Distance', 'Support Interface', 'Minimum Support Area'],
    references: ['Support Angle setting guide'],
    imageUrl: 'https://example.com/images/support-angle.png',
  },

  // Support Density
  supportDensity: {
    brief: 'Percentage of support structure fill',
    detailed:
      'Support density controls how much the support structure is filled. 15-20% is typical and provides good strength-to-material ratio. Lower density (10%) uses less material but may collapse. Higher density (25-30%) is stronger but harder to remove.',
    imageUrl: 'https://example.com/images/support-density.png',
  },

  // Travel Acceleration
  travelAccelerationEnabled: {
    brief: 'Control acceleration on non-printing moves',
    detailed:
      'Travel acceleration lets you set different acceleration limits for moves without extrusion. This is mainly supported on Marlin-based printers. Enabling this can reduce vibration and improve surface quality by allowing different acceleration profiles for travel vs. printing moves.',
    imageUrl: 'https://example.com/images/travel-accel.png',
  },

  // Travel Jerk
  travelJerkEnabled: {
    brief: 'Control jerk (direction change rate) on travel',
    detailed:
      'Travel jerk controls how quickly the printer changes direction during non-printing moves. Lower jerk values reduce vibration but slow down movement. This setting is mainly supported on Marlin-based printers and allows fine-tuning movement smoothness.',
    imageUrl: 'https://example.com/images/travel-jerk.png',
  },

  // Coasting
  coastingEnabled: {
    brief: 'Stop extrusion before end of move to reduce ooze',
    detailed:
      'Coasting stops filament extrusion a short distance before the end of a wall or infill line, letting momentum carry the nozzle to the endpoint. This reduces pressure in the nozzle and prevents oozing at line endpoints. Only supported on Marlin and Klipper.',
    imageUrl: 'https://example.com/images/coasting.png',
  },

  // Linear Advance
  linearAdvanceEnabled: {
    brief: 'Pressure advance compensation for better quality',
    detailed:
      'Linear advance (M900 on Marlin, pressure_advance on Klipper) compensates for filament pressure buildup by adjusting extrusion during acceleration/deceleration. This reduces bulges at corners and improves print quality significantly. Only supported on Marlin and Klipper firmware.',
    imageUrl: 'https://example.com/images/linear-advance.png',
  },

  // Ironing
  ironingEnabled: {
    brief: 'Smooth top surface by re-tracing with hot nozzle',
    detailed:
      'Ironing traces over the top surface of the print with the nozzle at reduced flow, smoothing the surface as if with a hot iron. Creates a glossy, smooth finish on top surfaces. Slightly increases print time but dramatically improves surface appearance.',
    imageUrl: 'https://example.com/images/ironing.png',
  },

  // Adaptive Layers
  adaptiveLayersEnabled: {
    brief: 'Automatically vary layer height to match model',
    detailed:
      'Adaptive layer heights automatically adjust layer thickness in different parts of the model based on geometry. Steep slopes use thinner layers for detail, while flat areas use thicker layers for speed. Results in better quality and faster prints than fixed layer heights.',
    imageUrl: 'https://example.com/images/adaptive-layers.png',
  },

  // Z-Seam Alignment
  zSeamAlignment: {
    brief: 'Where to place the start/end point of each layer',
    detailed:
      'Z-seam controls where the layer start/end point is positioned: "Sharpest Corner" hides it in corners (best), "Aligned" places it consistently (useful for small objects), "Random" varies position (reduces visible lines), "Shortest" minimizes travel distance.',
    imageUrl: 'https://example.com/images/z-seam.png',
  },

  // Bridge Fan Speed
  bridgeFanSpeed: {
    brief: 'Fan speed boost when printing bridges',
    detailed:
      'Bridge fan speed is extra cooling applied when printing unsupported sections (bridges). Higher fan speed (100%) cools plastic quickly so it bridges without drooping. Lower values may cause sagging under the bridge. Bridges benefit from maximum cooling.',
    imageUrl: 'https://example.com/images/bridge-fan.png',
  },

  // Min Layer Time
  minLayerTime: {
    brief: 'Minimum time per layer before moving to next',
    detailed:
      'Minimum layer time prevents thin layers from printing too fast, which can cause poor quality or melting. If a layer would finish sooner than this time, the print head slows down. Typical value is 10-20 seconds. Very fast layers benefit from this slowdown.',
    imageUrl: 'https://example.com/images/min-layer-time.png',
  },

  // Adhesion Type
  adhesionType: {
    brief: 'Method for sticking first layer to bed',
    detailed:
      'Adhesion type determines how the model bonds to the build plate: "None" for textured beds, "Skirt" (outline loop) for bed leveling check, "Brim" (border) for better adhesion, "Raft" (sacrificial base) for difficult materials. Raft and brim add material but improve success rate.',
    whenToChange: [
      'Use brim for tall, narrow, sharp-cornered, or warp-prone parts.',
      'Use raft when bed condition or material shrinkage makes normal first layers unreliable.',
    ],
    commonValues: ['None for well-tuned textured plates', 'Skirt for nozzle priming', '5-12mm brim for ABS/PETG edges'],
    relatedSettings: ['Brim Width', 'Skirt Lines', 'First Layer Height', 'Bed Temperature'],
    references: ['Adhesion Type setting guide'],
    imageUrl: 'https://example.com/images/adhesion-types.png',
  },

  // Combing Mode
  combingMode: {
    brief: 'Travel path strategy to reduce stringing',
    detailed:
      'Combing controls whether the nozzle retracts during travel: "Off" retracts every move (safest), "Infill Only" combs through infill without retracting, "No Skin" avoids top/bottom surfaces, "All" combs everywhere. Less retraction is faster but risks stringing. Choose based on material stringiness.',
    imageUrl: 'https://example.com/images/combing-mode.png',
  },

  // Retraction Z-Hop
  retractionZHop: {
    brief: 'Lift nozzle up during retraction to avoid drags',
    detailed:
      'Z-hop lifts the nozzle vertically by a small amount during retraction to avoid dragging across the print surface. 0.2mm is typical. Prevents surface marks and scars caused by the nozzle dragging on walls. Higher values (0.4mm+) may cause stringing if not retracted enough.',
    imageUrl: 'https://example.com/images/z-hop.png',
  },

  // Draft Shield
  draftShieldEnabled: {
    brief: 'Single-wall enclosure around print',
    detailed:
      'Draft shield creates a thin wall around your print to reduce air currents, improving print quality for temperature-sensitive materials like ABS and nylon. It takes no material (very thin wall) but helps retain heat and reduce warping. Not supported on all firmware.',
    imageUrl: 'https://example.com/images/draft-shield.png',
  },

  // First Layer Height
  firstLayerHeight: {
    brief: 'Thickness of the first printed layer',
    detailed:
      'First layer height is often slightly larger (0.2-0.3mm) to accommodate bed leveling tolerances and improve adhesion. A thicker first layer is more forgiving of bed leveling issues and helps the print stick to the bed. Usually set 0.5-1.5x the normal layer height.',
  },

  // Infill Pattern
  infillPattern: {
    brief: 'Structure pattern for internal fill',
    detailed:
      'Different patterns offer different benefits: Grid (2D crosshatch, good for speed), Gyroid (TPMS, isotropic strength all directions), Cubic (3D grid, lightweight), Honeycomb (exceptional strength, 20-40% density), Lines (simple, fast), Triangles (diagonal bracing), Lightning (optimal branching). Gyroid and Cubic are strongest for weight.',
  },

  // Support Type (Tree vs Normal)
  supportType: {
    brief: 'Structure type: Normal columns or Tree branches',
    detailed:
      'Normal supports use vertical columns (stable, more material). Tree/Organic supports branch like a tree (minimal material, faster print, cleaner removal, 30-50% material savings). Tree is better for complex overhangs; Normal for larger contact areas. Tree may struggle with extreme overhangs.',
  },

  // Fuzzy Skins
  fuzzySkinsEnabled: {
    brief: 'Randomly roughen outer surface for textured finish',
    detailed:
      'Adds random noise to the outer surface path, creating a textured, fuzzy appearance. Great for models that need friction or aesthetic roughness. Thickness controls how rough, point distance controls pattern resolution.',
  },

  // Draft Shield
  draftShield: {
    brief: 'Single-wall enclosure to reduce air currents',
    detailed:
      'Creates a thin wall around the print to shield from air currents. Helps temperature-sensitive materials (ABS, nylon) by retaining heat and reducing warping. Minimal material cost (thin wall only). Not supported on all firmware.',
  },

  // Support Interface
  supportInterface: {
    brief: 'Interface layer between support and model',
    detailed:
      'Creates a layer of denser support material where it contacts the model, improving support adhesion and making removal easier. Interface is printed with higher density (often 100%) for better contact, while bulk support can be sparser. Reduces surface defects.',
  },

  // First Layer Speed
  firstLayerSpeed: {
    brief: 'Reduced printing speed for first layer',
    detailed:
      'First layer prints slower (20-30 mm/s typical) to improve adhesion and reduce warping. Slower first layer = better bed adhesion = higher success rate. Usually set to 50-75% of normal print speed.',
  },

  // Line Width
  lineWidth: {
    brief: 'Default extrusion line width',
    detailed:
      'Width of extruded lines. Typically 0.4mm (matching 0.4mm nozzle). Narrower lines = more detail but slower. Wider lines = faster but less detail. Most important for walls; infill is more forgiving.',
  },

  // Top/Bottom Layers
  topLayers: {
    brief: 'Number of solid layers at the top',
    detailed:
      'Controls top surface solidity. 4+ layers create a fully solid top. More layers = stronger top and better appearance but slower and more material. At least 4 layers recommended for durability.',
  },

  bottomLayers: {
    brief: 'Number of solid layers at the bottom',
    detailed:
      'Controls bottom surface solidity and bed adhesion. 4-5 layers typical. More layers improve strength on bottom and bed adhesion but use more material. At least 4 layers recommended.',
  },

  // Small Hole Max Size
  smallHoleMaxSize: {
    brief: 'Maximum hole size to fill with support/infill',
    detailed:
      'Holes smaller than this size are filled rather than printed as holes. Prevents the printer from trying to print tiny holes that would be unreliable. Set to 0 to disable, or 2-3mm for typical prints.',
  },

  // Slicing Tolerance
  slicingTolerance: {
    brief: 'How the slicer rounds dimensions',
    detailed:
      '"Middle" balances accuracy, "Inclusive" makes features thicker/larger (safer), "Exclusive" makes features thinner/smaller (tighter fit). Use "Inclusive" for press-fits and moving parts, "Exclusive" for tight tolerances.',
  },

  // Top/Bottom Pattern
  topBottomPattern: {
    brief: 'Line pattern for top and bottom surfaces',
    detailed:
      '"Lines" provides good strength with visible lines, "Concentric" creates circular patterns (strongest, aesthetic), "Zigzag" is diagonal (good balance). Concentric is strongest but cosmetic preference varies.',
  },

  // ── Quality / Line Widths ───────────────────────────────────────────────────
  outerWallLineWidth: { brief: 'Width of outer perimeter extrusion lines', detailed: 'Controls the extrusion width for the outer wall only. Matching your nozzle diameter gives best surface quality. Slightly narrower lines improve detail; wider lines are faster and more robust.' },
  topBottomLineWidth: { brief: 'Width of top/bottom surface lines', detailed: 'Extrusion width for top and bottom solid surface lines. Narrower lines improve flat surface detail. Usually matches nozzle diameter.' },
  skirtBrimLineWidth: { brief: 'Width of skirt or brim lines', detailed: 'Extrusion width for the skirt or brim. Slightly wider (0.5–0.6mm with a 0.4mm nozzle) can improve first-layer adhesion for brims. Doesn\'t affect model quality.' },
  supportLineWidth: { brief: 'Width of support structure lines', detailed: 'Extrusion width for support material. Wider lines print faster and are stronger, but leave larger marks on the model surface. 0.4–0.6mm typical.' },
  supportInterfaceLineWidth: { brief: 'Width of support interface layer lines', detailed: 'Extrusion width for the interface layer between support and model. Narrower lines (matching nozzle size) give a cleaner detachment surface and better model finish.' },
  initialLayerLineWidthFactor: { brief: 'First-layer line width scale factor (100–120%)', detailed: 'Widens first-layer lines to improve bed adhesion. 100% = normal, 120% = 20% wider. A wider first layer increases contact area with the bed, helping the print stick.' },
  adaptiveLayersMaxVariation: { brief: 'Maximum layer height change allowed', detailed: 'Limits how much adaptive layers can vary from the base layer height. 0.1mm means layers can change ±0.1mm. Larger values allow more variation for faster prints; smaller gives smoother quality transitions.' },
  adaptiveLayersVariationStep: { brief: 'How fast layer height changes between regions', detailed: 'How much the layer height can change between neighboring regions. Smaller values create smoother gradients. 0.05mm gives gradual transitions across curved surfaces.' },

  // ── Walls ───────────────────────────────────────────────────────────────────
  outerWallFirst: { brief: 'Print outer wall before inner walls', detailed: 'When enabled, the outer wall is printed first, then inner walls fill in. This improves dimensional accuracy of the outer surface. May show more seam marks at the start point.' },
  alternateExtraWall: { brief: 'Add an extra wall on alternating layers', detailed: 'Adds an additional inner wall on every other layer, interlocking them like bricks. Increases bonding strength between layers at the cost of slightly more material.' },
  thinWallDetection: { brief: 'Detect and handle very thin wall areas', detailed: 'Identifies areas too thin for normal wall extrusion and adjusts them. Prevents two opposing walls from overlapping. Improves quality for thin features like small ribs.' },
  outerWallInset: { brief: 'Inset outer wall slightly to reduce ooze effect', detailed: 'Moves the outer wall inward by a small amount to compensate for nozzle ooze that would make the outer surface slightly oversize. Usually not needed on well-calibrated printers.' },
  minWallLineWidth: { brief: 'Minimum width for wall lines to be printed', detailed: 'Wall lines narrower than this value are omitted. Prevents extremely thin lines the printer cannot reliably extrude. Lower values print more thin features; higher values are more reliable.' },
  minEvenWallLineWidth: { brief: 'Minimum width for even-count wall fill lines', detailed: 'When distributing wall widths on even wall counts, lines narrower than this are dropped. Works alongside min wall line width to clean up narrow wall regions.' },
  wallDistributionCount: { brief: 'Number of walls affected by width redistribution', detailed: 'When walls can\'t all fit perfectly, width redistribution spreads excess across this many walls. Higher values balance the adjustment across more walls.' },
  wallTransitionLength: { brief: 'Distance over which wall count transitions', detailed: 'When the model narrows and wall count decreases, this is the length of the transition zone. Longer transitions are smoother but add extra moves in narrow areas.' },
  wallTransitionFilterDistance: { brief: 'Distance to filter out short wall transitions', detailed: 'Wall transitions shorter than this distance are removed to avoid printing tiny extra segments. Keeps paths clean in areas with rapid geometry changes.' },
  wallTransitionFilterMargin: { brief: 'Margin for filtering wall width transitions', detailed: 'Extra margin added when deciding whether to filter a wall transition. Slightly larger values remove more minor transitions for cleaner paths.' },
  outerWallWipeDistance: { brief: 'Extra wipe distance after outer wall', detailed: 'After finishing the outer wall, the nozzle continues a short distance to wipe away any ooze. Helps reduce seam artifacts. 0.1–0.2mm typical.' },
  holeHorizontalExpansionMaxDiameter: { brief: 'Maximum hole diameter affected by expansion', detailed: 'Limits hole expansion compensation to holes smaller than this diameter. Larger holes are usually accurate enough and don\'t need compensation.' },
  slicingClosingRadius: { brief: 'Seal tiny contour gaps before toolpath generation', detailed: 'Inflates contours by a tiny radius, merges close edges, then shrinks them back before slicing. Useful for imperfect STL exports with hairline gaps or nearly-touching walls. Keep it small so clean geometry is not rounded off unnecessarily.' },
  printThinWalls: { brief: 'Print features that are thinner than one extrusion', detailed: 'Enables printing of features too thin for a full extrusion width by using reduced-width lines. Allows very fine details to be printed that would otherwise be omitted.' },
  minFeatureSize: { brief: 'Minimum feature size to attempt printing', detailed: 'Features smaller than this are skipped entirely. Set slightly above your nozzle diameter for reliable results. Larger values skip more tiny features.' },
  minThinWallLineWidth: { brief: 'Minimum line width when printing thin walls', detailed: 'The narrowest line width allowed when the thin-wall feature is active. Must be achievable by the printer — typically 50% of nozzle diameter minimum.' },
  wallLineCount: { brief: 'Total number of wall perimeter lines', detailed: 'Alias for wall count — sets the total number of perimeter loops. Each additional wall adds significant lateral strength. 2–3 walls for most prints; 4+ for structural parts.' },
  innerWallLineWidth: { brief: 'Width of inner wall extrusion lines', detailed: 'Controls the extrusion width for inner (non-outer) walls. Can be slightly wider than the outer wall for faster printing. Usually matches nozzle diameter.' },
  groupOuterWalls: { brief: 'Print outer and inner walls together as a group', detailed: 'Groups outer and inner walls in the path planning so they print consecutively rather than interleaved with other features. Can reduce layer time and improve bonding.' },
  alternateWallDirections: { brief: 'Alternate wall printing direction each layer', detailed: 'Reverses the direction walls are printed on alternating layers. Can strengthen the print by distributing any directional weaknesses.' },
  optimizeWallOrder: { brief: 'Optimize the order walls are printed', detailed: 'Reorders wall printing to minimize travel moves between walls. Reduces stringing and improves surface quality on models with multiple separate wall regions.' },
  minOddWallLineWidth: { brief: 'Minimum width for odd-count wall fill lines', detailed: 'For odd-number wall counts, lines below this width are dropped. Works like min wall line width but specifically for the odd-count case.' },
  overhangingWallAngle: { brief: 'Angle at which walls are treated as overhanging', detailed: 'Walls steeper than this angle are printed at reduced speed for better cooling and layer bonding. Lower values = more walls slowed, higher values = only the steepest overhangs.' },
  overhangingWallSpeed: { brief: 'Speed multiplier for overhanging walls', detailed: 'Walls identified as overhanging print at this percentage of normal speed. Slowing steep overhangs gives more cooling time and prevents drooping.' },
  zSeamRelative: { brief: 'Use model-relative coordinates for Z seam', detailed: 'When enabled, the Z seam X/Y coordinates are relative to the model origin rather than the build plate. Useful for placing the seam at a specific point on the model.' },
  zSeamOnVertex: { brief: 'Snap Z seam to nearest polygon vertex', detailed: 'Forces the Z seam to land exactly on a polygon corner point. Can make the seam less visible by placing it at a natural corner rather than mid-edge.' },
  seamCornerPreference: { brief: 'How to handle the seam at polygon corners', detailed: '"None" ignores corners, "Hide Seam" tucks the seam inside corners, "Expose Seam" places it at outer corners, "Smart Hide" picks the best option automatically.' },

  // ── Top / Bottom ────────────────────────────────────────────────────────────
  initialBottomLayers: { brief: 'Extra solid layers at the very first bottom', detailed: 'Often set higher than bottomLayers to ensure extra solid layers on the build plate regardless of any adhesion variance. Useful for prints that need a very flat, solid base.' },
  topSurfaceSkinLayers: { brief: 'Extra quality layers at the very top surface', detailed: 'Adds additional skin layers printed with top-surface settings (usually slower) for better appearance. Even 1–2 extra layers significantly improve the visible top finish.' },
  bottomSurfaceSkinLayers: { brief: 'Extra quality layers at the very bottom surface', detailed: 'Like top surface skin layers but for the bottom. Adds extra quality layers at the floor for better finish on the bed-facing side.' },
  topSpeed: { brief: 'Speed for top and bottom surface lines', detailed: 'Printing visible surfaces slower (25–40 mm/s) improves quality. Slower speeds give better layer adhesion and smoother finish on the most visible parts of the print.' },
  ironingPattern: { brief: 'Path pattern used during the ironing pass', detailed: '"Lines" makes straight passes across the surface. "Concentric" follows the shape of the outline. "Zigzag" uses diagonal passes. Lines is most common; concentric follows complex shapes better.' },
  ironingInset: { brief: 'How far ironing insets from model edges', detailed: 'Keeps ironing moves away from model edges to prevent going over the edge and creating artifacts. 0.35mm is typical.' },
  ironingSpeed: { brief: 'Speed of the ironing movement', detailed: 'Ironing moves slowly to allow heat to smooth the surface. 15–30 mm/s typical. Faster speeds reduce the effect; slower improves surface quality but increases print time.' },
  ironingFlow: { brief: 'Material flow during ironing (very small value)', detailed: 'The amount of filament extruded during ironing. Very low values (10–20%) melt existing surface rather than adding new material. Higher values may cause ridges.' },
  ironingSpacing: { brief: 'Distance between ironing passes', detailed: 'Smaller spacing means more passes for a smoother result. 0.1mm gives thorough coverage; 0.3mm is faster but less thorough.' },
  topThickness: { brief: 'Total thickness of the solid top surface', detailed: 'Alternative to counting top layers — specifies thickness in mm directly. At 0.2mm layers, 0.8mm = 4 layers. Usually 4–6× the layer height for a complete solid top.' },
  bottomThickness: { brief: 'Total thickness of the solid bottom surface', detailed: 'Specifies bottom surface thickness in mm. 0.8mm is typical. More thickness improves strength and ensures a solid base.' },
  skinOverlapPercent: { brief: 'How much top/bottom skin overlaps with walls', detailed: 'Ensures top and bottom surfaces bond well to the walls. 10–20% overlap increases adhesion. Too high can cause bulges at wall junctions.' },
  topSkinExpandDistance: { brief: 'Extra distance top skin expands into walls', detailed: 'Expands the top skin outward to improve coverage near walls. Helps close gaps between the skin and walls on models with complex geometry.' },
  bottomSkinExpandDistance: { brief: 'Extra distance bottom skin expands into walls', detailed: 'Like top skin expand distance but for the bottom surface. Helps close gaps between the bottom skin and walls.' },
  extraSkinWallCount: { brief: 'Extra wall-like lines around skin areas', detailed: 'Adds extra wall lines around top/bottom skin areas to improve bonding between skin and walls. 1 extra line can significantly strengthen the skin-to-wall connection.' },

  // ── Infill ──────────────────────────────────────────────────────────────────
  randomInfillStart: { brief: 'Randomize where infill lines start each layer', detailed: 'Randomizes infill line start positions to distribute any artifacts. Reduces visible patterns in infill and slightly reduces stringing concentration.' },
  minInfillArea: { brief: 'Minimum area to fill with infill pattern', detailed: 'Areas smaller than this (mm²) use top/bottom skin instead of infill pattern. Prevents inefficient sparse infill in very small enclosed areas. Set to 0 to disable.' },
  gradualInfillSteps: { brief: 'Steps to gradually increase density near top', detailed: 'Creates intermediate density layers near the top surface instead of jumping from sparse infill to solid skin. More steps = smoother transition, slightly more material. 2–4 steps is typical.' },
  infillWallCount: { brief: 'Extra walls printed around infill areas', detailed: 'Adds additional wall-like lines around infill, strengthening the infill-to-wall bond. 1 extra wall noticeably improves the connection between infill and perimeter walls.' },
  infillOverlap: { brief: 'How far infill lines extend into walls (%)', detailed: 'Infill overlaps into the walls by this percentage. Ensures good bonding. Too little leaves gaps between infill and walls; too much causes bulging where they meet.' },
  infillLayerThickness: { brief: 'Override layer thickness for infill only', detailed: 'Allows infill to print at a thicker layer height than the walls. For example, walls at 0.2mm but infill at 0.4mm. Speeds up printing without affecting surface quality.' },
  connectInfillLines: { brief: 'Connect disconnected infill lines to reduce retractions', detailed: 'Joins short infill line segments so the nozzle doesn\'t need to retract between them. Fewer retractions = faster printing. May slightly affect infill appearance.' },

  // ── Speed ───────────────────────────────────────────────────────────────────
  outerWallSpeed: { brief: 'Speed for outer perimeter lines', detailed: 'The outer wall is the most visible part of the print. Printing it slower (25–35 mm/s) improves surface quality. This is the most important speed to reduce for better looks.' },
  wallSpeed: { brief: 'Speed for inner wall lines', detailed: 'Inner walls can print faster (40–60 mm/s) than outer walls since they\'re not visible. Faster inner walls save significant time without affecting surface quality.' },
  infillSpeed: { brief: 'Speed for infill lines', detailed: 'Infill can print at much higher speeds (60–100 mm/s) since appearance doesn\'t matter. Faster infill significantly reduces total print time.' },
  supportSpeed: { brief: 'Speed for support structures', detailed: 'Support can print faster (40–60 mm/s) since appearance isn\'t important. Faster support saves time but may be harder to remove from the model surface.' },
  bottomSpeed: { brief: 'Speed for bottom surface lines', detailed: 'Bottom surfaces face the bed so they\'re less critical visually, but printing them slower improves adhesion and surface quality. Usually matches top speed.' },
  numberOfSlowerLayers: { brief: 'Layers to gradually ramp up to full speed', detailed: 'Gradually increases speed from first layer speed to normal speed over this many layers. Prevents jarring transition from slow adhesion layers to full speed.' },
  initialLayerTravelSpeed: { brief: 'Travel speed during the first layer', detailed: 'Limits travel speed on the first layer to avoid disturbing the freshly laid material. Usually 50–80% of normal travel speed for better first-layer reliability.' },
  smallAreaSpeed: { brief: 'Speed for very small cross-section areas', detailed: 'Limits speed when printing very small cross-sections that would otherwise print so fast they can\'t cool. Prevents melting and deformation on small details.' },

  // ── Travel ──────────────────────────────────────────────────────────────────
  avoidCrossingPerimeters: { brief: 'Route travel paths through model interior', detailed: 'Instead of the shortest path (which may cross walls), the nozzle routes through the interior. Reduces stringing significantly but makes travel paths longer.' },
  retractionMinTravel: { brief: 'Minimum travel distance before retracting', detailed: 'Only retracts if the travel move is longer than this. Very short moves (under 1–2mm) don\'t benefit much from retraction. Fewer retractions = faster prints and less extruder wear.' },
  retractAtLayerChange: { brief: 'Retract when moving to the next layer', detailed: 'Performs a retraction at each layer change before moving to the next layer\'s start position. Reduces blobs at layer change positions.' },
  zHopWhenRetracted: { brief: 'Lift nozzle on retraction to avoid surface drag', detailed: 'After retracting, lifts the nozzle vertically before moving. Prevents dragging across the printed surface during travel, which can cause marks and scars.' },
  zHopHeight: { brief: 'How high to lift the nozzle when z-hopping', detailed: '0.2–0.4mm is typical. More height = safer but increases print time. Too high (>1mm) can increase stringing.' },
  zHopSpeed: { brief: 'Speed of the nozzle lift during z-hop', detailed: 'How quickly the nozzle lifts and descends during a z-hop. Slower speeds are more precise; faster speeds save time. Usually 10–20 mm/s.' },
  avoidPrintedParts: { brief: 'Route travel to avoid printed parts of the model', detailed: 'More aggressive version of avoiding perimeters — routes around already-printed solid areas. Reduces risk of knocking over tall, thin features during travel.' },
  avoidSupports: { brief: 'Route travel paths to avoid support structures', detailed: 'Routes travel around support structures to prevent knocking them over or dragging through them. Useful for tall, delicate tree supports.' },
  maxCombDistanceNoRetract: { brief: 'Maximum combing distance without retracting', detailed: 'The nozzle will comb (travel without retracting) up to this distance. For longer moves, a retraction is still performed even in combing mode. Balance between speed and stringing.' },
  travelAvoidDistance: { brief: 'Distance to keep away from walls when traveling', detailed: 'How far the travel path stays from walls when avoiding perimeters. 0.5–1mm typical. Larger values give more clearance but longer travel paths.' },
  insideTravelAvoidDistance: { brief: 'Clearance from walls for interior travel moves', detailed: 'Like travel avoid distance but specifically for travel moves inside the model. Can be smaller than the outside clearance since interior surfaces matter less.' },
  retractionExtraPrimeAmount: { brief: 'Extra material to prime after retraction', detailed: 'Extrudes a small extra amount after retracting to compensate for material lost to ooze. Too much causes blobs; too little causes under-extrusion after travel.' },
  wipeRetractionDistance: { brief: 'Wipe distance before retracting', detailed: 'Before retracting, the nozzle moves this distance to wipe excess material. Can help create a cleaner retraction point.' },

  // ── Cooling ─────────────────────────────────────────────────────────────────
  fanFullLayer: { brief: 'Layer number at which fan reaches full speed', detailed: 'Ramps up the fan gradually to avoid thermal shock on early layers. Layers 4–8 typical. Reaching full fan speed too soon can cause warping or delamination in ABS.' },
  minPrintSpeed: { brief: 'Minimum speed when slowing for min layer time', detailed: 'If the printer slows for min layer time, this is the slowest it will go. Prevents stopping completely, which causes heat buildup and material degradation at the nozzle.' },
  liftHeadEnabled: { brief: 'Move printhead away to let small layers cool', detailed: 'When a layer needs longer to cool than its print time, the printhead moves away to avoid heating it. Helps tall, narrow prints cool properly.' },
  enableBridgeFan: { brief: 'Enable extra cooling during bridge sections', detailed: 'Activates special fan speed when printing bridges. Maximum cooling on bridges helps the material solidify quickly, preventing sagging.' },
  regularFanSpeedLayer: { brief: 'Layer at which regular fan speed starts', detailed: 'Below this layer the fan ramps up; at this layer it reaches the regular speed setting. Pairs with fanFullLayer to control the fan ramp-up curve.' },
  regularFanSpeedAtHeight: { brief: 'Height at which fan reaches regular speed', detailed: 'Alternative to layer number — sets the height in mm at which the fan hits regular speed. Useful when you know the exact height rather than layer count.' },
  fanKickstartTime: { brief: 'Duration to run fan at 100% to start spinning', detailed: 'Some fans need a kick-start burst to begin spinning. Runs the fan at full speed for this many milliseconds, then drops to the set speed. 100–200ms typical.' },
  maximumFanSpeed: { brief: 'Maximum allowed fan speed (%)', detailed: 'Caps the fan speed at this percentage. Useful for printers where 100% fan is too aggressive for the material (e.g., ABS warps with full cooling). 70–100% for PLA, 30–50% for ABS.' },
  initialFanSpeed: { brief: 'Fan speed for the very first layers', detailed: 'The fan speed during the initial layers before it ramps up. Usually 0% to let the first layers bond to the bed without rapid cooling, which can cause warping.' },
  buildVolumeFanSpeed: { brief: 'Speed for the enclosure/build volume fan', detailed: 'Controls a separate fan for the printer enclosure (if present). A slow enclosure fan can maintain higher ambient temperatures for materials like ABS.' },

  // ── Support ─────────────────────────────────────────────────────────────────
  supportEnabled: { brief: 'Generate supports for overhanging areas', detailed: 'When enabled, the slicer adds support structures under overhanging areas that exceed the overhang angle. Essential for horizontal spans and 90° overhangs.' },
  supportPattern: { brief: 'Pattern used inside support structures', detailed: '"Lines" prints quickly and is easy to remove. "Grid" is stronger. "Zigzag" is good balance of speed and strength. Lines is most popular for easy removal.' },
  supportZDistance: { brief: 'Vertical gap between support top and model', detailed: 'Space between the top of support and the bottom of the model. Larger gap (0.2–0.3mm) makes removal easier but leaves a rougher surface. Smaller gap = harder to remove but better finish.' },
  supportXYDistance: { brief: 'Horizontal gap between support and model sides', detailed: 'Side clearance between support and model walls. 0.8–1.0mm typical. Larger gap = easier removal but more wobble; smaller = tighter fit but may fuse to the model.' },
  supportTreeAngle: { brief: 'Maximum angle for tree support branches', detailed: 'How far tree support branches can lean outward. Lower angles = more vertical (stable) but fewer merges; higher angles = fewer branches but may be less stable.' },
  supportTreeBranchDiameter: { brief: 'Diameter of tree support branches', detailed: 'Thicker branches are stronger and more stable but use more material. Thinner branches save material and are easier to remove. 2–5mm typical.' },
  supportBuildplateOnly: { brief: 'Only create support anchored to the build plate', detailed: 'Prevents support from growing on the model surface. Results in cleaner prints but may miss overhangs that can only be supported from the model itself.' },
  supportHorizontalExpansion: { brief: 'Expand support footprint horizontally', detailed: 'Positive values make the support slightly wider than the overhang, negative values make it narrower. Wider support is more stable; narrower reduces contact marks.' },
  supportJoinDistance: { brief: 'Distance at which nearby supports merge', detailed: 'Nearby support structures closer than this distance are joined into one piece. Merged supports are stronger and easier to remove as a single unit.' },
  minimumSupportArea: { brief: 'Minimum overhang area to generate support', detailed: 'Overhang areas smaller than this (mm²) are not supported. Prevents generating support for tiny overhangs that would print fine unsupported. 1–5mm² typical.' },

  // ── Adhesion ────────────────────────────────────────────────────────────────
  skirtLines: { brief: 'Number of outline loops in the skirt', detailed: 'Multiple skirt loops prime the nozzle more thoroughly. 1–3 lines is typical. More lines = more priming but more material. Skirt doesn\'t attach to the model.' },
  skirtDistance: { brief: 'Distance from model to skirt outline', detailed: '5–10mm typical. Farther skirts allow more nozzle priming but may be outside the print area on small printers. The skirt helps level check and primes the nozzle.' },
  brimWidth: { brief: 'Width of brim attached to model base', detailed: 'Wider brims (8–15mm) significantly improve adhesion for tall, narrow models. The brim attaches to the base and must be removed after printing. More width = better adhesion but more cleanup.' },
  raftLayers: { brief: 'Number of layers in the raft base', detailed: 'The raft is a sacrificial base under the model. More layers = more stable base. Typically 3–5 layers. The raft is removed after printing.' },
  raftMargin: { brief: 'How far raft extends beyond the model', detailed: '5–10mm typical. Wider margin = better adhesion and stability. Larger raft uses more material but is much more stable on difficult surfaces.' },

  // ── Special Modes ───────────────────────────────────────────────────────────
  relativeExtrusion: { brief: 'Use relative E commands in G-code (M83)', detailed: 'In relative mode, E values in G-code are distances to extrude, not absolute positions. Some printers require this. Most Marlin printers can use either mode.' },
  spiralizeContour: { brief: 'Print as a continuous spiral — no seam (vase mode)', detailed: 'Vase mode creates a single continuous spiral with no seams, perfect for hollow vessels. The model must have no overhangs and only one wall is printed.' },
  surfaceMode: { brief: 'How to handle surface vs. solid geometry', detailed: '"Normal" prints solid models. "Surface" prints the outer shell only (no infill). "Both" prints solid and surface shell separately. Useful for non-manifold or surface-only meshes.' },
  printSequence: { brief: 'Print all models simultaneously or one at a time', detailed: '"All at Once" prints all models layer by layer. "One at a Time" finishes each model before starting the next — reduces stringing between models but limits printer height.' },
  moldEnabled: { brief: 'Print a shell suitable for casting molds', detailed: 'Creates a hollow shell around the model so it can be used as a casting mold. The model defines the cavity shape. Useful for resin, silicone, or wax casting.' },

  // ── Experimental ────────────────────────────────────────────────────────────
  makeOverhangPrintable: { brief: 'Trim model geometry to make overhangs printable', detailed: 'Modifies the model to clip steep overhangs to the maximum printable angle. The printed model will differ slightly from the original — an alternative to generating support.' },
  enableBridgeSettings: { brief: 'Override speed/flow/fan specifically for bridges', detailed: 'Enables separate settings for unsupported spans. Tuning bridge settings independently can dramatically improve bridge quality without affecting the rest of the print.' },
  bridgeWallSpeed: { brief: 'Speed for wall lines crossing bridge spans', detailed: 'Printing bridge walls slower (20–30 mm/s) allows better cooling and prevents drooping. Faster bridges tend to sag more.' },
  bridgeSkinSpeed: { brief: 'Speed for skin over bridge spans', detailed: 'Speed for flat surface sections crossing bridges. Slower gives more cooling time. 20–30 mm/s typical for good bridge quality.' },
  bridgeSkinFlow: { brief: 'Flow rate for bridge skin sections', detailed: 'Slightly reduced flow (90–100%) during bridges can prevent material buildup. Normal flow is fine for most bridges; reduce for very long spans over 40mm.' },
  bridgeAngle: { brief: 'Bridge extrusion angle (0 = auto)', detailed: '0 = automatically calculate the best angle based on model geometry. Manual angle (1–359°) fixes the bridge direction. Auto is almost always better.' },
  fluidMotionEnable: { brief: 'Smooth path curves for higher quality at speed', detailed: 'Replaces sharp corners in paths with smooth curves. Allows higher print speeds on curved geometry while reducing ringing and vibration artifacts.' },
  enableOozeShield: { brief: 'Print a shield wall to catch nozzle ooze', detailed: 'Creates a thin wall that the nozzle wipes on before printing the model. Catches the ooze that accumulates during travel and primes the nozzle cleanly.' },
  scarfSeamLength: { brief: 'Length of the overlap at layer seam (scarf joint)', detailed: 'A scarf seam gradually ramps the Z position over this distance at the layer seam, blending the start/end instead of a sharp step. Reduces the visible seam line.' },

  // ── Acceleration ────────────────────────────────────────────────────────────
  accelerationPrint: { brief: 'Acceleration during printing moves', detailed: 'Lower values (1000–2000 mm/s²) reduce ringing and vibration artifacts. Higher values (3000+) print faster but may cause visible ghosting on walls at high speeds.' },
  accelerationTravel: { brief: 'Acceleration during travel moves', detailed: 'Travel moves can use higher acceleration (3000–5000 mm/s²) since no material is being deposited. Higher travel acceleration reduces time on non-printing moves.' },
  accelerationWall: { brief: 'Acceleration for wall printing moves', detailed: 'Lower wall acceleration (1000–1500 mm/s²) reduces ringing on the outer surface. The most important acceleration to keep low for better print quality.' },
  accelerationInfill: { brief: 'Acceleration for infill moves', detailed: 'Infill can use higher acceleration (2000–3000 mm/s²) since visual quality doesn\'t matter. Higher infill acceleration saves print time.' },
  accelerationTopBottom: { brief: 'Acceleration for top/bottom surface moves', detailed: 'Top and bottom surfaces benefit from moderate acceleration (1000–2000 mm/s²) to reduce ringing on the visible horizontal surfaces.' },
  accelerationSupport: { brief: 'Acceleration for support structure moves', detailed: 'Support can use relatively high acceleration since it\'s not visible in the final print. 2000–3000 mm/s² typical.' },
  jerkPrint: { brief: 'Jerk (instant velocity change) for print moves', detailed: 'Lower jerk (8–10 mm/s) reduces vibration at direction changes. Higher jerk means faster cornering. Marlin jerk controls instant speed; Klipper uses input shaper instead.' },
  jerkTravel: { brief: 'Jerk for travel moves', detailed: 'Travel moves can use higher jerk (10–15 mm/s) for faster cornering. Only affects non-printing moves so it doesn\'t impact surface quality.' },
  jerkWall: { brief: 'Jerk for wall printing moves', detailed: 'Lower jerk on walls (6–8 mm/s) reduces vibration artifacts on the outer surface. The most important jerk setting for print quality.' },
  jerkInfill: { brief: 'Jerk for infill moves', detailed: 'Infill can use higher jerk (10–15 mm/s) for faster direction changes. Doesn\'t affect visible surface quality.' },
  jerkTopBottom: { brief: 'Jerk for top/bottom surface moves', detailed: 'Moderate jerk (8–10 mm/s) for top/bottom surfaces. Lower than infill but higher than walls since these surfaces are visible but mostly flat.' },

  // ── Mesh Fixes ──────────────────────────────────────────────────────────────
  unionOverlappingVolumes: { brief: 'Merge overlapping model volumes into one solid', detailed: 'When enabled, intersecting volumes are treated as a single object (union). Prevents double-printing in overlapping areas. Usually keep this on unless you specifically need separate overlapping volumes.' },
  removeAllHoles: { brief: 'Fill all holes in the mesh, treating it as solid', detailed: 'Ignores holes in the mesh and treats the model as solid. Useful for models that should be solid but have unintended openings in the mesh geometry.' },
  extensiveStitching: { brief: 'Use aggressive algorithms to repair complex mesh errors', detailed: 'More aggressive stitching to fix open meshes and self-intersections. Slower than normal stitching. Use when standard mesh cleanup doesn\'t fix the model.' },
  maxResolution: { brief: 'Minimum path segment length for curve approximation', detailed: 'Curves shorter than this value are merged into longer segments. 0.5mm typical. Lower values preserve more detail but create larger G-code files.' },
  maxDeviation: { brief: 'Maximum deviation from original model surface', detailed: 'How far simplified paths can deviate from the original model. 0.025mm typical. Higher values create smaller files but may slightly simplify curved surfaces.' },
  maxTravelResolution: { brief: 'Minimum segment length for travel path approximation', detailed: 'Like max resolution but for travel moves. Slightly larger value (0.8mm) is fine since travel paths are not extruding material.' },

  // ── Dimensional Compensation ────────────────────────────────────────────────
  horizontalExpansion: {
    brief: 'Expand or shrink all horizontal dimensions',
    detailed: 'Positive values make the model larger; negative make it smaller. Used to calibrate dimensional accuracy. If a 20mm part prints as 20.2mm, use -0.1mm expansion.',
    whenToChange: [
      'Adjust after printing a dimensional gauge and confirming the error is consistent in X/Y.',
      'Avoid using it to compensate for elephant foot; use first-layer compensation instead.',
    ],
    commonValues: ['-0.05mm to -0.15mm for oversized parts', '0mm for calibrated profiles', '+0.05mm for loose shrink-prone materials'],
    relatedSettings: ['Hole Horizontal Expansion', 'Initial Layer Horizontal Expansion', 'Elephant Foot Compensation'],
    references: ['Horizontal Expansion setting guide'],
  },
  elephantFootCompensation: { brief: 'Reduce first-layer spreading (elephant foot)', detailed: 'The first layer often spreads slightly wider than designed ("elephant foot"). Positive values compensate by printing the first layer slightly narrower. 0.1–0.2mm typical.' },
  holeHorizontalExpansion: { brief: 'Expand hole diameters to compensate for shrinkage', detailed: 'FDM holes typically print smaller than designed. Positive values enlarge holes. Calibrate this for press-fit or clearance holes that need accurate sizing.' },
  initialLayerHorizontalExpansion: { brief: 'Horizontal expansion for first layer only', detailed: 'Adjusts the first layer width separately from the rest. Useful for compensating elephant foot independently from overall dimensional accuracy.' },

  // ── Flow ────────────────────────────────────────────────────────────────────
  wallFlow: {
    brief: 'Flow rate multiplier for wall extrusions',
    detailed: 'Adjusts how much material is extruded for walls. 100% is normal. Reduce slightly (95-98%) if walls are over-extruding. Increase if there are gaps between wall lines.',
    whenToChange: [
      'Tune after filament diameter, extrusion multiplier, and temperature are already reasonable.',
      'Lower if wall surfaces look swollen or dimensions are consistently oversized.',
    ],
    commonValues: ['95-98% for slight over-extrusion', '100% default', '102-105% for visible wall gaps'],
    relatedSettings: ['Outer Wall Flow', 'Inner Wall Flow', 'Initial Layer Flow', 'Flow Tower'],
    references: ['Wall Flow setting guide'],
  },
  outerWallFlow: { brief: 'Flow rate multiplier for outer walls', detailed: 'Fine-tune extrusion specifically for the outer wall. Slightly less material (97–99%) can reduce bulging on the outer surface for better dimensional accuracy.' },
  innerWallFlow: { brief: 'Flow rate multiplier for inner walls', detailed: 'Controls extrusion for inner walls. 100% is normal. Inner walls affect strength more than appearance, so keep close to 100%.' },
  topBottomFlow: { brief: 'Flow rate multiplier for top/bottom surfaces', detailed: 'Adjusts material for top and bottom solid surfaces. Keep near 100%. Slightly reducing (95–98%) can help with over-extrusion marks on top surfaces.' },
  infillFlow: { brief: 'Flow rate multiplier for infill', detailed: 'Flow adjustment for infill. 100% is normal. Slight under-extrusion in infill (90–95%) doesn\'t significantly affect strength or appearance.' },
  supportFlow: { brief: 'Flow rate multiplier for support structures', detailed: 'Adjusts material for support. 100% is normal. Consistent extrusion is important for support stability but exact flow matters less than for walls.' },
  supportInterfaceFlow: { brief: 'Flow rate for support interface layers', detailed: 'Adjusts material for the interface layers between support and model. Keeping this at 100% ensures the interface provides consistent contact for good model surface finish.' },
  skirtBrimFlow: { brief: 'Flow rate for skirt or brim lines', detailed: 'Adjusts material for the skirt/brim. Slightly higher flow (105%) can improve brim adhesion to the bed. Doesn\'t affect model quality.' },
  initialLayerFlow: { brief: 'Flow rate multiplier for the first layer', detailed: 'Slightly higher first layer flow (105–110%) helps fill the first layer more completely for better bed adhesion. Compensates for any slight gap in bed leveling.' },

  // ── Acceleration Control
  accelerationEnabled: {
    brief: 'Enable printer acceleration settings',
    detailed:
      'Allows control of acceleration for different movement types. Properly tuned acceleration reduces vibration and improves print quality. Most modern printers handle this, but requires firmware support.',
  },

  // Jerk Control
  jerkEnabled: {
    brief: 'Enable jerk (instant velocity change) limits',
    detailed:
      'Jerk controls how instantly the printer can change direction. Lower jerk = smoother, less vibration. Higher jerk = faster, more vibration. Marlin and Klipper support this. Typical jerk 8-10 mm/s for most printers.',
  },
};

export function getSettingHelp(settingKey: string): SettingHelp | null {
  return SETTINGS_HELP[settingKey] ?? null;
}
