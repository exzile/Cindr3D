// Tool schemas for the BYOK in-app chat path.
// Mirrors the MCP tool surface so the model can call the same handlers in-process.

export type ToolParam = { type: string; description?: string; enum?: string[] };

export type NeutralTool = {
  name: string;
  description: string;
  params: Record<string, ToolParam>;
  required?: string[];
};

// Anthropic messages API format
export type AnthropicTool = {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, ToolParam>; required?: string[] };
};

// OpenAI / OpenRouter function-calling format
export type OpenAITool = {
  type: 'function';
  function: { name: string; description: string; parameters: { type: 'object'; properties: Record<string, ToolParam>; required?: string[] } };
};

export function toAnthropic(t: NeutralTool): AnthropicTool {
  return { name: t.name, description: t.description, input_schema: { type: 'object', properties: t.params, required: t.required } };
}

export function toOpenAI(t: NeutralTool): OpenAITool {
  return { type: 'function', function: { name: t.name, description: t.description, parameters: { type: 'object', properties: t.params, required: t.required } } };
}

const str = (description: string): ToolParam => ({ type: 'string', description });
const num = (description: string): ToolParam => ({ type: 'number', description });
const en = (description: string, values: string[]): ToolParam => ({ type: 'string', description, enum: values });

export const BYOK_TOOLS: NeutralTool[] = [
  // Document / scene
  { name: 'list_objects', description: 'List all 3D objects in the current CAD document.', params: {} },
  { name: 'get_object_properties', description: 'Get detailed properties of a specific object by ID.', params: { id: str('Object ID') }, required: ['id'] },
  { name: 'select_objects', description: 'Select objects by ID array.', params: { ids: { type: 'array', description: 'Array of object IDs to select' } as ToolParam }, required: ['ids'] },
  { name: 'snapshot_view', description: 'Capture a screenshot of the current 3D viewport.', params: {} },

  // Primitives
  { name: 'create_box', description: 'Create a box primitive.', params: { name: str('Object name'), width: num('mm'), height: num('mm'), depth: num('mm'), x: num('X position mm'), y: num('Y position mm'), z: num('Z position mm') }, required: ['width', 'height', 'depth'] },
  { name: 'create_cylinder', description: 'Create a cylinder primitive.', params: { name: str('Object name'), radius: num('Radius mm'), height: num('Height mm'), x: num('X position mm'), y: num('Y position mm'), z: num('Z position mm') }, required: ['radius', 'height'] },
  { name: 'create_sphere', description: 'Create a sphere primitive.', params: { name: str('Object name'), radius: num('Radius mm'), x: num('X position mm'), y: num('Y position mm'), z: num('Z position mm') }, required: ['radius'] },
  { name: 'create_cone', description: 'Create a cone or truncated cone.', params: { name: str('Object name'), radiusBottom: num('Bottom radius mm'), radiusTop: num('Top radius mm (0 = sharp cone)'), height: num('Height mm'), x: num('X'), y: num('Y'), z: num('Z') }, required: ['radiusBottom', 'height'] },

  // Sketches
  { name: 'start_sketch', description: 'Start a new sketch on a plane.', params: { plane: en('Sketch plane', ['XY', 'XZ', 'YZ']), name: str('Sketch name') }, required: ['plane'] },
  { name: 'sketch_rect', description: 'Add a rectangle to the active sketch.', params: { x: num('Center X mm'), y: num('Center Y mm'), width: num('Width mm'), height: num('Height mm') }, required: ['x', 'y', 'width', 'height'] },
  { name: 'sketch_circle', description: 'Add a circle to the active sketch.', params: { x: num('Center X mm'), y: num('Center Y mm'), radius: num('Radius mm') }, required: ['x', 'y', 'radius'] },
  { name: 'sketch_polygon', description: 'Add a regular polygon to the active sketch.', params: { x: num('Center X mm'), y: num('Center Y mm'), radius: num('Circumradius mm'), sides: num('Number of sides') }, required: ['x', 'y', 'radius', 'sides'] },
  { name: 'sketch_dimension', description: 'Add a dimension constraint to the active sketch.', params: { entityId: str('Sketch entity ID'), value: num('Dimension value mm') }, required: ['entityId', 'value'] },
  { name: 'finish_sketch', description: 'Finish the active sketch and return its ID.', params: {} },

  // Features
  { name: 'extrude_sketch', description: 'Extrude a sketch into a 3D solid.', params: { sketchId: str('Sketch ID to extrude'), distance: num('Extrude distance mm'), direction: en('Extrude direction', ['positive', 'symmetric', 'two-sides']), name: str('Feature name') }, required: ['sketchId', 'distance'] },
  { name: 'revolve_sketch', description: 'Revolve a sketch around an axis.', params: { sketchId: str('Sketch ID'), axis: en('Revolution axis', ['X', 'Y', 'Z']), angle: num('Angle degrees (default 360)'), name: str('Feature name') }, required: ['sketchId', 'axis'] },
  { name: 'fillet_edges', description: 'Apply a fillet to selected edges.', params: { objectId: str('Object ID'), edgeIds: { type: 'array', description: 'Edge IDs' } as ToolParam, radius: num('Fillet radius mm') }, required: ['objectId', 'radius'] },
  { name: 'chamfer_edges', description: 'Apply a chamfer to selected edges.', params: { objectId: str('Object ID'), edgeIds: { type: 'array', description: 'Edge IDs' } as ToolParam, distance: num('Chamfer distance mm') }, required: ['objectId', 'distance'] },
  { name: 'hole', description: 'Create a hole feature.', params: { objectId: str('Object ID'), x: num('X position mm'), y: num('Y position mm'), z: num('Z position mm'), diameter: num('Diameter mm'), depth: num('Depth mm'), type: en('Hole type', ['simple', 'countersink', 'counterbore']) }, required: ['objectId', 'x', 'y', 'z', 'diameter', 'depth'] },

  // Booleans + transforms
  { name: 'boolean_union', description: 'Merge two objects into one.', params: { targetId: str('Base object ID'), toolId: str('Tool object ID (gets consumed)') }, required: ['targetId', 'toolId'] },
  { name: 'boolean_subtract', description: 'Subtract the tool object from the target object.', params: { targetId: str('Base object ID'), toolId: str('Tool object ID') }, required: ['targetId', 'toolId'] },
  { name: 'boolean_intersect', description: 'Keep only the intersection of two objects.', params: { targetId: str('Base object ID'), toolId: str('Tool object ID') }, required: ['targetId', 'toolId'] },
  { name: 'transform', description: 'Move/rotate/scale an object.', params: { id: str('Object ID'), translateX: num('X translation mm'), translateY: num('Y translation mm'), translateZ: num('Z translation mm'), rotateX: num('X rotation degrees'), rotateY: num('Y rotation degrees'), rotateZ: num('Z rotation degrees'), scaleX: num('X scale'), scaleY: num('Y scale'), scaleZ: num('Z scale') }, required: ['id'] },
  { name: 'mirror', description: 'Mirror an object across a plane.', params: { id: str('Object ID'), plane: en('Mirror plane', ['XY', 'XZ', 'YZ']) }, required: ['id', 'plane'] },
  { name: 'linear_pattern', description: 'Create a linear pattern of an object.', params: { id: str('Object ID'), countX: num('Count along X'), countY: num('Count along Y'), countZ: num('Count along Z'), spacingX: num('Spacing X mm'), spacingY: num('Spacing Y mm'), spacingZ: num('Spacing Z mm') }, required: ['id'] },
  { name: 'circular_pattern', description: 'Create a circular pattern of an object.', params: { id: str('Object ID'), count: num('Number of instances'), axis: en('Rotation axis', ['X', 'Y', 'Z']), angle: num('Total angle degrees') }, required: ['id', 'count'] },

  // Export / save
  { name: 'save_session', description: 'Save the current CAD session to a file.', params: {} },
  { name: 'export_stl', description: 'Open the STL export dialog.', params: {} },
  { name: 'export_step', description: 'Open the STEP export dialog.', params: {} },
  { name: 'export_gcode', description: 'Switch to the prepare workspace to slice and export G-code.', params: {} },
];

