# DesignCAD

A web-based parametric CAD application inspired by Fusion 360, built with React, Three.js, and TypeScript.

## Features

- **3D Viewport** with orbit, pan, zoom controls and a view cube
- **Sketch Mode** on XY, XZ, YZ planes with snap-to-grid
  - Line, Circle, Rectangle, Arc tools
  - Real-time preview while drawing
- **3D Operations**
  - Extrude sketches into solid bodies
  - Revolve sketches around an axis
  - Fillet edges
- **File Import**
  - Fusion 360 `.f3d` files
  - STEP/STP files
  - STL files (binary and ASCII)
  - OBJ files
- **Feature Timeline** with visibility toggling and feature management
- **Dark UI** styled after professional CAD software

## Tech Stack

- **React 19** + **TypeScript**
- **Three.js** via `@react-three/fiber` and `@react-three/drei`
- **Zustand** for state management
- **Vite** for build tooling
- **Lucide React** for icons

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Usage

1. **Create a Sketch**: Click "Sketch XY/XZ/YZ" to enter sketch mode on the chosen plane
2. **Draw Geometry**: Use Line, Circle, Rectangle, or Arc tools to draw shapes
3. **Finish Sketch**: Click "Finish Sketch" to save your sketch
4. **Extrude**: Click "Extrude", select a sketch, set the distance, and click OK
5. **Import Files**: Click "Import" to load STEP, F3D, STL, or OBJ files

### Controls

| Action | Input |
|--------|-------|
| Orbit | Left mouse drag (3D mode) |
| Pan | Right mouse drag |
| Zoom | Scroll wheel |
| Draw | Left click (sketch mode) |
| Cancel drawing | Escape |

## Build

```bash
npm run build
```

Output is in the `dist/` directory, ready for static hosting.
