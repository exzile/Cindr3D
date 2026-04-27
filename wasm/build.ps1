# Native (no-Docker) build of the ARACHNE-9 WASM modules.
#
# Mirrors wasm/build.sh but runs em++ from the local emsdk in
# wasm/.toolchain/emsdk and uses the Boost headers extracted to
# wasm/.toolchain/boost_1_84_0. Outputs to wasm/dist/.
#
# Use:
#   powershell -ExecutionPolicy Bypass -File wasm\build.ps1
#
$ErrorActionPreference = 'Stop'

$Root      = Split-Path -Parent $PSCommandPath
$Toolchain = Join-Path $Root '.toolchain'
$Emsdk     = Join-Path $Toolchain 'emsdk'
$BoostInc  = Join-Path $Toolchain 'boost_1_84_0'
$Clipper2  = Join-Path $Toolchain 'clipper2'
$Clipper2Inc = Join-Path $Clipper2 'CPP\Clipper2Lib\include'
$Clipper2Src = Join-Path $Clipper2 'CPP\Clipper2Lib\src'
$SrcDir    = Join-Path $Root 'src'
$OutDir    = Join-Path $Root 'dist'

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

# Load emsdk env into this process. emsdk_env.bat exports vars via SET;
# we capture them and apply to the current PS environment.
$envBat = Join-Path $Emsdk 'emsdk_env.bat'
if (-not (Test-Path $envBat)) { throw "emsdk not installed at $Emsdk" }

cmd /c "`"$envBat`" > nul 2>&1 && set" | ForEach-Object {
    if ($_ -match '^([^=]+)=(.*)$') {
        Set-Item -Path "Env:$($matches[1])" -Value $matches[2] -ErrorAction SilentlyContinue
    }
}

$emcc = Join-Path $Emsdk 'upstream\emscripten\em++.bat'
if (-not (Test-Path $emcc)) { throw "em++ not found at $emcc" }

$flags = @(
    '-std=c++17',
    '-Oz',
    '-fno-rtti',
    '-s', 'STANDALONE_WASM=0',     # need Module wrapper for HEAPF64/HEAP32 access
    '-s', 'WASM=1',
    '-s', 'ALLOW_MEMORY_GROWTH=1',
    '-s', 'INITIAL_MEMORY=2MB',
    '-s', 'ENVIRONMENT=web,worker,node',
    '-s', 'FILESYSTEM=0',
    '-s', 'MODULARIZE=1',
    '-s', 'EXPORT_ES6=1',
    '--no-entry'
)

$voronoiFlags = @(
    $flags,
    '-fno-exceptions',
    '-I', $BoostInc,
    '-s', 'EXPORT_NAME=createVoronoiModule',
    '-s', "EXPORTED_FUNCTIONS=['_answer','_buildVoronoi','_getCounts','_emitVertices','_emitVertexSourceCsr','_emitEdges','_emitEdgePointsCsr','_resetVoronoi','_malloc','_free']",
    '-s', "EXPORTED_RUNTIME_METHODS=['HEAPF64','HEAP32']"
)

Write-Host "[build.ps1] Building voronoi module..."
# em++ writes its INFO/WARN lines to stderr. Under $ErrorActionPreference=Stop
# PowerShell 5.1 promotes each stderr line to an ErrorRecord. Temporarily
# relax so we only fail on the real exit code.
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    & $emcc @voronoiFlags (Join-Path $SrcDir 'voronoi.cpp') -o (Join-Path $OutDir 'voronoi.js')
} finally {
    $ErrorActionPreference = $prevEAP
}
if ($LASTEXITCODE -ne 0) { throw "em++ failed with exit code $LASTEXITCODE" }

Write-Host "[build.ps1] Generating voronoi.d.ts..."
$dts = @'
export interface VoronoiModule {
  HEAPF64: Float64Array;
  HEAP32: Int32Array;
  _malloc(size: number): number;
  _free(ptr: number): void;

  _answer(): number;
  _buildVoronoi(segPtr: number, segCount: number): number;
  _getCounts(outPtr: number): void;
  _emitVertices(outPtr: number, capacityDoubles: number): number;
  _emitVertexSourceCsr(rowStarts: number, rowCapacity: number,
                       data: number, dataCapacity: number): number;
  _emitEdges(outPtr: number, capacityInts: number): number;
  _emitEdgePointsCsr(rowStarts: number, rowCapacity: number,
                     data: number, dataCapacity: number): number;
  _resetVoronoi(): void;
}

export default function createVoronoiModule(
  options?: { locateFile?(path: string): string }
): Promise<VoronoiModule>;
'@
Set-Content -Encoding utf8 -Path (Join-Path $OutDir 'voronoi.d.ts') -Value $dts

if (Test-Path $Clipper2) {
    $clipperFlags = @(
        $flags,
        '-fexceptions',
        '-I', $Clipper2Inc,
        '-s', 'EXPORT_NAME=createClipper2Module',
        '-s', "EXPORTED_FUNCTIONS=['_clipperAnswer','_offsetPaths','_booleanPaths','_strokeOpenPaths','_getOffsetCounts','_emitOffsetPathCounts','_emitOffsetPoints','_resetOffsetPaths','_malloc','_free']",
        '-s', "EXPORTED_RUNTIME_METHODS=['HEAPF64','HEAP32']"
    )

    Write-Host "[build.ps1] Building Clipper2 module..."
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $emcc @clipperFlags `
            (Join-Path $SrcDir 'clipper2.cpp') `
            (Join-Path $Clipper2Src 'clipper.engine.cpp') `
            (Join-Path $Clipper2Src 'clipper.offset.cpp') `
            (Join-Path $Clipper2Src 'clipper.rectclip.cpp') `
            -o (Join-Path $OutDir 'clipper2.js')
    } finally {
        $ErrorActionPreference = $prevEAP
    }
    if ($LASTEXITCODE -ne 0) { throw "em++ failed with exit code $LASTEXITCODE" }

    Write-Host "[build.ps1] Generating clipper2.d.ts..."
    $clipperDts = @'
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
  options?: { locateFile?(path: string): string }
): Promise<Clipper2Module>;
'@
    Set-Content -Encoding utf8 -Path (Join-Path $OutDir 'clipper2.d.ts') -Value $clipperDts
} else {
    Write-Host "[build.ps1] Clipper2 source not found at $Clipper2; skipping Clipper2 module."
}