// ── Slicer tools ──────────────────────────────────────────────────────────────

BYOK_TOOLS.push(
  { name: 'slicer_get_settings', description: 'Return the active print profile settings (layer height, infill, speeds, supports, etc.) and active printer/material profile names.', params: {} },
  {
    name: 'slicer_set_setting',
    description: 'Update a single setting in the active print profile. Use slicer_get_settings first to see valid key names and current values.',
    params: {
      key: str('Print profile field name (e.g. "layerHeight", "infillDensity", "supportEnabled", "printSpeed")'),
      value: { type: 'string', description: 'New value (numbers, booleans, and strings are all accepted as JSON)' },
    },
    required: ['key', 'value'],
  },
  { name: 'slicer_list_profiles', description: 'List all printer, material, and print profiles with their IDs and active flags.', params: {} },
  {
    name: 'slicer_set_active_profile',
    description: 'Switch the active printer, material, or print profile.',
    params: {
      kind: en('Profile category', ['printer', 'material', 'print']),
      id: str('Profile ID from slicer_list_profiles'),
    },
    required: ['kind', 'id'],
  },
  { name: 'slicer_list_plate_objects', description: 'List all objects currently on the build plate with their position, rotation, and scale.', params: {} },
  { name: 'slicer_start_slice', description: 'Start slicing the current build plate with the active profiles. Returns immediately; poll with slicer_get_status.', params: {} },
  { name: 'slicer_get_status', description: 'Get the current slice state (idle/slicing/done/error), progress, and result summary (print time, filament usage, layer count).', params: {} },

  // Printer + material settings
  { name: 'slicer_get_printer_settings', description: 'Return key active printer profile fields: build volume, nozzle diameter, filament diameter, heated bed, G-code flavor, speed limits.', params: {} },
  {
    name: 'slicer_set_printer_setting',
    description: 'Update one field in the active printer profile (e.g. "nozzleDiameter", "buildVolume", "gcodeFlavorType"). Use slicer_get_printer_settings for valid keys.',
    params: {
      key: str('Printer profile field name'),
      value: { type: 'string', description: 'New value as JSON (number, boolean, string, or object)' },
    },
    required: ['key', 'value'],
  },
  { name: 'slicer_get_material_settings', description: 'Return active material profile: temperatures (nozzle/bed), fan speeds, retraction, flow rate, density, cost.', params: {} },
  {
    name: 'slicer_set_material_setting',
    description: 'Update one field in the active material profile (e.g. "nozzleTemp", "bedTemp", "retractionDistance", "flowRate").',
    params: {
      key: str('Material profile field name'),
      value: { type: 'string', description: 'New value as JSON' },
    },
    required: ['key', 'value'],
  },

  // Plate object transforms
  {
    name: 'slicer_transform_plate_object',
    description: 'Move, rotate, or scale an object on the build plate. All axes are optional — only provided axes change.',
    params: {
      id: str('Plate object ID from slicer_list_plate_objects'),
      x: num('Position X mm (optional)'), y: num('Position Y mm (optional)'), z: num('Position Z mm (optional)'),
      rotX: num('Rotation X degrees (optional)'), rotY: num('Rotation Y degrees (optional)'), rotZ: num('Rotation Z degrees (optional)'),
      scaleX: num('Scale X (optional, 1=100%)'), scaleY: num('Scale Y (optional)'), scaleZ: num('Scale Z (optional)'),
    },
    required: ['id'],
  },
  { name: 'slicer_auto_orient_object', description: 'Auto-orient a plate object to minimise support material needed.', params: { id: str('Plate object ID') }, required: ['id'] },
  { name: 'slicer_drop_to_bed', description: 'Drop a plate object so its lowest point sits on the build plate (Z=0).', params: { id: str('Plate object ID') }, required: ['id'] },
  { name: 'slicer_center_object', description: 'Centre a plate object in XY on the build plate.', params: { id: str('Plate object ID') }, required: ['id'] },
  {
    name: 'slicer_scale_to_height',
    description: 'Uniformly scale a plate object so its Z height equals the target.',
    params: { id: str('Plate object ID'), targetHeight: num('Target height mm') },
    required: ['id', 'targetHeight'],
  },
  { name: 'slicer_auto_arrange', description: 'Auto-arrange all plate objects to fit the build volume with minimal overlap.', params: {} },
  { name: 'slicer_remove_plate_object', description: 'Remove one object from the build plate.', params: { id: str('Plate object ID') }, required: ['id'] },

  // Per-object settings + utilities
  {
    name: 'slicer_set_per_object_setting',
    description: 'Override a print setting for one plate object only (e.g. infillDensity, wallCount, supportEnabled). Other objects keep global values.',
    params: {
      id: str('Plate object ID'),
      key: str('Print profile field name to override'),
      value: { type: 'string', description: 'New value as JSON' },
    },
    required: ['id', 'key', 'value'],
  },
  { name: 'slicer_run_printability_check', description: 'Run a printability analysis (overhang, thin walls, manifold check) and surface results in the slicer panel.', params: {} },
  { name: 'slicer_download_gcode', description: 'Trigger a browser download of the sliced G-code file. Requires a completed slice.', params: {} },

  // Camera
  {
    name: 'slicer_set_camera_preset',
    description: 'Snap the 3D viewport camera to a preset angle (iso/top/front/right).',
    params: { preset: en('Camera preset', ['iso', 'top', 'front', 'right']) },
    required: ['preset'],
  },
  { name: 'slicer_fit_to_plate', description: 'Frame the camera to show all objects on the build plate.', params: {} },
  {
    name: 'slicer_focus_object',
    description: 'Frame the camera to show a single plate object by ID.',
    params: { id: str('Plate object ID from slicer_list_plate_objects') },
    required: ['id'],
  },

  // Preview / layer control
  {
    name: 'slicer_set_preview_mode',
    description: "Switch the slicer viewport between 3D model view ('model') and G-code layer preview ('preview').",
    params: { mode: en('Viewport mode', ['model', 'preview']) },
    required: ['mode'],
  },
  {
    name: 'slicer_set_preview_layer',
    description: 'Set the active layer shown in the G-code layer preview. Requires preview mode.',
    params: { layer: num('Layer index (0-based, clamped to total layer count)') },
    required: ['layer'],
  },
  {
    name: 'slicer_set_preview_layer_range',
    description: 'Set the start and end layers of the range shown in the G-code preview.',
    params: { start: num('Start layer index'), end: num('End layer index') },
    required: ['start', 'end'],
  },

  // Plate history
  { name: 'slicer_undo', description: 'Undo the last plate operation (move, rotate, scale, add, remove, etc.).', params: {} },
  { name: 'slicer_redo', description: 'Redo the previously undone plate operation.', params: {} },
  {
    name: 'slicer_duplicate_plate_object',
    description: 'Duplicate a plate object and place the copy offset from the original.',
    params: { id: str('Plate object ID to duplicate') },
    required: ['id'],
  },

  // Selection
  { name: 'slicer_select_plate_object', description: 'Set the active selection to one plate object by ID. Pass null to deselect all.', params: { id: str('Plate object ID, or "null" to clear selection') }, required: ['id'] },
  { name: 'slicer_clear_selection', description: 'Deselect all plate objects.', params: {} },
  { name: 'slicer_get_selection', description: 'Return the IDs of all currently selected plate objects.', params: {} },
  { name: 'slicer_duplicate_selected', description: 'Duplicate all currently selected plate objects.', params: {} },

  // Object properties
  { name: 'slicer_set_object_locked', description: 'Lock or unlock a plate object to prevent accidental moves.', params: { id: str('Plate object ID'), locked: { type: 'string', description: '"true" or "false"' } }, required: ['id', 'locked'] },
  { name: 'slicer_set_object_hidden', description: 'Hide or show a plate object. Hidden objects are excluded from slicing.', params: { id: str('Plate object ID'), hidden: { type: 'string', description: '"true" or "false"' } }, required: ['id', 'hidden'] },
  { name: 'slicer_set_object_color', description: 'Set a per-object color override. Pass an empty string to reset to default.', params: { id: str('Plate object ID'), color: str('CSS color string (e.g. "#ff4400") or empty string to reset') }, required: ['id', 'color'] },

  // Plate operations
  { name: 'slicer_clear_plate', description: 'Remove all objects from the build plate and reset plate state.', params: {} },
  { name: 'slicer_resolve_overlaps', description: 'Nudge a plate object to eliminate collisions with other objects.', params: { id: str('Plate object ID') }, required: ['id'] },

  // Geometry tools
  { name: 'slicer_hollow_object', description: 'Shell a plate object, leaving only walls of the specified thickness.', params: { id: str('Plate object ID'), wallThickness: num('Wall thickness mm') }, required: ['id', 'wallThickness'] },
  {
    name: 'slicer_cut_object_by_plane',
    description: 'Split a plate object at a plane defined by a point and normal. Produces two objects.',
    params: {
      id: str('Plate object ID'),
      axis: en('Shorthand axis for the cut normal (overrides pointX/Y/Z + normalX/Y/Z if provided)', ['X', 'Y', 'Z']),
      offset: num('Plane offset along the axis mm (used with axis shorthand)'),
      pointX: num('Plane point X mm'), pointY: num('Plane point Y mm'), pointZ: num('Plane point Z mm'),
      normalX: num('Plane normal X'), normalY: num('Plane normal Y'), normalZ: num('Plane normal Z'),
    },
    required: ['id'],
  },

  // Preview visualization
  { name: 'slicer_set_preview_color_mode', description: 'Set the G-code preview color scheme. Options: type, speed, flow, width, layer-time, wall-quality, seam.', params: { mode: en('Color mode', ['type', 'speed', 'flow', 'width', 'layer-time', 'wall-quality', 'seam']) }, required: ['mode'] },
  { name: 'slicer_set_preview_render_mode', description: "Switch the G-code preview between solid geometry ('solid') and wireframe ('wireframe').", params: { mode: en('Render mode', ['solid', 'wireframe']) }, required: ['mode'] },
  { name: 'slicer_set_preview_show_travel', description: 'Show or hide travel move lines in the G-code preview.', params: { show: { type: 'string', description: '"true" or "false"' } }, required: ['show'] },
  { name: 'slicer_set_preview_show_retractions', description: 'Show or hide retraction/prime markers in the G-code preview.', params: { show: { type: 'string', description: '"true" or "false"' } }, required: ['show'] },
  {
    name: 'slicer_toggle_preview_feature_type',
    description: 'Toggle visibility of a specific feature type in the G-code preview. Types: wall-outer, wall-inner, gap-fill, infill, top-bottom, support, skirt, brim, raft, bridge, ironing.',
    params: { type: en('Feature type', ['wall-outer', 'wall-inner', 'gap-fill', 'infill', 'top-bottom', 'support', 'skirt', 'brim', 'raft', 'bridge', 'ironing']) },
    required: ['type'],
  },
  { name: 'slicer_set_section_plane', description: 'Control the cross-section clipping plane in the slicer viewport.', params: { enabled: { type: 'string', description: '"true" or "false"' }, z: num('Section plane Z height mm') }, required: ['enabled'] },

  // Nozzle simulation
  { name: 'slicer_set_sim_enabled', description: 'Enable or disable the nozzle travel simulation overlay.', params: { enabled: { type: 'string', description: '"true" or "false"' } }, required: ['enabled'] },
  { name: 'slicer_set_sim_playing', description: 'Play or pause the nozzle simulation.', params: { playing: { type: 'string', description: '"true" or "false"' } }, required: ['playing'] },
  { name: 'slicer_set_sim_time', description: 'Scrub the nozzle simulation to a specific elapsed time in seconds.', params: { time: num('Elapsed time seconds') }, required: ['time'] },
  { name: 'slicer_set_sim_speed', description: 'Set the nozzle simulation playback speed multiplier.', params: { speed: num('Speed multiplier (1 = real-time, 10 = 10× faster)') }, required: ['speed'] },

  // Analytics
  { name: 'slicer_get_slice_stats', description: 'Return a per-feature filament/time breakdown and a list of detected print quality issues. Requires a completed slice.', params: {} },
);

