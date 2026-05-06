import {
  Accessibility,
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  ArrowUp,
  BarChart2,
  Bell,
  BookOpen,
  Bot,
  Box,
  BrainCircuit,
  CalendarClock,
  CalendarDays,
  CameraOff,
  ChevronRight,
  ClipboardCheck,
  Code2,
  Copy,
  Cpu,
  Crosshair,
  DollarSign,
  Download,
  Droplets,
  ExternalLink,
  Eye,
  Film,
  FlaskConical,
  FolderOpen,
  Gauge,
  GitBranch,
  GitMerge,
  Globe,
  History,
  Image,
  Images,
  LayoutGrid,
  Layers3,
  ListChecks,
  ListOrdered,
  Menu,
  MessageSquare,
  Microscope,
  Monitor,
  Move,
  MoveHorizontal,
  Navigation,
  Package,
  Palette,
  PenLine,
  PieChart,
  Play,
  Printer,
  Receipt,
  RefreshCw,
  Rocket,
  RotateCcw,
  Route,
  Ruler,
  Scan,
  Scissors,
  Server,
  Shapes,
  ShieldCheck,
  Sliders,
  Sparkles,
  Sun,
  SwitchCamera,
  Tablet,
  Tag,
  Terminal,
  Thermometer,
  Timer,
  TreePine,
  Upload,
  Usb,
  Video,
  Wand2,
  Wifi,
  Wind,
  Wrench,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import './HomePage.css';

const workflows = [
  {
    title: 'Design',
    copy: 'Sketch parts, build parametric features, organize components, and export models from a browser-based CAD workspace.',
    image: '/help/help-design-overview.png',
    color: '#7c3aed',
    sections: [
      {
        label: 'Sketcher',
        items: [
          'Constraint-based 2D sketcher with dimensions and geometric snaps',
          'Coincident, tangent, parallel, perpendicular, and equal constraints',
          'Point, line, arc, circle, spline, rectangle, and polygon tools',
          'Sketch references and projection from 3D geometry',
        ],
      },
      {
        label: 'Solid modeling',
        items: [
          'Parametric model library for Gridfinity bins, insert bosses, brackets, project boxes, clips, and gear blanks',
          'Extrude, revolve, sweep, and loft from closed sketches',
          'Shell, fillet, chamfer, draft, and taper operations',
          'Non-destructive boolean union, subtract, and intersect with editable parent links',
          'Mirror and pattern (linear, circular) for repeated geometry',
        ],
      },
      {
        label: 'Variants',
        items: [
          'Named design configurations with saved parameter sets and per-variant feature suppression',
          'Thread presets and helix thread geometry for printable hardware workflows',
        ],
      },
      {
        label: 'Organization',
        items: [
          'Parametric feature timeline with rollback and reorder',
          'Component tree with visibility toggling and grouping',
          'Per-body material and color assignment',
          'Named views and section planes for inspection',
        ],
      },
      {
        label: 'Import and export',
        items: [
          'Import STEP, STL, OBJ, and native project files',
          'Mesh repair reports, duplicate-vertex welding, normal repair, and STL import healing',
          'Export STEP, STL, OBJ with per-body or full-assembly options',
          'Measurement tools, mass properties, and bounding box readouts',
        ],
      },
    ],
  },
  {
    title: 'Prepare',
    copy: 'Arrange parts on the plate, tune print profiles, inspect sliced toolpaths, and generate labeled G-code for object cancellation.',
    image: '/help/help-prepare-overview.png',
    color: '#0284c7',
    sections: [
      {
        label: 'Plate layout',
        items: [
          'Drag-and-drop multi-part arrangement with snap and align guides',
          'Rotate, scale, and mirror parts on the build plate',
          'Auto-arrange to pack parts efficiently',
          'Per-part color coding for object cancellation identification',
        ],
      },
      {
        label: 'Slicing',
        items: [
          'In-browser WASM slicing kernels — no cloud upload required',
          'Print profiles: layer height, speed, temperature, walls, infill, supports',
          'Bridging, overhangs, seam placement, and retraction controls',
          'Per-object profile overrides for mixed-material or mixed-quality plates',
        ],
      },
      {
        label: 'Preview and inspection',
        items: [
          'Animated G-code preview with per-layer scrubbing',
          'Move-type highlighting: perimeter, infill, travel, support, bridge',
          'Layer time and filament usage estimates per layer',
          'Zoom and rotate the 3D toolpath preview freely',
        ],
      },
      {
        label: 'Calibration and output',
        items: [
          'Flow, pressure advance, resonance, and first-layer calibration utilities',
          'M486 and EXCLUDE_OBJECT label generation for mid-print cancellation',
          'Export labeled G-code ready for Duet, Klipper, or Marlin',
        ],
      },
    ],
  },
  {
    title: 'Print',
    copy: 'Connect printers, monitor jobs, manage files, queue work across a fleet, and control firmware-specific features from one panel.',
    image: '/help/help-printer-fleet.png',
    color: '#059669',
    sections: [
      {
        label: 'Firmware support',
        items: [
          'Duet / RepRapFirmware — full RRF API, object model, and DWC parity',
          'Klipper / Moonraker — native API, klippy config, pressure advance, input shaper',
          'Marlin — USB serial via WebSerial, no driver install or software bridge',
          'Unified UI surface — same controls work across all three firmwares',
        ],
      },
      {
        label: 'Printer control',
        items: [
          'File manager — upload, rename, delete, and start print jobs',
          'Macro library, interactive G-code console, and manual movement controls',
          'Heater control, fan overrides, and power management',
          'Spool and filament tracking with per-print usage estimates',
          'Real-time layer progress, ETA, and object cancellation from the dashboard',
        ],
      },
      {
        label: 'Camera and monitoring',
        items: [
          'Live MJPEG and WebRTC streams with sub-second latency',
          'Multi-camera per printer: top, side, nozzle, and custom tab views',
          'ONVIF PTZ control with D-pad and saved preset positions',
          'All-cameras fleet grid with per-tile status and alert overlays',
          'Automatic per-layer photo gallery with ZIP export',
        ],
      },
      {
        label: 'Fleet and queue',
        items: [
          'Smart job queue with drag-reorder and auto-routing rules',
          'Route by build volume, material loaded, nozzle size, and profile compatibility',
          'Distribute N copies across available printers in one action',
          'Cross-printer A/B comparison — timing and quality side-by-side',
          'Filament inventory across the fleet with low-stock warnings',
        ],
      },
    ],
  },
];

const useSteps = [
  'Open the app and start in Design to sketch, import, or edit a part.',
  'Move to Prepare to arrange the plate, tune print profiles, slice, and inspect the generated toolpath.',
  'Move to 3D Printer to connect hardware, queue jobs, monitor cameras, and manage print-farm work.',
  'Use the Help button inside the app for guided screenshots and firmware-specific setup notes.',
];

const featureGroups = [
  {
    page: 'Design',
    section: 'CAD modeling',
    icon: Shapes,
    summary: 'Parametric CAD tools for creating printable parts directly in the browser.',
    details: [
      { icon: PenLine, title: 'Constraint-based 2D sketcher', body: 'Dimensions, coincident, tangent, parallel, perpendicular, equal, and projection constraints. Improved tangent-arc solving, construction geometry, sketch references projected from 3D faces, and a fully keyboard-navigable constraint toolbar.' },
      { icon: Box, title: 'Solid modeling operations', body: 'Extrude, revolve, sweep, loft, shell, rib, split, draft, hole, thread, chamfer, and fillet — all stored as non-destructive timeline entries. Each feature is individually editable; change a sketch and all downstream geometry recomputes.' },
      { icon: BookOpen, title: 'Parametric model library', body: 'Ready-to-configure parametric starters for Gridfinity bins, insert bosses, snap-fit clips, bracket pairs, project enclosure boxes, cable clips, gear blanks, and knurled knobs — drop one on the timeline and tune it with typed dimensions.' },
      { icon: Wrench, title: 'Thread presets', body: 'Helix-based thread geometry with configurable pitch, length, class (1A/2A/3A), and handedness. Generates clean printable threads for M2–M12 hardware — no post-processing, no chasing required.' },
      { icon: History, title: 'Feature timeline and component tree', body: 'Full parametric history with rollback, reorder, and suppression. Component tree with visibility toggling, per-body grouping, material assignments, color overrides, named views, and arbitrary section planes for inspection.' },
    ],
  },
  {
    page: 'Design',
    section: 'Configurations and repair',
    icon: Sliders,
    summary: 'Variant management, resilient imports, and editable boolean history for production design work.',
    details: [
      { icon: GitBranch, title: 'Named design configurations', body: 'Save unlimited parameter snapshots with per-variant feature suppression. Switch configurations from the ribbon, capture the current state, rename, delete, or export a manifest — useful for "standard / lightweight / reinforced" print variants of the same model.' },
      { icon: Scan, title: 'Mesh repair reports', body: 'Analyzes imported geometry for vertex count, triangle count, duplicate vertices, open boundary edges, non-manifold edges, and degenerate (zero-area) faces before the mesh touches the timeline.' },
      { icon: Wand2, title: 'Repair actions', body: 'Duplicate-vertex welding, normal recompute, normal flip, and full STL import healing — applied individually or in one batch pass. Each repair step is recorded and can be rolled back.' },
      { icon: GitMerge, title: 'Non-destructive booleans', body: 'Union, subtract, and intersect operations retain editable parent links. Edit either input body and the boolean result recomputes instantly. Intersect supports partial overlaps via the csgIntersect overlap algorithm.' },
      { icon: Copy, title: 'Mirror and pattern tools', body: 'Linear arrays (X/Y/Z count + spacing), circular arrays (axis + count), and mirror across any sketch plane or planar face. All patterns are timeline entries — change the seed feature and the whole array updates.' },
    ],
  },
  {
    page: 'Design',
    section: 'Import and export',
    icon: ExternalLink,
    summary: 'Flexible file exchange for bringing geometry in and delivering production-ready files out.',
    details: [
      { icon: Upload, title: 'STEP, STL, OBJ import', body: 'Automatic mesh healing applied on load for STL/OBJ. STEP import preserves B-rep topology for Boolean operations. STL imports are analyzed for repair opportunities and surfaced in the Mesh Repair panel before being added to the timeline.' },
      { icon: Download, title: 'STEP, STL, OBJ export', body: 'Per-body or full-assembly export. STEP output preserves B-rep for downstream CAD. STL/OBJ exports include configurable resolution (chord deviation), unit selection, and optional per-body file splitting for multi-material slicing workflows.' },
      { icon: Ruler, title: 'Measurement tools', body: 'Point-to-point distance, angle between faces/edges, arc radius, edge length, face area, shell volume, center of mass, and bounding box — all accessible with a single click on any body or face in the viewport.' },
      { icon: FolderOpen, title: 'Native project format', body: 'Saves the full parametric history, configuration manifest, component tree, material assignments, named views, and section planes. Projects resume across browser sessions with no data loss — even after a tab close.' },
    ],
  },
  {
    page: 'Prepare',
    section: 'Plate planning and calibration',
    icon: FlaskConical,
    summary: 'Smarter build-plate decisions, calibration presets, and better handoff to connected printers.',
    details: [
      { icon: Move, title: 'Plate controls', body: 'Drag, rotate, scale, mirror, and auto-arrange parts on the build plate. Per-object profile overrides let you slice different objects at different quality settings in the same job — no separate G-code files needed.' },
      { icon: LayoutGrid, title: 'Bed-mesh-aware auto-arrange', body: 'Reads the stored bed mesh from a connected printer and packs parts onto flatter regions, avoiding known high-deviation dead spots. Falls back to standard packing when no mesh is available.' },
      { icon: Tag, title: 'Object cancellation labels', body: 'M486 and EXCLUDE_OBJECT comment markers are automatically embedded in output G-code per sliced object. Supports Duet ≥ 3.5, Marlin ≥ 2.0.9, and all Klipper versions — works with the printer-side cancel UI without any extra setup.' },
      { icon: Crosshair, title: 'Calibration presets', body: 'One-click test prints for dimensional accuracy cubes, first-layer adhesion patches, pressure advance towers, retraction distance towers, temperature gradient towers, and input shaper ringing artifacts.' },
      { icon: Image, title: 'G-code thumbnails', body: 'Embeds 16×16, 220×124, and 480×270 preview images directly in the G-code comment block for display in Duet DWC, Mainsail, Fluidd, Bambu HMS, and other modern firmware file pickers.' },
    ],
  },
  {
    page: 'Prepare',
    section: 'Slicing quality',
    icon: Layers3,
    summary: 'Modern slicer controls that close major Cura, Orca, and Bambu-style print-quality gaps.',
    details: [
      { icon: TreePine, title: 'Tree supports', body: 'Organic tree-support generation with configurable branch angle, tip diameter, density, and collision-avoidance margin. Preview renders full tree geometry in the viewport before slicing so you can identify problems early.' },
      { icon: Layers3, title: 'Adaptive layer heights', body: 'Slope-based layer subdivision automatically raises resolution on curved and steep surfaces, reduces it on flat areas. Preview shows the per-layer height map overlaid on the model before slicing.' },
      { icon: Palette, title: 'Multi-color slicing', body: 'Per-object tool indices with T0/T1/… selection G-code and prime-tower purge move generation. Configurable purge volume, wipe tower position, and purge lines for single-extruder MMU setups.' },
      { icon: Scissors, title: 'Seam and modifier controls', body: 'Coasting, wiping, scarf seam, Z-seam alignment painting on the model surface, sequential printing (object-by-object), and per-region modifier meshes for localized profile overrides anywhere on the model.' },
      { icon: Wand2, title: 'Advanced print modes', body: 'Non-planar surface ironing for smooth top faces, vase/spiralize mode, fuzzy skin texture, organic/natural infill, gyroid infill, lightning infill, and Arachne variable-width perimeter walls for accurate thin-feature reproduction.' },
    ],
  },
  {
    page: 'Prepare',
    section: 'Toolpath preview',
    icon: Code2,
    summary: 'Animated G-code viewer for inspecting toolpaths layer by layer before sending to a printer.',
    details: [
      { icon: Play, title: 'Animated G-code preview', body: 'Per-layer scrubbing with adjustable playback speed and a range selector for focusing on a span of layers. Pause on any layer to inspect move geometry — vertices, travel lines, and retract points are all pickable in the 3D viewport.' },
      { icon: Eye, title: 'Move-type color coding', body: 'Distinct per-move colors for perimeters (inner/outer), infill, travel, support, bridge, seam, and wipe moves. Toggle individual move types on and off for cleaner inspection of specific toolpath regions.' },
      { icon: BarChart2, title: 'Layer time and filament estimates', body: 'Per-layer and cumulative wall-clock time, filament length, and filament weight displayed as you scrub. Useful for locating the longest layers before committing to a print run.' },
      { icon: Code2, title: 'G-code dock panel', body: 'Full raw G-code listing with virtual scrolling synchronized to the current preview layer. Click any line to jump the 3D view to that move, or scrub the 3D view and watch the code panel follow. Includes a breakpoint system for step-by-step inspection.' },
      { icon: RotateCcw, title: 'Free 3D toolpath navigation', body: 'Orbit, pan, and zoom the toolpath preview completely independently of the main CAD viewport. Camera state is preserved across layer scrubs so you can inspect the same angle across multiple layers without re-orienting.' },
    ],
  },
  {
    page: '3D Printer',
    section: 'Cross-firmware support',
    icon: Printer,
    summary: 'One unified UI surface for Duet/RRF, Klipper/Moonraker, and Marlin/WebSerial.',
    details: [
      { icon: Server, title: 'Duet / RepRapFirmware', body: 'Full RRF HTTP API, real-time object model access, and DWC-parity feature set: extended status polling, file metadata, bed mesh visualization, run macros, M291 dialog rendering, and live thermistor graphs.' },
      { icon: Terminal, title: 'Klipper / Moonraker', body: 'Native Moonraker REST and WebSocket API, klippy config file reading, pressure advance, input shaper, save_config round-trip, and live sensor graphs. Auto-reconnect on klippy restart.' },
      { icon: Usb, title: 'Marlin / WebSerial', body: 'USB serial connection directly in the browser via the WebSerial API — no driver install, no software bridge, no OctoPrint required. Automatic baud negotiation and M-code capability detection on connect.' },
      { icon: GitMerge, title: 'Universal firmware wrappers', body: 'Bed Map, Exclude Object, Input Shaper, Pressure Advance, Spools, Timelapse, Power, and Updates all route through firmware-specific adapters behind a common interface — the same UI panel works across all three firmware targets.' },
      { icon: Activity, title: 'Cross-firmware layer awareness', body: 'Layer progress from Moonraker getPrintStatus, Duet M73 serial parsing, and Marlin echo:Layer N/M responses are unified into one progress model — so layer counters, ETAs, and object cancel overlays work identically regardless of firmware.' },
    ],
  },
  {
    page: '3D Printer',
    section: 'Printer dashboard',
    icon: Usb,
    summary: 'Daily printer management: jobs, files, macros, hardware controls, and live print preview.',
    details: [
      { icon: FolderOpen, title: 'File manager', body: 'Upload single or batch G-code files, rename, move, delete, and start print jobs from the browser. Folder support for organized storage, file metadata display including estimated print time and filament, and quick-start from the file browser.' },
      { icon: Terminal, title: 'Macro library and console', body: 'Saved macro buttons with custom labels, icons, and confirmation prompts. Interactive G-code console with command history, syntax highlighting, and manual XYZ/XYZE jog controls with configurable step sizes.' },
      { icon: Thermometer, title: 'Hardware controls', body: 'Heater setpoints with active/standby/off states, fan speed overrides (part cooling + chassis), power management commands, and per-spool filament tracking with live usage deduction against loaded-spool weight.' },
      { icon: Monitor, title: 'Live print dashboard', body: 'Real-time layer progress bar, ETA countdown, print-preview card with animated nozzle position and motion trail, object badges showing cancel state, and a diagnostics panel for firmware warnings and error history.' },
      { icon: XCircle, title: 'Mid-print object cancellation', body: 'Cancel any object from a dedicated Objects tab, from the dashboard badge list, or by right-clicking the object in the 3D print-preview viewport. Sends EXCLUDE_OBJECT_START/END or M486 commands as appropriate for the connected firmware.' },
    ],
  },
  {
    page: '3D Printer',
    section: 'Farm and queue',
    icon: SwitchCamera,
    summary: 'Print-farm orchestration for routing work, comparing printers, and managing fleet inventory.',
    details: [
      { icon: ListOrdered, title: 'Cross-printer job queue', body: 'Drag-reorder jobs in the global queue, pause and resume the entire queue, reassign a job mid-queue to a different printer, and let auto-routing send the next job to the best available machine automatically.' },
      { icon: Route, title: 'Smart routing rules', body: 'Route by build volume fit, loaded material and color, nozzle size compatibility, and profile tag matching. Rules are configurable per-job and saved per-queue slot — a mismatch shows a warning before dispatch.' },
      { icon: Copy, title: 'Copy distribution', body: 'Distribute N copies of a job across all available printers in a single action. The system splits the total count, assigns per-printer slice, and queues each automatically with the correct G-code.' },
      { icon: BarChart2, title: 'A/B printer comparison', body: 'Run the same G-code on two printers simultaneously and get a per-layer timing delta chart, a consistency score, and a summary identifying which machine runs faster or more repeatably. Useful for dialing in identical printers.' },
      { icon: Package, title: 'Fleet filament inventory', body: 'Spool weights, materials, colors, and brands tracked across every printer in the fleet. Low-stock warnings fire at a configurable threshold. Per-print filament usage is automatically deducted from the active spool.' },
    ],
  },
  {
    page: 'Camera',
    section: 'Monitoring, AR, and vision',
    icon: Video,
    summary: 'Live camera workflows for inspection, AR overlays, PTZ control, and failure detection.',
    details: [
      { icon: Video, title: 'Live streams', body: 'MJPEG and WebRTC streams with multi-camera per-printer tabs, sub-second latency, quality selector, and an all-cameras fleet grid with per-tile status overlays, alert badges, and click-through to the full printer panel.' },
      { icon: Navigation, title: 'ONVIF PTZ control', body: 'On-screen D-pad, continuous-move speed slider, optical zoom control, and saved preset positions with one-click recall. Compatible with Reolink, Tapo, Hikvision, Amcrest, and any other ONVIF Profile S camera.' },
      { icon: Scan, title: 'AR toolpath overlay', body: 'Live toolpath wireframe composited over the camera feed at full frame rate using a calibrated homography. Includes a bed-corner calibration wizard, camera ruler for real-world distance measurement, and right-click object cancel from the camera view.' },
      { icon: AlertTriangle, title: 'Failure detection', body: 'Computer-vision models detect spaghetti (delamination/blob-of-doom), layer shift, adhesion loss, and first-layer gaps. Configurable confidence threshold with a guarded auto-pause: the system pauses and asks for confirmation before stopping a print.' },
      { icon: Images, title: 'Layer photo gallery', body: 'Automatic snapshot on every layer change keyed by printer, job name, and layer number. Per-job gallery browser with filmstrip navigation, ZIP export, and a post-print AR comparison overlay: frozen final frame with the model wireframe showing any mismatch.' },
    ],
  },
  {
    page: '3D Printer',
    section: 'Cost, energy, and sustainability',
    icon: Gauge,
    summary: 'Operational intelligence for what prints cost, when to run them, and how much energy they use.',
    details: [
      { icon: DollarSign, title: 'Filament cost tracking', body: 'Per-spool cost-per-kg entry with automatic estimates for unpriced spools based on material type. Every print job accumulates a filament cost line using the active-spool price and the actual grams consumed by the slicer estimate.' },
      { icon: Receipt, title: 'Per-print energy receipts', body: 'Live electricity ticker during the print (watts × time × rate), kWh consumed total, CO2 equivalent estimate from the configured regional grid factor, and a completed-job receipt with a full itemized cost breakdown.' },
      { icon: PieChart, title: 'Cost analytics dashboard', body: 'Total spending grouped and charted by project, individual file, filament material, printer, calendar month, and printer-month — giving fleet-wide visibility into where budget is going.' },
      { icon: CalendarClock, title: 'Time-of-use scheduling', body: 'Configurable TOU rate windows (peak / off-peak / super off-peak) with a cheapest-window planner that suggests the lowest-cost start time for a given print duration. Integrates with the scheduling calendar.' },
      { icon: Sun, title: 'Solar-surplus printing', body: 'Gates print-start decisions on real-time solar surplus pulled from Powerwall, Enphase, SolarEdge, or a custom JSON provider endpoint. Includes CSV and JSON sustainability export for carbon-reporting workflows.' },
    ],
  },
  {
    page: '3D Printer',
    section: 'Maintenance and scheduling',
    icon: Timer,
    summary: 'Lifecycle tools that keep printers calibrated, maintained, and ready for queued work.',
    details: [
      { icon: RefreshCw, title: 'Calibration aging tracker', body: 'Tracks time-since-last-calibration for bed mesh, pressure advance, input shaper, Z-offset, and first-layer checks. Overdue alerts fire in the dashboard; each calibration type has a configurable recommended interval per printer.' },
      { icon: Wrench, title: 'Wear and service log', body: 'Belt tension, bearing condition, nozzle print-hours, hotend thermal cycles, and build-plate print count tracked with configurable replacement thresholds. A full chronological service log records every maintenance action.' },
      { icon: Droplets, title: 'Filament moisture model', body: 'Ambient humidity sensor integration and opened-on date tracking per spool. A moisture-risk score rises with time and humidity; pre-flight drying warnings fire when the score exceeds a threshold before a queued job starts.' },
      { icon: CalendarDays, title: 'Scheduling calendar', body: 'Day and week calendar views with drag-to-schedule print slots, quiet-hour enforcement (no jobs start between 11 pm and 7 am by default), scheduled-print editing in a popover, and bed-clear auto-queue on job completion.' },
      { icon: ClipboardCheck, title: 'Pre-flight checklist', body: 'Configurable per-printer checklist that runs automatically before any queued job starts. Each item can be auto-verified (bed temperature stable, filament loaded, door closed) or manual-confirm. A failed check pauses the queue and notifies.' },
    ],
  },
  {
    page: 'Settings',
    section: 'Integrations and safety',
    icon: Wifi,
    summary: 'Workshop integrations, recovery workflows, enclosure control, and hardware tuning for real printers.',
    details: [
      { icon: Bell, title: 'Notification bridges', body: 'Webhook, Discord, Slack, Telegram, MQTT, and Home Assistant event bridges publish print start, completion, failure, layer milestones, temperature events, and remote pause/resume/cancel commands — all configurable with per-event toggles.' },
      { icon: ArrowLeftRight, title: 'Slicer profile exchange', body: 'Import and convert profiles from Cura, OrcaSlicer, Bambu Studio, and Prusa slicer formats. Full 3MF plate round-trip for compatible slicers: arrange in Cindr3D, open in OrcaSlicer, or vice versa, with all object placements preserved.' },
      { icon: Zap, title: 'Power-loss recovery', body: 'Reconnect detection after unexpected power loss with automatic heat restore to pre-loss temperatures, Z height restore accounting for thermal expansion, and G-code file-position resume so the print continues from exactly where it stopped.' },
      { icon: Wind, title: 'Enclosure and air quality', body: 'Chamber temperature ramp curves, print-start preheat, completion cooldown with configurable delay, door-open safety interlocks that pause heaters, VOC/PM2.5/CO2 thresholds via MQTT, and enclosure door print-lock policies.' },
      { icon: Cpu, title: 'Stepper driver tuning', body: 'Per-axis current (RMS/peak), microstep resolution, StealthChop vs SpreadCycle mode selection, firmware command wrappers for TMC driver access, a quick wiggle diagnostic test, and saved per-printer presets that apply on connect.' },
    ],
  },
  {
    page: 'Platform',
    section: 'App platform',
    icon: Rocket,
    summary: 'The foundation that makes Cindr3D practical on desktops, tablets, kiosks, and self-hosted installs.',
    details: [
      { icon: RefreshCw, title: 'Session resume', body: 'Active print sessions persist across browser reload, tab close, and device switch. A reconnect banner appears on return with elapsed time and current print status. Session tokens survive service-worker updates without losing the active print context.' },
      { icon: Tablet, title: 'Mobile and tablet UI', body: 'Touch-optimized layout with larger tap targets, bottom-sheet navigation for the monitoring panels, pinch-to-zoom in the viewport, and a dedicated one-thumb kiosk mode for wall-mounted printer control screens.' },
      { icon: Globe, title: 'Internationalization', body: 'Generated string catalog with 100% English coverage. A catalog freshness check at build time flags any new UI strings not yet added to the translation file. Community translation bundles can be added without app changes.' },
      { icon: Accessibility, title: 'Accessibility', body: 'ARIA roles and labels on every interactive element, runtime label inference for dynamic controls, full keyboard navigation with roving-tabindex patterns, high-contrast theme, and a reduced-motion mode that removes all non-essential animations.' },
      { icon: Download, title: 'PWA and offline support', body: 'Installable as a Progressive Web App with a Workbox service worker for full asset caching, offline project editing and G-code viewing, a custom splash screen, maskable icons, and a background sync queue that flushes when connectivity returns.' },
    ],
  },
  {
    page: 'AI and Help',
    section: 'AI assistant',
    icon: BrainCircuit,
    summary: 'BYOK AI execution, local MCP tooling, and guided learning built into the app.',
    details: [
      { icon: Bot, title: 'Local MCP server', body: 'Token-paired local MCP server with 29 tools covering parametric primitives, sketch creation, feature operations, boolean history, transforms, slicer profile control, slice execution, and printer commands — usable from Claude Desktop, Cursor, VS Code, or the built-in chat panel.' },
      { icon: MessageSquare, title: 'BYOK chat panel', body: 'In-app streaming chat supporting Anthropic (claude-3-5-sonnet, claude-3-haiku) and OpenAI / OpenRouter models. Bring your own API key — no Cindr3D account required. Chat context includes the active model geometry, slicer settings, and connected-printer state.' },
      { icon: Microscope, title: 'AI print diagnostics', body: 'Aggregates camera frames from the failure window, temperature graphs, slicer per-layer timing, firmware error log, and printer context into a structured prompt. Returns a ranked list of probable causes with suggested fix steps.' },
      { icon: ShieldCheck, title: 'Natural-language printer control', body: 'Guarded command execution: the AI can heat extruders, home axes, adjust speeds, start, pause, and cancel prints — all subject to configurable confirmation gates for destructive or irreversible actions before any G-code is sent.' },
      { icon: BookOpen, title: 'Guided tutorials', body: 'Browser-local progress tracking for interactive step-by-step help flows with screenshot callouts. Richer in-app slicer setting help pages with firmware-specific notes, recommended starting values, and links to relevant calibration prints.' },
    ],
  },
];

const stats = [
  { value: '4', label: 'Design outputs', sub: 'CAD / STL / DXF / PDF' },
  { value: '3', label: 'Firmware targets', sub: 'Duet · Klipper · Marlin' },
  { value: '29', label: 'AI / MCP tools', sub: 'CAD · Slicer · Printer' },
  { value: '100%', label: 'Browser-native', sub: 'No install · No cloud' },
  { value: 'MIT', label: 'Open source license', sub: 'Fork · Extend · Self-host' },
  { value: 'WASM', label: 'In-browser slicing', sub: 'No upload required' },
];

const whyItems = [
  {
    icon: Layers3,
    color: '#7c3aed',
    tag: 'No other tool does this',
    title: 'CAD → slicer → printer in one browser tab',
    body: 'OctoPrint, Mainsail, and Fluidd only cover printing. PrusaSlicer and OrcaSlicer only cover slicing. Cindr3D combines parametric CAD design, in-browser slicing, and full printer control in a single workspace — no app switching, no file exports between tools.',
  },
  {
    icon: Cpu,
    color: '#0284c7',
    tag: 'Slicer',
    title: 'WASM slicing — your file never leaves your machine',
    body: 'The slicing engine runs entirely in the browser via WebAssembly. There is no cloud upload, no account, and no waiting on a server. Slice in the same tab you designed in, inspect the toolpath, and send G-code directly to your printer — all offline-capable.',
  },
  {
    icon: ListChecks,
    color: '#059669',
    tag: 'Slicer + Print',
    title: 'Object cancellation wired end-to-end',
    body: 'The slicer automatically emits M486 and EXCLUDE_OBJECT labels per object. In the printer panel, cancellation is surfaced in three places: a dedicated tab, the live dashboard list, and a 3D print-preview viewport with right-click context menus. Works on Duet ≥ 3.5, Marlin ≥ 2.0.9, and all Klipper versions.',
  },
  {
    icon: Shapes,
    color: '#0f7c83',
    tag: 'Print farm',
    title: 'Smart queue that routes jobs to the right printer',
    body: 'The job queue auto-routes by build volume, loaded material, nozzle size, and profile compatibility. Distribute N copies across available printers in one click. Drag-reorder, move jobs mid-print, and pause the entire fleet. No other open-source tool matches this.',
  },
  {
    icon: SwitchCamera,
    color: '#d97706',
    tag: 'Print farm',
    title: 'A/B cross-printer comparison',
    body: 'Run the same G-code on two printers in parallel, then get a side-by-side timing dashboard showing per-layer deltas and a summary of which printer is faster or more consistent. Unique to Cindr3D.',
  },
  {
    icon: Film,
    color: '#dc2626',
    tag: 'Camera',
    title: 'Per-layer photo gallery with ZIP export',
    body: 'A snapshot is captured automatically on every layer change, keyed by printer, job, and layer number. Scroll through the gallery to find exactly when a failure started. Export the full set as a ZIP for archival or time-lapse post-processing.',
  },
  {
    icon: BrainCircuit,
    color: '#9333ea',
    tag: 'AI',
    title: 'AI that actually executes — not just advises',
    body: 'The local MCP bridge gives Claude, GPT-4, or any MCP-compatible client real control over 29 tools: create geometry, adjust slicer profiles, trigger a slice, start or cancel a print. Other tools let AI answer questions. Cindr3D lets AI do the work.',
  },
  {
    icon: Wifi,
    color: '#475569',
    tag: 'Architecture',
    title: 'Direct to hardware — no relay, no cloud, no subscription',
    body: 'All communication is browser-to-printer over your LAN. Your G-code, camera feeds, and settings never leave your network. MIT licensed with no tiers, no telemetry, and no account required.',
  },
];

const faqs = [
  {
    q: 'Do I need a 3D printer to use it?',
    a: 'No. The CAD workspace, slicer, G-code preview, and AI tools all work in the browser without any hardware. Connect a printer when you are ready — or use it purely as a browser CAD and slicer tool.',
  },
  {
    q: 'Which firmwares are supported?',
    a: 'Duet / RepRapFirmware (via the RRF HTTP API), Klipper / Moonraker (via the Moonraker REST API), and Marlin (via WebSerial over USB). The same control panel UI works across all three.',
  },
  {
    q: 'What cameras work?',
    a: 'Any camera that serves an MJPEG stream or a WebRTC endpoint. PTZ control works with ONVIF-compatible cameras including Reolink, Tapo, Hikvision, and Amcrest. Per-layer snapshots work with any reachable stream URL.',
  },
  {
    q: 'Is it really free?',
    a: 'Yes. MIT license — you can use it, fork it, modify it, and self-host it for free. There are no tiers, no paid plans, and no telemetry.',
  },
  {
    q: 'How do I self-host it?',
    a: 'Build the project with `npm run build`, then serve the `dist` folder from any static host. For Orange Pi, the included auto-updater script installs a systemd service that polls GitHub releases and updates automatically.',
  },
  {
    q: 'How does the AI integration work?',
    a: 'A local MCP (Model Context Protocol) server starts alongside the dev server. Any MCP-compatible client — Claude Desktop, Cursor, or the built-in chat panel — can call 29 tools covering CAD creation, slicing, and printer control. You bring your own API key.',
  },
];

const v2Highlights = [
  {
    icon: Shapes,
    label: 'Parametric CAD workspace',
    detail: 'Built-in parametric models, named design configurations, mesh repair, threading presets, and non-destructive boolean history bring the Design workspace closer to mature desktop CAD.',
  },
  {
    icon: BrainCircuit,
    label: 'AI assistant + MCP bridge',
    detail: 'Local MCP server with token-paired auth and a 29-tool surface covering primitives, sketches, features, booleans, transforms, and export. BYOK chat panel supporting Anthropic and OpenAI/OpenRouter streaming.',
  },
  {
    icon: Zap,
    label: 'Cross-firmware unification',
    detail: 'Bed Map, Exclude Object, Input Shaper, Pressure Advance, Spools, Timelapse, Power, and Updates all routed through universal wrappers that delegate to Duet/RRF, Klipper/Moonraker, Marlin/USB, and others.',
  },
  {
    icon: Wifi,
    label: 'Workshop integrations',
    detail: 'Webhook, Discord, Slack, Telegram, MQTT, and Home Assistant bridges publish print events, telemetry, progress, temperatures, and remote pause/resume/cancel actions from the local app.',
  },
  {
    icon: FlaskConical,
    label: 'Enclosure and sensor safety',
    detail: 'Chamber temperature control, ramp curves, print-start preheat, completion cooldown, door-open cooldown, VOC/PM2.5/CO2 MQTT thresholds, and enclosure door pause/start-lock policies.',
  },
  {
    icon: Sliders,
    label: 'Stepper driver tuning',
    detail: 'Per-axis current, microsteps, StealthChop/SpreadCycle mode, firmware command wrappers, quick wiggle tests, and per-printer presets live directly on the dashboard.',
  },
  {
    icon: ListChecks,
    label: 'Mid-print object cancellation',
    detail: 'Surfaced in three places: a dedicated tab, the dashboard list, and a 3D preview viewport with right-click menus. Supports M486 (Duet >= 3.5, Marlin >= 2.0.9) and EXCLUDE_OBJECT (Klipper). Slicer emits labels automatically.',
  },
  {
    icon: Gauge,
    label: 'Cross-firmware layer awareness',
    detail: 'Moonraker getPrintStatus() for live progress. Duet serial parses M73 and echo:Layer N/M into the unified model so layer counters and ETAs work identically across all firmware targets.',
  },
  {
    icon: Film,
    label: 'Print farm foundations',
    detail: 'Smart queue with drag-reorder, auto-routing, and copy-distribution across printers. All-cameras grid with per-tile overlays, PTZ presets, multi-camera per printer, and a per-layer photo gallery with ZIP export.',
  },
  {
    icon: MoveHorizontal,
    label: 'A/B cross-printer comparison',
    detail: 'Run the same G-code on two printers in parallel, compare side-by-side layer timing deltas, and produce a quality report on which printer is faster or more consistent.',
  },
];

const milestones = [
  {
    phase: 'Phase 8',
    icon: CameraOff,
    title: 'Vision and AI diagnostics',
    items: [
      'Failure detection — spaghetti, layer-shift, blob-of-doom, adhesion with auto-pause',
      '"What\'s wrong with my print?" AI diagnostics aggregating frames, temps, and slicer timing',
      'Auto-tune wizards for pressure advance, retraction, temperature, and first-layer squish',
      'Camera measurement tool with homography-based real-world distance readout',
    ],
  },
  {
    phase: 'Phase 9',
    icon: SwitchCamera,
    title: 'AR camera overlay',
    items: [
      'Toolpath wireframe composited over the live camera feed at full frame rate',
      'Right-click object cancel from the camera view using inverse-projected bed coordinates',
      'Post-print AR comparison: frozen final frame with model wireframe overlay and mismatch highlights',
    ],
  },
  {
    phase: 'Phase 10',
    icon: Zap,
    title: 'Cost and energy tracking',
    items: [
      'Cost-per-print from filament price and smart-plug wattage with live ticker',
      'Off-peak scheduling with TOU rate editor and optional utility API integration',
      'Solar-aware printing gated on Powerwall / Enphase / SolarEdge surplus',
      'Sustainability dashboard: kg filament, kWh, CO2 estimates with CSV export',
    ],
  },
  {
    phase: 'Phase 11',
    icon: Timer,
    title: 'Maintenance lifecycle',
    items: [
      'Calibration aging dashboard with recommended re-cal intervals and overdue alerts',
      'Wear tracking for belts, bearings, nozzles, and hotends with full service log',
      'Filament moisture model with ambient humidity tracking and pre-print drying warnings',
    ],
  },
  {
    phase: 'Phase 12',
    icon: FlaskConical,
    title: 'Scheduling',
    items: [
      'Print scheduling calendar with drag-to-schedule and quiet-hours awareness',
      'Bed-clearing auto-queue with printer-ready checks',
      'Pre-flight checklist before queued jobs start',
    ],
  },
  {
    phase: 'Phase 13',
    icon: Code2,
    title: 'Integrations and enclosure operations',
    items: [
      'Webhook, Discord, Slack, Telegram, MQTT, and Home Assistant event bridges',
      'Profile import from Cura / OrcaSlicer / Bambu Studio and 3MF plate round-trip',
      'Power-loss recovery with resumable file-position restore',
      'Chamber, air-quality, door/enclosure, and stepper-driver dashboard controls',
    ],
  },
  {
    phase: 'Phase 14',
    icon: Sparkles,
    title: 'Polish and platform',
    items: [
      'PWA mode — installable, offline-capable, custom splash screen',
      'Mobile and tablet UI with bottom-sheet nav and one-thumb kiosk mode',
      'i18n, accessibility audit, high-contrast theme, and reduced-motion mode',
      'Profile versioning with diff viewer and cherry-pick restore',
    ],
  },
];

const PAGE_COLORS: Record<string, string> = {
  Design: '#7c3aed',
  Prepare: '#0284c7',
  '3D Printer': '#059669',
  Camera: '#d97706',
  Settings: '#475569',
  Platform: '#dc2626',
  'AI and Help': '#9333ea',
};


function FeatureDirectory() {
  const workspacePages = Array.from(new Set(featureGroups.map((g) => g.page)));
  const pages = ['Summary', 'All', ...workspacePages];
  const [activePage, setActivePage] = useState('Summary');

  const countByPage = Object.fromEntries(
    workspacePages.map((p) => [
      p,
      featureGroups.filter((g) => g.page === p).reduce((n, g) => n + g.details.length, 0),
    ]),
  );
  const totalCount = featureGroups.reduce((n, g) => n + g.details.length, 0);

  const visibleGroups = activePage === 'All' || activePage === 'Summary'
    ? featureGroups
    : featureGroups.filter((g) => g.page === activePage);

  return (
    <section className="home-band home-band--features" id="features" aria-labelledby="features-title">
      <div className="home-section-heading">
        <p>Complete feature list</p>
        <h2 id="features-title">Everything Cindr3D does</h2>
      </div>

      <div className="fd-filters" role="group" aria-label="Filter by workspace">
        {pages.map((page) => {
          const count = page === 'Summary'
            ? featureGroups.length
            : page === 'All'
              ? totalCount
              : countByPage[page];
          const isActive = activePage === page;
          const color = PAGE_COLORS[page];
          return (
            <button
              key={page}
              className={`fd-filter-tab${isActive ? ' fd-filter-tab--active' : ''}`}
              onClick={() => setActivePage(page)}
              aria-pressed={isActive}
              style={isActive && color ? ({ '--ft-color': color } as React.CSSProperties) : undefined}
            >
              {page}
              <span className="fd-filter-tab__count">{count}</span>
            </button>
          );
        })}
      </div>

      {activePage === 'Summary' ? (
        <div className="fd-summary-grid">
          {featureGroups.map((group) => {
            const Icon = group.icon;
            const color = PAGE_COLORS[group.page] ?? '#f06c3f';
            return (
              <div
                className="fd-summary-card"
                key={`${group.page}-${group.section}`}
                style={{ '--fd-color': color } as React.CSSProperties}
              >
                <div className="fd-summary-card__header">
                  <div className="fd-summary-card__icon"><Icon size={16} /></div>
                  <div>
                    <span className="fd-summary-card__page">{group.page}</span>
                    <h3 className="fd-summary-card__name">{group.section}</h3>
                  </div>
                </div>
                <ul className="fd-summary-card__list">
                  {group.details.map((feat) => (
                    <li key={feat.title}>{feat.title}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="fd-table">
          {visibleGroups.map((group) => {
            const Icon = group.icon;
            const color = PAGE_COLORS[group.page] ?? '#f06c3f';
            return (
              <div
                className="fd-row"
                key={`${group.page}-${group.section}`}
                style={{ '--fd-color': color } as React.CSSProperties}
              >
                <div className="fd-row__head">
                  <div className="fd-row__meta">
                    <div className="fd-row__icon"><Icon size={15} /></div>
                    <span className="fd-row__page">{group.page}</span>
                  </div>
                  <h3 className="fd-row__name">{group.section}</h3>
                  <p className="fd-row__summary">{group.summary}</p>
                  <span className="fd-row__count">{group.details.length} features</span>
                </div>
                <ul className="fd-row__features">
                  {group.details.map((feat) => {
                    const FeatIcon = feat.icon;
                    return (
                      <li key={feat.title} className="fd-feat">
                        <div className="fd-feat__head">
                          <span className="fd-feat__ico" aria-hidden="true"><FeatIcon size={13} /></span>
                          <h4 className="fd-feat__title">{feat.title}</h4>
                        </div>
                        <p className="fd-feat__body">{feat.body}</p>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ReleaseRoadmapTabs() {
  type ReleaseTab = 'shipped' | 'roadmap';
  const [tab, setTab] = useState<ReleaseTab>('shipped');

  function handleKey(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    setTab((current) => current === 'shipped' ? 'roadmap' : 'shipped');
  }
  return (
    <section className="home-band home-band--release" id="v2" aria-labelledby="release-title">
      <div className="rrtabs" style={{ width: 'min(1180px, calc(100% - 40px))', margin: '0 auto' }}>
        <div className="rrtabs__head">
          <div className="home-section-heading" style={{ margin: 0 }}>
            <p>{tab === 'shipped' ? 'Next version' : 'Future planning'}</p>
            <h2 id="release-title">{tab === 'shipped' ? 'Release highlights' : 'Upcoming milestones'}</h2>
          </div>
          <div className="rrtabs__nav" role="tablist">
            <button role="tab" aria-selected={tab === 'shipped'} className={`rrtabs__tab${tab === 'shipped' ? ' rrtabs__tab--active' : ''}`} onClick={() => setTab('shipped')} onKeyDown={handleKey}>
              Next release
            </button>
            <button role="tab" aria-selected={tab === 'roadmap'} className={`rrtabs__tab${tab === 'roadmap' ? ' rrtabs__tab--active' : ''}`} onClick={() => setTab('roadmap')} onKeyDown={handleKey}>
              Roadmap
            </button>
          </div>
        </div>

        {tab === 'shipped' && (
          <div className="v2-grid">
            {v2Highlights.map((h) => {
              const Icon = h.icon;
              return (
                <article className="v2-card" key={h.label}>
                  <div className="v2-card__icon"><Icon size={18} /></div>
                  <div>
                    <h3>{h.label}</h3>
                    <p>{h.detail}</p>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {tab === 'roadmap' && (
          <div className="roadmap-grid">
            {milestones.map((m) => {
              const Icon = m.icon;
              return (
                <article className="roadmap-card" key={m.phase}>
                  <div className="roadmap-card__header">
                    <span className="roadmap-card__phase"><Rocket size={12} />{m.phase}</span>
                  </div>
                  <div className="roadmap-card__title-row">
                    <Icon size={18} className="roadmap-card__icon" />
                    <h3>{m.title}</h3>
                  </div>
                  <ul>
                    {m.items.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function WorkspaceTabs() {
  const [active, setActive] = useState(0);
  const wf = workflows[active];

  function handleKey(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    setActive((current) =>
      e.key === 'ArrowRight'
        ? (current + 1) % workflows.length
        : (current - 1 + workflows.length) % workflows.length,
    );
  }

  return (
    <div className="wstabs" style={{ '--ws-color': wf.color } as React.CSSProperties}>
      <div className="wstabs__nav" role="tablist">
        {workflows.map((w, i) => (
          <button
            key={w.title}
            role="tab"
            aria-selected={i === active}
            className={`wstabs__tab${i === active ? ' wstabs__tab--active' : ''}`}
            style={i === active ? { '--ws-color': w.color } as React.CSSProperties : undefined}
            onClick={() => setActive(i)}
            onKeyDown={handleKey}
          >
            {w.title}
          </button>
        ))}
      </div>
      <div className="wstabs__panel" key={active}>
        <div className="wstabs__media">
          <img src={wf.image} alt={`${wf.title} workspace`} />
        </div>
        <div className="wstabs__body">
          <p className="wstabs__copy">{wf.copy}</p>
          <div className="wstabs__sections">
            {wf.sections.map((section) => (
              <div key={section.label} className="wstabs__section">
                <p className="wstabs__section-label">{section.label}</p>
                <ul className="wstabs__list">
                  {section.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('');
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const sections = document.querySelectorAll<HTMLElement>('section[id], div[id]');
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => { if (e.isIntersecting) setActiveSection(e.target.id); });
      },
      { rootMargin: '-40% 0px -55% 0px' },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 600);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const navLinks = [
    { href: '#workflows', label: 'Workflows' },
    { href: '#features', label: 'Features' },
    { href: '#why', label: 'Why Cindr3D' },
    { href: '#v2', label: 'Release' },
    { href: '#faq', label: 'FAQ' },
    { href: '#how-to-use', label: 'Get started' },
  ];

  return (
    <main className="home-page">
      <section className="home-hero" aria-labelledby="home-hero-title">
        <div className="home-hero__media" aria-hidden="true" />
        <nav className="home-nav" aria-label="Site navigation">
          <a className="home-nav__brand" href="/home">
            <img src="/logo.png" alt="" />
            <span>Cindr3D</span>
          </a>
          <div className={`home-nav__links${menuOpen ? ' home-nav__links--open' : ''}`}>
            {navLinks.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className={activeSection === l.href.slice(1) ? 'home-nav__link--active' : ''}
                onClick={() => setMenuOpen(false)}
              >
                {l.label}
              </a>
            ))}
            <a href="/" className="home-button home-button--primary home-nav__cta" style={{ minHeight: 32, padding: '0 14px', fontSize: 13 }}>
              Open app
            </a>
          </div>
          <button
            className="home-nav__burger"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </nav>
        <div className="home-hero__content">
          <div className="home-hero__left">
            <div className="home-hero__brand">
              <img src="/logo.png" alt="" className="home-hero__logo" aria-hidden="true" />
              <h1 id="home-hero-title" className="home-hero__wordmark">Cindr3D</h1>
            </div>
            <p className="home-kicker"><Sparkles size={13} /> Open-source · Browser-native · Self-hosted</p>
            <p className="home-hero__lede">
              Design parts, prepare prints, and run a fleet of 3D printers from a single browser workspace.
            </p>
            <div className="home-hero__firmware-chips" aria-label="Supported firmwares">
              <span><Printer size={12} /> Duet / RRF</span>
              <span><Cpu size={12} /> Klipper</span>
              <span><Usb size={12} /> Marlin</span>
              <span><Wifi size={12} /> LAN direct</span>
              <span><Video size={12} /> MJPEG + WebRTC</span>
            </div>
          </div>
          <div className="home-hero__right">
            <div className="home-hero__actions" aria-label="Primary actions">
              <a className="home-button home-button--primary" href="/">
                Open the demo <ChevronRight size={16} />
              </a>
              <a className="home-button home-button--secondary" href="https://github.com/exzile/Cindr3D" target="_blank" rel="noreferrer">
                <GitBranch size={15} /> View on GitHub
              </a>
              <a className="home-button home-button--secondary" href="https://github.com/exzile/Cindr3D/releases/latest" target="_blank" rel="noreferrer">
                Latest release <ExternalLink size={15} />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Stats strip */}
      <div className="home-stats-strip" aria-label="At a glance">
        {stats.map((s) => (
          <div className="home-stat" key={s.label}>
            <span className="home-stat__value">{s.value}</span>
            <span className="home-stat__label">{s.label}</span>
            <span className="home-stat__sub">{s.sub}</span>
          </div>
        ))}
      </div>

      {/* Workflows */}
      <section className="home-band home-band--intro" id="workflows" aria-labelledby="workflow-title">
        <div className="home-section-heading">
          <p>Connected pages and workspaces</p>
          <h2 id="workflow-title">From model to monitored print</h2>
        </div>
        <WorkspaceTabs />
      </section>

      <FeatureDirectory />

      {/* Why Cindr3D */}
      <section className="home-band home-band--why" id="why" aria-labelledby="why-title">
        <div className="home-section-heading">
          <p>Features other tools don't have</p>
          <h2 id="why-title">Why Cindr3D</h2>
        </div>
        <div className="why-grid">
          {whyItems.map((w) => {
            const Icon = w.icon;
            return (
              <article className="why-card" key={w.title} style={{ '--why-color': w.color } as React.CSSProperties}>
                <div className="why-card__icon"><Icon size={20} /></div>
                <div className="why-card__body">
                  <span className="why-card__tag">{w.tag}</span>
                  <h3>{w.title}</h3>
                  <p>{w.body}</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Release + Roadmap combined */}
      <ReleaseRoadmapTabs />

      {/* FAQ */}
      <section className="home-band home-band--faq" id="faq" aria-labelledby="faq-title">
        <div className="home-section-heading">
          <p>Common questions</p>
          <h2 id="faq-title">FAQ</h2>
        </div>
        <div className="faq-list">
          {faqs.map((faq) => (
            <details key={faq.q} className="faq-item">
              <summary className="faq-item__question">
                <ChevronRight size={15} className="faq-item__chevron" />
                {faq.q}
              </summary>
              <p className="faq-item__answer">{faq.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="home-band home-band--deploy" id="how-to-use" aria-labelledby="deploy-title">
        <div className="deploy-panel">
          <div className="deploy-panel__text">
            <p className="home-kicker"><GitBranch size={15} /> MIT licensed · Self-hosted · No cloud</p>
            <h2 id="deploy-title">Your workshop, your hardware</h2>
            <p>
              Deploy to any static host, NAS, Raspberry Pi, or Orange Pi. Start in the browser with CAD and the slicer — no hardware needed. Connect printers over LAN when you're ready.
            </p>
            <ol className="deploy-steps">
              {useSteps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </div>
          <div className="deploy-panel__actions">
            <a className="home-button home-button--primary" href="/">
              Launch Cindr3D <Cpu size={18} />
            </a>
            <a className="home-button home-button--light" href="https://github.com/exzile/Cindr3D" target="_blank" rel="noreferrer">
              <GitBranch size={16} /> View on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="home-footer">
        <div className="home-footer__inner">
          <div className="home-footer__brand">
            <img src="/logo.png" alt="" />
            <span>Cindr3D</span>
          </div>
          <p className="home-footer__copy">
            MIT licensed · Open source · No telemetry · No cloud
          </p>
          <div className="home-footer__links">
            <a href="https://github.com/exzile/Cindr3D" target="_blank" rel="noreferrer"><GitBranch size={14} /> GitHub</a>
            <a href="https://github.com/exzile/Cindr3D/releases" target="_blank" rel="noreferrer"><ExternalLink size={14} /> Releases</a>
            <a href="https://github.com/exzile/Cindr3D/issues" target="_blank" rel="noreferrer">Issues</a>
            <a href="https://github.com/exzile/Cindr3D/blob/master/LICENSE" target="_blank" rel="noreferrer">License</a>
          </div>
        </div>
      </footer>

      {/* Scroll-to-top */}
      {showScrollTop && (
        <button
          className="scroll-top-btn"
          aria-label="Scroll to top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <ArrowUp size={18} />
        </button>
      )}
    </main>
  );
}
