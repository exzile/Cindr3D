---
name: Duet Service Architecture
description: Duet3D printer API — DuetService facade + sibling sub-API modules + event bus; where to add/edit which concern
type: project
originSessionId: e1e3f23a-f47d-4fbb-9116-3ea9059d054b
---
Duet3D support is a substantial subsystem: live printer connection (standalone RepRapFirmware OR SBC DuetSoftwareFramework), object-model polling, file management, g-code upload, macro control, height-map, webcam. The service was broken out of a fat `DuetService.ts` monolith into a facade + per-concern sibling modules.

## Layout — `src/services/`

- `DuetService.ts` — class façade. Holds connection state (`config`, `sessionKey`, `ws`, `connected`), delegates every API call to a sibling module function.
- `duet/fileApi.ts` — `createDirectory`, `deleteFile`, `downloadFile`, `getFileInfo`, `listFiles`, `moveFile`, `uploadFile`
- `duet/controls.ts` — low-level control commands: `emergencyStopCommand`, `extrudeCommand`, `homeAxesCommand`, `moveAxisCommand`, `runMacroCommand`
- `duet/machineControls.ts` — print-job / temperature / tool / fan commands: `startPrintCommand`, `pausePrintCommand`, `resumePrintCommand`, `cancelPrintCommand`, `cancelObjectCommand`, `selectToolCommand`, `deselectToolCommand`, `simulateFileCommand`, `setBedTemperatureCommand`, `setChamberTemperatureCommand`, `setToolTemperatureCommand`, `setFanSpeedCommand`
- `duet/modelApi.ts` — `getObjectModelRequest`, `fetchConfigSnapshot` (as `fetchObjectModelSnapshot`), `applyModelPatch` (as `applyObjectModelPatch`) — object-model read + diff-patch apply
- `duet/mediaApi.ts` — `getHeightMapData`, `getThumbnailData`, `getSnapshotImageUrl`, `getWebcamStreamUrl`
- `duet/upload.ts` — multi-part upload plumbing (wrapped by fileApi)
- `duet/heightMap.ts`, `duet/modelMerge.ts` — parsers/mergers called by the APIs above
- `duet/eventBus.ts` — `DuetEventBus` class: simple `on(event, cb) → unsubscribe` + `emit(event, data)` + listener errors swallowed so one bad subscriber can't break the connection
- `httpRequest.ts` (top-level) — `fetchOrThrow`, `requestJsonOrText` — shared HTTP primitives. All new HTTP calls MUST go through these (centralized retry/session-key/error handling).

## Where to add a new API call

1. Pick the sibling module by concern (NOT by HTTP verb). Machine state mutation → `machineControls.ts`. Filesystem → `fileApi.ts`. Object model → `modelApi.ts`. Media/images → `mediaApi.ts`.
2. Export a pure function taking `config`/`sessionKey` (and whatever else); use `fetchOrThrow`/`requestJsonOrText` for the transport.
3. Add a wrapper method on `DuetService` that forwards and maintains state (emits on `eventBus` if state changed).

**Do NOT** put new logic into `DuetService.ts` beyond the forwarding wrapper — the whole point of the refactor was to keep the façade thin.

## Types — `src/types/duet*.types.ts`

- `duet.ts` — `DuetConfig`, `DuetObjectModel`, `DuetFileInfo`, `DuetGCodeFileInfo`, `DuetHeightMap`
- `duet-config.types.ts`, `duet-config-commands.types.ts`, `duet-prefs.types.ts` — printer config/prefs sub-types

## UI consumers

- `src/components/printer/` — `DuetService.tsx`, `DuetConsole.tsx`, `DuetDashboard.tsx`, `DuetFilamentManager.tsx`, `DuetFileEditor.tsx`, `DuetFileManager.tsx`, `DuetStatus.tsx`, `DuetSettings.tsx`, `DuetHeightMap.tsx`, `DuetPrinterPanel.tsx` — each big panel has a sibling subdir (e.g., `duetConsole/`, `duetDashboard/`, `duetFilamentManager/`, etc.) with extracted subcomponents + config + hooks. Same shim+subdir pattern as the rest of the project.
- Store: `src/store/printerStore.ts` (shim) → `src/store/printer/actions/{controls,files,lifecycle}.ts` + `connection.ts` + `prefsBinding.ts`

## Event bus — when to use it

Prefer direct callbacks / React subscriptions when the consumer is a single component. Use `DuetEventBus` for cross-panel broadcasts (e.g., connection status, object-model updates that multiple panels need to react to). Every listener error is swallowed — handlers MUST NOT rely on throwing to signal anything.
