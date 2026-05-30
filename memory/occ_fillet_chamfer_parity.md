---
name: OCC vs Fusion Fillet/Chamfer Parity
description: The honest capability contract for fillet & chamfer — which Fusion 360 modal options OCC delivers, approximates, only round-trips, or cannot do. Single source of truth replacing "should be identical to Fusion".
type: reference
---

# OCC ⇄ Fusion 360 fillet / chamfer capability matrix (OCC-13.8)

## Kernel reality (read first)

Fusion 360 runs on Autodesk Shape Manager (ASM, ACIS lineage). Cindr3D runs on
OpenCASCADE (OCCT, via opencascade.js WASM). These are different kernels, so our
fillet/chamfer geometry **cannot be bit-identical** to Fusion's, and no free/WASM
kernel matches ASM — swapping kernels is not a lever.

**The goal** is an identical *option model + UX + behaviour where OCC can deliver*,
with documented graceful degradation where it can't. The columns below are:

- **SUPPORTED** — option is wired and matches Fusion's behaviour within OCC's geometry.
- **APPROXIMATED** — works, but differs from ASM output (documented approximation).
- **ROUND-TRIP-ONLY** — stored on the feature for Fusion 360 file round-trip; has no
  geometric effect today (no OCC binding / no kernel API).
- **UNSUPPORTED** — OCC cannot do this; the dialog must gate/label it, never imply it works.

Drives which dialog controls are live vs. labelled. Update this file when a status changes.

## Fillet (`occFilletEdgeSetsWithInstance` + variants)

