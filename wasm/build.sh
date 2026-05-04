#!/usr/bin/env bash
# Build WASM artifacts for ARACHNE-9.
#
# Run inside the cindr3d-wasm Docker image:
#   docker build -t cindr3d-wasm -f wasm/Dockerfile wasm
#   docker run --rm -v "$PWD/wasm:/wasm" cindr3d-wasm /wasm/build.sh
#
# Outputs to wasm/dist/. Each module is built standalone (no embind, no
# Emscripten runtime). We use raw C exports so JS can marshal flat
# Float64/Int32 buffers via Module.HEAPF64 / HEAP32 — keeps the binding
# auditable and the .wasm small.
set -euo pipefail

SRC_DIR="$(dirname "$0")/src"
OUT_DIR="$(dirname "$0")/dist"
mkdir -p "$OUT_DIR"

BOOST_INC="${BOOST_INCLUDE:-/opt/boost/include}"
CLIPPER2_INC="${CLIPPER2_INCLUDE:-/opt/clipper2/include}"
CLIPPER2_SRC="${CLIPPER2_SRC:-/opt/clipper2/src}"
LIB_ARACHNE_INC="$(dirname "$0")/vendor/libArachne/include"
LIB_ARACHNE_SRC="$(dirname "$0")/vendor/libArachne/src"
STUB_INC="$(dirname "$0")/vendor/stubs"

# Common flags. -Oz prioritises bundle size over speed; the polygon code
# is short enough that the speed delta vs -O3 is negligible at the sizes
# we feed in. -fno-exceptions / -fno-rtti shave another ~30KB.
COMMON_FLAGS=(
  -std=c++17
  -Oz
  -fno-rtti
  -s STANDALONE_WASM=1
  -s WASM=1
  -s ALLOW_MEMORY_GROWTH=1
  -s INITIAL_MEMORY=2MB
  -s ENVIRONMENT=web,worker,node
  -s FILESYSTEM=0
  -s MODULARIZE=1
  -s EXPORT_ES6=1
  --no-entry
)

echo "[build.sh] Building voronoi module..."
em++ "${COMMON_FLAGS[@]}" \
  -fno-exceptions \
  -I "$BOOST_INC" \
  -s EXPORT_NAME=createVoronoiModule \
  -s "EXPORTED_FUNCTIONS=['_answer','_buildVoronoi','_getCounts','_emitVertices','_emitVertexSourceCsr','_emitEdges','_emitEdgePointsCsr','_resetVoronoi','_malloc','_free']" \
  -s "EXPORTED_RUNTIME_METHODS=['HEAPF64','HEAP32']" \
  "$SRC_DIR/voronoi.cpp" \
  -o "$OUT_DIR/voronoi.js"

echo "[build.sh] Generating voronoi.d.ts..."
cat > "$OUT_DIR/voronoi.d.ts" <<'EOF'
export interface VoronoiModule {
  HEAPF64: Float64Array;
  HEAP32: Int32Array;
  _malloc(size: number): number;
  _free(ptr: number): void;

  // Smoke test — returns 1.0 once the module instantiates.
  _answer(): number;

  // Build a Voronoi diagram from a packed segment buffer.
  //   segPtr   — byte offset into HEAPF64 of length segCount*4
  //              (x0, y0, x1, y1 per segment, mm units)
  //   segCount — number of segments
  // Returns 0 on success, -1 on degenerate input, -2 on internal failure.
  _buildVoronoi(segPtr: number, segCount: number): number;

  // Fill a 4-int buffer at outPtr (HEAP32 offset) with
  //   [vertexCount, edgeCount, vertexSourceRefTotal, edgePointTotal]
  _getCounts(outPtr: number): void;

  // Emit-side accessors. Each returns elements written or -1 on capacity
  // mismatch. Call _getCounts first to size the buffers.
  _emitVertices(outPtr: number, capacityDoubles: number): number;
  _emitVertexSourceCsr(rowStarts: number, rowCapacity: number,
                       data: number, dataCapacity: number): number;
  _emitEdges(outPtr: number, capacityInts: number): number;
  _emitEdgePointsCsr(rowStarts: number, rowCapacity: number,
                     data: number, dataCapacity: number): number;

  // Free internal state before building the next diagram.
  _resetVoronoi(): void;
}

export default function createVoronoiModule(
  options?: { locateFile?(path: string): string }
): Promise<VoronoiModule>;
EOF

