# WASM Toolchain (ARACHNE-9)

Reproducible C++ to WASM build for the variable-width-walls pipeline.
See `TaskLists.txt` ARACHNE-9 for the full plan.

## Layout

```text
wasm/
  Dockerfile     - emsdk 3.1.74 + vendored Boost and Clipper2 sources
  build.sh       - emits dist/{voronoi,clipper2}.{js,wasm,d.ts}
  build.ps1      - local no-Docker fallback using wasm/.toolchain
  src/
    voronoi.cpp  - boost::polygon::voronoi binding
    clipper2.cpp - Clipper2 offset binding
  dist/          - checked-in build artifacts consumed by Vite
```

## Build

```bash
docker build -t cindr3d-wasm -f wasm/Dockerfile wasm
docker run --rm -v "$PWD:/repo" -w /repo cindr3d-wasm bash wasm/build.sh
```

The Docker image vendors only the Boost subtrees we use plus Clipper2 C++
headers/sources. Add new subtrees in `Dockerfile` if libArachne pulls them
in during 9.2A.

For local Windows builds without Docker:

```powershell
powershell -ExecutionPolicy Bypass -File wasm\build.ps1
```

## ABI

No `embind`. The C++ side exports plain C functions; JS marshals flat
`double[]` / `int32[]` buffers through `Module.HEAPF64` / `HEAP32`.
Layouts are documented in `dist/*.d.ts`.

## Smoke Tests

`_answer()` checks the Voronoi module and `_clipperAnswer()` checks the
Clipper2 module. The TS loaders assert these before running geometry.
Clipper2's loader lives at `src/engine/slicer/geometry/clipper2Wasm.ts`;
production offsetting still uses the existing JS path until parity tests
are added.
