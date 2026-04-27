#include <cmath>
#include <cstdint>
#include <map>
#include <vector>

#include <clipper2/clipper.h>

using Clipper2Lib::ClipType;
using Clipper2Lib::Difference;
using Clipper2Lib::EndType;
using Clipper2Lib::FillRule;
using Clipper2Lib::InflatePaths;
using Clipper2Lib::Intersect;
using Clipper2Lib::JoinType;
using Clipper2Lib::PathD;
using Clipper2Lib::PathsD;
using Clipper2Lib::PointD;
using Clipper2Lib::Union;
using Clipper2Lib::Xor;

namespace {
// Single result buffer shared across offset and boolean ops — both
// produce PathsD output with the same emit ABI. Last call wins.
PathsD g_result_paths;
PathsD& g_offset_paths = g_result_paths;  // back-compat alias for offset emit names

JoinType join_type_from_int(int32_t value) {
  switch (value) {
    case 1: return JoinType::Square;
    case 2: return JoinType::Round;
    default: return JoinType::Miter;
  }
}

FillRule fill_rule_from_int(int32_t value) {
  switch (value) {
    case 1: return FillRule::NonZero;
    case 2: return FillRule::Positive;
    case 3: return FillRule::Negative;
    default: return FillRule::EvenOdd;
  }
}

// Decode a flat (points, path_counts, path_count) tuple into a PathsD.
// Returns false on malformed input (negative count, sub-2 path).
bool decode_paths(const double* points, const int32_t* path_counts,
                  int32_t path_count, PathsD& out) {
  out.clear();
  if (path_count < 0) return false;
  if (path_count == 0) return true;
  if (!points || !path_counts) return false;
  out.reserve(static_cast<size_t>(path_count));
  int32_t off = 0;
  for (int32_t pi = 0; pi < path_count; ++pi) {
    const int32_t n = path_counts[pi];
    if (n < 0) return false;
    PathD path;
    path.reserve(static_cast<size_t>(n));
    for (int32_t i = 0; i < n; ++i) {
      path.emplace_back(points[(off + i) * 2], points[(off + i) * 2 + 1]);
    }
    off += n;
    out.push_back(std::move(path));
  }
  return true;
}
}

