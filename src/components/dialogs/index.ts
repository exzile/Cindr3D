// Barrel export — import dialogs from here instead of FeatureDialogs directly.
import './FeatureDialogExtras.css';

// solid
export { FilletDialog } from './solid/FilletDialog';
export { ChamferDialog } from './solid/ChamferDialog';
export { ShellDialog } from './solid/ShellDialog';
export { CombineDialog } from './solid/CombineDialog';
export { HoleDialog } from './solid/HoleDialog';
export { ThreadDialog } from './solid/ThreadDialog';
export { DraftDialog } from './solid/DraftDialog';
export { ScaleDialog } from './solid/ScaleDialog';
export { WebDialog } from './solid/WebDialog';
export { EmbossDialog } from './solid/EmbossDialog';
export { RestDialog } from './solid/RestDialog';
export { BoundaryFillDialog } from './solid/BoundaryFillDialog';
export { BaseFeatureDialog } from './solid/BaseFeatureDialog';
export { RemoveFaceDialog } from './solid/RemoveFaceDialog';
export { SilhouetteSplitDialog } from './solid/SilhouetteSplitDialog';

// pattern
export { LinearPatternDialog } from './pattern/LinearPatternDialog';
export { CircularPatternDialog } from './pattern/CircularPatternDialog';
export { RectangularPatternDialog } from './pattern/RectangularPatternDialog';
export { MirrorDialog } from './pattern/MirrorDialog';
export { PatternOnPathDialog } from './pattern/PatternOnPathDialog';

// surface
export { ThickenDialog } from './surface/ThickenDialog';
export { OffsetSurfaceDialog } from './surface/OffsetSurfaceDialog';
export { SurfaceTrimDialog } from './surface/SurfaceTrimDialog';
export { SurfaceExtendDialog } from './surface/SurfaceExtendDialog';
export { StitchDialog } from './surface/StitchDialog';
export { UnstitchDialog } from './surface/UnstitchDialog';
export { SurfaceSplitDialog } from './surface/SurfaceSplitDialog';

// mesh
export { MeshReduceDialog, ReverseNormalDialog, TessellateDialog } from './mesh/MeshDialogs';
export { MeshSectionSketchDialog } from './mesh/MeshSectionSketchDialog';
export { MeshPrimitivesDialog } from './mesh/MeshPrimitivesDialog';
export { RemeshDialog } from './mesh/RemeshDialog';
export { PlaneCutDialog } from './mesh/PlaneCutDialog';
export { MakeClosedMeshDialog } from './mesh/MakeClosedMeshDialog';
export { EraseAndFillDialog } from './mesh/EraseAndFillDialog';
export { MeshSmoothDialog } from './mesh/MeshSmoothDialog';
export { MeshShellDialog } from './mesh/MeshShellDialog';
export { MeshCombineDialog } from './mesh/MeshCombineDialog';
export { MeshReverseNormalDialog } from './mesh/MeshReverseNormalDialog';
export { MeshAlignDialog } from './mesh/MeshAlignDialog';
export { MeshSeparateDialog } from './mesh/MeshSeparateDialog';
export { MeshTransformDialog } from './mesh/MeshTransformDialog';
export { ConvertMeshToBRepDialog } from './mesh/ConvertMeshToBRepDialog';
export { MeshRepairDialog } from './mesh/MeshRepairDialog';

// sketch
export { RenameSketchDialog } from './sketch/RenameSketchDialog';
export { RedefineSketchPlaneDialog } from './sketch/RedefineSketchPlaneDialog';
export { InsertSVGDialog } from './sketch/InsertSVGDialog';
export { InsertDXFDialog } from './sketch/InsertDXFDialog';
export { InsertCanvasDialog } from './sketch/InsertCanvasDialog';

// construction
export { ConstructionPlaneDialog } from './construction/ConstructionPlaneDialog';
export { AxisPerpToFaceDialog } from './construction/AxisPerpToFaceDialog';
export { PerpendicularPlaneDialog } from './construction/PerpendicularPlaneDialog';
export { PlaneAlongPathDialog } from './construction/PlaneAlongPathDialog';
export { PointAtEdgeAndPlaneDialog } from './construction/PointAtEdgeAndPlaneDialog';
export { PointAlongPathDialog } from './construction/PointAlongPathDialog';

// primitives
export { PrimitivesDialog } from './primitives/PrimitivesDialog';

// parametric
export { ParametricModelDialog } from './parametric';
export { DesignConfigurationsDialog } from './configurations';

// assembly
export { ContactSetsDialog } from './assembly/ContactSetsDialog';
export { InsertComponentDialog } from './assembly/InsertComponentDialog';
export { JointDialog } from './assembly/JointDialog';
export { default as AsBuiltJointDialog } from './assembly/AsBuiltJointDialog';
export { DriveJointsDialog } from './assembly/DriveJointsDialog';
export { MotionLinkDialog } from './assembly/MotionLinkDialog';
export { RigidGroupDialog } from './assembly/RigidGroupDialog';
export { ComponentPatternDialog } from './assembly/ComponentPatternDialog';
export { JointOriginDialog } from './assembly/JointOriginDialog';
export { MirrorComponentDialog } from './assembly/MirrorComponentDialog';
export type { MirrorComponentParams } from './assembly/MirrorComponentDialog';
export { DuplicateWithJointsDialog } from './assembly/DuplicateWithJointsDialog';
export { BOMDialog } from './assembly/BOMDialog';
export type { BOMEntry } from './assembly/BOMDialog';

// inspect
export { InterferenceDialog } from './inspect/InterferenceDialog';

// additional solid dialogs
export { SnapFitDialog } from './solid/SnapFitDialog';
export { LipGrooveDialog } from './solid/LipGrooveDialog';
export { OffsetFaceDialog } from './solid/OffsetFaceDialog';
export { AlignDialog } from './solid/AlignDialog';
export { PipeDialog } from './solid/PipeDialog';
export { CoilDialog } from './solid/CoilDialog';
export { MoveBodyDialog } from './solid/MoveBodyDialog';
export { SplitBodyDialog } from './solid/SplitBodyDialog';
export { PhysicalMaterialDialog } from './solid/PhysicalMaterialDialog';
export { AppearanceDialog } from './solid/AppearanceDialog';

// additional surface dialogs
export { UntrimDialog } from './surface/UntrimDialog';
export { SurfaceMergeDialog } from './surface/SurfaceMergeDialog';
export type { SurfaceMergeParams } from './surface/SurfaceMergeDialog';
export { FillDialog } from './surface/FillDialog';
export type { FillParams } from './surface/FillDialog';
export { OffsetCurveDialog } from './surface/OffsetCurveDialog';
export type { OffsetCurveParams } from './surface/OffsetCurveDialog';
export { DeleteFaceDialog } from './surface/DeleteFaceDialog';
export type { DeleteFaceParams } from './surface/DeleteFaceDialog';
export { SurfacePrimitivesDialog } from './surface/SurfacePrimitivesDialog';
export type { SurfacePrimitiveParams } from './surface/SurfacePrimitivesDialog';
