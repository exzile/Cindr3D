# libArachne vendor inventory (ARACHNE-9.2A)

Sources copied from CuraEngine 5.6.0 commit at
`wasm/.toolchain/CuraEngine/` (gitignored). 22 files vendored:

```
include/
  WallToolPaths.h
  SkeletalTrapezoidation.h
  SkeletalTrapezoidationEdge.h
  SkeletalTrapezoidationGraph.h
  SkeletalTrapezoidationJoint.h
  BeadingStrategy/
    BeadingStrategy.h
    BeadingStrategyFactory.h
    DistributedBeadingStrategy.h
    LimitedBeadingStrategy.h
    OuterWallInsetBeadingStrategy.h
    RedistributeBeadingStrategy.h
    WideningBeadingStrategy.h
src/
  WallToolPaths.cpp
  SkeletalTrapezoidation.cpp
  BeadingStrategy/
    BeadingStrategy.cpp
    BeadingStrategyFactory.cpp
    DistributedBeadingStrategy.cpp
    LimitedBeadingStrategy.cpp
    OuterWallInsetBeadingStrategy.cpp
    RedistributeBeadingStrategy.cpp
    WideningBeadingStrategy.cpp
```

**Files NOT yet vendored (transitive deps to resolve in 9.2A.2):**

## Geometry primitives — must replace or vendor

| Header                          | What it provides                          | Plan |
|---------------------------------|-------------------------------------------|------|
| `utils/IntPoint.h`              | `coord_t` (int64_t), `Point2LL`           | Vendor minimal subset; keep nm-scale int math |
| `utils/polygon.h`               | `Polygon`, `Polygons` (ClipperLib wrapper)| Replace with thin wrapper over our flat-array ABI; reuse Clipper2 from 9.4A for ops |
| `utils/ExtrusionLine.h`         | `ExtrusionLine`, `VariableWidthLines`     | Vendor as-is (small, no deps) |
| `utils/ExtrusionJunction.h`     | `ExtrusionJunction(point, width, perim)`  | Vendor as-is |
| `utils/HalfEdgeGraph.h`         | Generic half-edge graph template          | Vendor as-is (header-only template) |
| `utils/SparsePointGrid.h`       | Spatial-hash grid                         | Vendor as-is (header-only template) |
| `utils/Simplify.h`              | RDP polygon simplification                | Replace with Clipper2's `RamerDouglasPeucker` |
| `utils/PolygonsSegmentIndex.h`  | Segment spatial index                     | Vendor; depends on polygon.h |
| `utils/PolylineStitcher.h`      | Endpoint-merging path stitcher            | Vendor; small (~200 LOC) |
| `utils/VoronoiUtils.h`          | Boost.Voronoi sampling helpers            | Vendor; reuse 9.1C voronoi binding for parabola sampler |
| `utils/linearAlg2D.h`           | 2D vector math                            | Vendor as-is |
| `utils/polygonUtils.h`          | Misc polygon utilities                    | Vendor selectively (only the symbols libArachne actually calls) |
| `utils/section_type.h`          | `SectionType` enum                        | Vendor as-is (single enum) |
| `utils/macros.h`                | Cura assertion + flag macros              | Replace with no-op stubs |
| `utils/actions/smooth.h`        | Range-v3 smoothing action                 | Replace with imperative loop |
| `BoostInterface.hpp`            | boost::polygon traits for Point2LL        | Vendor; tiny |

## Settings — must flatten

`settings/Settings.h`, `settings/types/Angle.h`, `settings/types/Ratio.h`,
`ExtruderTrain.h` — Cura's massive settings system.

**Replacement:** define a flat C struct in
`wasm/src/arachne_config.h`:

```c
struct ArachneConfig {
    int32_t inset_count;
    double  bead_width_0;     // outer-wall bead width, mm
    double  bead_width_x;     // inner-wall bead width, mm
    double  wall_0_inset;     // outer-wall extra inset, mm
    double  wall_transition_length;
    double  wall_transition_angle_deg;
    double  wall_transition_filter_distance;
    double  wall_transition_filter_margin;
    double  min_feature_size;
    double  min_bead_width;
    int32_t wall_distribution_count;
    int32_t section_type;     // matches utils/section_type.h enum
};
```

Then patch `WallToolPaths` ctor to take `ArachneConfig` instead of
`Settings&`, and the BeadingStrategy* files' `BeadingStrategyFactory`
functions to take the same. Eliminates Cura's settings tree entirely.

## Logging / debug

| Header                | Replacement                                      |
|-----------------------|--------------------------------------------------|
| `spdlog/spdlog.h`     | Stub `wasm/vendor/stubs/spdlog/spdlog.h` with `#define spdlog::info(...)` no-ops |
| `scripta/logger.h`    | Stub `wasm/vendor/stubs/scripta/logger.h` with no-op `SCRIPTA_LOG(...)` |

Both need to be on the include path so unmodified libArachne sources
keep compiling. Stubs total ~30 LOC.

## range-v3

Used in 3 spots:
- `WallToolPaths.cpp` — `views::filter` + `views::transform` over a
  `std::vector<VariableWidthLines>` to flatten paths.
- `SkeletalTrapezoidation.cpp` — `views::transform` for vertex lookup.
- `BeadingStrategyFactory.cpp` — `range::to<vector>` adaptor.

**Replacement:** explicit `std::transform` / for-loop equivalents.
~30 LOC total. Drop the include, no new dep.

## Compilation order (proposed)

1. **9.2A.1** [done] Copy libArachne sources into vendor/libArachne/. ✓
2. **9.2A.2** [next] Vendor utils/* + stub spdlog/scripta + replace
   range-v3 (header-only changes; no compilation yet).
3. **9.2A.3** Replace `Settings` references with `ArachneConfig`.
   Audit each file for `settings.get<...>()` calls.
4. **9.2A.4** Try to compile `BeadingStrategy/*.cpp` standalone with
   em++. Fix linker/include errors. Should be small files, easiest
   layer.
5. **9.2A.5** Compile `SkeletalTrapezoidation.cpp` next. Hook into
   our existing `wasm/src/voronoi.cpp` Boost.Voronoi binding.
6. **9.2A.6** Compile `WallToolPaths.cpp` last (top-level coordinator).
7. **9.2C** Write `wasm/src/arachne.cpp` wrapper — flat input/output
   ABI matching the JS-side adapter.

## Lines of code reference

```
$ wc -l include/**/*.h src/**/*.cpp
include/BeadingStrategy/*.h:           ~600
include/SkeletalTrapezoidation*.h:     ~500
include/WallToolPaths.h:                100
src/BeadingStrategy/*.cpp:             ~700
src/SkeletalTrapezoidation.cpp:       ~2000
src/WallToolPaths.cpp:                 ~700
TOTAL libArachne (vendored):          ~4600 LOC
+ utils/* deps to vendor:             ~1500 LOC
+ stubs:                                 ~50 LOC
~6000 LOC of C++ to bring up under emsdk.
```
