#ifndef DESIGNCAD_WASM_STUB_SETTINGS_H
#define DESIGNCAD_WASM_STUB_SETTINGS_H

namespace cura
{
class Settings
{
public:
    template<typename T>
    T get(const char*) const
    {
        return T{};
    }
};
} // namespace cura

#endif // DESIGNCAD_WASM_STUB_SETTINGS_H
