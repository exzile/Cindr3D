#include <cstdint>
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
