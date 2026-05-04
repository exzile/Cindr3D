#ifndef CINDR3D_WASM_ARACHNE_CONFIG_H
#define CINDR3D_WASM_ARACHNE_CONFIG_H

#include <cstdint>

struct ArachneConfig
{
    int32_t inset_count;
    double bead_width_0;
    double bead_width_x;
    double wall_0_inset;
    double wall_transition_length;
    double wall_transition_angle_deg;
    double wall_transition_filter_distance;
    double wall_transition_filter_deviation;
    double min_feature_size;
    double min_bead_width;
    int32_t wall_distribution_count;
    int32_t section_type;
    double meshfix_maximum_deviation;
    double min_wall_line_width;
    double min_even_wall_line_width;
    double min_odd_wall_line_width;
    double min_variable_line_ratio;
    double simplify_max_resolution;
    double simplify_max_deviation;
    double simplify_max_area_deviation;
    bool print_thin_walls;
    bool fluid_motion_enabled;
    double min_wall_length_factor;
    bool is_top_or_bottom_layer;
    bool precise_outer_wall;
};

#endif // CINDR3D_WASM_ARACHNE_CONFIG_H