// ── Physical printer machine control ─────────────────────────────────────────

BYOK_TOOLS.push(
  // Status & connection
  { name: 'printer_list_printers', description: 'List saved printers with IDs, names, active flag, and whether each has a configured hostname. Use this before named-printer commands.', params: {} },
  { name: 'printer_select_printer', description: 'Switch the active printer by ID before running printer control tools on that printer.', params: { id: str('Printer ID from printer_list_printers') }, required: ['id'] },
  { name: 'printer_get_status', description: 'Return live machine status: connection state, temperatures (bed/chamber/tools), axis positions, active job progress, speed factor, and fan speeds.', params: {} },
  { name: 'printer_connect', description: 'Connect to the active printer using its saved configuration.', params: {} },
  { name: 'printer_disconnect', description: 'Disconnect from the active printer.', params: {} },

  // Raw G-code
  { name: 'printer_send_gcode', description: 'Send a raw G-code command to the printer and return the response.', params: { code: str('G-code command string (e.g. "M114" or "G28 X Y")') }, required: ['code'] },

  // Temperature
  { name: 'printer_set_tool_temp', description: 'Set the active temperature for a tool heater. Pass standby to also set standby temp.', params: { tool: num('Tool index (0-based)'), heater: num('Heater index within the tool (usually 0)'), temp: num('Active temperature °C'), standby: num('Standby temperature °C (optional)') }, required: ['tool', 'heater', 'temp'] },
  { name: 'printer_set_bed_temp', description: 'Set the heated bed target temperature.', params: { temp: num('Target temperature °C (0 = off)') }, required: ['temp'] },
  { name: 'printer_set_chamber_temp', description: 'Set the chamber heater target temperature.', params: { temp: num('Target temperature °C (0 = off)') }, required: ['temp'] },

  // Motion
  { name: 'printer_home_axes', description: 'Home one or more axes. Pass no axes to home all.', params: { axes: { type: 'array', description: 'Axes to home, e.g. ["X","Y","Z"]. Omit to home all.' } as ToolParam } },
  { name: 'printer_move_axis', description: 'Jog an axis by a relative distance.', params: { axis: str('Axis letter (X, Y, Z, E, etc.)'), distance: num('Distance mm (negative = opposite direction)') }, required: ['axis', 'distance'] },
  { name: 'printer_extrude', description: 'Extrude or retract filament on the active tool.', params: { amount: num('Amount mm (negative = retract)'), feedrate: num('Feed rate mm/min') }, required: ['amount', 'feedrate'] },
  { name: 'printer_set_baby_step', description: 'Apply a live Z baby-step offset (M290 S{offset}).', params: { offset: num('Z offset mm') }, required: ['offset'] },

  // Speed & flow
  { name: 'printer_set_speed_factor', description: 'Set the global print speed override percentage (M220). 100 = normal.', params: { percent: num('Speed percentage (e.g. 80 for 80%)') }, required: ['percent'] },
  {
    name: 'printer_set_flow_factor',
    description: 'Set the extrusion flow factor (M221). Pass extruder=-1 for global override.',
    params: { extruder: num('Extruder index (0-based), or -1 for global'), percent: num('Flow percentage (e.g. 100 for 100%)') },
    required: ['extruder', 'percent'],
  },

  // Fan
  { name: 'printer_set_fan_speed', description: 'Set a fan speed. Speed is 0.0–1.0 (fraction) or 0–255 (PWM).', params: { fan: num('Fan index'), speed: num('Speed 0.0–1.0') }, required: ['fan', 'speed'] },

  // Print control
  { name: 'printer_start_print', description: 'Start printing a G-code file from the printer SD card.', params: { filename: str('Full path on SD card, e.g. "0:/gcodes/benchy.gcode"') }, required: ['filename'] },
  { name: 'printer_pause_print', description: 'Pause the current print (M25).', params: {} },
  { name: 'printer_resume_print', description: 'Resume a paused print (M24).', params: {} },
  { name: 'printer_cancel_print', description: 'Cancel the current print and stop all movement (M0).', params: {} },
  { name: 'printer_emergency_stop', description: 'Immediately halt all motion and heaters (M112). Use only in emergencies.', params: {} },

  // Files
  { name: 'printer_list_files', description: "List G-code files on the printer's SD card in the specified directory.", params: { directory: str('Directory path (default: "0:/gcodes")') } },
  { name: 'printer_delete_file', description: "Delete a file from the printer's SD card.", params: { path: str('Full file path on SD card') }, required: ['path'] },

  // Macros
  { name: 'printer_list_macros', description: 'List available macros from the printer macro directory.', params: {} },
  { name: 'printer_run_macro', description: 'Execute a macro file on the printer.', params: { filename: str('Macro filename (without path prefix)') }, required: ['filename'] },

  // Filament
  { name: 'printer_load_filament', description: 'Load a filament profile on a tool (runs the load macro).', params: { tool: num('Tool index'), name: str('Filament name from 0:/filaments/') }, required: ['tool', 'name'] },
  { name: 'printer_unload_filament', description: 'Unload filament from a tool (runs the unload macro).', params: { tool: num('Tool index') }, required: ['tool'] },

  // Vision
  {
    name: 'vision_check_print',
    description: 'Capture a printer camera frame, combine it with printer telemetry and slicer geometry, and classify likely print failures such as spaghetti, layer shift, blob-of-doom, first-layer adhesion, or knocked-loose parts.',
    params: {
      cameraId: str('Optional camera ID. Defaults to the active camera.'),
      confidenceThreshold: num('Failure confidence threshold from 0 to 1. Defaults to 0.82.'),
      autoPauseEnabled: { type: 'string', description: '"true" to pause when confidence is above threshold; default false' },
      requireUserConfirmation: { type: 'string', description: '"true" to require confirmation before an auto-pause; default true' },
      saveSettings: { type: 'string', description: '"true" to persist the supplied threshold and auto-pause settings' },
      confirmAutoAction: { type: 'string', description: '"true" only after the user confirms the suggested auto-pause' },
      notes: str('Optional operator notes to include in the diagnosis context.'),
    },
  },
  {
    name: 'diagnose_print',
    description: 'Diagnose what is wrong with the active print from recent camera frames, printer telemetry, filament sensor state, and slicer expected-vs-actual layer timing. Returns ranked causes and actionable suggestions.',
    params: {
      cameraId: str('Optional camera ID. Defaults to the active camera.'),
      frameCount: num('Number of recent frames to include, 1 to 5. Defaults to 3.'),
      notes: str('Optional operator notes to include in the diagnosis context.'),
    },
  },
  {
    name: 'tuning_analyze_tower',
    description: 'Analyze calibration tower camera frames for pressure advance, retraction, temperature, first-layer squish, or input shaping. AI recommends values only; the operator applies them.',
    params: {
      kind: en('Tuning wizard kind', ['pressure-advance', 'retraction', 'temperature', 'first-layer-squish', 'input-shaper']),
      cameraId: str('Optional camera ID. Defaults to the active camera.'),
      frameCount: num('Number of recent frames to include, 1 to 5. Defaults to 3.'),
      startValue: num('Tower start value, when applicable.'),
      stepPerMm: num('Tower setting increment per mm, when applicable.'),
      towerHeightMm: num('Visible/measured tower height in mm, when applicable.'),
      axis: en('Axis for input shaper analysis', ['X', 'Y']),
      notes: str('Optional operator notes to include in the tuning analysis.'),
    },
    required: ['kind'],
  },
);

export const DESTRUCTIVE_TOOLS = new Set([
  'boolean_subtract',
  'boolean_intersect',
  'printer_send_gcode',
  'printer_set_tool_temp',
  'printer_set_bed_temp',
  'printer_set_chamber_temp',
  'printer_home_axes',
  'printer_move_axis',
  'printer_extrude',
  'printer_set_baby_step',
  'printer_set_speed_factor',
  'printer_set_flow_factor',
  'printer_set_fan_speed',
  'printer_start_print',
  'printer_pause_print',
  'printer_resume_print',
  'printer_cancel_print',
  'printer_emergency_stop',
  'printer_delete_file',
  'printer_run_macro',
  'printer_load_filament',
  'printer_unload_filament',
]);
