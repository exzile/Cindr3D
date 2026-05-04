import { BookOpen, ChevronDown, Search, X } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import './AppHelpModal.css';

interface ShortcutEntry { keys: string; action: string }

interface HelpSection {
  heading: string;
  intro?: string;
  image?: { src: string; alt: string; caption?: string };
  items?: string[];
  shortcuts?: ShortcutEntry[];
  notes?: string[];
}

interface HelpTopic {
  id: string;
  title: string;
  summary: string;
  group?: string;
  sections: HelpSection[];
}

const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'start',
    title: 'Getting started',
    summary: 'A tour of the workspaces, the top bar, and the menus you reach for most often.',
    sections: [
      {
        heading: 'Workspaces',
        intro: 'Cindr3D splits work into three workspaces. Use the workspace selector at the top-left to switch.',
        items: [
          'Design — the CAD modeller. Sketch, build solid features, assemble components, and inspect geometry.',
          'Prepare — the slicer. Lay parts out on a build plate, choose printer + material profiles, slice, preview, and export G-code.',
          '3D Printer — the fleet console. Manage printers, watch live cameras, send G-code, view job progress, manage files and macros, and configure each printer.',
        ],
      },
      {
        heading: 'Top bar',
        intro: 'The top bar is the same on every page. From left to right:',
        items: [
          'Workspace selector — jump between Design, Prepare, and 3D Printer.',
          'Ribbon — context-sensitive tools for the active workspace.',
          'File menu — open, save, import, export, and settings-bundle actions.',
          'Quick access bar (right side) — gear (global settings), bell (notifications + site updates), question mark (this help guide), and the theme toggle.',
        ],
      },
      {
        heading: 'Files',
        intro: 'Documents and settings move through the same File menu.',
        items: [
          'Open Design / Save Design — read or write a CAD design file.',
          'Save Settings — write the active workspace section to the current bundle.',
          'Save Settings As — branch into a new bundle so you can keep variations.',
          'Load Settings — restore a saved bundle. Bundles are portable across machines.',
        ],
      },
      {
        heading: 'Theme',
        items: [
          'Light/dark theme toggle lives in the top bar. Your choice persists per browser.',
          'Most colours are driven by CSS custom properties so switching themes is instant.',
        ],
      },
    ],
  },

  {
    id: 'design',
    title: 'Design workspace',
    summary: 'Sketches, solid features, components, the timeline, and viewport navigation.',
    group: 'Design',
    sections: [
      {
        heading: 'Modeling flow',
        intro: 'A typical part starts as a sketch on a plane or planar face, then is built up with solid features.',
        image: { src: '/help/help-design-overview.png', alt: 'Design workspace showing the ribbon with Create and Modify tools, the component browser, 3D viewport, and timeline', caption: 'Design workspace — browser (left), 3D viewport (centre), timeline (right), ribbon tools (top).' },
        items: [
          'Pick a plane (XY, XZ, YZ) or click an existing flat face, then start a sketch.',
          'Draw 2D geometry, add constraints to lock intent, and dimension to drive size.',
          'Finish the sketch, then create a feature: Extrude, Revolve, Sweep, Loft, Rib, Web, Emboss, or Patch.',
          'Use Modify to refine: Fillet, Chamfer, Shell, Draft, Scale, Combine (boolean), Offset Face, Replace Face, Direct Edit, Split Face/Body.',
          'Use Construct to add reference geometry: planes (offset, angle, tangent, midplane, perpendicular), axes, and points.',
        ],
      },
      {
        heading: 'Components and the tree',
        items: [
          'The component tree on the left lists bodies, sketches, components, and reference geometry.',
          'Right-click any node for show/hide, isolate, rename, duplicate, and delete.',
          'Multi-select with Shift / Ctrl to operate on several nodes at once.',
        ],
      },
      {
        heading: 'Timeline',
        items: [
          'The timeline at the bottom is the feature history in creation order.',
          'Roll back to inspect or edit an earlier feature; the model rebuilds when you return.',
          'Right-click a feature to suppress, delete, or edit the parameters that created it.',
        ],
      },
      {
        heading: 'Viewport navigation',
        items: [
          'Orbit — middle-mouse drag (or right-mouse drag depending on input mapping).',
          'Pan — Shift + middle-mouse drag.',
          'Zoom — mouse wheel, or pinch on a trackpad.',
          'View cube (top-right of the viewport) snaps to standard orthographic views.',
          'Selection filters narrow picks when bodies, faces, edges, sketches, or profiles overlap.',
          'The status bar at the bottom shows the active command and the next expected pick.',
        ],
      },
      {
        heading: 'Inspection',
        intro: 'The Inspect ribbon contains analysis tools that don\'t modify geometry.',
        items: [
          'Measure — distance, angle, position between picks; live preview while picking.',
          'Interference — find overlapping bodies in an assembly.',
          'Curvature / Zebra / Draft / Accessibility — surface analysis overlays.',
          'Section — slice the model with a plane to see internal geometry.',
        ],
      },
    ],
  },

  {
    id: 'sketch',
    title: 'Sketching and dimensions',
    summary: 'Every draw tool, constraint type, dimension type, and the exit-and-feature workflow.',
    group: 'Design',
    sections: [
      {
        heading: 'Starting a sketch',
        intro: 'Every sketch lives on a plane. You can sketch on the origin planes (XY, XZ, YZ), a planar face of an existing body, or a custom construction plane.',
        image: { src: '/help/help-sketch-mode.png', alt: 'Design workspace in sketch mode on the XY plane, with sketch ribbon and palette visible', caption: 'Sketch mode — the ribbon switches to sketch tools and the Sketch Palette floats on the right. The status bar shows the active plane.' },
        items: [
          'Click Sketch in the Create ribbon, or press S.',
          'Pick a plane or planar face — the viewport tilts to an orthographic view aligned to that plane.',
          'The ribbon switches to the Sketch toolbar with all 2D draw, constrain, and dimension commands.',
          'A reference frame marks the sketch origin; horizontal and vertical axes are shown as dashed lines.',
          'To exit sketch mode at any time, click Finish Sketch or press Esc.',
        ],
      },
      {
        heading: 'Line and arc tools',
        intro: 'The most-used drawing primitives. They chain together automatically in a single command.',
        image: { src: '/help/help-sketch-ribbon.png', alt: 'Sketch ribbon showing Line, Rectangle, Fillet, Chamfer, Dimension, Coincident, Grid, and Snap tools', caption: 'Sketch ribbon — Draw tools (left), Modify, Constraints, Configure, and Finish Sketch (right).' },
        items: [
          'Line (L) — click to place the start point, click again for each endpoint. The line chains automatically. Esc ends the chain without closing it.',
          'Arc — 3-point (click start, end, and a midpoint on the curve) or center+radius (click center, then radius, then arc extent).',
          'Polyline — a connected chain of line and arc segments. Press A mid-chain to switch between line and arc mode.',
          'Tangent Arc — draws an arc tangent to the last line or arc segment in the chain.',
          'Hold Shift while placing to force horizontal or vertical alignment on the current segment.',
        ],
      },
      {
        heading: 'Rectangle and circle tools',
        items: [
          'Rectangle (R) — two-corner: click diagonally opposite corners.',
          'Center Rectangle — click the center, then a corner. Useful for symmetric parts.',
          'Circle (C) — center + radius: click center, then drag or type the radius.',
          '3-Point Circle — click three points on the circumference. Useful when the center is unknown.',
          '2-Point Circle — click two endpoints of a diameter.',
          'Ellipse — click the center, set the major radius along one axis, then set the minor radius.',
        ],
      },
      {
        heading: 'Polygon, slot, and spline',
        items: [
          'Polygon — inscribed or circumscribed. Set the number of sides in the dialog (3–96), click the center, then set the radius.',
          'Slot (straight) — click the two centerline endpoints, then set the width.',
          'Slot (center-point) — click the center, one endpoint, then the width.',
          'Arc Slot / 3-Point Arc Slot — the centerline follows an arc path. Three clicks define the arc.',
          'Spline — control-point curve. Click to place each control handle. The curve passes near the handles.',
          'Fit-Point Spline — the curve passes exactly through each clicked point. Useful for tracing scanned profiles.',
          'Conic — a conic section with a controllable Rho value. Rho < 0.5 gives an ellipse, 0.5 a parabola, and > 0.5 a hyperbola.',
        ],
      },
      {
        heading: 'Editing tools',
        items: [
          'Sketch Fillet (F) — click two lines or a corner vertex to insert a tangent arc fillet. Type a radius in the dialog.',
          'Trim (T) — click a segment to remove it up to the nearest intersecting curves. Works on lines, arcs, circles, and splines.',
          'Extend — hover over a segment endpoint; click to extend it to the next intersection.',
          'Offset (O) — select one or more curves, enter a distance, choose inside or outside. Creates a parallel copy at the given distance.',
          'Mirror — select entities, then pick a mirror line. Creates a symmetric copy; optionally link the originals so both sides update together.',
          'Move / Copy (M) — translate sketch geometry by a delta vector. Copy mode leaves the originals in place.',
          'Scale — scale selected entities about a pivot point by a factor.',
          'Rotate — rotate selected entities about a point by an angle.',
          'Project (P) — pull edges, vertices, or silhouettes from existing 3D geometry into the sketch plane as reference curves.',
          'Include 3D Geometry — same as Project but inserts curves as fully editable entities rather than locked references.',
          'Text — places a typographic profile. Set the string, font, size, and angle in the dialog. Closed letter forms produce filled profiles suitable for embossing or engraving.',
        ],
      },
      {
        heading: 'Geometric constraints',
        intro: 'Constraints lock relationships between entities. Select the entities first, then click the constraint button. Constraints turn entities black when fully resolved.',
        items: [
          'Horizontal — forces a line to be parallel to the X axis.',
          'Vertical — forces a line to be parallel to the Y axis.',
          'Parallel — forces two lines to be parallel to each other.',
          'Perpendicular — forces two lines to meet at 90°.',
          'Tangent — forces a line/arc/spline to be tangent to an arc or circle at the contact point.',
          'Coincident — forces two points (endpoints, arc centers) to share the same location.',
          'Equal — forces two lines to have the same length, or two arcs/circles to have the same radius.',
          'Concentric — forces two arcs or circles to share the same center point.',
          'Symmetric — forces two entities to be mirror images about a chosen axis or line.',
          'Fix — pins a point or entity to its current absolute position. Use sparingly; dimensions are usually a better driver.',
          'Collinear — forces two lines to lie on the same infinite line.',
          'Midpoint — forces a point to remain on the midpoint of a line segment.',
          'Smooth (G2) — forces a spline junction to have matching curvature (G2 continuity), not just tangency.',
        ],
        notes: [
          'Over-constrained sketches turn red — remove the conflicting constraint or dimension to recover. Right-click the sketch → Show Sketch Doctor to highlight the conflict.',
          'Under-constrained entities appear in a lighter colour. They can drift when downstream features drive them, causing unexpected rebuilds.',
        ],
      },
      {
        heading: 'Dimensions',
        intro: 'Press D (or click Sketch Dimension) then click entities to place a driving dimension. The geometry resizes immediately when you accept the value.',
        items: [
          'Linear — click two points, or click a horizontal or vertical line directly. Measures horizontal or vertical extent.',
          'Aligned — measures the true point-to-point distance regardless of angle, following the line between the two points.',
          'Radial — click an arc to set its radius.',
          'Diameter — click a circle (or arc) to set its diameter.',
          'Angular — click two lines that share a vertex; place the dimension arc on the angle you want to drive.',
          'Edit a value — double-click any dimension to reopen the editor. You can enter expressions (50/2) or reference named model parameters.',
          'A fully constrained sketch shows all entities in the same resolved colour (black or dark grey). That sketch is ready to use as a feature profile.',
        ],
      },
      {
        heading: 'Sketch palette and display toggles',
        image: { src: '/help/help-sketch-palette.png', alt: 'Sketch Palette panel showing Linetype, Look At, Grid & Snap toggles, and Finish Sketch button', caption: 'Sketch Palette — toggle grid, snap, profile shading, constraint visibility, and look-at from here.' },
        items: [
          'Toggle Construction (Q) — switches selected entities to dashed reference lines. Construction geometry participates in constraints and dimensions but is not used as a feature profile.',
          'Look At — rotates the viewport to look directly at the sketch plane. Helpful when the sketch was started on a tilted face.',
          'Profile shading — highlights closed regions that form valid extrude profiles with a light fill so you can see which areas the slicer would use.',
          'Show Constraints — toggles constraint icons on every entity. Useful for diagnosing which relationships are in play.',
          'Grid Snap — snaps cursor to the sketch grid. Toggle from the palette or the status bar.',
          'Point Snap — independent snap to sketch points, intersections, midpoints, and centers regardless of grid setting.',
        ],
      },
      {
        heading: 'Finishing and re-editing',
        items: [
          'Finish Sketch returns to the Design ribbon. Closed profiles immediately become available to Extrude, Revolve, Loft, and other feature commands.',
          'Open profiles can be used as paths for Sweep, Pipe, or Rib.',
          'To re-edit a sketch, double-click it in the component tree or the timeline, or right-click → Edit Sketch.',
          'Downstream features rebuild automatically when you finish editing. Roll back the timeline first if you want to inspect the model at an earlier state.',
          'If a rebuild fails after editing a sketch, the Repair dialog highlights the first feature that cannot resolve and offers to suppress it.',
        ],
      },
    ],
  },

  {
    id: 'prepare',
    title: 'Prepare and slicing',
    summary: 'Build plates, printer + material profiles, slicing, preview, and G-code export.',
    group: 'Prepare',
    sections: [
      {
        heading: 'Workspace layout',
        intro: 'The Prepare workspace has three zones side-by-side, plus a ribbon at the top.',
        image: { src: '/help/help-prepare-overview.png', alt: 'Full Prepare workspace with a model on the build plate', caption: 'Prepare workspace — objects panel (left), 3D build plate (centre), slicer settings (right).' },
        items: [
          'Objects on Plate panel (left) — the list of every model on the current plate, with per-object controls.',
          '3D build plate (centre) — interactive 3D viewport where you position and inspect models.',
          'Slicer Settings panel (right) — all slicing parameters, organised into collapsible groups.',
          'Ribbon (top) — workspace-level actions: BUILD PLATE, PROFILES, SLICE, and EXPORT.',
          'Prepare / Preview tabs (below ribbon) — switch between the layout view and the sliced toolpath viewer.',
        ],
      },
      {
        heading: 'Ribbon tools',
        intro: 'The ribbon groups actions into four sections.',
        image: { src: '/help/help-prepare-ribbon.png', alt: 'Prepare ribbon showing BUILD PLATE, PROFILES, SLICE and EXPORT sections', caption: 'Ribbon — use Add Model, Select, the profile pickers, Slice, and Save G-code from left to right.' },
        items: [
          'BUILD PLATE — Add Model (drag-in or browse), Auto Arrange (pack parts efficiently), Clear Plate, and Select tool.',
          'PROFILES — click the printer profile button to swap printer machines; click the material button to swap filament profiles.',
          'SLICE — Slice runs the slicer engine; Preview switches to the toolpath viewer (enabled after a slice).',
          'EXPORT — Save G-code writes the sliced file to disk; Send to Printer pushes it directly to a connected machine.',
        ],
      },
      {
        heading: 'Adding and arranging models',
        intro: 'Every model on the plate appears in the Objects on Plate panel.',
        image: { src: '/help/help-prepare-objects-panel.png', alt: 'Objects on Plate panel listing the models with their dimensions', caption: 'Objects panel — each row shows the model name, size, and per-object action icons.' },
        items: [
          'Drag an STL / OBJ / 3MF file directly onto the build plate, or click Add Model in the ribbon.',
          'Add from CAD sends the active Design geometry straight into Prepare without exporting a file.',
          'Select a model in the panel or viewport, then use the on-screen gizmo to Move, Rotate, or Scale it.',
          'Auto Arrange packs all plate objects to minimise footprint; useful before slicing a multi-part job.',
          'Per-object icon buttons (visible on hover): toggle visibility, lock, centre, reset transform, and delete.',
          'Check Printability (above viewport) flags parts that are off the bed, intersecting, or at unsupported angles.',
        ],
      },
      {
        heading: 'Printer and material profiles',
        intro: 'Two profiles are always active: one for the printer machine, one for the material.',
        image: { src: '/help/help-prepare-profile.png', alt: 'Profile row showing printer and material profile pickers with a quality preset dropdown', caption: 'Profile row — switch printer and material profile in one click; the quality preset is above.' },
        items: [
          'Printer profile — defines the build volume, kinematics type (Cartesian / CoreXY / Delta), max feedrates, and acceleration limits.',
          'Material profile — defines hotend and bed temperatures, fan speed curve, retraction distance and speed, and flow.',
          'Quality preset (top of Settings panel) — a named combination of layer height and line widths; pick Standard, Fine, or Draft, or enter custom values.',
          'Profiles are independent — any printer can be paired with any material profile.',
          'Create or edit profiles in Settings → Profiles. Changes apply to the current plate immediately.',
        ],
      },
      {
        heading: 'Slicer settings — BASIC / ADVANCED / EXPERT',
        intro: 'The Settings panel on the right shows all slicing parameters, grouped into collapsible sections.',
        image: { src: '/help/help-prepare-settings.png', alt: 'Slicer Settings panel showing QUALITY, LINE WIDTHS, ADAPTIVE LAYERS, WALLS, and INFILL sections', caption: 'Settings panel — switch between BASIC, ADVANCED, and EXPERT tabs to reveal more parameters.' },
        items: [
          'QUALITY — Layer Height, First Layer Height. Lower layer heights give finer detail but longer print times.',
          'LINE WIDTHS — Outer Wall, Inner Wall, Top/Bottom, Support, Infill line widths. Usually 100–120% of nozzle diameter.',
          'ADAPTIVE LAYERS — automatically vary layer height across the model surface to balance speed and quality.',
          'WALLS — number of perimeters, seam position, overhangs, ironing, fuzzy skin.',
          'TOP / BOTTOM — solid layer count, pattern (lines/concentric/Hilbert), and monotonic fill.',
          'INFILL — density (%), pattern (Grid, Gyroid, Honeycomb, Lightning, …), and gradual infill for strength without weight.',
          'SUPPORT — enable, angle threshold, type (normal / tree), interface layers, and Z-distance.',
          'Search box — type any setting name to filter the list instantly.',
          'The ⓘ icon next to each field opens an explanation tooltip.',
        ],
        notes: [
          'EXPERT tab exposes parameters like seam position scoring, bridge flow, ironing speed, and Arachne variable-width walls. These are safe to ignore until you\'ve dialled in the basics.',
        ],
      },
      {
        heading: 'Slicing',
        intro: 'Click Slice (ribbon or the blue button at the bottom-left) to generate toolpaths.',
        items: [
          'Progress is shown in the status bar at the bottom of the window — the rest of the UI stays responsive.',
          'Slice time depends on model complexity, layer height, support volume, and the number of objects on the plate.',
          'When slicing completes the Preview tab activates automatically and the print-time estimate appears.',
          'Re-slicing after a settings change discards the previous result — there is no incremental update.',
        ],
        notes: [
          'If slicing fails, the console log (browser DevTools) shows the geometry or settings issue. The most common cause is a non-manifold mesh — repair it in Design first.',
        ],
      },
      {
        heading: 'Preview and layer inspection',
        intro: 'After slicing, switch to the Preview tab to inspect the toolpath before printing.',
        image: { src: '/help/help-prepare-preview.png', alt: 'Preview tab showing the sliced model with colour-coded toolpaths and a layer slider', caption: 'Preview — colour-coded extrusion paths with a layer slider to step through each layer.' },
        items: [
          'Color mode — cycle through Type (outer wall / inner wall / infill / top/bottom / bridge / support / travel), Speed, Flow, Width, Layer Time, Wall Quality, and Seam.',
          'Layer slider — drag to inspect any layer. The current layer number and Z-height are shown.',
          'Travel moves — shown as thin lines when Color mode includes Travel. Long travel jumps often indicate a retraction or sequence issue.',
          'Print time and filament estimates appear once the preview is loaded; they update if you re-slice with different settings.',
          'Zoom, orbit, and pan work the same as in the Prepare view — right-drag to orbit, scroll to zoom.',
        ],
        notes: [
          'Sparse infill patterns (Lightning, Gyroid) can look incomplete in preview but print correctly — the preview shows every line the slicer generates.',
        ],
      },
      {
        heading: 'Exporting G-code',
        items: [
          'Save G-code (ribbon EXPORT section) writes a standard .gcode file you can copy to an SD card or upload via OctoPrint / Mainsail / Fluidd.',
          'Send to Printer pushes the file directly to a connected printer and optionally starts the print — the printer must be connected in the 3D Printer workspace first.',
          'OrcaSlicer-style ;TYPE: markers are included in the G-code so third-party tools (OctoPrint plugins, Klipper preview) parse feature types correctly.',
          'G-code is a plain text file — you can open it in any text editor to inspect or hand-edit commands.',
        ],
      },
    ],
  },

  {
    id: 'printer',
    title: '3D Printer workspace',
    summary: 'Fleet view, printer monitor, connection setup, camera previews, and per-printer tools.',
    group: '3D Printer',
    sections: [
      {
        heading: 'Fleet dashboard',
        intro: 'Open 3D Printer, then click Printers in the ribbon. This is the landing page for every saved machine.',
        image: { src: '/help/help-printer-fleet.png', alt: 'Printer fleet dashboard with printer card, camera status, monitor, connect, and settings actions', caption: 'Fleet dashboard - each card summarizes one printer and gives quick access to Monitor, Connect, and Settings.' },
        items: [
          'The top counters show total printers, configured printers, connected printers, and saved camera feeds.',
          'Each printer card shows camera preview status, printer name, host, connection state, current tool, bed, uptime, and remaining job time.',
          'Add Printer creates another saved printer profile. Manage lets you rename or delete printers and their optional camera clips.',
          'Monitor opens the selected printer dashboard. Settings opens that printer\'s connection, camera, behaviour, machine, firmware, and backup panels.',
          'Connect is disabled until the printer has enough connection details, usually a host/IP for network mode or a selected USB port for Web Serial mode.',
        ],
      },
      {
        heading: 'Monitor dashboard',
        intro: 'Click Monitor on a printer card to inspect a single printer. The dashboard still works as an offline setup surface before a board is connected.',
        image: { src: '/help/help-printer-monitor.png', alt: 'Printer monitor dashboard with connection panel, files and config shortcuts, and camera panel', caption: 'Monitor dashboard - connection state, printer shortcuts, and the camera panel live together.' },
        items: [
          'The offline state points you to Connection Settings, Files, Config, and Camera so setup is discoverable even before connecting.',
          'When connected, Dashboard shows heaters, axes, current job, uptime, board status, quick controls, and live model data.',
          'The dashboard is a drag-and-resize card grid. Drag panels by their title bar (in edit mode), resize from corner handles, and hide cards you do not use. Layout persists per browser.',
          'Cards include: Camera, Tools, Temperature, Fans, Axis Movement, Extruder, Speed & Flow, Pressure Advance, Input Shaper, Tool Offsets, Workplace Coordinates, Bed Compensation, Restore Points, Macros, Custom Buttons, ATX Power, System Info, Filament Sensors, Object Cancellation (compact list of labelled objects with per-object cancel), and Print Preview (3D viewport with bed, object silhouettes, and toolpath wireframe up to the live print layer; right-click an object for a context menu with stats and per-object cancel).',
          'The context strip names the active printer, host, board mode, and current online/offline state so you can tell which machine you are controlling.',
          'The bottom footer repeats machine status, current tool, uptime, and progress for quick scanning while switching tabs.',
          'Open Camera uses the saved per-printer camera profile and expands into the full camera workspace.',
        ],
      },
      {
        heading: 'Connection settings',
        intro: 'Settings starts on Connection. Use this panel to identify the firmware, transport, preset, host, password, and reconnect behaviour.',
        image: { src: '/help/help-printer-connection-settings.png', alt: 'Printer connection settings with preset, network or USB transport, board type, host, password, and connection mode', caption: 'Connection settings - choose a preset, pick Network or USB, fill the required transport fields, then Test Connection.' },
        items: [
          'Printer Preset patches common machine defaults such as board type, baud rate, build volume, and kinematics. Custom leaves existing settings alone.',
          'Connection Type switches between Network and USB. Network uses the firmware HTTP API; USB uses Web Serial from the browser.',
          'Board Type changes which capabilities Cindr3D expects: Duet/RRF, Klipper, Marlin, Smoothieware, grbl, Repetier, or Other.',
          'Hostname / IP accepts a plain IP or .local name. Leave http:// off unless the field hint says otherwise.',
          'Test Connection probes the board without opening the persistent session. Connect starts the actual live session.',
          'Auto-reconnect can retry dropped network or USB sessions using the configured interval and retry limit.',
        ],
      },
      {
        heading: 'Settings navigation',
        intro: 'The left settings rail keeps every printer-specific setup area in one place.',
        image: { src: '/help/help-printer-settings-navigation.png', alt: 'Printer settings page with left navigation for connection, general, camera, behaviour, notifications, machine, filaments, firmware, PanelDue, backup, and about', caption: 'Settings navigation - every printer has its own saved connection, camera, safety, filament, and backup settings.' },
        items: [
          'General stores name, identity, and day-to-day preferences.',
          'Camera stores network, browser USB, or server USB camera settings for the printer card, monitor, and camera workspace.',
          'Behaviour includes safety limits, auto-reconnect behaviour, sounds, and operational preferences.',
          'Notifications controls alert severity, toast duration, sound, and printer event messages.',
          'Machine stores build volume, kinematics, axes, heaters, and motion-related printer metadata.',
          'Filaments stores per-printer material presets used by dashboard actions and slicer seeding.',
          'Firmware, PanelDue, Backup, and About cover firmware-specific features, touchscreen setup, import/export state, and diagnostics.',
        ],
      },
      {
        heading: 'Per-printer tool tabs',
        intro: 'After a printer is selected/configured, the ribbon exposes deeper printer tabs. The top row covers monitoring and the print itself; the bottom row covers tuning, automation, and per-firmware utilities (collectively the "cross-firmware" tabs - see the Mid-print object cancellation and Print tuning & utilities topics for details).',
        items: [
          'Dashboard - heaters, axes, current job, camera summary, quick controls, plus drag-and-resizable panels including a 3D Print Preview card and an Object Cancellation card.',
          'Camera - live feed, snapshots, recordings, timelapses, overlays, calibration, PTZ, and clip review.',
          'Status and Console - board status plus a G-code console with command history.',
          'Job - active file, layer, progress, time remaining, pause/resume/cancel, and print details.',
          'History and Analytics - previous prints, event history, and aggregate printer performance.',
          'Files - browse, upload, download, delete, and start files on the printer storage.',
          'Filaments - board-side filament library and printer-specific app filament profiles (Duet only).',
          'Macros - saved G-code macros that can be run from the app.',
          'Bed Map - bed mesh probe data and visualisation; routes to RRF heightmap.csv, Klipper bed_mesh, or Marlin G29 internally.',
          'Model and Config - object-model browser and config.g editor for Duet/RRF setups.',
          'Network and Plugins - board network status and Duet Software Framework plugin management where available.',
          'Exclude Object - mid-print object cancellation on Klipper (EXCLUDE_OBJECT), Duet RRF 3.5+ (M486), or Marlin 2.0.9+ (M486 with CANCEL_OBJECTS).',
          'Input Shaper and Pressure Advance - guided resonance and pressure-advance tuning with calibration-tower workflows; emits the right G-code per firmware (M593 / M572 for Duet, SET_INPUT_SHAPER / SET_PRESSURE_ADVANCE for Klipper, M593 / M900 for Marlin).',
          'Power - smart-plug control for Tasmota, Shelly Gen1/Gen2, or generic HTTP devices (printer mains, lights, enclosure fans). Klipper printers also see Moonraker-managed power devices.',
          'Spools - local filament-spool tracker (brand, material, color, weight remaining, active spool); cross-firmware via localStorage. Klipper installs with Spoolman get a dedicated bridge.',
          'Timelapse - in-browser timelapse capture via webcam rendered to WebM client-side; Klipper installs with the moonraker-timelapse plugin get the server-rendered version.',
          'Updates - GitHub release checker for the active firmware (RRF, Klipper, Marlin, Smoothie, Repetier) and for Cindr3D itself. Klipper also shows component-level Moonraker update status.',
          'Settings - connection, presets, camera, behaviour, safety, filaments, firmware, and backup.',
        ],
      },
      {
        heading: 'Connection lifecycle',
        intro: 'A normal setup session usually goes Settings, Test Connection, Connect, then Monitor.',
        image: { src: '/help/help-printer-ribbon-navigation.png', alt: 'Connection settings with hostname filled and Test Connection and Connect enabled', caption: 'Ready to connect - once the required fields are filled, Test Connection and Connect become available.' },
        items: [
          'Test Connection probes the board without committing; it reads firmware identity and returns.',
          'Connect opens the persistent session: polling, websocket, or serial reader depending on transport.',
          'Disconnect closes the session cleanly; auto-reconnect (when enabled) takes over on transient drops.',
          'Emergency Stop sends M112 and should be reserved for real machine faults. The button is disabled until a printer is connected.',
          'If a connected printer later goes stale, the panel dims live controls and shows the last update age so you do not mistake cached data for live state.',
        ],
      },
      {
        heading: 'Common workflows',
        items: [
          'Add a network printer: Add Printer, Settings, choose a preset, enter Hostname / IP, Test Connection, then Connect.',
          'Add a USB printer: Settings, Connection Type USB, select a USB port, set baud rate, test with the diagnostic console, then Connect.',
          'Set up monitoring: configure the Camera tab, save camera settings, return to Printers, then verify the card preview and Monitor camera panel.',
          'Send a sliced file: export or upload G-code, open Files, select the file, then start the print from the printer panel.',
          'Tune materials: create per-printer Filament profiles, star the default, and use that default when changing filament or seeding slicer temperatures.',
          'Back up before experimenting: Settings, Backup, export a settings snapshot, then make firmware, machine, or safety changes.',
        ],
      },
    ],
  },

  {
    id: 'connection',
    title: 'Connecting your printer',
    summary: 'Open Settings on a printer card, choose Network or USB, pick your firmware, fill in the host, and click Test Connection.',
    group: '3D Printer',
    sections: [
      {
        heading: 'Opening connection settings',
        intro: 'Connection settings live per-printer. Go to 3D Printer → Printers, find your printer card, click Settings, then choose Connection in the left rail.',
        image: { src: '/help/help-conn-network-klipper.png', alt: 'Connection settings page with Network and Klipper selected, showing hostname field, password field, and Test Connection button', caption: 'Connection page — pick transport (Network or USB), firmware type, enter the host, then run Test Connection.' },
        items: [
          'Each printer saves its own connection settings — configure a Klipper machine and a Duet machine at the same time.',
          'Settings are stored per-browser. Export a settings bundle via Settings → Backup to move configs to another machine.',
        ],
      },
      {
        heading: 'Step 1 — Apply a printer preset (optional)',
        intro: 'The Printer Preset dropdown patches board type, baud rate, build volume, and kinematics in one click.',
        image: { src: '/help/help-conn-preset-row.png', alt: 'Printer preset dropdown showing Custom (no changes) selected', caption: 'Printer Preset — pick your model to pre-fill board type, baud, and build volume. Choose Custom to leave all settings as-is.' },
        items: [
          'Creality Ender 3 / V2 — Marlin, 115200 baud, 220×220×250 (V2: 235×235×250).',
          'Voron 2.4 (350) — Klipper, 250000 baud, 350×350×350, CoreXY.',
          'Prusa MK3S+ / MK4 — Marlin, 115200 baud, 250×210×210–220.',
          'Bambu A1 — CoreXY, 256×256×256.',
          'Duet 3 MB6HC — RepRapFirmware reference build.',
          'FLSUN Q5 Delta — Marlin, 250000 baud, 200×200×200, delta kinematics.',
          'Custom (no changes) — leaves every field exactly as you set it.',
        ],
        notes: [
          'Presets patch the fields but do not save or connect automatically. Adjust any field after applying, then Test or Save.',
        ],
      },
      {
        heading: 'Step 2 — Pick your board firmware',
        image: { src: '/help/help-conn-board-types.png', alt: 'Board type row showing Duet (RRF), Klipper, Marlin, Smoothieware, Grbl, Repetier, Other tabs', caption: 'Board type — choose the firmware running on your board. This controls which API and object model the app uses.' },
        items: [
          'Duet (RRF) — RepRapFirmware 3 on Duet 2/3 boards. Uses the RRF REST + WebSocket API.',
          'Klipper — Klipper firmware via the Moonraker API. Enter the Moonraker host address.',
          'Marlin — via OctoPrint, Mainsail, Fluidd, or direct HTTP.',
          'Smoothieware — Smoothieboard via its HTTP API.',
          'Grbl — CNC / laser firmware, G-code transport only.',
          'Repetier — Repetier Server API.',
          'Other — generic G-code transport for any firmware not listed.',
        ],
        notes: [
          'Choosing the wrong firmware type is the most common setup mistake. Check your board\'s own web UI — the brand logo confirms which firmware it runs.',
        ],
      },
      {
        heading: 'Step 3 — Network: fill in the host',
        items: [
          'Hostname / IP — enter the board address without the http:// prefix. Examples: 192.168.1.100, myprinter.local, klipper.home.',
          'Board Password — only needed if your firmware requires one. RepRapFirmware sets this via M551 in config.g. Klipper and Marlin leave it blank.',
          'Use an IP address if .local names are unreliable on your network — some routers block multicast DNS.',
        ],
      },
      {
        heading: 'Duet (RRF) — Standalone vs SBC',
        image: { src: '/help/help-conn-network-duet.png', alt: 'Duet (RRF) connection page showing Standalone and SBC (Raspberry Pi) connection mode toggle', caption: 'Duet boards have an extra toggle: Standalone (built-in Ethernet) or SBC (Raspberry Pi running DSF alongside the board).' },
        items: [
          'Standalone — the Duet board handles HTTP and WebSocket natively. Most Duet 3 setups without a Pi use this.',
          'SBC (Raspberry Pi) — DuetSoftwareFramework (DSF) runs on a Pi connected to the board via SBC header. The Pi exposes HTTP on port 80 and a Unix socket on port 8181.',
          'If unsure, try Standalone first — the Test Connection error message will indicate if DSF is expected.',
        ],
      },
      {
        heading: 'Step 3 (alt) — USB: select a port',
        image: { src: '/help/help-conn-usb.png', alt: 'Connection settings in USB mode with USB SERIAL PORT section and Select USB Port button', caption: 'USB mode — click Select USB Port to grant browser access to the printer serial port, then match the baud rate to your firmware.' },
        items: [
          'Switch CONNECTION TYPE to USB, then click Select USB Port. The browser shows a chooser — pick your printer.',
          'The app remembers the granted port by USB vendor/product ID across sessions.',
          'Baud Rate must match the firmware: Marlin 115200 or 250000, RepRapFirmware 115200, Klipper-USB 250000.',
          'Requires a Chromium browser (Chrome, Edge, Arc, Brave) over HTTPS or http://localhost.',
          'Another app holding the port (OctoPrint, PrusaSlicer, pronterface) will block the connection — close it first.',
        ],
      },
      {
        heading: 'Step 4 — Test Connection, then Connect',
        image: { src: '/help/help-conn-buttons.png', alt: 'Test Connection and Connect buttons at the bottom of the connection settings form', caption: 'Always run Test Connection before Connect — it confirms host, firmware type, and password without opening a persistent session.' },
        items: [
          'Test Connection — probes the board, reads firmware identity, and returns a pass/fail. No persistent session is opened.',
          'Connect — opens the persistent session. The app starts polling, subscribes to WebSocket events, and unlocks the dashboard.',
          'A successful test shows firmware version and board name.',
          '"Connection refused" usually means a wrong IP or the board is off. "Unauthorised" means wrong password.',
        ],
      },
      {
        heading: 'Auto-reconnect',
        items: [
          'Toggle Enable auto-reconnect at the bottom of the Connection page to retry automatically when the connection drops.',
          'Works for both Network and USB transports.',
          'Tune Reconnect Interval and Max Retries to match your network stability.',
          'Off by default — enable once you\'ve confirmed your settings are stable.',
        ],
      },
    ],
  },

  {
    id: 'usb',
    title: 'USB connection (Web Serial)',
    summary: 'Plug the printer into the computer running Cindr3D. No network required.',
    group: '3D Printer',
    sections: [
      {
        heading: 'Requirements',
        items: [
          'Chromium-based browser only: Chrome, Edge, Opera, Brave, or Arc.',
          'Page must be served over HTTPS or http://localhost — plain http:// remote URLs lack Serial API access.',
          'Firefox and Safari do not implement Web Serial. The Connection tab shows a warning when the API is unavailable.',
          'A USB data cable between the computer and the printer control board (not a charge-only cable).',
        ],
      },
      {
        heading: 'Selecting a port',
        image: { src: '/help/help-conn-usb-section.png', alt: 'USB SERIAL PORT section showing No port selected with Select USB Port button and 115200 baud dropdown', caption: 'USB Serial Port — click Select USB Port to open the browser chooser, then set the baud rate to match your firmware.' },
        items: [
          'Click Select USB Port — the browser shows a chooser listing available serial devices.',
          'Pick your printer\'s port. It may show the vendor name (Prusa Research, FTDI) or chip (CH340, CP2102, ATmega16U2).',
          'After granting, the app stores the USB vendor/product ID and auto-selects the port next time.',
          'Click Change Port to switch printers. Click Clear to release the saved permission entirely.',
        ],
        notes: [
          'If the chooser is empty, check the cable is a data cable and the board is powered on. Try a different USB port on your computer.',
        ],
      },
      {
        heading: 'Baud rate',
        items: [
          'The baud rate must exactly match the value compiled into the firmware.',
          'Marlin — 115200 (default) or 250000. Check Configuration.h → BAUDRATE.',
          'RepRapFirmware — 115200.',
          'Klipper USB — 250000 (the virtual serial port typically uses this regardless of setting).',
          'Garbled output or no response to M115 usually means the baud rate is wrong — try the other common value.',
        ],
      },
      {
        heading: 'Diagnostic console',
        intro: 'The Diagnostic Console in Settings → Connection → USB lets you open a raw serial session before committing to a full Connect.',
        items: [
          'Click Open Port to attach. The terminal shows firmware banners and system events.',
          'Type G-code in the input bar and press Enter. > = sent, < = reply, ! = error, · = system event.',
          'Run M115 first — the firmware identity response confirms baud and port are correct.',
          'Run M105 (temperatures) and M119 (endstop states) to verify the board is alive.',
          'Click Close Port before clicking Connect — only one process can own the serial port at a time.',
        ],
      },
      {
        heading: 'Limitations',
        items: [
          'USB mode is G-code transport only. File listings, dashboard graphs, height maps, and object-model browsers require network.',
          'Browser permissions are origin-scoped — a port granted at http://localhost:5173 is not visible at a different origin.',
          'Closing the browser tab closes the serial connection. Reopen and click Connect to restore.',
          'Some 8-bit boards (Mega 2560 with CH340) reset when the serial port opens. The app waits ~1.5 s before sending — this is normal.',
        ],
      },
    ],
  },

  {
    id: 'object-cancel',
    title: 'Mid-print object cancellation',
    summary: 'Cancel individual objects mid-print without stopping the whole job. Works on Klipper, Duet RRF 3.5+, and Marlin 2.0.9+ when the G-code carries object labels.',
    group: '3D Printer',
    sections: [
      {
        heading: 'What it does',
        intro: 'Most prints involve more than one object on the plate. If one part lifts, knocks loose, or fails for any reason, mid-print cancellation lets you skip the rest of that single object while the others keep going. The firmware handles the actual extruder lift and skip logic; Cindr3D provides the UI on top.',
        items: [
          'Klipper - sends EXCLUDE_OBJECT NAME=<name> via Moonraker. Requires the [exclude_object] section in printer.cfg.',
          'Duet (RepRapFirmware 3.5+) - sends M486 P<index>. Requires labelled objects in the G-code.',
          'Marlin (2.0.9+) - sends M486 P<index>. Requires the firmware to be built with CANCEL_OBJECTS, plus labelled G-code.',
          'Smoothie / grbl / Repetier - no firmware support; the Exclude Object tab shows a workaround page that points you back to the Prepare workspace to delete bodies before slicing.',
        ],
      },
      {
        heading: 'Three places to cancel',
        intro: 'There are three surfaces in Cindr3D that can cancel an object mid-print, all backed by the same firmware commands.',
        items: [
          'Exclude Object tab - dedicated full-page UI. Lists every labelled object, shows the currently-printing one, dims cancelled ones, and uses click-to-arm + click-to-confirm to prevent accidents.',
          'Object Cancellation dashboard card - compact list version that lives next to your other dashboard panels (drag/resize like any other card).',
          'Print Preview dashboard card - 3D viewport showing your build plate, object silhouettes, and toolpath wireframe up to the layer currently being printed. Right-click an object to open a context menu with dimensions, position, currently-printing/cancelled status, and a per-object cancel button.',
        ],
      },
      {
        heading: 'Slicer support',
        intro: 'Mid-print cancellation only works when the G-code carries object labels - the firmware needs a way to know which lines belong to which object.',
        items: [
          'Cindr3D - the built-in slicer now emits M486 labels automatically. Every plate object becomes a labelled group, so jobs you slice in the Prepare workspace work out of the box.',
          'PrusaSlicer / SuperSlicer / OrcaSlicer - enable Print Settings -> Output -> Label objects.',
          'Cura 5.x - install the Label Objects post-processing script: Extensions -> Post-Processing -> Add Script -> Label Objects.',
          'Files without labels show "No labelled objects in this print" in the Exclude Object tab. Re-slice with labels enabled to populate the list.',
        ],
      },
      {
        heading: 'Firmware version requirements',
        intro: 'The Exclude Object tab reads your firmware version (from the live object model on Duet, from the M115 banner on USB-attached printers) and surfaces a clear status badge.',
        items: [
          'Green badge - your firmware supports M486/EXCLUDE_OBJECT and the cancel buttons are live.',
          'Red badge - your firmware is too old. Cancel buttons are disabled and the page tells you the minimum version (RRF 3.5, Marlin 2.0.9) and links to the Updates tab to check for newer firmware.',
          'Amber badge - the firmware version was reported but couldn\'t be parsed. The cancel commands are still sent; your printer will reject them cleanly if unsupported.',
        ],
      },
      {
        heading: 'Manual M486 (SD-card prints)',
        items: [
          'The Marlin Exclude Object tab includes a "Send M486 manually" panel for prints Cindr3D didn\'t slice (e.g. files printed from SD card). Type the object ID from your slicer\'s preview, click Send, and the firmware cancels that object.',
          'For Klipper, the same fallback is the EXCLUDE_OBJECT NAME=<name> command in the Console tab.',
          'For Duet, M486 P<index> from the Console works if the Exclude Object tab can\'t see the labels.',
        ],
      },
    ],
  },

  {
    id: 'tuning-utilities',
    title: 'Print tuning & utilities',
    summary: 'Cross-firmware tabs for resonance compensation, pressure advance, smart-plug power, spool tracking, timelapses, and firmware updates.',
    group: '3D Printer',
    sections: [
      {
        heading: 'Input Shaper',
        intro: 'Resonance compensation reduces ringing artifacts caused by frame vibration during fast moves. The Input Shaper tab gives you a guided UI per firmware.',
        items: [
          'Pick a shaper type (MZV is the recommended starting point on most printers; EI / 2-Hump EI / 3-Hump EI work better for high-vibration machines).',
          'Enter measured X and Y resonance frequencies (typically 20-80 Hz for Marlin, 20-60 Hz for Duet, varies for Klipper).',
          'Set damping ratio (default 0.1 is fine for most machines).',
          'Click Apply to send the right G-code: SET_INPUT_SHAPER on Klipper (with optional ADXL345 TEST_RESONANCES auto-calibration), M593 P"<TYPE>" F<freq> S<damping> on Duet 3.3+, or M593 X F<freq> D<damping> + M593 Y F<freq> D<damping> on Marlin 2.x.',
          'Klipper users with an accelerometer can hit "Test resonances" to run TEST_RESONANCES AXIS=X / AXIS=Y; the tab lists the resulting CSV files for the input_shaper script to consume.',
        ],
      },
      {
        heading: 'Pressure Advance',
        intro: 'Pressure advance (called "Linear Advance" in Marlin) compensates for filament compression during printing, sharpening corners and reducing seams. The Pressure Advance tab walks you through the calibration tower workflow.',
        items: [
          'Step 1 - Reset PA to 0 with the firmware-appropriate command and print a calibration tower (TUNING_TOWER on Klipper, a tower G-code on Marlin/Duet).',
          'Step 2 - Inspect the tower and note the height where corners look cleanest.',
          'Step 3 - Enter that height; the tab calculates the PA value and sends the right command: SET_PRESSURE_ADVANCE ADVANCE=<x> SMOOTH_TIME=<t> on Klipper, M572 D0 S<x> on Duet, M900 K<x> on Marlin.',
          'Klipper SMOOTH_TIME (default 0.04 s) damps interactions with input shaper. Duet/Marlin don\'t expose smooth time; the tab hides that field for those firmwares.',
        ],
      },
      {
        heading: 'Power',
        intro: 'Control AC-side power (printer mains, enclosure fans, lights, dehumidifiers) without leaving Cindr3D. Two backends:',
        items: [
          'Klipper printers - the tab queries Moonraker /machine/device_power/devices and shows on/off/toggle for each Moonraker-managed device.',
          'All other firmwares - the HTTP smart-plug backend supports Tasmota, Shelly Gen1, Shelly Gen2, and generic-URL plugs. Add devices by name + IP; states persist in localStorage.',
          'Toggle commands hit the plug directly, not the printer - so you can power on the printer from this tab even when it\'s offline.',
          'Klipper devices marked "lock during print" are disabled in the UI while a print is active to prevent accidents.',
        ],
      },
      {
        heading: 'Spools',
        intro: 'Track filament inventory (brand, material, color, weight remaining, active spool) without needing a Spoolman server.',
        items: [
          'Cross-firmware - storage is local (Zustand-backed localStorage). Add a spool, mark it active, and the active spool is highlighted across the app.',
          'Klipper - if your install runs Spoolman, the dedicated Klipper Spoolman bridge polls /server/spoolman/spool_id and lets you set the active spool ID through Moonraker. The tab also links to the Spoolman web UI on port 7912.',
          'Each spool tracks initial weight, used weight, percent remaining, and free-form notes. Use it to plan multi-spool jobs or estimate when to reorder.',
        ],
      },
      {
        heading: 'Timelapse',
        intro: 'Two implementations depending on your install.',
        items: [
          'Klipper with the moonraker-timelapse plugin - the tab uses Moonraker /machine/timelapse APIs to start a server-rendered timelapse, list past renders in the timelapse folder, and delete old files.',
          'All other firmwares (and Klipper without the plugin) - the in-browser timelapse uses your webcam (getUserMedia). Capture frames manually or on layer change, render the result to WebM via MediaRecorder, then download the video.',
          'No printer-side rendering needed for the browser version; everything runs in the tab.',
        ],
      },
      {
        heading: 'Updates',
        intro: 'Firmware update awareness without leaving the app.',
        items: [
          'GitHub release checker - polls the upstream repo for your active firmware (Duet3D/RepRapFirmware, Klipper3d/klipper, MarlinFirmware/Marlin, Smoothieware, Repetier) plus Cindr3D itself.',
          'Each banner shows the latest version, release date, pre-release flag if applicable, and a "View Release" link to the GitHub release notes.',
          'Klipper - the tab also shows Moonraker\'s component-level update status (klipper, moonraker, mainsail/fluidd, system packages) and lets you trigger per-component or full updates from the UI.',
          'Cindr3D does not auto-update firmware - this tab only tells you when something new is available. Always read release notes before upgrading.',
        ],
      },
    ],
  },

  {
    id: 'camera',
    title: 'Camera setup',
    summary: 'Configure network, browser USB, or server USB cameras for printer cards, monitoring, capture, and print review.',
    group: '3D Printer',
    sections: [
      {
        heading: 'Where camera settings live',
        intro: 'Open 3D Printer, click Settings on the printer card, then choose Camera in the left settings rail.',
        image: { src: '/help/help-camera-settings.png', alt: 'Camera settings tab with source, stream, credentials, test, and save controls', caption: 'Camera settings - choose a source, fill stream details, test the feed, then save the per-printer camera profile.' },
        items: [
          'Camera settings are stored per printer, so each printer card can use a different camera, credentials, stream quality, and path preset.',
          'The printer does not have to be connected before you configure the camera. You can test and save camera settings while the board is offline.',
          'After saving, the fleet card, dashboard camera panel, and Open Camera view all read from the saved values.',
        ],
      },
      {
        heading: 'Choose the right source',
        items: [
          'Network camera - an IP camera, Wi-Fi camera, Raspberry Pi camera bridge, OctoPrint webcam endpoint, or any URL reachable by the browser over HTTP/HLS/RTSP.',
          'Browser USB camera - a webcam attached to the computer viewing Cindr3D. The browser will ask for camera permission when the Camera page starts using it.',
          'Server USB camera - a webcam attached to the machine running the Cindr3D server, such as an Orange Pi near the printer. Use this when the browser is on a laptop but the camera is plugged into the printer host.',
          'Use one camera source per printer. Switch the source later if you move the camera from the browser machine to the printer host.',
        ],
      },
      {
        heading: 'Network camera discovery',
        intro: 'For most IP cameras, start with the simplest possible address and let Cindr3D probe the common paths.',
        items: [
          'Enter only the host in Camera Address / IP, for example 192.168.1.55, printercam.local, or http://192.168.1.55.',
          'Leave Sub Stream URL blank on the first pass, then click Test Connection. A successful probe fills the MJPEG/snapshot URL for you.',
          'For Amcrest or Dahua-compatible cameras, click Fill Amcrest Defaults or set Camera Path Preset to Amcrest / Dahua-compatible paths. That seeds the common MJPEG, RTSP, and PTZ endpoints.',
          'Use Generic / custom URLs for OctoPrint, Mainsail, Fluidd, camera-streamer, mjpg-streamer, custom Nginx routes, and non-Amcrest cameras.',
          'Camera Username and Camera Password are only for cameras that require HTTP basic authentication. They are stored with this printer profile in local preferences.',
        ],
      },
      {
        heading: 'Sub stream vs main stream',
        items: [
          'Preferred Stream controls which feed the camera panel tries first: Sub stream for light MJPEG previews, or Main stream for high-quality video.',
          'Sub Stream URL should be browser-renderable HTTP/MJPEG or a snapshot/MJPEG endpoint. This is what the fleet card and dashboard preview use most often.',
          'Main Stream URL is for high-quality video. RTSP/H.264 is common on IP cameras; HLS/HTTP works when your camera or bridge already exposes a browser-compatible stream.',
          'If Main Stream Protocol is RTSP, TCP is usually best on Wi-Fi because it is more tolerant of packet loss. UDP can be lower latency on a stable wired network.',
          'Browsers cannot play RTSP directly. Cindr3D can route RTSP through its local RTSP-to-HLS bridge where the server supports it, while MJPEG remains the reliable dashboard preview path.',
        ],
      },
      {
        heading: 'Testing and saving',
        items: [
          'Click Test Connection before saving. The test checks whether the configured URL returns a loadable image or MJPEG stream.',
          'If Test Connection fills Sub Stream URL, review the generated URL and then click Save Camera Settings.',
          'Save Camera Settings is disabled until the draft differs from the saved camera profile.',
          'If a stream opens in a normal browser tab but the test fails, paste that exact URL into Sub Stream URL and test again.',
          'If the dashboard preview is blank after a successful test, make sure you saved the settings. The preview uses saved values, not unsaved draft fields.',
        ],
      },
      {
        heading: 'Dashboard camera panel',
        intro: 'Click Monitor on a printer card to see the camera panel in context with printer state and job controls.',
        image: { src: '/help/help-camera-dashboard.png', alt: 'Printer monitor dashboard with camera panel and open camera action', caption: 'Dashboard camera panel - once a stream is saved, this area shows the preview, capture status, and quick camera actions.' },
        items: [
          'The compact dashboard panel shows connection health, the current stream status, saved clip size, active job context, and the Open Camera action.',
          'Open Camera expands into the full camera workspace with quality controls, snapshots, recording, timelapse, overlays, calibration, and saved clip management.',
          'The fleet card uses the same saved camera profile for its small live preview, so fixing the dashboard camera usually fixes the card preview too.',
          'Recording and timelapse clips save locally in the browser using IndexedDB. Deleting a printer can also delete its associated camera clips.',
        ],
      },
      {
        heading: 'Full camera workspace tools',
        items: [
          'Quality - switch between SD/sub stream and HD/main stream. HD may start the local RTSP bridge when the main stream is RTSP.',
          'Snapshots - capture still images for first-layer checks, finish evidence, or troubleshooting.',
          'Recordings and timelapses - save short clips, print evidence, or reviewable timelapses tied to the active printer/job.',
          'Markers and tags - flag moments such as warping, stringing, layer shift, blobs, adhesion problems, and under-extrusion.',
          'Overlays - grid, crosshair, flip, rotation, and calibration aids help line up the camera with the bed.',
          'PTZ controls - available for Amcrest / Dahua-compatible paths; use the Amcrest preset before trying pan, tilt, zoom, or home.',
        ],
      },
      {
        heading: 'Common setup recipes',
        items: [
          'Amcrest/Dahua IP camera: choose Network camera, enter the camera IP, click Fill Amcrest Defaults, add credentials if required, Test Connection, then Save Camera Settings.',
          'OctoPrint webcam: choose Network camera, keep Generic / custom URLs, paste the webcam stream URL into Sub Stream URL, Test Connection, then save.',
          'Mainsail/Fluidd/camera-streamer: choose Network camera, paste the browser-viewable stream or snapshot URL into Sub Stream URL, set Main Stream URL only if you have an HLS/RTSP high-quality feed.',
          'Laptop webcam: choose Browser USB camera, save, then open the Camera page and approve the browser camera permission prompt when it appears.',
          'Orange Pi/server webcam: choose Server USB camera, pick or enter the server USB device, save, then use Open Camera to view the bridged feed.',
        ],
      },
      {
        heading: 'Troubleshooting camera setup',
        items: [
          'If Test Connection fails, open the same URL directly in the browser first. If the browser cannot load it, check camera power, network, IP address, credentials, and CORS/proxy setup.',
          'If the test works but the preview does not, click Save Camera Settings and refresh the dashboard panel.',
          'If HTTP works but HTTPS does not, avoid mixed-content browser blocking by using the same scheme as the app deployment or a server-side bridge.',
          'If RTSP HD does not start, confirm the Cindr3D server can reach the camera, then try RTSP Transport TCP before UDP.',
          'If Browser USB shows no devices, use a Chromium browser on HTTPS or localhost, close other apps that may own the webcam, and grant camera permission when prompted.',
          'If PTZ buttons do nothing, confirm the camera is Amcrest / Dahua-compatible, the path preset is Amcrest, and credentials have permission to control PTZ.',
        ],
      },
    ],
  },

  {
    id: 'filaments',
    title: 'Filament profiles',
    summary: 'Per-printer profiles that store the temps, fan, retraction, and flow you reach for most often.',
    group: '3D Printer',
    sections: [
      {
        heading: 'What a profile holds',
        items: [
          'Material — PLA, PETG, ABS, TPU, PC, Nylon, ASA, or Other.',
          'Color — used as a swatch on the dashboard and the printer card.',
          'Nozzle / bed / chamber temperature setpoints.',
          'Fan speed (%), retraction distance (mm), retraction speed (mm/s), and flow (%).',
          'Free-text notes — drying time, brand, batch, anything else worth remembering.',
        ],
      },
      {
        heading: 'Material defaults',
        intro: 'Picking a material seeds typical temps and retraction so you don\'t have to start from scratch:',
        items: [
          'PLA — 210/60, fan 100%, retraction 0.8 mm.',
          'PETG — 235/75, fan 50%, retraction 1.2 mm.',
          'ABS — 245/100, chamber 45, fan 20%, retraction 1.0 mm.',
          'TPU — 225/50, fan 60%, retraction 0.4 mm.',
          'PC — 280/110, chamber 60, fan off, retraction 1.0 mm.',
        ],
      },
      {
        heading: 'Default profile',
        items: [
          'The starred profile loads by default when changing filament from the dashboard.',
          'Click the star on any profile card to make it the default.',
          'Two starter profiles (Generic PLA and Generic PETG) ship out of the box; replace or rename them as needed.',
        ],
      },
    ],
  },

  {
    id: 'safety',
    title: 'Safety limits',
    summary: 'Guard rails on temperature and emergency commands.',
    group: '3D Printer',
    sections: [
      {
        heading: 'Temperature caps',
        intro: 'Settings → Behaviour → Safety Limits hard-caps setpoints sent to the firmware.',
        items: [
          'Max Nozzle Temperature — defaults to 280 °C; raise it for high-temp hotends.',
          'Max Bed Temperature — defaults to 120 °C.',
          'Max Chamber Temperature — defaults to 60 °C.',
          'Setpoints above the cap are blocked before they leave the app.',
        ],
      },
      {
        heading: 'High-temperature warning',
        items: [
          'Toggle "Warn before high-temperature setpoints" to require a confirm above a soft threshold.',
          'Adjust the threshold below the toggle. Defaults to 250 °C — anything at or above that needs confirmation.',
          'Useful when you frequently print PLA but occasionally swap to ABS / PC.',
        ],
      },
      {
        heading: 'Runaway and E-stop',
        items: [
          '"Surface thermal-runaway alerts" elevates firmware-reported runaway / heater-fault events to a high-priority toast.',
          '"Confirm emergency stop" requires a confirm dialog before sending M112 / E-stop, which prevents accidental clicks.',
          'Both are recommended for shared shop printers.',
        ],
      },
    ],
  },

  {
    id: 'files',
    title: 'Files and settings bundles',
    summary: 'Documents, settings, and how they\'re saved.',
    group: 'Reference',
    sections: [
      {
        heading: 'Documents',
        items: [
          'Open Design / Save Design read and write CAD design files in the Design workspace.',
          'Documents include the feature timeline; rolling back and saving keeps history intact.',
        ],
      },
      {
        heading: 'Settings bundles',
        items: [
          'Save Settings writes the active workspace section to the current bundle.',
          'Save Settings As branches into a new bundle so variations can coexist.',
          'Load Settings restores a saved bundle. Bundles travel cleanly across machines and OSes.',
          'Settings → Backup also exports/imports the entire app state as JSON when you want a portable archive.',
        ],
      },
      {
        heading: 'Per-printer vs global',
        items: [
          'Each printer has its own connection, preferences, filament profiles, and camera settings.',
          'Global preferences (theme, units, notifications) live under the gear in the top bar.',
        ],
      },
    ],
  },

  {
    id: 'updates',
    title: 'Notifications and updates',
    summary: 'The bell aggregates printer alerts and site update status.',
    group: 'Reference',
    sections: [
      {
        heading: 'Notifications',
        items: [
          'Printer messages, status changes, heater faults, and connection changes appear as alerts.',
          'A dot on the bell means there\'s an unread alert or a pending update.',
          'Severity (info / warning / error) is filtered by Settings → Notifications → Minimum Severity.',
          'Toast duration and beep / sound preferences live in the same panel.',
        ],
      },
      {
        heading: 'Site updates',
        items: [
          'The bell also shows site update status so update controls don\'t float over the workspace.',
          'Check refreshes update status from the server.',
          'Install applies an available release — only enabled when an asset is ready.',
          'The updater key is required only on protected deployments; most installs leave it blank.',
        ],
      },
    ],
  },

  {
    id: 'ai',
    title: 'AI Assistant & MCP',
    summary: 'Chat with an AI directly in the app, or connect Claude Code via MCP to control Cindr3D from your terminal.',
    group: 'Reference',
    sections: [
      {
        heading: 'Opening the AI panel',
        intro: 'The AI panel is available in every workspace. Three ways to open it:',
        image: { src: '/help/help-topbar.png', alt: 'Top bar showing the AI button and green AI MCP badge', caption: 'Top bar — click "AI" to open the panel. The green "AI MCP" badge confirms the server is running.' },
        items: [
          'Click the AI button in the top bar (between the workspace selector and the AI MCP badge).',
          'In the Prepare workspace, click the AI button in the bottom action bar.',
          'In the 3D Printer workspace, click the AI button in the bottom action bar.',
        ],
        notes: [
          'The panel floats over the viewport and has two tabs — MCP and Chat.',
          'The green "AI MCP" badge in the top bar means the local MCP server is running and ready for Claude Code to connect.',
        ],
      },
      {
        heading: 'MCP tab — connect Claude Code',
        intro: 'The MCP tab lets you wire Claude Code (the Anthropic CLI) into Cindr3D. Once connected, any Claude Code conversation can call tools that drive the app directly.',
        image: { src: '/help/help-ai-mcp.png', alt: 'AI panel MCP tab showing the server status and Claude Code config command', caption: 'MCP tab — copy the config command and paste it into Claude Code Settings → MCP Servers.' },
        items: [
          'Copy the Claude Code Config command shown in the panel — it looks like: claude mcp add cindr3d http://localhost:5174/mcp?token=...',
          'In your terminal, open Claude Code Settings → MCP Servers and paste the command, then restart Claude Code.',
          'Return to the MCP tab — the "MCP Server Running :5174" indicator confirms the server is active.',
          'The Recent Tool Calls list at the bottom logs every tool call Claude Code has made, so you can audit what the AI changed.',
          'The copy button (two squares) copies the config command. The refresh button regenerates the token if it needs to be rotated.',
        ],
        notes: [
          'The MCP server only accepts connections from localhost — it is not exposed to the network.',
          'Restarting the app regenerates the token; update the Claude Code MCP config if you see 401 errors.',
        ],
      },
      {
        heading: 'Chat tab — in-app AI chat (BYOK)',
        intro: 'The Chat tab is a built-in chat interface that runs fully in your browser. It is Bring Your Own Key (BYOK) — your API key is stored locally and never sent to Cindr3D servers.',
        image: { src: '/help/help-ai-chat.png', alt: 'AI panel Chat tab with message input and empty state prompt', caption: 'Chat tab — set your provider and API key in Global Settings to unlock the chat input.' },
        items: [
          'Go to Global Settings → AI to set your provider (Anthropic, OpenAI, or compatible), model, and API key.',
          'Once a key is configured, the chat input unlocks and you can type messages directly.',
          'The AI can call the same tools as Claude Code via MCP — camera moves, slice stats, printer control — without leaving the panel.',
          'Conversation history is kept in-session; a new page load starts a fresh thread.',
        ],
        notes: [
          'Your API key is stored in browser localStorage and sent directly to the provider\'s API — not through Cindr3D servers.',
        ],
      },
      {
        heading: 'What the AI can do — Design workspace',
        items: [
          'List and select bodies, faces, edges, and sketches.',
          'Read geometry properties: volume, surface area, bounding box, mass, material.',
          'Create and modify sketch entities, constraints, and dimensions.',
          'Call solid features: Extrude, Revolve, Fillet, Chamfer, Shell, and more.',
        ],
      },
      {
        heading: 'What the AI can do — Prepare workspace',
        image: { src: '/help/help-prepare-workspace.png', alt: 'Prepare workspace showing the 3D build plate and slicer tools', caption: 'Prepare workspace — the AI can position objects, set camera views, slice, and read print stats.' },
        items: [
          'List plate objects, read and set position, rotation, and scale.',
          'Move, duplicate, delete, and reset transforms on plate objects.',
          'Set camera presets (isometric, top, front, right) and fit the view to the build plate.',
          'Focus the camera on a specific object by ID.',
          'Trigger a slice, read slice stats, and detect potential print issues.',
          'Set preview color mode (by type, speed, flow, width, layer-time, wall quality, or seam).',
          'Cut an object by an axis-aligned plane or a custom point + normal.',
          'Read the active printer and material profile.',
        ],
      },
      {
        heading: 'What the AI can do — 3D Printer workspace',
        image: { src: '/help/help-printer-workspace.png', alt: '3D Printer workspace showing the printer fleet dashboard', caption: '3D Printer workspace — the AI can connect, monitor temperatures, move axes, and control print jobs.' },
        items: [
          'Connect and disconnect a configured printer.',
          'Read live status: temperatures, axes, fans, active job, and print progress.',
          'Set tool and bed temperatures (and wait for target).',
          'Home axes, move to absolute or relative positions.',
          'Set feed-rate override (print speed percent) and flow-rate override per extruder.',
          'Control part-cooling fans.',
          'Pause, resume, and cancel the active print job.',
          'List files on the printer SD card, upload G-code, and start a print by filename.',
          'Send raw G-code commands for diagnostics.',
          'Run named macros stored on the printer.',
          'Report filament runout sensor state and initiate a filament change.',
          'Send an emergency stop (M112) — works even when not connected.',
        ],
      },
    ],
  },

  {
    id: 'shortcuts',
    title: 'Keyboard shortcuts',
    summary: 'A consolidated list of the keys the menus assign in each workspace.',
    group: 'Reference',
    sections: [
      {
        heading: 'Design — Create',
        shortcuts: [
          { keys: 'S', action: 'Sketch' },
          { keys: 'E', action: 'Extrude' },
          { keys: 'H', action: 'Hole' },
        ],
      },
      {
        heading: 'Design — Modify',
        shortcuts: [
          { keys: 'Q', action: 'Press Pull' },
          { keys: 'F', action: 'Fillet' },
          { keys: 'M', action: 'Move / Copy' },
          { keys: 'Del', action: 'Delete' },
          { keys: 'A', action: 'Appearance' },
          { keys: 'Ctrl+B', action: 'Change Parameters' },
        ],
      },
      {
        heading: 'Design — Assemble',
        shortcuts: [
          { keys: 'J', action: 'Joint' },
          { keys: 'Shift+J', action: 'As-Built Joint' },
        ],
      },
      {
        heading: 'Design — Inspect',
        shortcuts: [
          { keys: 'I', action: 'Measure' },
          { keys: 'Shift+N', action: 'Display Component Colors' },
        ],
      },
      {
        heading: 'Sketch — Selection',
        shortcuts: [
          { keys: '1', action: 'Window select' },
          { keys: '2', action: 'Freeform select' },
          { keys: '3', action: 'Paint select' },
        ],
      },
      {
        heading: 'Sketch — Tools',
        shortcuts: [
          { keys: 'L', action: 'Line' },
          { keys: 'R', action: 'Rectangle' },
          { keys: 'C', action: 'Circle' },
          { keys: 'P', action: 'Project' },
          { keys: 'F', action: 'Sketch Fillet' },
          { keys: 'T', action: 'Trim' },
          { keys: 'O', action: 'Offset' },
          { keys: 'M', action: 'Move' },
          { keys: 'D', action: 'Dimension' },
        ],
      },
      {
        heading: 'Universal',
        intro: 'Standard browser shortcuts apply on top of the workspace bindings:',
        shortcuts: [
          { keys: 'Esc', action: 'Cancel the current command / close the open dialog' },
          { keys: 'Ctrl+Z', action: 'Undo' },
          { keys: 'Ctrl+Y', action: 'Redo (Ctrl+Shift+Z also works)' },
          { keys: 'Ctrl+S', action: 'Save (browser fallback if the workspace doesn\'t intercept)' },
          { keys: 'F11', action: 'Toggle browser fullscreen' },
        ],
      },
    ],
  },

  {
    id: 'tips',
    title: 'Tips and tricks',
    summary: 'Habits that pay off on real projects.',
    group: 'Reference',
    sections: [
      {
        heading: 'Modeling',
        items: [
          'Constrain sketches fully before adding features. Under-constrained sketches that drive features are the #1 source of ghost-rebuild surprises.',
          'Name bodies and components as you go. The tree gets unreadable fast otherwise.',
          'Use Construct planes liberally — they\'re cheap and they make later sketches easier to place.',
          'Roll back the timeline before doing exploratory edits; you can always roll forward without losing work.',
        ],
      },
      {
        heading: 'Slicing',
        items: [
          'Pick a printer preset before drawing — build volume + kinematics drive default constraints in Prepare.',
          'Use the layer slider in preview mode to scrub critical layers (first layer, transitions, bridging).',
          'Save settings bundles per filament so you don\'t lose temperature tuning when switching materials.',
        ],
      },
      {
        heading: 'Fleet',
        items: [
          'Star a default filament profile per printer — the dashboard\'s change-filament action picks it up.',
          'Set max-temp safety caps before connecting a new printer; prevents accidents during board commissioning.',
          'For USB printers, open the diagnostic console first and try M115 — that confirms baud / port / power are all fine before committing.',
        ],
      },
    ],
  },

  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    summary: 'First-pass fixes when something doesn\'t work.',
    group: 'Reference',
    sections: [
      {
        heading: 'General',
        items: [
          'Reload the tab if a dev build changed while a page was already open.',
          'Check the bottom status bar for command hints before assuming a tool is stuck.',
          'If a button is disabled, the current selection or workspace likely doesn\'t meet that tool\'s requirement — read the tooltip.',
          'Settings → Backup → Export gives a copyable snapshot to help diagnose state-related bugs.',
        ],
      },
      {
        heading: 'Network printer won\'t connect',
        items: [
          'Open the board\'s web UI (Duet Web Control / Mainsail / Fluidd) directly in a browser tab and confirm it loads.',
          'If the IP works but Cindr3D says "Connection refused", clear the password field and try again — boards return err=2 when the password is wrong.',
          'Reach the board over .local? Some networks block multicast DNS; try the raw IP.',
          'For Duet SBC mode, confirm DSF is running on the Pi and reachable on port 80 + 8181.',
        ],
      },
      {
        heading: 'USB printer won\'t connect',
        items: [
          'The browser must be Chromium-based and the page must be on HTTPS or http://localhost.',
          'Click Select USB Port and pick the device — the browser requires that grant per-origin per-session.',
          'If "Open Port" fails, another app probably holds the port (close OctoPrint / PrusaSlicer / Cura / pronterface).',
          'Try a different baud rate. Marlin firmware compiled with BAUDRATE 250000 won\'t answer at 115200 and vice versa.',
          'Some 8-bit boards (Mega 2560 with CH340) reset on port open — wait the 1.5 s the app holds before sending; that\'s normal.',
        ],
      },
      {
        heading: 'Camera',
        items: [
          'Confirm the camera URL opens in the browser first; if it doesn\'t, no app fix will help.',
          'Test the same base IP in Camera Address / IP, then run Test Connection — the probe fills Sub Stream URL when it finds a working path.',
          'For Amcrest / Dahua, click Fill Amcrest Defaults to seed the vendor-specific paths.',
          'If the test passes but the dashboard preview is empty, save the camera settings — preview reads from saved values, not draft input.',
        ],
      },
      {
        heading: 'Slice / preview',
        items: [
          'A slice that fails on a complex part is usually a non-manifold mesh — repair the model in Design before sending it to Prepare.',
          'Preview Travel mode shows long jumps; if the part is full of them, retraction or sequence settings are off.',
          'If estimates look wildly wrong, the active material profile likely has a flow / speed mismatch.',
        ],
      },
    ],
  },
];