echo "[build.sh] Building Clipper2 module..."
em++ "${COMMON_FLAGS[@]}" \
  -fexceptions \
  -I "$CLIPPER2_INC" \
  -s EXPORT_NAME=createClipper2Module \
  -s "EXPORTED_FUNCTIONS=['_clipperAnswer','_offsetPaths','_booleanPaths','_strokeOpenPaths','_getOffsetCounts','_emitOffsetPathCounts','_emitOffsetPoints','_resetOffsetPaths','_malloc','_free']" \
  -s "EXPORTED_RUNTIME_METHODS=['HEAPF64','HEAP32']" \
  "$SRC_DIR/clipper2.cpp" \
  "$CLIPPER2_SRC/clipper.engine.cpp" \
  "$CLIPPER2_SRC/clipper.offset.cpp" \
  "$CLIPPER2_SRC/clipper.rectclip.cpp" \
  -o "$OUT_DIR/clipper2.js"

echo "[build.sh] Generating clipper2.d.ts..."
cat > "$OUT_DIR/clipper2.d.ts" <<'EOF'
export interface Clipper2Module {
  HEAPF64: Float64Array;
  HEAP32: Int32Array;
  _malloc(size: number): number;
  _free(ptr: number): void;

  _clipperAnswer(): number;
  _offsetPaths(pointsPtr: number, pathCountsPtr: number, pathCount: number,
               delta: number, joinType: number, miterLimit: number,
               arcTolerance: number, precision: number): number;
  _getOffsetCounts(outPtr: number): void;
  _emitOffsetPathCounts(outPtr: number, capacityInts: number): number;
  _emitOffsetPoints(outPtr: number, capacityDoubles: number): number;
  _resetOffsetPaths(): void;

  _booleanPaths(subjPointsPtr: number, subjCountsPtr: number, subjCount: number,
                clipPointsPtr: number, clipCountsPtr: number, clipCount: number,
                op: number, fillRule: number, precision: number): number;

  _strokeOpenPaths(pointsPtr: number, pathCountsPtr: number, pathCount: number,
                   widthsPtr: number, pad: number, arcTolerance: number, precision: number): number;
}

export default function createClipper2Module(
  options?: { wasmBinary?: ArrayBuffer; locateFile?(path: string): string }
): Promise<Clipper2Module>;
EOF

echo "[build.sh] Building Arachne module..."
mapfile -t ARACHNE_SOURCES < <(find "$LIB_ARACHNE_SRC" -name '*.cpp' -print | sort)
em++ "${COMMON_FLAGS[@]}" \
  -std=c++20 \
  -fexceptions \
  -I "$SRC_DIR" \
  -I "$LIB_ARACHNE_INC" \
  -I "$STUB_INC" \
  -I "$BOOST_INC" \
  -I "$CLIPPER2_INC" \
  -s EXPORT_NAME=createArachneModule \
  -s "EXPORTED_FUNCTIONS=['_arachneAnswer','_arachneConfigValueCount','_generateArachnePaths','_getArachneCounts','_emitArachnePathCounts','_emitArachnePathMeta','_emitArachnePoints','_getArachneInnerContourCounts','_emitArachneInnerContourPathCounts','_emitArachneInnerContourPoints','_resetArachnePaths','_malloc','_free']" \
  -s "EXPORTED_RUNTIME_METHODS=['HEAPF64','HEAP32']" \
  "$SRC_DIR/arachne.cpp" \
  "${ARACHNE_SOURCES[@]}" \
  "$CLIPPER2_SRC/clipper.engine.cpp" \
  "$CLIPPER2_SRC/clipper.offset.cpp" \
  "$CLIPPER2_SRC/clipper.rectclip.cpp" \
  -o "$OUT_DIR/arachne.js"

echo "[build.sh] Generating arachne.d.ts..."
cat > "$OUT_DIR/arachne.d.ts" <<'EOF'
export interface ArachneModule {
  HEAPF64: Float64Array;
  HEAP32: Int32Array;
  _malloc(size: number): number;
  _free(ptr: number): void;

  _arachneAnswer(): number;
  _arachneConfigValueCount(): number;
  _generateArachnePaths(pointsPtr: number, pathCountsPtr: number, pathCount: number,
                        configValuesPtr: number, configValueCount: number): number;
  _getArachneCounts(outPtr: number): void;
  _emitArachnePathCounts(outPtr: number, capacityInts: number): number;
  _emitArachnePathMeta(outPtr: number, capacityInts: number): number;
  _emitArachnePoints(outPtr: number, capacityDoubles: number): number;
  _getArachneInnerContourCounts(outPtr: number): void;
  _emitArachneInnerContourPathCounts(outPtr: number, capacityInts: number): number;
  _emitArachneInnerContourPoints(outPtr: number, capacityDoubles: number): number;
  _resetArachnePaths(): void;
}

export default function createArachneModule(
  options?: { wasmBinary?: ArrayBuffer; locateFile?(path: string): string }
): Promise<ArachneModule>;
EOF

echo "[build.sh] Done. Artifacts in $OUT_DIR:"
ls -lh "$OUT_DIR"
