// ARACHNE-9 Phase 1 — boost::polygon::voronoi WASM wrapper.
//
// Drop-in replacement for the JS Voronoi at
// src/engine/slicer/pipeline/arachne/voronoi.ts. Same logical output
// (VoronoiGraph: sourceEdges, vertices with radius + sourceEdgeIds,
// edges with from/to/sourceEdgeIds/sample points), expressed as flat
// numeric buffers that JS marshals via HEAPF64 / HEAP32.
//
// The wrapper is stateful: one Voronoi diagram lives in a translation-
// unit-local `g_state` between calls. Lifecycle:
//
//   1. JS allocates a segment buffer, fills with double[4]/segment, calls
//      _buildVoronoi(segPtr, segCount).  Returns 0 on success, -1 on
//      degenerate input, -2 if Boost throws (we eat exceptions because
//      em++ is built -fno-exceptions; failure is signalled via return).
//   2. JS calls _getCounts(outPtr) — fills Int32[4]:
//        [vertexCount, edgeCount, vertexSourceRefTotal, edgePointTotal]
//      so JS knows how big the emit buffers need to be.
//   3. JS allocates emit buffers and calls _emit*() for each section.
//   4. JS calls _resetVoronoi() before the next layer (frees state).
//
// Coordinate quantisation: Boost's voronoi_diagram requires integer input.
// We scale by COORD_SCALE=1e6 (1 micron precision over the slicer's mm
// world). 32-bit signed range gives us ±2147 m of build volume — more
// than enough for any printer.

#include <cstddef>
#include <cstdint>
#include <vector>
#include <cmath>
#include <unordered_map>

#include <boost/polygon/voronoi.hpp>

namespace bp = boost::polygon;

namespace {

constexpr double COORD_SCALE = 1.0e6;
constexpr double INV_COORD_SCALE = 1.0 / COORD_SCALE;

struct Point { int32_t x, y; };
struct Segment {
    Point a, b;
    int32_t sourceId;  // index into the original segment array
};

}  // namespace

// Boost.Polygon traits: teach the library how to read our Segment type.
namespace boost { namespace polygon {

template <>
struct geometry_concept<Point> { typedef point_concept type; };

template <>
struct point_traits<Point> {
    typedef int32_t coordinate_type;
    static inline coordinate_type get(const Point& p, orientation_2d orient) {
        return orient == HORIZONTAL ? p.x : p.y;
    }
};

template <>
struct geometry_concept<Segment> { typedef segment_concept type; };

template <>
struct segment_traits<Segment> {
    typedef int32_t coordinate_type;
    typedef Point point_type;
    static inline point_type get(const Segment& s, direction_1d dir) {
        return dir.to_int() ? s.b : s.a;
    }
};

}}  // namespace boost::polygon

namespace {

struct State {
    std::vector<Segment> segments;
    bp::voronoi_diagram<double> diagram;

    // Cached emit-side data, populated lazily from the diagram so we
    // don't re-walk Boost's structures multiple times.
    std::vector<double>  vertexData;        // flat: x, y, radius
    std::vector<int32_t> vertexSourceCsr;   // rowStarts, len = vertexCount+1
    std::vector<int32_t> vertexSourceIds;   // CSR data
    std::vector<int32_t> edgeData;          // flat: from, to, srcA, srcB
    std::vector<int32_t> edgePointCsr;      // rowStarts, len = edgeCount+1
    std::vector<double>  edgePoints;        // CSR data: x, y pairs

