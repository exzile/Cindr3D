#ifndef CINDR3D_WASM_STUB_ANGLE_H
#define CINDR3D_WASM_STUB_ANGLE_H

#include <cmath>

namespace cura
{
struct AngleRadians
{
    double value;

    constexpr AngleRadians(double v = 0.0)
        : value(v)
    {
    }

    constexpr operator double() const
    {
        return value;
    }
};

struct AngleDegrees
{
    double value;

    constexpr AngleDegrees(double v = 0.0)
        : value(v)
    {
    }

    constexpr operator double() const
    {
        return value;
    }
};

constexpr AngleRadians pi_div(double divisor)
{
    return AngleRadians(M_PI / divisor);
}
} // namespace cura

#endif // CINDR3D_WASM_STUB_ANGLE_H
