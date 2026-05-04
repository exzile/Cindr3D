#ifndef CINDR3D_WASM_STUB_SETTINGS_H
#define CINDR3D_WASM_STUB_SETTINGS_H

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

#endif // CINDR3D_WASM_STUB_SETTINGS_H
