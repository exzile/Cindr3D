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
- [Feature Highlights](#feature-highlights)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
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

DesignCAD combines design, print preparation, and printer interaction in one browser workspace.

| Workspace | Purpose |
|-----------|---------|
| **Design** | Sketching, solid modeling, imports/exports, feature timeline, and component organization. |
| **Prepare** | Plate setup, slicer-oriented model inspection, calibration utilities, and G-code preview. |
| **Printer** | Duet/RepRapFirmware-style printer connection, monitoring, file handling, and update-oriented flows. |
| **Self-hosting** | Static Nginx deployment with an optional local updater service for Orange Pi style installs. |

The project is evolving quickly. Some CAD and slicer features are experimental, but the repository is public so the implementation can be inspected, used, and improved in the open.

## Feature Highlights

### CAD And Modeling

- 3D viewport with orbit, pan, zoom, and view-cube style navigation.
- Sketching on XY, XZ, and YZ planes.
- Sketch tools including line, circle, rectangle, arc, and text workflows.
- Solid operation dialogs for extrude, revolve, sweep, loft, shell, rib, split, draft, hole, thread, chamfer, fillet, and related modeling actions.
- Mesh, surface, construction, inspect, assemble, and utilities ribbon areas.
- Component tree, feature timeline, selection filters, and visibility controls.

### Import And Export

- Import support for `.f3d`, `.step`, `.stp`, `.stl`, and `.obj`.
- Project/settings bundle flows for saving and loading workspace state.
- Export dialog for generated project/model outputs.

### Slicer And Preview

- Prepare workspace for slicer-focused workflows.
- Plate and model management.
- Calibration utilities.
- G-code preview and layer inspection.
- WASM-backed geometry/slicer helpers.

### Printer Workflows

- Printer workspace for Duet/RepRapFirmware-style devices.
- Printer profile and connection settings.
- Firmware/update-related UI flows.
- File and status panels for connected printers.

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
| `GET /api/update/status` | Check the installed version against GitHub. |
| `POST /api/update/apply` | Install the selected branch or release update. |

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

Updater environment variables are documented in `.env.example`.

For public repositories, GitHub reads do not require a token. For private forks or private deployments, set:

```bash
DESIGNCAD_GITHUB_TOKEN=your_read_only_token
```

Do not put GitHub tokens in the browser. The browser update panel uses the local updater key from `/etc/designcad-updater/token`.

## Release Assets

The updater can install either:

- the latest configured branch, normally `master`, by cloning and building on the Pi
- the latest GitHub release asset

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

Branch updates run `npm ci && npm run build` on the device, which is slower and uses more disk space. Release updates only download and install already-built static files.

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
