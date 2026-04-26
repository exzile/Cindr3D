#include <algorithm>
#include <cstdint>
#include <vector>

#include "WallToolPaths.h"
#include "arachne_config.h"
#include "utils/Coord_t.h"
#include "utils/ExtrusionLine.h"
#include "utils/polygon.h"
#include "utils/section_type.h"

namespace {

constexpr int32_t kConfigValueCount = 22;

std::vector<cura::ExtrusionLine> g_result_paths;

inline cura::coord_t mm_to_coord(double value) {
  return static_cast<cura::coord_t>(value * 1000.0 + 0.5 * ((value > 0.0) - (value < 0.0)));
}

double config_value(const double* values, int32_t count, int32_t index, double fallback) {
  return values && index >= 0 && index < count ? values[index] : fallback;
}

ArachneConfig decode_config(const double* values, int32_t count) {
  ArachneConfig config{};
  config.inset_count = static_cast<int32_t>(config_value(values, count, 0, 3.0));
  config.bead_width_0 = config_value(values, count, 1, 0.42);
  config.bead_width_x = config_value(values, count, 2, 0.42);
  config.wall_0_inset = config_value(values, count, 3, 0.0);
  config.wall_transition_length = config_value(values, count, 4, 0.4);
  config.wall_transition_angle_deg = config_value(values, count, 5, 10.0);
  config.wall_transition_filter_distance = config_value(values, count, 6, 0.1);
  config.wall_transition_filter_deviation = config_value(values, count, 7, 0.025);
  config.min_feature_size = config_value(values, count, 8, 0.1);
  config.min_bead_width = config_value(values, count, 9, 0.2);
  config.wall_distribution_count = static_cast<int32_t>(config_value(values, count, 10, 1.0));
  config.section_type = static_cast<int32_t>(config_value(values, count, 11, static_cast<double>(static_cast<int>(cura::SectionType::WALL))));
  config.meshfix_maximum_deviation = config_value(values, count, 12, 0.01);
  config.min_wall_line_width = config_value(values, count, 13, 0.2);
  config.min_even_wall_line_width = config_value(values, count, 14, 0.2);
  config.min_odd_wall_line_width = config_value(values, count, 15, 0.2);
  config.min_variable_line_ratio = config_value(values, count, 16, 0.5);
  config.simplify_max_resolution = config_value(values, count, 17, 0.01);
  config.simplify_max_deviation = config_value(values, count, 18, 0.01);
  config.simplify_max_area_deviation = config_value(values, count, 19, 0.01);
  config.print_thin_walls = config_value(values, count, 20, 1.0) != 0.0;
  config.fluid_motion_enabled = config_value(values, count, 21, 0.0) != 0.0;
  return config;
}

bool decode_polygons(const double* points, const int32_t* path_counts, int32_t path_count, cura::Polygons& out) {
  out.clear();
  if (!points || !path_counts || path_count <= 0) return false;

  int32_t point_offset = 0;
  for (int32_t path_index = 0; path_index < path_count; ++path_index) {
    const int32_t count = path_counts[path_index];
    if (count < 3) return false;

    cura::Polygon polygon;
    polygon.reserve(static_cast<size_t>(count));
    for (int32_t i = 0; i < count; ++i) {
      const int32_t point_index = point_offset + i;
      polygon.add(cura::Point(mm_to_coord(points[point_index * 2]), mm_to_coord(points[point_index * 2 + 1])));
    }
    point_offset += count;
    out.add(std::move(polygon));
  }

  return true;
}

void flatten_toolpaths(const std::vector<cura::VariableWidthLines>& toolpaths) {
  g_result_paths.clear();
  for (const cura::VariableWidthLines& inset : toolpaths) {
    for (const cura::ExtrusionLine& line : inset) {
      if (!line.empty()) {
        g_result_paths.push_back(line);
      }
    }
  }
}

}  // namespace

extern "C" {

double arachneAnswer() {
  return 1.0;
}

int32_t arachneConfigValueCount() {
  return kConfigValueCount;
}

// Generate variable-width wall paths from packed polygon input.
//
// points:      double[x, y] in mm, concatenated across all polygons.
// path_counts: int32 vertex counts for each polygon.
// config:      double[kConfigValueCount], matching decode_config() order.
//
// Returns 0 on success, -1 on malformed/degenerate input, -2 on internal
// failure. Results are kept in module state until resetArachnePaths().
int32_t generateArachnePaths(
  const double* points,
  const int32_t* path_counts,
  int32_t path_count,
  const double* config_values,
  int32_t config_value_count
) {
  g_result_paths.clear();

  cura::Polygons outline;
  if (!decode_polygons(points, path_counts, path_count, outline)) return -1;

  ArachneConfig config = decode_config(config_values, config_value_count);
  if (config.inset_count < 0 || config.bead_width_0 <= 0.0 || config.bead_width_x <= 0.0) {
    return -1;
  }

  const cura::SectionType section_type = static_cast<cura::SectionType>(config.section_type);

  try {
    cura::WallToolPaths generator(
      outline,
      mm_to_coord(config.bead_width_0),
      mm_to_coord(config.bead_width_x),
      static_cast<size_t>(config.inset_count),
      mm_to_coord(config.wall_0_inset),
      config,
      0,
      section_type);
    flatten_toolpaths(generator.generate());
    return 0;
  } catch (...) {
    g_result_paths.clear();
    return -2;
  }
}

void getArachneCounts(int32_t* out) {
  if (!out) return;
  int32_t point_count = 0;
  for (const cura::ExtrusionLine& line : g_result_paths) {
    point_count += static_cast<int32_t>(line.size());
  }
  out[0] = static_cast<int32_t>(g_result_paths.size());
  out[1] = point_count;
}

int32_t emitArachnePathCounts(int32_t* out, int32_t capacity) {
  const int32_t needed = static_cast<int32_t>(g_result_paths.size());
  if (!out || capacity < needed) return -1;
  for (int32_t i = 0; i < needed; ++i) {
    out[i] = static_cast<int32_t>(g_result_paths[static_cast<size_t>(i)].size());
  }
  return needed;
}

// Per path metadata is [inset_idx, is_odd, is_closed].
int32_t emitArachnePathMeta(int32_t* out, int32_t capacity_ints) {
  const int32_t needed = static_cast<int32_t>(g_result_paths.size() * 3);
  if (!out || capacity_ints < needed) return -1;

  int32_t offset = 0;
  for (const cura::ExtrusionLine& line : g_result_paths) {
    out[offset++] = static_cast<int32_t>(line.inset_idx);
    out[offset++] = line.is_odd ? 1 : 0;
    out[offset++] = line.is_closed ? 1 : 0;
  }
  return needed;
}

// Emits double[x, y, width] in mm for every junction in path-count order.
int32_t emitArachnePoints(double* out, int32_t capacity_doubles) {
  int32_t needed = 0;
  for (const cura::ExtrusionLine& line : g_result_paths) {
    needed += static_cast<int32_t>(line.size() * 3);
  }
  if (!out || capacity_doubles < needed) return -1;

  int32_t offset = 0;
  for (const cura::ExtrusionLine& line : g_result_paths) {
    for (const cura::ExtrusionJunction& junction : line) {
      out[offset++] = INT2MM(junction.p.X);
      out[offset++] = INT2MM(junction.p.Y);
      out[offset++] = INT2MM(junction.w);
    }
  }
  return needed;
}

void resetArachnePaths() {
  g_result_paths.clear();
}

}  // extern "C"
