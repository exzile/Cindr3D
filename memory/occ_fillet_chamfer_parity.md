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
| Tangent-chain propagation (`isTangentChain`) | SUPPORTED | `collectTangentChainEdges` — the same grouping the selectable-edge `chainId` uses, so highlight/propagation agree by construction (OCC-12). **Round-seed guard (2026-05-30):** only CLOSED full circles (`getSelectableEdges().kind==='circle'`, span≥2π) are held back from propagation; ARCS propagate (a full-circle rim's tangent chain is just itself, so the guard's old `computeEdgeAnchor`-based block over-blocked arcs vs Fusion). |
| Full-round fillet (`FullRoundFilletFaceSets`) | APPROXIMATED | `occFullRoundFilletWithInstance`; auto side-face inference is best-effort 2-coloring of the center face's neighbours. |
| Rule fillet — AllEdges | SUPPORTED | `occRuleFilletAllEdgesWithInstance` (collects every edge of the face(s)). |
| Rule fillet — BetweenFaces | SUPPORTED | `occRuleFilletBetweenFacesWithInstance` (shared edges between two face groups). |
| Rule fillet — RuleFilletTopologyTypes (RoundsOnly / FilletsOnly / RoundsAndFillets) | SUPPORTED | **OCC-14.1 (2026-05-28):** `convex: boolean\|null` added to `SelectableEdgeMeta` via centroid-difference test. `topologyFilter` option on both rule-fillet wrappers; wired through `FilletParams.ruleFilletTopology` + dialog Topology selector. |
| Multi-edge corner at a shared vertex | APPROXIMATED | **OCC-13.3**: all edges go into one `Build()` pass so the kernel blends the corner in a single solve. **OCC-13.2** clamps an over-large radius to local topology (0.95× a non-filleted neighbour chord, ~0.49× a co-filleted connector) so the blend shrinks to a valid value instead of throwing. **OCC-16 (2026-05-30)**: topology-aware corner auto-reordering — when a circular/arc edge is adjacent (shares a vertex) to a linear edge, the fillet chain now applies round edges first, then linear edges on the running body. This resolves the 1mm-meets-1mm corner that previously failed with all combined-pass strategies. `occFilletEdgeSetsTopologicalWithInstance` is inserted as a fallback between combined-on-base and the per-edge sequential last resort. Hard ASM-only vertex blends still fail → previous body preserved with actionable message including verified max-radius suggestion (3-probe bisection). |

## Chamfer (`occChamferWithInstance`)

| Fusion `ChamferTypes` / option | Status | OCC mechanism / note |
|---|---|---|
| EqualDistance | SUPPORTED | `Add_2(distance, edge)` |
| TwoDistances | SUPPORTED | `Add_3(d1, d2, edge, refFace)` (reference face resolved via `findAdjacentFace`). **Was silently DEAD until 2026-05-30** (refFace cast bug — see audit note below); now verified asymmetric (distance2 respected). |
| DistanceAndAngle | SUPPORTED | **OCC-14.6**: uses `AddDA(distance, angleRad, edge, refFace)` directly. Degrades to `Add_2` when no reference face resolves. **Was silently DEAD until 2026-05-30** (refFace cast bug). |
| ThreeFace | UNSUPPORTED | not implemented; dialog shows a hint and `commitChamfer` rejects with a message. |
| Flip faces (`isFlipped`) | SUPPORTED | swaps (d1, d2). |
| Tangent-chain propagation | SUPPORTED | `collectTangentChainEdges`. |
| ChamferCornerType (Patch / Miter / Blend) | ROUND-TRIP-ONLY | `BRepFilletAPI_MakeChamfer` exposes no corner-type enum; the kernel computes the corner. `commitChamfer` warns when `miter` is requested. |
| Seam / boundary edges | UNSUPPORTED | guarded: `countAdjacentFacesForEdge < 2` edges are skipped (OCC-13.5) so they never reach `Build()`. |

## Live validity preview (Fusion-style red-flash, 2026-05-30)

`probeEdgeModification` (store action in `edgeModActions.ts`) is a **non-committing
dry-run** of the fillet/chamfer. `applyOccEdgeModification` gained a `dryRun` flag:
it runs the FULL pipeline — every fallback + the null-result, blend-face,
consumed-edge, tessellation, and open-mesh/BRepCheck guards — then disposes the
result mesh+body instead of installing, routing failure messages to `onDryRunError`
rather than feature health/status. So the probe verdict is identical to the commit
by construction. The dry-run exit sits AFTER the open-mesh guard (it must tessellate
to match commit; a radius/distance that builds a valid BRep but an invalid solid is
correctly flagged). Disposal verified leak-free (registry body count stable).

`useEdgeModValidityProbe` (debounced 350 ms) is called from both dialog state hooks
with the dialog's effective edge IDs (live selection, or stored IDs when editing).
On failure it sets `edgeModInvalidPreview {edgeIds, message}` (transient, cleared on
dialog open/close) and raises one `addToast('error', …)` per new message. The
viewport flashes those edges bright red: `EdgeOpEdgeHighlight` swaps the selected
line's material to a red singleton (`invalidMat`) and pulses it faster. Toasts render
globally via `<GCodeToast/>` in App.tsx. OK stays enabled (matches Fusion).

