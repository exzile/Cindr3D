import CanvasControls from './canvasControls/CanvasControls';
import SketchPalette from './sketch/SketchPalette';
import DimensionEditorOverlay from './sketch/DimensionEditorOverlay';
import OverConstraintDialog from './sketch/OverConstraintDialog';
import MeasurePanel from './panels/MeasurePanel';
import ExtrudePanel from './panels/ExtrudePanel';
import RevolvePanel from './panels/RevolvePanel';
import SweepPanel from './panels/SweepPanel';
import LoftPanel from './panels/LoftPanel';
import SketchTextPanel from './sketch/SketchTextPanel';
import SketchProjectPanel from './sketch/SketchProjectPanel';
import PatchPanel from './panels/PatchPanel';
import RuledSurfacePanel from './panels/RuledSurfacePanel';
import RibPanel from './panels/RibPanel';
import SectionAnalysisPanel from './panels/SectionAnalysisPanel';
import SketchPatternPanel from './sketch/SketchPatternPanel';
import SketchTransformPanel from './sketch/SketchTransformPanel';
import SketchMirrorPanel from './sketch/SketchMirrorPanel';
import ExplodedViewPanel from './panels/ExplodedViewPanel';
import ConstructTwoPlanePanel from './panels/ConstructTwoPlanePanel';
import ConstructThreePlanePanel from './panels/ConstructThreePlanePanel';
import AnalysisPanel from './panels/AnalysisPanel';

export function ViewportPanels() {
  return (
    <>
      <CanvasControls />
      <SketchPalette />
      <MeasurePanel />
      <ExtrudePanel />
      <RevolvePanel />
      <SweepPanel />
      <LoftPanel />
      <PatchPanel />
      <RuledSurfacePanel />
      <RibPanel />
      <SectionAnalysisPanel />
      <SketchPatternPanel />
      <SketchTransformPanel />
      <SketchMirrorPanel />
      <SketchTextPanel />
      <SketchProjectPanel />
      <ConstructTwoPlanePanel />
      <ConstructThreePlanePanel />
      <AnalysisPanel />
      <ExplodedViewPanel />
      <DimensionEditorOverlay />
      <OverConstraintDialog />
    </>
  );
}