| Fusion option / edge-set type | Status | OCC mechanism / note |
|---|---|---|
| Constant radius | SUPPORTED | `Add_2(radius, edge)` |
| Variable radius (start → end) | SUPPORTED | `Add_3(startR, endR, edge)` |
| Variable radius, N interior mid-points | SUPPORTED | **OCC-14.3 DONE:** `Add_5(TColgp_Array1OfPnt2d, edge)` with `TColgp_Array1OfPnt2d_2(lo,hi)` + `gp_Pnt2d_3(u,r)` radius law. `OccFilletEdgeSet.midRadii[]` + dialog "Add Mid-point" rows. Falls back to Add_3 if binding absent. |
| Chord-length | APPROXIMATED | dihedral-angle → equivalent radius, then `Add_2`. Falls back to 90° (`chord/√2`) when topology walk fails. |
| Asymmetric (per-face two distances) | APPROXIMATED (averaged only) | **OCC-14.2 DECIDED**: there is NO per-face two-distance fillet overload in OCC. Available overloads: `Add_1(E)`, `Add_2(R,E)`, `Add_3(R1,R2,E)` (start→end), `Add_4(Law_Function,E)`, `Add_5(TColgp_Array1OfPnt2d,E)`. Per-face asymmetry is a *chamfer* concept. Decision: option (a) — averages startR/endR to symmetric `Add_2` (fillet.ts ~653). Users get a fillet; the radius is averaged. Dialog may show "Asymmetric mode: averaged (OCC limitation)" hint. |
| Continuity = Tangent (G1) | SUPPORTED | `ChFi3d_Rational` surface form (OCC default). |
| Continuity = Curvature (G2) | APPROXIMATED | `ChFi3d_Polynomial` surface form + best-effort `SetContinuity(GeomAbs_C2)` when bound. Not bit-identical to ASM's G2. |
| Continuity = Connected (G0) | ROUND-TRIP-ONLY (APPROXIMATED≈G1) | **OCC-14.4**: `BRepFilletAPI_MakeFillet` always produces ≥G1. No C0-only surface form exists. G0 maps to `ChFi3d_Rational` (same as G1). Accepted in `OccFilletOptions.continuity` for Fusion file round-trip; not exposed in dialog UI (no-op control would mislead). |
| tangencyWeight (0.1–2.0) | ROUND-TRIP-ONLY | no per-edge weight API on `BRepFilletAPI_MakeFillet` in the WASM build. |
| isRollingBallCorner | ROUND-TRIP-ONLY | **OCC-13.1**: this is the vertex corner *solution* (rolling-ball vs setback), which OCC computes automatically and exposes no toggle for. It does **not** select the surface form (that's continuity). Previously mis-mapped to `ChFi3d_QuasiAngular`. |
| Setback corner + setbackDistance | ROUND-TRIP-ONLY (≈UNSUPPORTED) | OCC has no per-vertex setback API. Only the rolling-ball corner solution is produced. |
| Tangent-chain propagation (`isTangentChain`) | SUPPORTED | `collectTangentChainEdges` — the same grouping the selectable-edge `chainId` uses, so highlight/propagation agree by construction (OCC-12). |
| Full-round fillet (`FullRoundFilletFaceSets`) | APPROXIMATED | `occFullRoundFilletWithInstance`; auto side-face inference is best-effort 2-coloring of the center face's neighbours. |
| Rule fillet — AllEdges | SUPPORTED | `occRuleFilletAllEdgesWithInstance` (collects every edge of the face(s)). |
| Rule fillet — BetweenFaces | SUPPORTED | `occRuleFilletBetweenFacesWithInstance` (shared edges between two face groups). |
| Rule fillet — RuleFilletTopologyTypes (RoundsOnly / FilletsOnly / RoundsAndFillets) | SUPPORTED | **OCC-14.1 (2026-05-28):** `convex: boolean\|null` added to `SelectableEdgeMeta` via centroid-difference test. `topologyFilter` option on both rule-fillet wrappers; wired through `FilletParams.ruleFilletTopology` + dialog Topology selector. |
| Multi-edge corner at a shared vertex | APPROXIMATED | **OCC-13.3**: all edges go into one `Build()` pass so the kernel blends the corner in a single solve. **OCC-13.2** clamps an over-large radius to local topology (0.95× a non-filleted neighbour chord, ~0.49× a co-filleted connector) so the blend shrinks to a valid value instead of throwing. Hard ASM-only vertex blends still fail → previous body preserved with a clear message. |

## Chamfer (`occChamferWithInstance`)

| Fusion `ChamferTypes` / option | Status | OCC mechanism / note |
|---|---|---|
| EqualDistance | SUPPORTED | `Add_2(distance, edge)` |
| TwoDistances | SUPPORTED | `Add_3(d1, d2, edge, refFace)` (reference face resolved via `findAdjacentFace`). |
| DistanceAndAngle | SUPPORTED | **OCC-14.6**: uses `AddDA(distance, angleRad, edge, refFace)` directly (binding confirmed). Degrades to `Add_2` (equal-distance) when no reference face can be resolved. |
| ThreeFace | UNSUPPORTED | not implemented; dialog shows a hint and `commitChamfer` rejects with a message. |
| Flip faces (`isFlipped`) | SUPPORTED | swaps (d1, d2). |
| Tangent-chain propagation | SUPPORTED | `collectTangentChainEdges`. |
| ChamferCornerType (Patch / Miter / Blend) | ROUND-TRIP-ONLY | `BRepFilletAPI_MakeChamfer` exposes no corner-type enum; the kernel computes the corner. `commitChamfer` warns when `miter` is requested. |
| Seam / boundary edges | UNSUPPORTED | guarded: `countAdjacentFacesForEdge < 2` edges are skipped (OCC-13.5) so they never reach `Build()`. |

## Robustness baseline (shared by both, OCC-13.5)

Both ops now: skip seam/boundary edges before `Build()`, run `Build(progress)` with a
`Build()` no-arg fallback across binding variants (`runEdgeOpBuild`), reject partial
results (`Build()` threw or `IsDone()===false` → `null`, never install a partial/open
solid), and keep the `Make*` builder alive via `ownedResources` because `Shape()`
references it. The store layer additionally rejects results that increase boundary /
non-manifold edge counts (open-mesh guard) and keeps the previous body on failure.

## Open / manual-QA items

- **OCC-13.4** — build the failing case (half-circle extrude: fillet arc edge +
  adjacent straight edge) and compare to Fusion; decide whether a setback-corner
  approximation is worth adding. Requires interactive 3D QA.
- **OCC-12.D2 / C2** — flip-the-flag manual verification and deletion of the legacy
  selection heuristics for OCC bodies remain gated on browser QA (see TaskLists.txt).
- AddDA-based DistanceAndAngle: **OCC-14.6 DONE** — switched to `AddDA`; row upgraded to SUPPORTED.
- ThreeFace chamfer: confirmed no 3-face overload exists in this build (only Add_1/2/3 +
  AddDA) — stays UNSUPPORTED (OCC-14.5 investigation closed).