    bool emitReady = false;
};

State g_state;

inline int32_t scaleCoord(double v) {
    // round-half-away-from-zero — keeps coords symmetric around origin.
    return static_cast<int32_t>(v >= 0.0 ? v * COORD_SCALE + 0.5
                                         : v * COORD_SCALE - 0.5);
}

inline double unscale(double v) { return v * INV_COORD_SCALE; }

// Compute clearance radius at a Voronoi vertex: distance from the vertex
// to any of its incident source segments. Boost gives us cell pointers on
// each edge; we use the first incident edge's cell to find the source.
double computeRadiusAt(const bp::voronoi_diagram<double>::vertex_type& v) {
    auto edge = v.incident_edge();
    if (!edge) return 0.0;
    auto cell = edge->cell();
    if (!cell) return 0.0;

    const double vx = v.x() * INV_COORD_SCALE;
    const double vy = v.y() * INV_COORD_SCALE;

    if (cell->contains_point()) {
        // Cell source is a segment endpoint.
        std::size_t idx = cell->source_index();
        if (idx >= g_state.segments.size() * 2) return 0.0;
        std::size_t segIdx = idx / 2;
        bool isB = (idx & 1u) != 0;
        const Segment& seg = g_state.segments[segIdx];
        const Point& p = isB ? seg.b : seg.a;
        double dx = vx - p.x * INV_COORD_SCALE;
        double dy = vy - p.y * INV_COORD_SCALE;
        return std::sqrt(dx * dx + dy * dy);
    } else {
        std::size_t segIdx = cell->source_index();
        if (segIdx >= g_state.segments.size()) return 0.0;
        const Segment& seg = g_state.segments[segIdx];
        double ax = seg.a.x * INV_COORD_SCALE;
        double ay = seg.a.y * INV_COORD_SCALE;
        double bx = seg.b.x * INV_COORD_SCALE;
        double by = seg.b.y * INV_COORD_SCALE;
        double dx = bx - ax, dy = by - ay;
        double len2 = dx * dx + dy * dy;
        if (len2 < 1e-20) {
            double ex = vx - ax, ey = vy - ay;
            return std::sqrt(ex * ex + ey * ey);
        }
        double t = ((vx - ax) * dx + (vy - ay) * dy) / len2;
        if (t < 0.0) t = 0.0; else if (t > 1.0) t = 1.0;
        double cx = ax + t * dx, cy = ay + t * dy;
        double ex = vx - cx, ey = vy - cy;
        return std::sqrt(ex * ex + ey * ey);
    }
}

// 9.X.2 — sample a parabolic Voronoi edge between a point cell and a
// segment cell. Adapted from Cura's `VoronoiUtils::discretizeParabola`
// (libArachne) and the boost example. The parabola has the cell-point
// as focus and the cell-segment line as directrix. We sample uniformly
// in the segment's tangent direction so chord-arc deviation stays
// bounded by ~`approxStepMm`.
//
// Inputs in mm coords (already unscaled). Endpoints `s`/`e` are the
// edge's two Voronoi vertices; intermediate samples are appended to
// `out` (caller must push `s` first; this fn pushes interior samples
// AND the final `e`).
static void sampleParabola(
    double px, double py,         // focus point (cell-point source)
    double ax, double ay, double bx, double by,  // directrix segment endpoints
    double sx_world, double sy_world,             // edge endpoint 0
    double ex_world, double ey_world,             // edge endpoint 1
    double approxStepMm,
    std::vector<double>& out) {
    const double abx = bx - ax, aby = by - ay;
    const double abLen = std::sqrt(abx * abx + aby * aby);
    if (abLen < 1e-12) {
        // Degenerate segment — emit endpoint only.
        out.push_back(ex_world);
        out.push_back(ey_world);
        return;
    }
    const double tx = abx / abLen, ty = aby / abLen;  // segment tangent (unit)
    // Project p onto line(a,b). Distance d = |p - foot|. Sign uses
    // segment-normal (CCW-90 of tangent).
    const double apx = px - ax, apy = py - ay;
    const double t_p = apx * tx + apy * ty;            // tangential coord of p
    const double footX = ax + t_p * tx, footY = ay + t_p * ty;
    const double dx = px - footX, dy = py - footY;
    const double d = std::sqrt(dx * dx + dy * dy);
    if (d < 1e-9) {
        // Focus on directrix — degenerate parabola.
        out.push_back(ex_world);
        out.push_back(ey_world);
        return;
    }
    // Normal pointing from foot toward focus.
    const double nx = dx / d, ny = dy / d;
    // Project edge endpoints onto segment line: tangential coord (sx/ex
    // relative to a). px is t_p (focus's tangent coord).
    const double sx = (sx_world - ax) * tx + (sy_world - ay) * ty;
    const double ex = (ex_world - ax) * tx + (ey_world - ay) * ty;
    const int32_t stepCount = std::max<int32_t>(2,
        static_cast<int32_t>(std::abs(ex - sx) / approxStepMm + 0.5));
    // Parabola in (t, h) frame relative to focus (t = tangent - t_p):
    //   h = t² / (2d) + d/2  (height above directrix line)
    // World pos = foot_at_tangent_t + h * normal
    for (int32_t step = 1; step < stepCount; ++step) {
        const double frac = static_cast<double>(step) / stepCount;
        const double t_world = sx + (ex - sx) * frac;       // tangent coord on segment line
        const double t = t_world - t_p;                      // relative to focus
        const double h = t * t / (2.0 * d) + d * 0.5;
        const double sxw = ax + t_world * tx + h * nx;
        const double syw = ay + t_world * ty + h * ny;
        out.push_back(sxw);
        out.push_back(syw);
    }
    out.push_back(ex_world);
    out.push_back(ey_world);
}

int32_t cellSourceSegmentId(const bp::voronoi_diagram<double>::cell_type* cell) {
    if (!cell) return -1;
    std::size_t idx = cell->source_index();
    if (cell->contains_point()) idx /= 2;  // endpoint cells map to their owning segment
    if (idx >= g_state.segments.size()) return -1;
    return g_state.segments[idx].sourceId;
}

void buildEmitCaches() {
    if (g_state.emitReady) return;
    auto& diag = g_state.diagram;

    // Vertex pass.
    const auto& verts = diag.vertices();
    g_state.vertexData.clear();
    g_state.vertexData.reserve(verts.size() * 3);
    g_state.vertexSourceCsr.clear();
    g_state.vertexSourceCsr.reserve(verts.size() + 1);
    g_state.vertexSourceIds.clear();
    g_state.vertexSourceCsr.push_back(0);

    // Map vertex pointer → index for edge emit. Boost gives stable
    // addresses inside the vertex container, so a pointer-keyed hash is
    // safe across the Voronoi's lifetime. Built during the vertex pass
    // below, queried per-edge during the edge pass — replaces the
    // earlier O(V) linear search with O(1) average.
    using VertexPtr = const bp::voronoi_diagram<double>::vertex_type*;
    std::unordered_map<VertexPtr, int32_t> vertIndex;
    vertIndex.reserve(verts.size() * 2);

    int32_t vertIdx = 0;
    for (auto it = verts.begin(); it != verts.end(); ++it) {
        const auto& v = *it;
        vertIndex.emplace(&v, vertIdx++);
        g_state.vertexData.push_back(unscale(v.x()));
        g_state.vertexData.push_back(unscale(v.y()));
        g_state.vertexData.push_back(computeRadiusAt(v));

        // Walk incident edges to collect distinct source-segment ids.
        // Each twin edge contributes its cell's source; the JS impl keeps
        // these as a multiset (3+ at junctions). We dedupe here.
        auto e = v.incident_edge();
        const auto* start = e;
        // Collect into a small inline buffer, dedupe, write to CSR.
        int32_t local[16];
        int localCount = 0;
        if (e) {
            do {
                int32_t srcId = cellSourceSegmentId(e->cell());
                if (srcId >= 0 && localCount < 16) {
                    bool seen = false;
                    for (int i = 0; i < localCount; ++i) {
                        if (local[i] == srcId) { seen = true; break; }
                    }
                    if (!seen) local[localCount++] = srcId;
                }
                e = e->rot_next();
            } while (e && e != start);
        }
        for (int i = 0; i < localCount; ++i) {
            g_state.vertexSourceIds.push_back(local[i]);
        }
        g_state.vertexSourceCsr.push_back(
            static_cast<int32_t>(g_state.vertexSourceIds.size()));
    }

    // Edge pass — only emit primary, finite edges (both endpoints exist
    // and the edge has a twin). Skip duplicates by emitting only when
    // edge < twin (pointer comparison gives a stable canonical order).
    g_state.edgeData.clear();
    g_state.edgePointCsr.clear();
    g_state.edgePoints.clear();
    g_state.edgePointCsr.push_back(0);

    auto vertIndexOf = [&](VertexPtr v) -> int32_t {
        if (!v) return -1;
        auto it = vertIndex.find(v);
        return it == vertIndex.end() ? -1 : it->second;
    };

    for (auto it = diag.edges().begin(); it != diag.edges().end(); ++it) {
        const auto& edge = *it;
        if (!edge.is_primary()) continue;
        if (!edge.is_finite()) continue;
        // Canonical ordering — emit each undirected edge exactly once.
        if (&edge >= edge.twin()) continue;

        int32_t fromIdx = vertIndexOf(edge.vertex0());
        int32_t toIdx   = vertIndexOf(edge.vertex1());
        if (fromIdx < 0 || toIdx < 0) continue;

        int32_t srcA = cellSourceSegmentId(edge.cell());
        int32_t srcB = cellSourceSegmentId(edge.twin() ? edge.twin()->cell() : nullptr);
        g_state.edgeData.push_back(fromIdx);
        g_state.edgeData.push_back(toIdx);
        g_state.edgeData.push_back(srcA);
        g_state.edgeData.push_back(srcB);

        // 9.X.2: linear edges emit endpoints only; curved (parabolic)
        // edges sample along the parabola so downstream skeletal
        // trapezoidation sees the actual medial-axis curve, not a
        // chord. is_curved() is true exactly when one cell is a
        // point-source and the other a segment-source.
        const double v0x = unscale(edge.vertex0()->x());
        const double v0y = unscale(edge.vertex0()->y());
        const double v1x = unscale(edge.vertex1()->x());
        const double v1y = unscale(edge.vertex1()->y());
        g_state.edgePoints.push_back(v0x);
        g_state.edgePoints.push_back(v0y);
        if (edge.is_curved() && edge.twin()) {
            const auto* cell0 = edge.cell();
            const auto* cell1 = edge.twin()->cell();
            const auto* pointCell = cell0->contains_point() ? cell0 : cell1;
            const auto* segCell = cell0->contains_point() ? cell1 : cell0;
            if (pointCell && segCell && segCell->source_index() < g_state.segments.size()) {
                std::size_t pIdx = pointCell->source_index();
                std::size_t segIdx = pIdx / 2;
                bool isB = (pIdx & 1u) != 0;
                if (segIdx < g_state.segments.size()) {
                    const Segment& fs = g_state.segments[segIdx];
                    const Point& fp = isB ? fs.b : fs.a;
                    const Segment& ds = g_state.segments[segCell->source_index()];
                    const double pxw = fp.x * INV_COORD_SCALE;
                    const double pyw = fp.y * INV_COORD_SCALE;
                    const double axw = ds.a.x * INV_COORD_SCALE;
                    const double ayw = ds.a.y * INV_COORD_SCALE;
                    const double bxw = ds.b.x * INV_COORD_SCALE;
                    const double byw = ds.b.y * INV_COORD_SCALE;
                    // Approx 0.05mm chord step — fine enough for medial
                    // axis, coarse enough not to inflate path counts.
                    sampleParabola(pxw, pyw, axw, ayw, bxw, byw,
                                   v0x, v0y, v1x, v1y, 0.05, g_state.edgePoints);
                } else {
                    g_state.edgePoints.push_back(v1x);
                    g_state.edgePoints.push_back(v1y);
                }
            } else {
                g_state.edgePoints.push_back(v1x);
                g_state.edgePoints.push_back(v1y);
            }
        } else {
            g_state.edgePoints.push_back(v1x);
            g_state.edgePoints.push_back(v1y);
        }
        g_state.edgePointCsr.push_back(
            static_cast<int32_t>(g_state.edgePoints.size() / 2));
    }

    g_state.emitReady = true;
}

}  // namespace

