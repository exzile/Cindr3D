---
name: Theme System Architecture
description: How light/dark theming works across all workspaces and the 3D viewport
type: project
---

All workspaces (Design, Slicer, Duet printer) and the 3D viewport share a single theme system driven by CSS custom properties.

**Why:** User explicitly asked for themes to carry between all pages including the 3D canvas.

**How to apply:** Any new component with inline styles must import from `src/utils/theme.ts` instead of defining local color constants. 3D viewport colors must come from `useThemeStore((s) => s.colors)`.

## Theme flow
1. `src/store/themeStore.ts` — defines `lightColors` and `darkColors` objects with 50+ tokens, calls `applyTheme(colors, mode)` which sets CSS custom properties and `data-theme` attribute on `document.documentElement`
2. `src/utils/theme.ts` — exports `colors` object mapping semantic names to `var(--css-var)` strings, plus `sharedStyles` for common inline style shapes
3. Components import `{ colors as COLORS } from '../utils/theme'` and use tokens like `COLORS.panel`, `COLORS.accent`, `COLORS.textDim`
4. 3D viewport uses `useThemeStore((s) => s.colors)` directly for Three.js colors (can't use CSS vars in WebGL)

## Why CSS vars work in inline styles
`style={{ background: 'var(--bg-panel)' }}` — the browser resolves `var()` dynamically, so theme changes from `themeStore.applyTheme()` propagate to all components without re-renders.

## 3D Viewport Theming
- `SceneTheme` component inside Canvas reactively syncs `gl.setClearColor()` and `scene.background` with `themeColors.canvasBg`
- `GroundPlaneGrid` uses `themeColors.gridCell`, `gridSection`, `groundPlane`, `groundPlaneEdge`
- Axis lines use `themeColors.axisRed`, `axisGreen`, `axisBlue`
- Hemisphere light uses `themeColors.hemisphereColor`, `hemisphereGround`
- Light theme: soft gray-blue canvas (#d6dce4), subtle grid lines
- Dark theme: deep purple canvas (#1a1a2e), vibrant grid lines

## Viewport-specific ThemeColors tokens
`canvasBg`, `gridCell`, `gridSection`, `groundPlane`, `groundPlaneEdge`, `axisRed`, `axisGreen`, `axisBlue`, `hemisphereColor`, `hemisphereGround`

## Completed migrations
- `SlicerWorkspace.tsx` — uses `colors` + `sharedStyles` from theme.ts
- `DuetPrinterPanel.tsx` — imports `colors as COLORS` from theme.ts
- `DuetDashboard.tsx` — imports `colors as COLORS` from theme.ts
- `DuetMessageBox.tsx` — imports `colors as COLORS` from theme.ts
- `DuetSettings.tsx` — imports `colors as COLORS` from theme.ts
- `DuetNotifications.tsx` — TOAST_COLORS use `var(--info)` etc.
- `Viewport.tsx` — all Three.js colors from themeStore, SceneTheme reactive sync

## Available color tokens (src/utils/theme.ts)
bg, panel, panelLight, elevated, elevatedHover, inputBg, hover, active,
text, textSecondary, textDim,
panelBorder, borderLight, borderStrong, inputBorder,
accent, accentHover, accentLight, accentDim,
success, warning, danger, dangerHover, error, info,
overlay, surface, surfaceHover
