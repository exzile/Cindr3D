#ifndef DESIGNCAD_WASM_STUB_RATIO_H
#define DESIGNCAD_WASM_STUB_RATIO_H

namespace cura
{
struct Ratio
{
    double value;

    constexpr Ratio(double v = 0.0)
        : value(v)
    {
    }

    constexpr operator double() const
    {
        return value;
    }
};

constexpr Ratio operator""_r(long double value)
{
    return Ratio(static_cast<double>(value));
}
} // namespace cura

#endif // DESIGNCAD_WASM_STUB_RATIO_H
