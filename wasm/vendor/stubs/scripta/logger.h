#ifndef CINDR3D_WASM_STUBS_SCRIPTA_LOGGER_H
#define CINDR3D_WASM_STUBS_SCRIPTA_LOGGER_H

namespace scripta
{
struct CellVDI
{
    template<typename T>
    CellVDI(const char*, T)
    {
    }
};

struct PointVDI
{
    template<typename T>
    PointVDI(const char*, T)
    {
    }
};

template<typename... Args>
inline void log(Args&&...)
{
}
} // namespace scripta

#endif // CINDR3D_WASM_STUBS_SCRIPTA_LOGGER_H
