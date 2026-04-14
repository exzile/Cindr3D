---
name: UI Architecture
description: Fusion 360-style ribbon toolbar, ViewCube, canvas controls, flyout menus, sketch palette
type: project
---

## Ribbon Toolbar (Toolbar.tsx)

The toolbar uses a Fusion 360-style ribbon layout with workspace selector, tabbed sections, and flyout dropdown menus.

### Flyout Menus (Portal-based)
- Section labels (CREATE, MODIFY, etc.) with `menuItems` prop show a `▾` chevron
- Clicking opens a flyout dropdown rendered via `createPortal(menu, document.body)` to escape `.ribbon-content`'s `overflow-y: hidden`
- Position is calculated from the label's `getBoundingClientRect()` and set as `position: fixed`
- Click-outside detection checks both `sectionRef` and `menuRef` (portal is outside DOM tree)
- CSS class `.flyout-menu` uses `position: fixed; z-index: 10000`

### ToolButton Dropdowns
- Individual `ToolButton` components can have a `dropdown` prop for small context menus
- These are rendered INSIDE the button container (NOT portaled) — they CAN be clipped by `.ribbon-content` overflow
- **Known issue:** ToolButton dropdowns (e.g., Sketch button dropdown) get clipped by parent overflow. Should be converted to portals if they extend beyond ribbon bounds.

### Tab System
- Design tabs: SOLID, SURFACE, MESH, SHEET METAL, PLASTIC, MANAGE, UTILITIES
- Prepare tabs: PLATE, PROFILES, SLICE, EXPORT
- Sketch tab: contextual tab that appears when editing a sketch
- Each tab has a colored underline via CSS `--tab-color` variable

## ViewCube (ViewCube.tsx)
- Separate `<Canvas>` overlay in top-right of viewport
- Syncs rotation with main camera via quaternion
- Clickable faces (6), edges (12), corners (8) for orientation
- Axis triad with arrowheads and labels (X=red, Y=green, Z=blue) originating from bottom-left corner of cube
- Navigation controls: home button, orbit arrows (up/down/left/right), orbit CW/CCW, zoom-to-fit
- Uses `@react-three/drei` `Html` component for axis labels

## Canvas Controls (CanvasControls.tsx)
- Bottom-right bar with popover menus
- Grid/snap toggles, display settings, navigation tools

## Ground Plane Grid (Viewport.tsx - GroundPlaneGrid component)
- Solid platform slab with `boxGeometry` for physical depth
- Custom grid lines via `BufferGeometry` with vertex colors (fine cells + thick major sections)
- Colored axis lines on ground: Red (X), Green (Z), Blue (Y vertical)
- All colors theme-aware via `themeStore` tokens

## Sketch Palette (SketchPalette.tsx)
- Floating panel positioned on the right side of the viewport
- Shows when `activeSketch` is not null
- Options: Linetype, Look At, Sketch Grid, Snap, Slice, Profile, Points, Dimensions, Constraints, Projected Geometries, Construction Geometries, 3D Sketch
- Finish Sketch button at bottom

## 3D Viewport Theming
- `SceneTheme` component inside Canvas reactively syncs `gl.setClearColor()` and `scene.background` with theme
- Theme tokens for viewport: `canvasBg`, `gridCell`, `gridSection`, `groundPlane`, `groundPlaneEdge`, `axisRed`, `axisGreen`, `axisBlue`, `hemisphereColor`, `hemisphereGround`
- Light theme: soft gray-blue tones; Dark theme: deep purple tones