extern "C" {

double clipperAnswer() {
  return 1.0;
}

int32_t offsetPaths(
  const double* points,
  const int32_t* path_counts,
  int32_t path_count,
  double delta,
  int32_t join_type,
  double miter_limit,
  double arc_tolerance,
  int32_t precision
) {
  g_offset_paths.clear();
  if (!points || !path_counts || path_count <= 0) return -1;

  PathsD input;
  input.reserve(static_cast<size_t>(path_count));

  int32_t point_offset = 0;
  for (int32_t path_index = 0; path_index < path_count; ++path_index) {
    const int32_t count = path_counts[path_index];
    if (count < 3) return -1;

    PathD path;
    path.reserve(static_cast<size_t>(count));
    for (int32_t i = 0; i < count; ++i) {
      const int32_t point_index = point_offset + i;
      path.emplace_back(points[point_index * 2], points[point_index * 2 + 1]);
    }
    point_offset += count;
    input.push_back(std::move(path));
  }

  try {
    g_offset_paths = InflatePaths(
      input,
      delta,
      join_type_from_int(join_type),
      EndType::Polygon,
      miter_limit > 0 ? miter_limit : 2.0,
      precision,
      arc_tolerance >= 0 ? arc_tolerance : 0.0
    );
    return 0;
  } catch (...) {
    g_offset_paths.clear();
    return -2;
  }
}

void getOffsetCounts(int32_t* out) {
  if (!out) return;
  int32_t point_count = 0;
  for (const auto& path : g_offset_paths) {
    point_count += static_cast<int32_t>(path.size());
  }
  out[0] = static_cast<int32_t>(g_offset_paths.size());
  out[1] = point_count;
}

int32_t emitOffsetPathCounts(int32_t* out, int32_t capacity) {
  if (!out || capacity < static_cast<int32_t>(g_offset_paths.size())) return -1;
  for (size_t i = 0; i < g_offset_paths.size(); ++i) {
    out[i] = static_cast<int32_t>(g_offset_paths[i].size());
  }
  return static_cast<int32_t>(g_offset_paths.size());
}

int32_t emitOffsetPoints(double* out, int32_t capacity_doubles) {
  int32_t required = 0;
  for (const auto& path : g_offset_paths) {
    required += static_cast<int32_t>(path.size() * 2);
  }
  if (!out || capacity_doubles < required) return -1;

  int32_t offset = 0;
  for (const auto& path : g_offset_paths) {
    for (const PointD& point : path) {
      out[offset++] = point.x;
      out[offset++] = point.y;
    }
  }
  return required;
}

void resetOffsetPaths() {
  g_offset_paths.clear();
}

// Stroke a set of OPEN polylines into closed polygon footprints, then
// union them. This is what CuraEngine's `WallToolPaths::computeInner
// Contour()` does to determine actual wall coverage from variable-width
// toolpaths. Each segment between vertices i and i+1 is inflated with
// `EndType::Round` and `delta = avg(widths[i], widths[i+1]) * 0.5 + pad`,
// so the per-vertex bead width tapers segment-by-segment plus a uniform
// safety pad to absorb libArachne's non-uniform bead-placement variance.
//
// Performance: segments with the SAME delta (within a 1µm bucket) are
// batched into a single `InflatePaths` call. For uniform-width walls
// (the common case — wallLineWidth applies to every vertex), this
// collapses N per-path stroke calls plus N per-vertex disk calls down
// to a single call covering every segment of every path. On a 4-hole
// disc with 3 walls each, this drops from ~1300 Clipper2 calls per
// layer to ~2.
//
// The `pad` parameter folds in what was previously a separate post-
// stroke `InflatePaths(coverage, +pad)` call from JavaScript. Folding
// it into each segment's delta saves one whole Clipper2 round-trip
// per layer at zero geometric cost (the safety margin is identical
// either way).
//
// Inputs:
//   points        — flat (x,y) doubles, all vertices of all paths
//   path_counts   — int32 length of each path (>= 2 for a stroked path)
//   path_count    — number of paths
//   widths        — per-vertex widths, parallel to `points`
//   pad           — extra outward margin added to every delta (mm).
//                   Pass 0 for an unpadded stroke.
//   arc_tolerance — Clipper2 round-cap tolerance (mm); 0 = default
//   precision     — decimal digits Clipper retains internally
//
// Result lands in `g_result_paths`, read with the existing
// `getOffsetCounts` / `emitOffsetPathCounts` / `emitOffsetPoints` ABI.
//
// Returns 0 on success, -1 on degenerate input, -2 on internal failure.
int32_t strokeOpenPaths(
  const double* points,
  const int32_t* path_counts,
  int32_t path_count,
  const double* widths,
  double pad,
  double arc_tolerance,
  int32_t precision
) {
  g_result_paths.clear();
  if (path_count <= 0) return 0;
  if (!points || !path_counts || !widths) return -1;

  // Quantize delta to 1µm buckets. Bead widths from libArachne are
  // typically in units of 0.05mm or finer, so 1µm quantization
  // collapses identical-width segments into one bucket without
  // measurably distorting the stroke.
  static constexpr double DELTA_QUANTUM = 1e-3;
  auto quantize = [](double v) -> int32_t {
    return static_cast<int32_t>(std::lround(v / DELTA_QUANTUM));
  };

  std::map<int32_t, PathsD> segments_by_delta;
  std::map<int32_t, PathsD> disks_by_delta;

  try {
    int32_t voff = 0;
    for (int32_t pi = 0; pi < path_count; ++pi) {
      const int32_t n = path_counts[pi];
      if (n < 0) return -1;
      if (n < 2) { voff += n; continue; }

      // Detect uniform-width path: if every vertex has the same width,
      // round-cap segment ends from adjacent segments already cover
      // the joints (their caps share the same radius and overlap), so
      // we don't need separate per-vertex disks. This is the common
      // case — most slicer profiles use a single lineWidth across the
      // whole part — and it halves the work.
      bool uniform_width = true;
      const double w0 = widths[voff];
      for (int32_t i = 1; i < n; ++i) {
        if (widths[voff + i] != w0) { uniform_width = false; break; }
      }

      // Bucket each segment by its avg-of-endpoint-widths delta plus
      // the uniform safety pad. For uniform-width paths this is one
      // bucket per path; for variable-width Arachne output it's
      // typically a handful (libArachne's bead allocator tends to
      // converge on a small set of widths). The pad is added to each
      // delta so we don't need a second InflatePaths pass to widen
      // the union after the fact.
      const double pad_clamped = pad > 0.0 ? pad : 0.0;
      for (int32_t i = 0; i < n - 1; ++i) {
        const double wA = widths[voff + i];
        const double wB = widths[voff + i + 1];
        const double delta = (wA + wB) * 0.25 + pad_clamped;  // avg(w)/2 + pad
        if (delta <= 0.0) continue;
        const int32_t key = quantize(delta);
        PathsD& bucket = segments_by_delta[key];
        bucket.emplace_back();
        bucket.back().emplace_back(points[(voff + i)     * 2],
                                   points[(voff + i)     * 2 + 1]);
        bucket.back().emplace_back(points[(voff + i + 1) * 2],
                                   points[(voff + i + 1) * 2 + 1]);
      }

      // Per-vertex disks ONLY for variable-width paths. Adjacent
      // round-end caps cover joints fully when both segments have the
      // same delta; when they differ, the smaller-delta cap leaves
      // a sliver outside the joint that the disk fills. The same pad
      // applies so disk radius matches segment cap radius at the joint.
      if (!uniform_width) {
        for (int32_t i = 0; i < n; ++i) {
          const double w = widths[voff + i];
          const double delta = w * 0.5 + pad_clamped;
          if (delta <= 0.0) continue;
          const int32_t key = quantize(delta);
          const double vx = points[(voff + i) * 2];
          const double vy = points[(voff + i) * 2 + 1];
          PathsD& bucket = disks_by_delta[key];
          bucket.emplace_back();
          bucket.back().emplace_back(vx, vy);
          // Tiny offset so the path has nonzero length — Clipper2
          // skips zero-length paths. Offset stays well below
          // `precision` so it has no observable shape effect.
          bucket.back().emplace_back(vx + 1e-9, vy);
        }
      }
      voff += n;
    }

    PathsD accum;
    // One InflatePaths per delta bucket — the heart of the batching.
    // For uniform-width walls, this is exactly one call covering every
    // segment of every input path. Each call's output gets folded into
    // `accum` for the final union pass.
    for (auto& kv : segments_by_delta) {
      const double delta = static_cast<double>(kv.first) * DELTA_QUANTUM;
      if (delta <= 0.0) continue;
      PathsD stroked = InflatePaths(
        kv.second,
        delta,
        JoinType::Round,
        EndType::Round,
        2.0,
        precision,
        arc_tolerance >= 0 ? arc_tolerance : 0.0
      );
      for (auto& p : stroked) accum.push_back(std::move(p));
    }
    for (auto& kv : disks_by_delta) {
      const double delta = static_cast<double>(kv.first) * DELTA_QUANTUM;
      if (delta <= 0.0) continue;
      PathsD stroked = InflatePaths(
        kv.second,
        delta,
        JoinType::Round,
        EndType::Round,
        2.0,
        precision,
        arc_tolerance >= 0 ? arc_tolerance : 0.0
      );
      for (auto& p : stroked) accum.push_back(std::move(p));
    }

    if (accum.empty()) return 0;
    // Self-union to coalesce overlapping segment footprints into the
    // final coverage polygon(s).
    g_result_paths = Union(accum, FillRule::NonZero, precision);
    return 0;
  } catch (...) {
    g_result_paths.clear();
    return -2;
  }
}

// Boolean op selector (matches the JS adapter's enum):
//   0 = union, 1 = intersection, 2 = difference, 3 = xor.
//
// Subject and clip share the offset emit pipeline (`_getOffsetCounts`,
// `_emitOffsetPathCounts`, `_emitOffsetPoints`, `_resetOffsetPaths`)
// because both produce a PathsD result. Single shared `g_result_paths`
// — caller treats this module as single-instance like the Voronoi one.
//
// Returns 0 on success, -1 on degenerate input, -2 on internal failure.
int32_t booleanPaths(
  const double* subj_points,
  const int32_t* subj_counts,
  int32_t subj_count,
  const double* clip_points,
  const int32_t* clip_counts,
  int32_t clip_count,
  int32_t op,
  int32_t fill_rule_id,
  int32_t precision
) {
  g_result_paths.clear();
  PathsD subjects;
  PathsD clips;
  if (!decode_paths(subj_points, subj_counts, subj_count, subjects)) return -1;
  if (!decode_paths(clip_points, clip_counts, clip_count, clips)) return -1;

  const FillRule fr = fill_rule_from_int(fill_rule_id);
  // Clipper2's UnionD/IntersectD/DifferenceD take precision as digits.
  const int dec = precision;

  try {
    switch (op) {
      case 0: g_result_paths = Union(subjects, clips, fr, dec); break;
      case 1: g_result_paths = Intersect(subjects, clips, fr, dec); break;
      case 2: g_result_paths = Difference(subjects, clips, fr, dec); break;
      case 3: g_result_paths = Xor(subjects, clips, fr, dec); break;
      default: return -1;
    }
    return 0;
  } catch (...) {
    g_result_paths.clear();
    return -2;
  }
}

}