extern "C" {

// Smoke test (kept from 9.1A scaffold so the toolchain validation hook
// still works without instantiating a diagram).
double answer() { return 1.0; }

// Build the diagram from a packed segment buffer.
//   segPtr   — pointer into Module.HEAPF64 of length segCount*4
//   segCount — number of segments
// Returns 0 on success, -1 on degenerate input, -2 on internal failure.
int32_t buildVoronoi(const double* segPtr, int32_t segCount) {
    if (segCount <= 0 || !segPtr) return -1;

    g_state.segments.clear();
    g_state.segments.reserve(segCount);
    g_state.diagram.clear();
    g_state.emitReady = false;
    g_state.vertexData.clear();
    g_state.vertexSourceCsr.clear();
    g_state.vertexSourceIds.clear();
    g_state.edgeData.clear();
    g_state.edgePointCsr.clear();
    g_state.edgePoints.clear();

    for (int32_t i = 0; i < segCount; ++i) {
        const double* p = segPtr + i * 4;
        Point a{ scaleCoord(p[0]), scaleCoord(p[1]) };
        Point b{ scaleCoord(p[2]), scaleCoord(p[3]) };
        if (a.x == b.x && a.y == b.y) continue;  // skip zero-length
        g_state.segments.push_back({ a, b, i });
    }

    if (g_state.segments.empty()) return -1;

    bp::construct_voronoi(g_state.segments.begin(), g_state.segments.end(),
                          &g_state.diagram);
    return 0;
}

// Fill a 4-element Int32 buffer at outPtr with [vertexCount, edgeCount,
// vertexSourceRefTotal, edgePointTotal]. Triggers emit-cache build.
void getCounts(int32_t* outPtr) {
    buildEmitCaches();
    outPtr[0] = static_cast<int32_t>(
        g_state.vertexData.size() / 3);
    outPtr[1] = static_cast<int32_t>(g_state.edgeData.size() / 4);
    outPtr[2] = static_cast<int32_t>(g_state.vertexSourceIds.size());
    outPtr[3] = static_cast<int32_t>(g_state.edgePoints.size() / 2);
}

// Emit functions: caller passes preallocated buffers of the sizes
// reported by getCounts(). Each writes its slice and returns the count
// of elements written, or -1 on capacity mismatch.
int32_t emitVertices(double* outPtr, int32_t capacityDoubles) {
    buildEmitCaches();
    int32_t needed = static_cast<int32_t>(g_state.vertexData.size());
    if (capacityDoubles < needed) return -1;
    for (int32_t i = 0; i < needed; ++i) outPtr[i] = g_state.vertexData[i];
    return needed;
}

int32_t emitVertexSourceCsr(int32_t* rowStarts, int32_t rowCapacity,
                            int32_t* data, int32_t dataCapacity) {
    buildEmitCaches();
    int32_t rowsNeeded = static_cast<int32_t>(g_state.vertexSourceCsr.size());
    int32_t dataNeeded = static_cast<int32_t>(g_state.vertexSourceIds.size());
    if (rowCapacity < rowsNeeded || dataCapacity < dataNeeded) return -1;
    for (int32_t i = 0; i < rowsNeeded; ++i) rowStarts[i] = g_state.vertexSourceCsr[i];
    for (int32_t i = 0; i < dataNeeded; ++i) data[i] = g_state.vertexSourceIds[i];
    return dataNeeded;
}

int32_t emitEdges(int32_t* outPtr, int32_t capacityInts) {
    buildEmitCaches();
    int32_t needed = static_cast<int32_t>(g_state.edgeData.size());
    if (capacityInts < needed) return -1;
    for (int32_t i = 0; i < needed; ++i) outPtr[i] = g_state.edgeData[i];
    return needed;
}

int32_t emitEdgePointsCsr(int32_t* rowStarts, int32_t rowCapacity,
                          double* data, int32_t dataCapacity) {
    buildEmitCaches();
    int32_t rowsNeeded = static_cast<int32_t>(g_state.edgePointCsr.size());
    int32_t dataNeeded = static_cast<int32_t>(g_state.edgePoints.size());
    if (rowCapacity < rowsNeeded || dataCapacity < dataNeeded) return -1;
    for (int32_t i = 0; i < rowsNeeded; ++i) rowStarts[i] = g_state.edgePointCsr[i];
    for (int32_t i = 0; i < dataNeeded; ++i) data[i] = g_state.edgePoints[i];
    return dataNeeded;
}

void resetVoronoi() {
    g_state.segments.clear();
    g_state.diagram.clear();
    g_state.emitReady = false;
    g_state.vertexData.clear();
    g_state.vertexSourceCsr.clear();
    g_state.vertexSourceIds.clear();
    g_state.edgeData.clear();
    g_state.edgePointCsr.clear();
    g_state.edgePoints.clear();
}

}  // extern "C"