$LibArachneInc = Join-Path $Root 'vendor\libArachne\include'
$LibArachneSrc = Join-Path $Root 'vendor\libArachne\src'
$StubInc = Join-Path $Root 'vendor\stubs'

if (Test-Path $LibArachneSrc) {
    $arachneSources = @((Join-Path $SrcDir 'arachne.cpp')) + @(
        Get-ChildItem -Path $LibArachneSrc -Recurse -File -Include *.cpp |
            ForEach-Object { $_.FullName }
    ) + @(
        (Join-Path $Clipper2Src 'clipper.engine.cpp'),
        (Join-Path $Clipper2Src 'clipper.offset.cpp'),
        (Join-Path $Clipper2Src 'clipper.rectclip.cpp')
    )
    $arachneFlags = @(
        $flags,
        '-std=c++20',
        '-fexceptions',
        '-I', $SrcDir,
        '-I', $LibArachneInc,
        '-I', $StubInc,
        '-I', $BoostInc,
        '-I', $Clipper2Inc,
        '-s', 'EXPORT_NAME=createArachneModule',
        '-s', "EXPORTED_FUNCTIONS=['_arachneAnswer','_arachneConfigValueCount','_generateArachnePaths','_getArachneCounts','_emitArachnePathCounts','_emitArachnePathMeta','_emitArachnePoints','_getArachneInnerContourCounts','_emitArachneInnerContourPathCounts','_emitArachneInnerContourPoints','_resetArachnePaths','_malloc','_free']",
        '-s', "EXPORTED_RUNTIME_METHODS=['HEAPF64','HEAP32']"
    )

    Write-Host "[build.ps1] Building Arachne module..."
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $emcc @arachneFlags @arachneSources -o (Join-Path $OutDir 'arachne.js')
    } finally {
        $ErrorActionPreference = $prevEAP
    }
    if ($LASTEXITCODE -ne 0) { throw "em++ failed with exit code $LASTEXITCODE" }

    Write-Host "[build.ps1] Generating arachne.d.ts..."
    $arachneDts = @'
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
  options?: { locateFile?(path: string): string }
): Promise<ArachneModule>;
'@
    Set-Content -Encoding utf8 -Path (Join-Path $OutDir 'arachne.d.ts') -Value $arachneDts
} else {
    Write-Host "[build.ps1] libArachne source not found at $LibArachneSrc; skipping Arachne module."
}

Write-Host "[build.ps1] Done."
Get-ChildItem $OutDir | Format-Table Name, Length
