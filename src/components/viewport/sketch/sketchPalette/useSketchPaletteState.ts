import { useCADStore } from '../../../../store/cadStore';

export function useSketchPaletteState() {
  const activeSketch = useCADStore((s) => s.activeSketch);
  const activeTool = useCADStore((s) => s.activeTool);
  const finishSketch = useCADStore((s) => s.finishSketch);
  const snapEnabled = useCADStore((s) => s.snapEnabled);
  const setSnapEnabled = useCADStore((s) => s.setSnapEnabled);
  const gridVisible = useCADStore((s) => s.gridVisible);
  const setGridVisible = useCADStore((s) => s.setGridVisible);
  const gridSize = useCADStore((s) => s.gridSize);
  const sketchGridSize = useCADStore((s) => s.sketchGridSize);
  const setSketchGridSize = useCADStore((s) => s.setSketchGridSize);
  const polygonSides = useCADStore((s) => s.sketchPolygonSides);
  const setPolygonSides = useCADStore((s) => s.setSketchPolygonSides);
  const filletRadius = useCADStore((s) => s.sketchFilletRadius);
  const setFilletRadius = useCADStore((s) => s.setSketchFilletRadius);
  const tangentCircleRadius = useCADStore((s) => s.tangentCircleRadius);
  const setTangentCircleRadius = useCADStore((s) => s.setTangentCircleRadius);
  const blendCurveMode = useCADStore((s) => s.blendCurveMode);
  const setBlendCurveMode = useCADStore((s) => s.setBlendCurveMode);
  const conicRho = useCADStore((s) => s.conicRho);
  const setConicRho = useCADStore((s) => s.setConicRho);
  const chamferDist1 = useCADStore((s) => s.sketchChamferDist1);
  const setChamferDist1 = useCADStore((s) => s.setSketchChamferDist1);
  const chamferDist2 = useCADStore((s) => s.sketchChamferDist2);
  const setChamferDist2 = useCADStore((s) => s.setSketchChamferDist2);
  const chamferAngle = useCADStore((s) => s.sketchChamferAngle);
  const setChamferAngle = useCADStore((s) => s.setSketchChamferAngle);
  const showProfile = useCADStore((s) => s.showSketchProfile);
  const setShowProfile = useCADStore((s) => s.setShowSketchProfile);
  const sliceEnabled = useCADStore((s) => s.sliceEnabled);
  const setSliceEnabled = useCADStore((s) => s.setSliceEnabled);
  const showSketchPoints = useCADStore((s) => s.showSketchPoints);
  const setShowSketchPoints = useCADStore((s) => s.setShowSketchPoints);
  const showSketchDimensions = useCADStore((s) => s.showSketchDimensions);
  const setShowSketchDimensions = useCADStore((s) => s.setShowSketchDimensions);
  const showSketchConstraints = useCADStore((s) => s.showSketchConstraints);
  const setShowSketchConstraints = useCADStore((s) => s.setShowSketchConstraints);
  const showProjectedGeometries = useCADStore((s) => s.showProjectedGeometries);
  const setShowProjectedGeometries = useCADStore((s) => s.setShowProjectedGeometries);
  const showConstructionGeometries = useCADStore((s) => s.showConstructionGeometries);
  const setShowConstructionGeometries = useCADStore((s) => s.setShowConstructionGeometries);
  const setCameraTargetQuaternion = useCADStore((s) => s.setCameraTargetQuaternion);
  const solveSketch = useCADStore((s) => s.solveSketch);
  const sketchComputeDeferred = useCADStore((s) => s.sketchComputeDeferred);
  const setSketchComputeDeferred = useCADStore((s) => s.setSketchComputeDeferred);
  const sketchGridEnabled = useCADStore((s) => s.sketchGridEnabled);
  const setSketchGridEnabled = useCADStore((s) => s.setSketchGridEnabled);
  const sketchSnapEnabled = useCADStore((s) => s.sketchSnapEnabled);
  const setSketchSnapEnabled = useCADStore((s) => s.setSketchSnapEnabled);
  const sketch3DMode = useCADStore((s) => s.sketch3DMode);
  const toggleSketch3DMode = useCADStore((s) => s.toggleSketch3DMode);
  const sketch3DActivePlane = useCADStore((s) => s.sketch3DActivePlane);
  const setSketch3DActivePlane = useCADStore((s) => s.setSketch3DActivePlane);
  const slotWidth = useCADStore((s) => s.sketchSlotWidth);
  const setSlotWidth = useCADStore((s) => s.setSketchSlotWidth);
  const constraintOffsetValue = useCADStore((s) => s.constraintOffsetValue);
  const setConstraintOffsetValue = useCADStore((s) => s.setConstraintOffsetValue);
  const constraintSurfacePlane = useCADStore((s) => s.constraintSurfacePlane);
  const setConstraintSurfacePlane = useCADStore((s) => s.setConstraintSurfacePlane);

  const isPolygonTool =
    activeTool === 'polygon' ||
    activeTool === 'polygon-inscribed' ||
    activeTool === 'polygon-circumscribed' ||
    activeTool === 'polygon-edge';
  const isFilletTool = activeTool === 'sketch-fillet';
  const isChamferEqualTool = activeTool === 'sketch-chamfer-equal';
  const isChamferTwoDistTool = activeTool === 'sketch-chamfer-two-dist';
  const isChamferDistAngleTool = activeTool === 'sketch-chamfer-dist-angle';
  const isChamferTool = isChamferEqualTool || isChamferTwoDistTool || isChamferDistAngleTool;
  const isTangentCircleTool = activeTool === 'circle-2tangent';
  const isConicTool = activeTool === 'conic';
  const isBlendCurveTool = activeTool === 'blend-curve';
  const isArcSlotTool = activeTool === 'slot-3point-arc' || activeTool === 'slot-center-arc';
  const isOffsetConstraintTool = activeTool === 'constrain-offset';
  const isSurfaceConstraintTool =
    activeTool === 'constrain-coincident-surface' ||
    activeTool === 'constrain-perpendicular-surface' ||
    activeTool === 'constrain-line-on-surface' ||
    activeTool === 'constrain-distance-surface';

  return {
    activeSketch,
    activeTool,
    finishSketch,
    snapEnabled,
    setSnapEnabled,
    gridVisible,
    setGridVisible,
    gridSize,
    sketchGridSize,
    setSketchGridSize,
    polygonSides,
    setPolygonSides,
    filletRadius,
    setFilletRadius,
    tangentCircleRadius,
    setTangentCircleRadius,
    blendCurveMode,
    setBlendCurveMode,
    conicRho,
    setConicRho,
    chamferDist1,
    setChamferDist1,
    chamferDist2,
    setChamferDist2,
    chamferAngle,
    setChamferAngle,
    showProfile,
    setShowProfile,
    sliceEnabled,
    setSliceEnabled,
    showSketchPoints,
    setShowSketchPoints,
    showSketchDimensions,
    setShowSketchDimensions,
    showSketchConstraints,
    setShowSketchConstraints,
    showProjectedGeometries,
    setShowProjectedGeometries,
    showConstructionGeometries,
    setShowConstructionGeometries,
    setCameraTargetQuaternion,
    solveSketch,
    sketchComputeDeferred,
    setSketchComputeDeferred,
    sketchGridEnabled,
    setSketchGridEnabled,
    sketchSnapEnabled,
    setSketchSnapEnabled,
    sketch3DMode,
    toggleSketch3DMode,
    sketch3DActivePlane,
    setSketch3DActivePlane,
    slotWidth,
    setSlotWidth,
    constraintOffsetValue,
    setConstraintOffsetValue,
    constraintSurfacePlane,
    setConstraintSurfacePlane,
    isPolygonTool,
    isFilletTool,
    isChamferEqualTool,
    isChamferTwoDistTool,
    isChamferDistAngleTool,
    isChamferTool,
    isTangentCircleTool,
    isConicTool,
    isBlendCurveTool,
    isArcSlotTool,
    isOffsetConstraintTool,
    isSurfaceConstraintTool,
  };
}

export type SketchPaletteState = ReturnType<typeof useSketchPaletteState>;