**CHAMFER DEGENERACY HEAL + PRE-BLEND REPLAY (d=1mm near r=1 fillets):**
Chamfer had NO fallbacks (fillet has 6). Two added in `applyOccEdgeModification`'s
chamfer branch: (1) **degeneracy heal** — right at OCC's valid ceiling an EXACT
distance can fail to build OR build a BRep-INVALID solid (e.g. a 1mm chamfer meeting
r=1 corner fillets: d=1.0 fails to build, d≥1.001 builds invalid, but d=0.999 builds
a valid chamfer). Retry with a tiny relative nudge (set `[0.999, 1.001, 0.997, …]`,
≤0.5%), BRepCheck-validating each, accepting the first VALID one. Heals the
degenerate exact value (a few microns); does NOT shrink an over-large chamfer to fit
(d=5 on a small edge still fails with a clear message). (2) **pre-blend replay** —
chamfer the earliest body that carries the edge, then replay intervening fillets
(mirrors fillet round-edge pre-blend); secondary, often fails on fillet-edge
reconstruction, so the heal is the primary win. Verified: d=1 now commits healthy.

**DECIMAL INPUT** (`edgeDialog/NumberInput.tsx`, shared by 14 dialogs/panels): was a
controlled `type=number` with `parseFloat(v) || fallback` — treated `0` and partial
input (".", "0.") as invalid → snapped to fallback, and couldn't hold a leading-dot
intermediate. Rewritten to `type=text inputmode=decimal` with a draft buffer: display
= `draft ?? String(value)` (no setState-in-effect), `PARTIAL_NUMBER` regex allows
every intermediate (".25", "0.", "-.5"), emits a clamped number per valid keystroke,
reverts to the clamped value on blur. Lost the spinner arrows (acceptable).

## WASM cast bug — chamfer was silently dead (2026-05-30)

`occChamferWithInstance` deref'd edges/faces as `oc.TopoDS_Edge`/`oc.TopoDS_Face`,
which return a `TopoDS_Shape` → `Add_2`/`Add_3`/`AddDA` threw `BindingError` → caught →
null. Effect: **EqualDistance chamfer worked only by luck (no ref face); EVERY chamfer
on EVERY edge actually failed once a ref face was involved, and the edge cast broke
even EqualDistance** until both were fixed to `oc.TopoDS.Edge_1/Face_1(occDeref(…,
TopoDS_Shape))`. This is a recurring cross-cutting bug — full pattern + the other
affected features in [[wasm_patterns]] (occDeref note). Regression test:
`__tests__/chamferEdgeCast.test.ts` (asserts Add_2/Add_3/AddDA receive Edge_1/Face_1
casts). Post-fix, chamfer-near-fillet works at small sizes and only fails above OCC's
valid ceiling — Fusion's "works to a measurement then errors".

## Circle-edge audit results (2026-05-30, verified live on cylinder rim + box edge)

- **All modes BRep-VALID on a full-circle rim:** constant/variable/varMidpts/chord/
  asymmetric/G2 fillet (valid even near max radius); equal/two-dist/angle chamfer.
  Same matrix all VALID on a box edge. Fusion has NO circle-specific API — circular
  edges are ordinary edges; the only circle logic is the span≥2π full-vs-arc split
  (`selectableEdges`) and the tangent-propagation round-seed guard (fillet table row).
- **Two-distance chamfer is genuinely asymmetric** (not d2-ignored): box-edge volumes
  equal(4)=7840, equal(1)=7990, two-dist(4,1)=7960 — distinct from both. Flip is applied
  upstream by `resolveChamferDistances` swapping d1/d2 (occChamfer options carry no
  isFlipped — correct).
- **Same cast bug broke 3 NON-fillet/chamfer features — FIXED in OCC-18 (2026-05-30):**
  `geomSurface.sketchPlaneFromFace` (rewritten to BRepAdaptor_Surface; Surface_2 was the
  1-arg overload + Handle_Geom_Plane.DownCast undefined), `offsetFaces` (Face_1 cast +
  boolean Build()→runEdgeOpBuild), `draft` (DraftAngle_2 ctor + 5-arg Add + Face_1 +
  runEdgeOpBuild). See [[wasm_patterns]] for the compounding-binding gotchas. fillet.ts CLEAN.

## Robustness baseline (shared by both, OCC-13.5)

Both ops now: skip seam/boundary edges before `Build()`, run `Build(progress)` with a
`Build()` no-arg fallback across binding variants (`runEdgeOpBuild`), reject partial
results (`Build()` threw or `IsDone()===false` → `null`, never install a partial/open
solid), and keep the `Make*` builder alive via `ownedResources` because `Shape()`
references it. The store layer additionally rejects results that increase boundary /
non-manifold edge counts (open-mesh guard) and keeps the previous body on failure.

## Open / manual-QA items

- **Live red-flash preview + chamfer heal + decimal input (2026-05-30):** all verified at
  the store/engine level; remaining = interactive 3D QA of the on-screen red pulse (needs a
  genuine 3D edge pick, not automatable in the preview harness). Tracked in TaskLists.
- **OCC-13.4** — **OCC-16 shipped (2026-05-30)**; the 1mm corner case is now resolved by
  topology-aware ordering. Setback corner is documented as ROUND-TRIP-ONLY (≈UNSUPPORTED) above.
  Remaining: interactive 3D browser QA to confirm rolling-ball corner matches Fusion output.
- **OCC-12.D2** — visual selection QA (all 12 box edges, cylinder seam, arc chain highlight)
  requires browser QA (see TaskLists.txt).
- AddDA-based DistanceAndAngle: **OCC-14.6 DONE** — switched to `AddDA`; row upgraded to SUPPORTED.
- ThreeFace chamfer: confirmed no 3-face overload exists in this build (only Add_1/2/3 +
  AddDA) — stays UNSUPPORTED (OCC-14.5 investigation closed).
