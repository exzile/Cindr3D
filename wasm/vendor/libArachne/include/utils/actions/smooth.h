// Copyright (c) 2023 UltiMaker
// CuraEngine is released under the terms of the AGPLv3 or higher

#ifndef UTILS_VIEWS_SMOOTH_H
#define UTILS_VIEWS_SMOOTH_H

#include "settings/Settings.h"
#include "utils/macros.h"

namespace cura
{
class SmoothTest_TestSmooth_Test;
} // namespace cura

namespace cura::actions
{

struct smooth_fn
{
    friend class cura::SmoothTest_TestSmooth_Test;

    template<typename Config>
    auto operator()(const Config& settings) const
    {
        UNUSED_PARAM(settings);
        return *this;
    }

    template<class Rng>
    constexpr auto operator()(Rng&& rng) const
    {
        return static_cast<Rng&&>(rng);
    }
};

inline constexpr smooth_fn smooth{};
} // namespace cura::actions

#endif // UTILS_VIEWS_SMOOTH_H
