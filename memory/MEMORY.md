# DesignCAD Project Memory

## Core Architecture
- [Project Architecture](project_architecture.md) — Stack (React 19/TypeScript/Vite/Three.js), workspace structure, store locations, key files, slicer parity status
- [Theme System](theme_system.md) — How light/dark theming works; CSS vars via themeStore; 3D viewport theming; migration status
- [Parameters System](parameters_system.md) — Named variable/parametric design feature; expression evaluator; dialog integration pattern
- [UI Architecture](ui_architecture.md) — Fusion 360-style ribbon toolbar, ViewCube, canvas controls, flyout menus (portal-based), sketch palette

## Slicer
- [Slicer Implementation](slicer_implementation.md) — Architecture, bugs fixed, full PrintProfile settings list, 16 UI sections, file import, transform controls, known remaining gaps vs Cura
- [Slicer Profiles Reference](slicer_profiles.md) — All 3 printer profiles, 9 material profiles, 3 print profiles with key values; G-code preview color coding
- [Cura Feature Inventory](cura_feature_inventory.md) — Complete Cura 5.12.0 feature set: 17 setting categories, 416 settings, 40+ plugins, file formats, advanced features — used as parity target

## Build & Debug
- [VS 2026 Setup](vs2026_setup.md) — Visual Studio 2026 .esproj configuration, F5 debugging, SDK version pinning
