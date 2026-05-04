# Cindr3D Project Memory

## Read first

- [intent.md](intent.md) — what we're building (Fusion 360 + Cura 5 + Duet3D parity), launch plan, what the user expects from Claude
- [feedback_memory_first.md](feedback_memory_first.md) — read memory before launching Explore agents (saves massive tokens)
- [code_graph.md](code_graph.md) — workspace anchors + "where to add X" lookup table
- [project_cindr3d.md](project_cindr3d.md) — architectural invariants (shim+subdir pattern, store slices, material singletons, plane-aware math, persistence caches)

## Subsystems

- [slicer_engine.md](slicer_engine.md) — slicer pipeline contracts, two-emission-site rule, calcExtrusion-as-method, layer-height contract, scarf seam duality
- [arachne_subsystem.md](arachne_subsystem.md) — variable-width walls (pure-JS + WASM post-9.2/9.4), flap-topology limit, libArachne integration, diagnostic patterns, what doesn't work
- [extrude_pipeline.md](extrude_pipeline.md) — profile flat list + atomic regions, smallest-wins picker, csgIntersect overlap rule, disconnected-body splitting
- [sketch_interaction_pipeline.md](sketch_interaction_pipeline.md) — chain-of-responsibility commit dispatch, fingerprint-LRU preview cache, SketchCommitCtx shape
- [duet_service_architecture.md](duet_service_architecture.md) — DuetService façade + per-concern sibling modules, where to add new API calls

## Bug catalogs (read before non-trivial UI/engine changes)

- [r3f_critical_patterns.md](r3f_critical_patterns.md) — recurring R3F bugs: per-frame allocs, plane-aware math, disposal, stale closures, JSX bufferAttribute leaks, material mutation rules
- [gotchas.md](gotchas.md) — Vite/rolldown `import type`, drei Grid on non-horizontal planes, R3F 9.6.0 minimum, hook-rules crash, getPlaneAxes SoT
- [wasm_patterns.md](wasm_patterns.md) — emsdk loading gotchas (HEAP32, node wasmBinary, vite-ignore), 8-byte align, single-instance ABI, warm-up pattern

## Slicer parity

- [slicer_gaps.md](slicer_gaps.md) — settings whose UI exists but engine ignores or stubs (canonical list in TaskLists.txt)
- [cura_categories.md](cura_categories.md) — Cura 5.12 17-category parity scoreboard with setting counts

## Feedback rules (apply by default)

- [feedback_code_quality.md](feedback_code_quality.md) — subcomponents over monoliths; the 2026-04 shim+subdir pattern
- [feedback_agents.md](feedback_agents.md) — ONE agent at a time; current hot files; TSC-OK gate
- [feedback_dialog_style.md](feedback_dialog_style.md) — Extrude panel canonical; tool-panel + tp-* classes from common/ToolPanel.css

## References

- [azure_hosting.md](azure_hosting.md) — Azure Static Web App resource IDs and deferred cindr3d.com domain plan
- [fusion360_sdk.md](fusion360_sdk.md) — local SDK install path; C++ headers for Features/, BRep/, Sketch/; canonical enum names
