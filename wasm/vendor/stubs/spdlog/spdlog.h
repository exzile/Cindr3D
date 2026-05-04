#ifndef CINDR3D_WASM_STUBS_SPDLOG_H
#define CINDR3D_WASM_STUBS_SPDLOG_H

namespace spdlog
{
template<typename... Args>
inline void debug(Args&&...)
{
}

template<typename... Args>
inline void info(Args&&...)
{
}

template<typename... Args>
inline void warn(Args&&...)
{
}

template<typename... Args>
inline void error(Args&&...)
{
}
} // namespace spdlog

#endif // CINDR3D_WASM_STUBS_SPDLOG_H
