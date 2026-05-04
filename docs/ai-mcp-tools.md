# Cindr3D MCP Tool Reference

Generated from the MCP tool schemas registered in `vite.config.ts`.

Cindr3D exposes a localhost-only Model Context Protocol server during development. The MCP server listens on `http://localhost:5174/mcp?token=...` by default and relays tool calls into the open Cindr3D browser tab.

## Connection

| Item | Value |
|------|-------|
| Default app URL | `http://localhost:5173` |
| Default MCP URL | `http://localhost:5174/mcp?token=...` |
| Port override | `CINDR3D_MCP_PORT` |
| Pairing command | Copy the `claude mcp add cindr3d ...` line from the AI MCP status badge |

The browser tab must stay open because CAD actions are executed through the in-page bridge. The server accepts localhost clients only, requires the pairing token, rate-limits tool calls, and records tool activity in the AI MCP status badge.

## Document And Scene

| Tool | Inputs | Description |
|------|--------|-------------|
| `cindr3d_status` | none | Reports whether a Cindr3D browser tab is connected. |
| `list_objects` | none | Returns feature and body ids, names, kinds, visibility, and suppression state. |
| `get_object_properties` | `id: string` | Returns full details for one feature, including params, sketch id, body kind, and mesh bounds when available. |
| `select_objects` | `ids: string[]` | Selects features by id. Pass an empty array to clear selection. |
| `snapshot_view` | none | Captures the 3D viewport as a PNG image for visual inspection. |

## Primitives

All primitive dimensions are in millimeters.

| Tool | Inputs | Description |
|------|--------|-------------|
| `create_box` | `x: number`, `y: number`, `z: number`, optional `px`, `py`, `pz` | Inserts a box primitive at the optional position. |
| `create_cylinder` | `radius: number`, `height: number`, optional `px`, `py`, `pz` | Inserts a cylinder primitive. |
| `create_sphere` | `radius: number`, optional `px`, `py`, `pz` | Inserts a sphere primitive. |
| `create_cone` | `r1: number`, `r2: number`, `height: number`, optional `px`, `py`, `pz` | Inserts a cone-like cylinder. `r1` is bottom radius, `r2` is top radius. |

## Sketches

Sketch coordinates use the active sketch plane units, millimeters by default.

| Tool | Inputs | Description |
|------|--------|-------------|
| `start_sketch` | `plane: "XY" \| "XZ" \| "YZ"` | Begins a new sketch on the selected plane. |
| `sketch_rect` | `x: number`, `y: number`, `w: number`, `h: number`, optional `centered: boolean` | Adds a rectangle to the active sketch. |
| `sketch_circle` | `cx: number`, `cy: number`, `radius: number` | Adds a circle to the active sketch. |
| `sketch_polygon` | `points: [number, number][]` | Adds a closed polyline from the supplied points. |
| `sketch_dimension` | `entityId: string`, `value: number` | Applies a dimension constraint to a sketch entity. |
| `finish_sketch` | none | Commits and closes the active sketch. |

## Features

| Tool | Inputs | Description |
|------|--------|-------------|
| `extrude_sketch` | `sketchId: string`, `depth: number`, optional `direction`, optional `operation` | Extrudes a sketch. `direction` is `one-side`, `symmetric`, or `two-sides`; `operation` is `new-body`, `join`, `cut`, or `intersect`. |
| `revolve_sketch` | `sketchId: string`, `axis: "X" \| "Y" \| "Z"`, optional `angle: number` | Revolves a sketch around an axis. |
| `fillet_edges` | `objectId: string`, `edgeIds: string[]`, `radius: number` | Applies a constant-radius fillet. |
| `chamfer_edges` | `objectId: string`, `edgeIds: string[]`, `distance: number` | Applies a chamfer. |
| `hole` | `objectId: string`, `x: number`, `y: number`, `z: number`, `diameter: number`, `depth: number`, optional `throughAll: boolean` | Creates a simple drilled hole on a feature. |

## Booleans And Transforms

| Tool | Inputs | Description |
|------|--------|-------------|
| `boolean_union` | `targetId: string`, `toolId: string` | Joins two features into one solid body. |
| `boolean_subtract` | `targetId: string`, `toolId: string` | Subtracts the tool feature from the target feature. |
| `boolean_intersect` | `targetId: string`, `toolId: string` | Keeps only the intersection of two features. |
| `transform` | `id: string`, optional `tx`, `ty`, `tz`, `sx`, `sy`, `sz` | Translates or scales a feature mesh. |
| `mirror` | `id: string`, `plane: "XY" \| "XZ" \| "YZ"` | Mirrors a feature across a named plane. |
| `linear_pattern` | `id: string`, `axis: "X" \| "Y" \| "Z"`, `count: number`, `spacing: number` | Creates a linear pattern along an axis. |
| `circular_pattern` | `id: string`, `axis: "X" \| "Y" \| "Z"`, `count: number`, optional `totalAngle: number` | Creates a circular pattern around an axis. |

## Export And Save

| Tool | Inputs | Description |
|------|--------|-------------|
| `save_session` | none | Saves the current design to a `.dznd` file through the browser. |
| `export_stl` | optional `ids: string[]` | Exports selected objects, or all objects when omitted, as STL. |
| `export_step` | optional `ids: string[]` | Exports selected objects, or all objects when omitted, as STEP. |
| `export_gcode` | optional `profileId: string` | Slices the design and exports G-code with the active or selected printer profile. |

## Resources

| Resource URI | Description |
|--------------|-------------|
| `cindr3d://document/summary` | Active document summary: units, object counts, workspace mode, and plate state. |
| `cindr3d://document/objects` | Full active document object list as JSON. |
| `cindr3d://printer/active` | Active printer and machine configuration as JSON. |

## Client Guidance

Prefer read-only calls first: `cindr3d_status`, `list_objects`, `get_object_properties`, and `snapshot_view`. When changing geometry, use explicit dimensions and inspect with `snapshot_view` after meaningful steps. For destructive or broad operations, select target ids with `list_objects` rather than relying on names alone.
