<div align="center">

# DesignCAD

**Browser-based CAD, slicing, and printer control for makers and self-hosted workshops.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178c6.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646cff.svg)](https://vite.dev/)
[![Node](https://img.shields.io/badge/Node-%3E%3D22.12.0-339933.svg)](package.json)

DesignCAD brings a professional CAD-style workflow into a web app that can run locally during development or be served from a small Linux board such as an Orange Pi.

</div>

> DesignCAD is not affiliated with Autodesk, Fusion 360, Duet3D, RepRapFirmware, or any slicer vendor.

## Contents

- [Overview](#overview)
- [What's New](#whats-new)
- [Feature Highlights](#feature-highlights)
- [Cross-Firmware Support](#cross-firmware-support)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Use Your Own Claude With DesignCAD](#use-your-own-claude-with-designcad)
- [Roadmap](#roadmap)
- [Development Scripts](#development-scripts)
- [Project Layout](#project-layout)
- [Production Builds](#production-builds)
- [Orange Pi Hosting](#orange-pi-hosting)
- [Self-Updater Service](#self-updater-service)
- [Release Assets](#release-assets)
- [Quality And Testing](#quality-and-testing)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Overview

DesignCAD combines design, print preparation, and multi-printer fleet control in one browser workspace. It's designed to run locally during development or be served from a small Linux board (Orange Pi or similar) on your home network — no cloud account required.

| Workspace | Purpose |
|-----------|---------|
| 🎨 **Design** | Sketching, solid modelling, imports/exports, feature timeline, component organisation. |
| 🛠️ **Prepare** | Plate setup, slicing pipeline with WASM kernel, G-code preview, calibration utilities. |
| 🖨️ **3D Printer** | Multi-printer fleet, live monitoring, files, macros, mid-print object cancellation, tuning, power, spools, timelapse, updates — all cross-firmware. |
| 🤖 **AI** | Local MCP server + BYOK in-app chat panel for driving CAD/slicer/printer actions through your own Claude / OpenAI / OpenRouter subscription. |

The project is evolving quickly. Some CAD and slicer features are experimental, but the repository is public so the implementation can be inspected, used, and improved in the open.

## What's New

> [!NOTE]
> **2026-05** — Cross-firmware unification. Klipper-style features now work on Duet RRF, Marlin, and any host that talks the basics. The slicer emits `M486` labels automatically.

**Headline features shipped this release:**

- 🎯 **Mid-print object cancellation** — `M486` on Duet RRF 3.5+ and Marlin 2.0.9+, `EXCLUDE_OBJECT` on Klipper. Three surfaces: dedicated tab, dashboard list card, and a 3D Print Preview viewport with right-click context menus.
- 🎬 **Live 3D Print Preview dashboard card** — viewport showing the build plate, plate-object silhouettes, and toolpath wireframe up to the layer currently being printed; right-click any object to cancel just that one.
- ⚙️ **Cross-firmware tuning UI** — Input Shaper, Pressure Advance, Power, Spools, Timelapse, and Updates tabs that route to the right firmware-specific commands automatically.
- 🏷️ **Slicer auto-labels** — every job DesignCAD slices is automatically tagged with `M486 S<id> A"<name>"` so cancellation works out of the box on uploaded files too.
- 📡 **Live progress on every firmware** — Duet via the RRF object model, Klipper via Moonraker `print_stats` polling, Marlin via `M73` parsing on the USB stream.
- 🤖 **AI Assistant** — local MCP server for Claude Code, plus an in-app BYOK chat panel that streams Anthropic, OpenAI, and OpenRouter with full tool-use.

## Feature Highlights

### 🎨 CAD & Modelling

- 3D viewport with orbit, pan, zoom, view-cube navigation
- Sketching on XY / XZ / YZ planes with constraint-driven tools (line, circle, rectangle, arc, text)
- Solid features: extrude, revolve, sweep, loft, shell, rib, split, draft, hole, thread, chamfer, fillet
- Mesh, surface, construction, inspect, assemble, utilities ribbon areas
- Component tree, feature timeline, selection filters, visibility controls
- Imports: `.f3d`, `.step`, `.stp`, `.stl`, `.obj`; project + settings bundle save/load
- Every CAD action is callable from the local MCP server (29 tools)

### 🛠️ Slicer & Preview

- Plate layout with multi-object support and per-object profile overrides
- WASM-backed geometry kernel (Clipper2, Arachne) for crisp boolean ops and variable-width walls
- Calibration utilities (towers, first-layer test)
- G-code preview with layer slider, simulation playback, wireframe / tube modes, multiple color schemes (type / speed / flow / width / layer-time / wall-quality / seam)
- Bridge skin classification with bridge-fan override
- Print, printer, and material profiles with multi-profile flows
- 🏷️ **`M486` object labels emitted automatically** — mid-print cancellation just works on supported firmware

### 🖨️ Printer Workflows (cross-firmware)

DesignCAD treats Klipper, Duet/RRF, Marlin, Smoothie, grbl, and Repetier as first-class boards. Tabs adapt to whichever board is connected; common features route to firmware-specific commands automatically.

**Mid-print object cancellation** — three places to cancel:

- 🎯 **Exclude Object tab** — full UI with click-to-arm, click-to-confirm cancel; firmware-version badge auto-disables the buttons on too-old firmware
- 📋 **Object Cancellation dashboard card** — compact two-click cancel inline with your other panels
- 🎬 **3D Print Preview viewport** — right-click any object for a context menu with dimensions, position, currently-printing/cancelled status, and a per-object cancel button

**Live print state** is fed in cross-firmware:

- **Duet** — full RRF object-model polling
- **Klipper** — Moonraker `print_stats` + `display_status` polled at 3 s
- **Marlin** — `M73` (`P` / `R` / `Q` / `S`) and `echo:Layer N/M` parsed from the USB serial stream

**Tabs:** Dashboard, Camera, Status, Console, Job, History, Analytics, Files, Macros, Bed Map, Exclude Object, Updates, Power, Input Shaper, Pressure Advance, Spools, Timelapse, Settings (plus Filaments / Object Model / DSF Plugins on Duet only).

### 🤖 AI Assistant

- 🔗 **Local MCP server** on `:5174` — pair Claude Code with `claude mcp add designcad …`
- 🛡️ **Localhost-only**, token-paired, per-tool rate-limited (12 calls / 10 s / tool), 80-entry audit log in the AI status badge
- 💬 **BYOK chat panel** — streaming Anthropic + OpenAI / OpenRouter with full tool-use; 29 tools cover primitives, sketches, features, booleans, transforms, exports, viewport snapshots, and document inspection
- 🔒 Confirmation gate for destructive operations (configurable, off by default)
- ↻ Token rotation from the badge; old tokens invalidate immediately on rotation

### 📡 Self-hosting & deployment

- Static SPA — any static host works; Nginx fallback to `index.html`
- Optional Orange Pi updater service exposing `GET /api/update/status` + `POST /api/update/apply` against the latest GitHub release asset
- WASM artifacts bundled and budget-checked in CI

## Cross-Firmware Support

| Tab / Feature | Klipper | Duet (RRF) | Marlin (USB) | Other |
|---|:---:|:---:|:---:|:---:|
| Dashboard (live) | ✅ | ✅ | ✅ | ✅ |
| Camera | ✅ | ✅ | ✅ | ✅ |
| Files | ✅ | ✅ | — | varies |
| Macros | ✅ | ✅ | — | varies |
| **Exclude Object** | ✅ `EXCLUDE_OBJECT` | ✅ `M486` (3.5+) | ✅ `M486` (2.0.9+) | Workaround page |
| Bed Map | ✅ Moonraker mesh | ✅ heightmap.csv | ✅ G29 | — |
| Input Shaper | ✅ `SET_INPUT_SHAPER` | ✅ `M593` (3.3+) | ✅ `M593` | Notes only |
| Pressure Advance | ✅ `SET_PRESSURE_ADVANCE` | ✅ `M572` | ✅ `M900` | Notes only |
| Power | ✅ Moonraker | ✅ HTTP plugs | ✅ HTTP plugs | ✅ HTTP plugs |
| Spools | ✅ Spoolman bridge | ✅ local | ✅ local | ✅ local |
| Timelapse | ✅ `moonraker-timelapse` | ✅ in-browser | ✅ in-browser | ✅ in-browser |
| Updates | ✅ component + GitHub | ✅ GitHub | ✅ GitHub | ✅ GitHub |
| Object Model browser | — | ✅ | — | — |
| DSF Plugins | — | ✅ SBC | — | — |

> [!TIP]
> Mid-print cancellation requires labelled G-code. DesignCAD-sliced jobs are labelled automatically. For files from PrusaSlicer / SuperSlicer / OrcaSlicer, enable **Print Settings → Output → Label objects**. For Cura, run the **Label Objects** post-processing script.

## Tech Stack

| Area | Tools |
|------|-------|
| UI | React 19, TypeScript, Lucide React |
| 3D | Three.js, `@react-three/fiber`, `@react-three/drei` |
| State | Zustand |
| Build | Vite 8 |
| Tests | Vitest, Testing Library |
| Quality | ESLint, TypeScript composite builds |
| Geometry/runtime | WASM assets for selected geometry and slicer operations |

## Quick Start

Requirements:

- Node.js `22.12.0` or newer
- npm
- A modern browser with WebGL support

Use the expected Node major version if you have `nvm`:

```bash
nvm use
```

Install dependencies:

```bash
npm ci
```

Start the dev server:

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

## Use Your Own Claude With DesignCAD

DesignCAD ships with two complementary AI integration paths. Both reuse the same 29-tool MCP surface, so behaviour is identical across them.

### 🔗 Path 1: Pair Claude Code via MCP (recommended)

Run Claude Code locally and add DesignCAD as an MCP server. Your subscription quota covers the conversation; geometry shows up live in the running browser session.

```bash
# Start the dev server
npm run dev

# Open http://localhost:5173, then click the AI MCP status badge
# in the status bar to copy the pairing command:
claude mcp add designcad http://localhost:5174/mcp?token=...
```

The browser tab must stay open — tool calls are relayed into the running DesignCAD session.

### 💬 Path 2: BYOK in-app chat panel

For users who prefer not to run Claude Code, the **AI Chat tab** inside DesignCAD provides a streaming chat interface that connects to your own Anthropic, OpenAI, or OpenRouter API key. Set the provider, model, and key in **Global Settings → AI**; the key is stored locally and sent only to your chosen provider.

### 🛡️ Safety & Hardening

- Localhost-only — refuses non-localhost origins
- Token-paired auth, rotateable from the AI status badge
- Per-tool rate limiting (12 calls / 10 s / tool)
- 80-entry audit log of every tool call in the badge popover
- Optional confirmation gate before destructive operations

See [docs/ai-mcp-tools.md](docs/ai-mcp-tools.md) for the tool reference and [docs/ai-examples.md](docs/ai-examples.md) for sample assistant transcripts ("design a phone stand", "add 3 mm fillet to all top edges").

## Roadmap

The next 12 phases of work are tracked in detail in [`TaskLists.txt`](TaskLists.txt). Highlights:

| Phase | Theme | What lands |
|---|---|---|
| 7 | 🏭 Print farm intelligence | Cross-printer queue, all-cameras grid, A/B compare, multi-camera per printer, PTZ, WebRTC streaming, fleet inventory |
| 8 | 👁️ Vision / AI | Failure detection, "what's wrong" diagnostics, auto-tune wizards, camera measurement, natural-language control |
| 9 | 🥽 AR camera overlay | Calibrated toolpath projected on live camera feed; cancel objects directly from the camera view |
| 10 | 💰 Cost & energy | Cost-per-print, off-peak scheduling, solar-aware printing, sustainability dashboard |
| 11 | 🔧 Maintenance & calibration | Calibration aging, wear tracking, filament moisture model |
| 12 | 📅 Print scheduling | Calendar, bed-clearing auto-queue, pre-flight checklist |
| 13 | 🔌 Integrations | Webhooks + Discord/Slack/Telegram, MQTT, HomeAssistant, profile import (Cura/Orca/Bambu), power-loss resume, chamber/air-quality/door sensors, stepper driver tuning |
| 14 | ✨ Operational polish | Session resume, mobile UI, i18n, accessibility, profile diff, profile sync, PWA mode, print-from-URL |
| 15 | 🧱 Slicer fundamentals | Tree supports, adaptive layers, non-planar ironing, vase mode, organic infill, multi-color, bed-mesh-aware auto-arrange, history analytics, embedded thumbnails, Z-seam painter, sequential printing, modifier-mesh painting, fuzzy skin |
| 16 | 📐 Design workspace | Parametric model library, design configurations, 2D drawings, mesh repair, sketch constraint solver upgrades, threading library, non-destructive boolean history |
| 17 | 🎓 Onboarding & education | Calibration print library, guided tutorials, settings deep-help wiki |
| 18 | 🧩 Plugin system | *Future — captured for planning, not yet scheduled* |

> [!TIP]
> Phases 7, 11, 13, 14, 16, 17 are mostly independent and can run in parallel. Phase 8 (Vision) gates Phase 9 (AR). See [`TaskLists.txt`](TaskLists.txt) for detailed sub-phases, effort estimates, file hints, and dependency notes.

## Development Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start the Vite development server. |
| `npm run dev:fresh` | Clear Vite optimized dependency cache, then start dev server. Useful after dependency, WASM, or persisted-state changes. |
| `npm run build` | Typecheck and build production static files into `dist/`. |
| `npm run preview` | Serve the production build locally with Vite preview. |
| `npm run clean` | Remove `dist/`. |
| `npm run typecheck` | Run the composite TypeScript build check. |
| `npm run lint` | Run ESLint. |
| `npm run test` | Run Vitest in watch mode. |
| `npm run test:run` | Run the Vitest suite once. |
| `npm run test:ui` | Start the Vitest UI. |
| `npm run verify` | Run `tsc -b` and `vitest run`. |
| `npm run check:wasm-budget` | Check WASM asset budget. |
| `npm run verify:wasm-build` | Verify the WASM build artifacts. |

## Project Layout

```text
src/
  app/                 Application shell helpers
  components/          UI components and workspace panels
  engine/              Geometry, import, slicer, and CAD logic
  services/            External/device service integrations
  store/               Zustand stores and slices
  test/                Vitest integration and behavior tests
  types/               Shared TypeScript types
  utils/               Project IO and shared helpers

public/
  fonts/               Runtime font assets

wasm/
  dist/                Tracked WASM runtime artifacts

scripts/
  designcad-updater.mjs
  install-orangepi-updater.sh
  check-wasm-budget.mjs
  verify-wasm-build.mjs
```

Ignored local/private folders include `gcodes/`, `.claude/`, `.codex/`, `memory/`, `.gitnexus/`, `obj/`, `node_modules/`, and `dist/`.

## Production Builds

Build static files:

```bash
npm run build
```

Output:

```text
dist/
```

The production build is a static single-page app. Any static host can serve it as long as unknown routes fall back to `index.html`.

## Orange Pi Hosting

DesignCAD can be served from an Orange Pi 3 LTS or similar small Linux board. For small SD cards, build on your development machine and copy only `dist/` to the board.

Recommended base packages:

```bash
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y nginx git curl ufw fail2ban rsync ca-certificates
sudo systemctl enable --now nginx
```

Firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Example Nginx site:

```nginx
server {
    listen 80;
    server_name _;

    root /var/www/designcad;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /assets/ {
        try_files $uri =404;
        access_log off;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

Deploy:

```bash
npm run build
rsync -av --delete dist/ user@device:/var/www/designcad/
```

## Self-Updater Service

The repository includes an optional updater service for a self-hosted Orange Pi deployment:

```text
scripts/designcad-updater.mjs
scripts/install-orangepi-updater.sh
```

The service exposes local endpoints through Nginx:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/update/status` | Check the installed version against the latest GitHub release. |
| `POST /api/update/apply` | Install the latest release asset. |

The web app includes an **Updates** panel that can talk to this local service.

Install from a checked-out repo on the Pi:

```bash
sudo ./scripts/install-orangepi-updater.sh
```

The installer creates:

```text
/opt/designcad/updater/designcad-updater.mjs
/etc/designcad-updater/updater.env
/etc/designcad-updater/token
/var/lib/designcad-updater/state.json
designcad-updater.service
```

Updater environment variables are documented in `.env.example`. The browser update panel uses the local updater key from `/etc/designcad-updater/token`.

## Release Assets

The updater installs only the latest GitHub release asset. It does not update from `master`.

For faster and more reliable device updates, publish a release asset named like:

```text
designcad-dist.zip
```

Accepted archive layouts:

```text
index.html
assets/
```

or:

```text
dist/index.html
dist/assets/
```

Release updates download and install already-built static files, avoiding a full `npm ci && npm run build` on the device.

## Quality And Testing

Recommended checks before submitting code:

```bash
npm run typecheck
npm run lint
npm run test:run
npm run build
```

Faster pre-check during development:

```bash
npm run typecheck
npm run lint
```

The slicer and geometry tests are intentionally detailed because small numerical changes can affect generated toolpaths, preview alignment, or dimensional accuracy.

## GitNexus Code Intelligence

This repository includes `AGENTS.md` instructions for GitNexus-assisted code navigation and impact analysis.

Useful commands:

```bash
npm run graph:analyze
npm run graph:list
npm run graph:serve
```

When changing functions, classes, or methods, follow the GitNexus impact-analysis guidance in `AGENTS.md`.

## Contributing

Start with:

- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`

Good contributions include:

- focused bug fixes
- tests for slicer/geometry edge cases
- importer/exporter improvements
- viewport interaction fixes
- printer workflow improvements
- documentation that helps new users run or self-host the app

## Security

Please do not report security issues in public issues. See `SECURITY.md`.

Never commit:

- printer credentials
- Wi-Fi credentials
- updater keys
- GitHub tokens
- local G-code test files
- generated caches
- private project files

## License

DesignCAD is released under the MIT License. See `LICENSE`.

The bundled Roboto font is licensed separately by Google under Apache-2.0. See `THIRD_PARTY_NOTICES.md`.