function renderShortcutKeys(keys: string) {
  return keys.split('+').map((key, idx, arr) => (
    <Fragment key={`${key}-${idx}`}>
      <kbd>{key}</kbd>
      {idx < arr.length - 1 && <span className="app-help-kbd-sep">+</span>}
    </Fragment>
  ));
}

export function AppHelpModal({ onClose }: { onClose: () => void }) {
  const [activeTopicId, setActiveTopicId] = useState(HELP_TOPICS[0].id);
  const [query, setQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(['Design', 'Prepare', '3D Printer', 'Reference']),
  );

  const filteredTopics = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return HELP_TOPICS;
    return HELP_TOPICS.filter((topic) => {
      const haystack = [
        topic.title,
        topic.summary,
        topic.group ?? '',
        ...topic.sections.flatMap((section) => [
          section.heading,
          section.intro ?? '',
          section.image?.alt ?? '',
          section.image?.caption ?? '',
          ...(section.items ?? []),
          ...(section.shortcuts ?? []).flatMap((s) => [s.keys, s.action]),
          ...(section.notes ?? []),
        ]),
      ].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }, [query]);

  const groupedNav = useMemo(() => {
    const result: Array<{ group: string | null; topics: HelpTopic[] }> = [];
    for (const topic of filteredTopics) {
      const g = topic.group ?? null;
      const last = result[result.length - 1];
      if (last && last.group === g) {
        last.topics.push(topic);
      } else {
        result.push({ group: g, topics: [topic] });
      }
    }
    return result;
  }, [filteredTopics]);

  const activeTopic = filteredTopics.find((topic) => topic.id === activeTopicId) ?? filteredTopics[0];

  const visibleExpandedGroups = useMemo(() => {
    if (!query.trim()) return expandedGroups;
    return new Set(filteredTopics.map((t) => t.group).filter(Boolean) as string[]);
  }, [expandedGroups, filteredTopics, query]);

  function toggleGroup(group: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  return (
    <div className="app-help-overlay" role="presentation" onMouseDown={onClose}>
      <div className="app-help-modal" role="dialog" aria-modal="true" aria-label="Help documentation" onMouseDown={(event) => event.stopPropagation()}>
        <header className="app-help-header">
          <div className="app-help-title">
            <BookOpen size={18} />
            <div>
              <h2>Cindr3D Help</h2>
              <p>Reference guide for modelling, slicing, printer fleets, cameras, USB connections, and updates.</p>
            </div>
          </div>
          <button className="app-help-close" onClick={onClose} aria-label="Close help">
            <X size={16} />
          </button>
        </header>

        <div className="app-help-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search help"
            autoFocus
          />
        </div>

        <div className="app-help-body">
          <nav className="app-help-nav" aria-label="Help topics">
            {groupedNav.map(({ group, topics }) =>
              group === null ? (
                // Ungrouped topics (Getting started) — always visible
                <Fragment key="ungrouped">
                  {topics.map((topic) => (
                    <button
                      key={topic.id}
                      className={`app-help-topic-btn${topic.id === activeTopic?.id ? ' active' : ''}`}
                      onClick={() => setActiveTopicId(topic.id)}
                    >
                      <span>{topic.title}</span>
                      <small>{topic.summary}</small>
                    </button>
                  ))}
                </Fragment>
              ) : (
                // Collapsible group section
                <div key={group} className="app-help-group">
                  <button
                    className={`app-help-group-header${visibleExpandedGroups.has(group) ? ' open' : ''}`}
                    onClick={() => toggleGroup(group)}
                    aria-expanded={visibleExpandedGroups.has(group)}
                  >
                    <span>{group}</span>
                    <ChevronDown size={13} className="app-help-group-chevron" />
                  </button>
                  {visibleExpandedGroups.has(group) && (
                    <div className="app-help-group-items">
                      {topics.map((topic) => (
                        <button
                          key={topic.id}
                          className={`app-help-topic-btn${topic.id === activeTopic?.id ? ' active' : ''}`}
                          onClick={() => setActiveTopicId(topic.id)}
                        >
                          <span>{topic.title}</span>
                          <small>{topic.summary}</small>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ),
            )}
            {filteredTopics.length === 0 && (
              <div className="app-help-empty">No help topics match that search.</div>
            )}
          </nav>

          <article className="app-help-content">
            {activeTopic ? (
              <>
                <h3>{activeTopic.title}</h3>
                <p className="app-help-summary">{activeTopic.summary}</p>
                {activeTopic.sections.map((section) => (
              <section key={section.heading} className="app-help-section">
                <h4>{section.heading}</h4>
                {section.intro && <p className="app-help-intro">{section.intro}</p>}
                {section.image && (
                  <figure className="app-help-figure">
                    <img src={section.image.src} alt={section.image.alt} className="app-help-img" />
                    {section.image.caption && <figcaption className="app-help-caption">{section.image.caption}</figcaption>}
                  </figure>
                )}
                {section.items && section.items.length > 0 && (
                  <ul>
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
                {section.shortcuts && section.shortcuts.length > 0 && (
                  <table className="app-help-shortcuts">
                    <thead>
                      <tr>
                        <th>Keys</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.shortcuts.map((s) => (
                        <tr key={`${s.keys}-${s.action}`}>
                          <td>{renderShortcutKeys(s.keys)}</td>
                          <td>{s.action}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {section.notes && section.notes.length > 0 && (
                  <div className="app-help-notes">
                    {section.notes.map((note) => (
                      <p key={note} className="app-help-note">{note}</p>
                    ))}
                  </div>
                )}
              </section>
                ))}
              </>
            ) : (
              <div className="app-help-empty">No help content matches that search.</div>
            )}
          </article>
        </div>
      </div>
    </div>
  );
}
