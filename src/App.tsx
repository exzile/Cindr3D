import Viewport from './components/viewport/Viewport';
import Toolbar from './components/toolbar/Toolbar';
import Timeline from './components/panels/Timeline';
import ComponentTree from './components/panels/ComponentTree';
import StatusBar from './components/panels/StatusBar';
import ExportDialog from './components/dialogs/ExportDialog';
import DuetPrinterPanel from './components/printer/DuetPrinterPanel';
import DuetSettings from './components/printer/DuetSettings';
import SlicerWorkspace from './components/slicer/SlicerWorkspace';
import { MirrorComponentDialog } from './components/dialogs/assembly/MirrorComponentDialog';
import { DuplicateWithJointsDialog } from './components/dialogs/assembly/DuplicateWithJointsDialog';
import { BOMDialog } from './components/dialogs/assembly/BOMDialog';
import { RibDialog } from './components/dialogs/solid/RibDialog';
import {
  ShellDialog,
  LinearPatternDialog,
  CircularPatternDialog,
  PatternOnPathDialog,
  ThreadDialog,
  ThickenDialog,
  WebDialog,
  EmbossDialog,
  RestDialog,
  RedefineSketchPlaneDialog,
  BaseFeatureDialog,
  RenameSketchDialog,
  MirrorDialog,
  CombineDialog,
  HoleDialog,
  ConstructionPlaneDialog,
  JointDialog,
  DraftDialog,
  ScaleDialog,
  PrimitivesDialog,
  MeshReduceDialog,
  ReverseNormalDialog,
  SilhouetteSplitDialog,
  RemoveFaceDialog,
  BoundaryFillDialog,
  TessellateDialog,
  OffsetSurfaceDialog,
  SurfaceTrimDialog,
  SurfaceExtendDialog,
  StitchDialog,
  UnstitchDialog,
  SurfaceSplitDialog,
  AxisPerpToFaceDialog,
  PerpendicularPlaneDialog,
  PlaneAlongPathDialog,
  PointAtEdgeAndPlaneDialog,
  PointAlongPathDialog,
  AsBuiltJointDialog,
  DriveJointsDialog,
  MotionLinkDialog,
  RigidGroupDialog,
  ComponentPatternDialog,
  UntrimDialog,
  SurfaceMergeDialog,
  FillDialog,
  OffsetCurveDialog,
  DeleteFaceDialog,
  SurfacePrimitivesDialog,
  MeshSectionSketchDialog,
  MeshPrimitivesDialog,
  RemeshDialog,
  PlaneCutDialog,
  MakeClosedMeshDialog,
  EraseAndFillDialog,
  MeshSmoothDialog,
  MeshShellDialog,
  MeshCombineDialog,
  MeshReverseNormalDialog,
  MeshAlignDialog,
  MeshSeparateDialog,
  MeshTransformDialog,
  ConvertMeshToBRepDialog,
  PipeDialog,
  MoveBodyDialog,
  SplitBodyDialog,
  PhysicalMaterialDialog,
  AppearanceDialog,
  InsertSVGDialog,
  InsertDXFDialog,
  InsertCanvasDialog,
  JointOriginDialog,
  InterferenceDialog,
} from './components/dialogs';
import ParametersPanel from './components/panels/ParametersPanel';
import { OffsetFaceDialog } from './components/dialogs/solid/OffsetFaceDialog';
import { AlignDialog } from './components/dialogs/solid/AlignDialog';
import { FilletDialog } from './components/dialogs/solid/FilletDialog';
import { ChamferDialog } from './components/dialogs/solid/ChamferDialog';
import DirectEditDialog from './components/dialogs/solid/DirectEditDialog';
import TextureExtrudeDialog from './components/dialogs/solid/TextureExtrudeDialog';
import ReplaceFacePanel from './components/viewport/ReplaceFacePanel';
import { DecalDialog } from './components/dialogs/insert/DecalDialog';
import { AttachedCanvasDialog } from './components/dialogs/insert/AttachedCanvasDialog';
import { SplitFaceDialog } from './components/dialogs/solid/SplitFaceDialog';
import { BoundingSolidDialog } from './components/dialogs/solid/BoundingSolidDialog';
import { ContactSetsDialog } from './components/dialogs/assembly/ContactSetsDialog';
import { InsertComponentDialog } from './components/dialogs/assembly/InsertComponentDialog';
import { SnapFitDialog } from './components/dialogs/solid/SnapFitDialog';
import { LipGrooveDialog } from './components/dialogs/solid/LipGrooveDialog';
import { BossDialog } from './components/dialogs/plastic/BossDialog';
import { FlangeDialog } from './components/dialogs/sheet-metal/FlangeDialog';
import { BendDialog } from './components/dialogs/sheet-metal/BendDialog';
import { UnfoldDialog } from './components/dialogs/sheet-metal/UnfoldDialog';
import { FlatPatternDialog } from './components/dialogs/sheet-metal/FlatPatternDialog';
import { useCADStore } from './store/cadStore';
import { useComponentStore } from './store/componentStore';
import './App.css';

function DirectEditDialogConnected({ onClose }: { onClose: () => void }) {
  const commitDirectEdit = useCADStore((s) => s.commitDirectEdit);
  const directEditFaceId = useCADStore((s) => s.directEditFaceId);
  return (
    <DirectEditDialog
      open={true}
      onClose={onClose}
      onConfirm={commitDirectEdit}
      selectedFaceInfo={directEditFaceId ? 'Face selected' : undefined}
    />
  );
}

function TextureExtrudeDialogConnected({ onClose }: { onClose: () => void }) {
  const commitTextureExtrude = useCADStore((s) => s.commitTextureExtrude);
  return (
    <TextureExtrudeDialog
      open={true}
      onClose={onClose}
      onConfirm={commitTextureExtrude}
    />
  );
}

function DecalDialogConnected({ onClose }: { onClose: () => void }) {
  const decalFaceId = useCADStore((s) => s.decalFaceId);
  const commitDecal = useCADStore((s) => s.commitDecal);
  return (
    <DecalDialog
      open={true}
      faceId={decalFaceId}
      onOk={commitDecal}
      onClose={onClose}
    />
  );
}

function AttachedCanvasDialogConnected({ onClose }: { onClose: () => void }) {
  const canvasReferences = useCADStore((s) => s.canvasReferences);
  const attachedCanvasId = useCADStore((s) => s.attachedCanvasId);
  const updateCanvas = useCADStore((s) => s.updateCanvas);
  const openAttachedCanvasDialog = useCADStore((s) => s.openAttachedCanvasDialog);
  return (
    <AttachedCanvasDialog
      open={true}
      canvases={canvasReferences}
      selectedId={attachedCanvasId}
      onSelectCanvas={(id) => openAttachedCanvasDialog(id)}
      onOk={(id, changes) => { updateCanvas(id, changes); onClose(); }}
      onClose={onClose}
    />
  );
}

function SplitFaceDialogConnected({ onClose }: { onClose: () => void }) {
  const splitFaceId = useCADStore((s) => s.splitFaceId);
  const sketches = useCADStore((s) => s.sketches);
  const constructionPlanes = useCADStore((s) => s.constructionPlanes);
  const commitSplitFace = useCADStore((s) => s.commitSplitFace);
  return (
    <SplitFaceDialog
      open={true}
      faceId={splitFaceId}
      sketches={sketches}
      constructionPlanes={constructionPlanes}
      onOk={commitSplitFace}
      onClose={onClose}
    />
  );
}

function JointOriginDialogConnected({ onClose }: { onClose: () => void }) {
  const componentMap = useComponentStore((s) => s.components);
  const components = Object.values(componentMap);
  const commitJointOrigin = useCADStore((s) => s.commitJointOrigin);
  return (
    <JointOriginDialog
      open={true}
      components={components}
      onOk={(params) => { commitJointOrigin(params); }}
      onClose={onClose}
    />
  );
}

function InterferenceDialogConnected({ onClose }: { onClose: () => void }) {
  const computeInterference = useCADStore((s) => s.computeInterference);
  return (
    <InterferenceDialog
      open={true}
      onClose={onClose}
      onRun={() => { computeInterference(); return useCADStore.getState().interferenceResults; }}
    />
  );
}

function BoundingSolidDialogConnected({ onClose }: { onClose: () => void }) {
  const commitBoundingSolid = useCADStore((s) => s.commitBoundingSolid);
  return (
    <BoundingSolidDialog
      open={true}
      onOk={commitBoundingSolid}
      onClose={onClose}
    />
  );
}

function ContactSetsDialogConnected({ onClose }: { onClose: () => void }) {
  const componentMap       = useComponentStore((s) => s.components);
  const components         = Object.values(componentMap);
  const contactSets        = useCADStore((s) => s.contactSets);
  const addContactSet      = useCADStore((s) => s.addContactSet);
  const toggleContactSet   = useCADStore((s) => s.toggleContactSet);
  const removeContactSet   = useCADStore((s) => s.removeContactSet);
  const enableAllContactSets  = useCADStore((s) => s.enableAllContactSets);
  const disableAllContactSets = useCADStore((s) => s.disableAllContactSets);
  return (
    <ContactSetsDialog
      open={true}
      components={components}
      contactSets={contactSets}
      onAdd={addContactSet}
      onToggle={toggleContactSet}
      onRemove={removeContactSet}
      onEnableAll={enableAllContactSets}
      onDisableAll={disableAllContactSets}
      onClose={onClose}
    />
  );
}

function InsertComponentDialogConnected({ onClose }: { onClose: () => void }) {
  const commitInsertComponent = useCADStore((s) => s.commitInsertComponent);
  return (
    <InsertComponentDialog
      open={true}
      onOk={commitInsertComponent}
      onClose={onClose}
    />
  );
}

function SnapFitDialogConnected({ onClose }: { onClose: () => void }) {
  const snapFitFaceId = useCADStore((s) => s.snapFitFaceId);
  const commitSnapFit = useCADStore((s) => s.commitSnapFit);
  return (
    <SnapFitDialog
      open={true}
      faceId={snapFitFaceId}
      onOk={commitSnapFit}
      onClose={onClose}
    />
  );
}

function LipGrooveDialogConnected({ onClose }: { onClose: () => void }) {
  const lipGrooveEdgeId = useCADStore((s) => s.lipGrooveEdgeId);
  const commitLipGroove = useCADStore((s) => s.commitLipGroove);
  return (
    <LipGrooveDialog
      open={true}
      edgeId={lipGrooveEdgeId}
      onOk={commitLipGroove}
      onClose={onClose}
    />
  );
}

function MirrorComponentDialogConnected({ onClose }: { onClose: () => void }) {
  const componentMap = useComponentStore((s) => s.components);
  const components = Object.values(componentMap);
  const mirrorComponent = useComponentStore((s) => s.mirrorComponent);
  const constructionPlanes = useCADStore((s) => s.constructionPlanes);
  return (
    <MirrorComponentDialog
      open={true}
      components={components}
      constructionPlanes={constructionPlanes}
      onOk={(params) => { mirrorComponent(params); }}
      onClose={onClose}
    />
  );
}

function DuplicateWithJointsDialogConnected({ onClose }: { onClose: () => void }) {
  const duplicateWithJointsTargetId = useCADStore((s) => s.duplicateWithJointsTargetId);
  const componentMap = useComponentStore((s) => s.components);
  const joints = useComponentStore((s) => s.joints);
  const duplicateComponentWithJoints = useComponentStore((s) => s.duplicateComponentWithJoints);
  const component = duplicateWithJointsTargetId ? componentMap[duplicateWithJointsTargetId] ?? null : null;
  const jointCount = duplicateWithJointsTargetId
    ? Object.values(joints).filter(
        (j) => j.componentId1 === duplicateWithJointsTargetId || j.componentId2 === duplicateWithJointsTargetId
      ).length
    : 0;
  return (
    <DuplicateWithJointsDialog
      open={true}
      component={component}
      jointCount={jointCount}
      onOk={() => { if (duplicateWithJointsTargetId) duplicateComponentWithJoints(duplicateWithJointsTargetId); }}
      onClose={onClose}
    />
  );
}

function BOMDialogConnected({ onClose }: { onClose: () => void }) {
  const getBOMEntries = useCADStore((s) => s.getBOMEntries);
  const entries = getBOMEntries();

  const handleExportCSV = () => {
    const header = '#,Name,Qty,Material,Est. Mass,Description';
    const rows = entries.map((e) =>
      [e.partNumber, `"${e.name}"`, e.quantity, `"${e.material}"`, `"${e.estimatedMass}"`, `"${e.description}"`].join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bill-of-materials.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <BOMDialog
      open={true}
      entries={entries}
      onExportCSV={handleExportCSV}
      onClose={onClose}
    />
  );
}

function FillDialogConnected({ onClose }: { onClose: () => void }) {
  const fillBoundaryEdgeIds = useCADStore((s) => s.fillBoundaryEdgeIds);
  const commitFill = useCADStore((s) => s.commitFill);
  return (
    <FillDialog
      open={true}
      edgeCount={Math.max(fillBoundaryEdgeIds.length, 1)}
      onOk={(params) => { commitFill(params); onClose(); }}
      onClose={onClose}
    />
  );
}

function OffsetCurveDialogConnected({ onClose }: { onClose: () => void }) {
  const sketches = useCADStore((s) => s.sketches);
  const commitOffsetCurve = useCADStore((s) => s.commitOffsetCurve);
  return (
    <OffsetCurveDialog
      open={true}
      sketches={sketches}
      onOk={(params) => { commitOffsetCurve(params); onClose(); }}
      onClose={onClose}
    />
  );
}

function SurfaceMergeDialogConnected({ onClose }: { onClose: () => void }) {
  const surfaceMergeFace1Id = useCADStore((s) => s.surfaceMergeFace1Id);
  const surfaceMergeFace2Id = useCADStore((s) => s.surfaceMergeFace2Id);
  const commitSurfaceMerge = useCADStore((s) => s.commitSurfaceMerge);
  return (
    <SurfaceMergeDialog
      open={true}
      face1Id={surfaceMergeFace1Id}
      face2Id={surfaceMergeFace2Id}
      onOk={(params) => { commitSurfaceMerge(params); onClose(); }}
      onClose={onClose}
    />
  );
}

function DeleteFaceDialogConnected({ onClose }: { onClose: () => void }) {
  const deleteFaceIds = useCADStore((s) => s.deleteFaceIds);
  const commitDeleteFace = useCADStore((s) => s.commitDeleteFace);
  return (
    <DeleteFaceDialog
      open={true}
      faceCount={deleteFaceIds.length}
      onOk={(params) => { commitDeleteFace({ ...params, faceIds: deleteFaceIds }); onClose(); }}
      onClose={onClose}
    />
  );
}

function SurfacePrimitivesDialogConnected({ onClose }: { onClose: () => void }) {
  const commitSurfacePrimitive = useCADStore((s) => s.commitSurfacePrimitive);
  return (
    <SurfacePrimitivesDialog
      open={true}
      onOk={(params) => { commitSurfacePrimitive(params); onClose(); }}
      onClose={onClose}
    />
  );
}

function ActiveDialog() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const setActiveDialog = useCADStore((s) => s.setActiveDialog);
  const dialogPayload = useCADStore((s) => s.dialogPayload);
  const close = () => setActiveDialog(null);

  switch (activeDialog) {
    case 'shell': return <ShellDialog onClose={close} />;
    case 'linear-pattern': return <LinearPatternDialog onClose={close} />;
    case 'circular-pattern': return <CircularPatternDialog onClose={close} />;
    case 'mirror': return <MirrorDialog onClose={close} />;
    case 'combine': return <CombineDialog onClose={close} />;
    case 'hole': return <HoleDialog onClose={close} />;
    case 'construction-plane': return <ConstructionPlaneDialog onClose={close} />;
    case 'construction-plane-angle': return <ConstructionPlaneDialog onClose={close} initialMethod="angle" />;
    case 'construction-plane-midplane': return <ConstructionPlaneDialog onClose={close} initialMethod="midplane" />;
    case 'thicken': return <ThickenDialog onClose={close} />;
    case 'rib': return <RibDialog onClose={close} />;
    case 'web': return <WebDialog onClose={close} />;
    case 'emboss': return <EmbossDialog onClose={close} />;
    case 'rest': return <RestDialog onClose={close} />;
    case 'redefine-sketch-plane': return <RedefineSketchPlaneDialog onClose={close} />;
    case 'rename-sketch': return <RenameSketchDialog sketchId={dialogPayload} onClose={close} />;
    case 'base-feature': return <BaseFeatureDialog onClose={close} />;
    case 'joint': return <JointDialog onClose={close} />;
    case 'as-built-joint': return <AsBuiltJointDialog onClose={close} />;
    case 'component-pattern': return <ComponentPatternDialog onClose={close} />;
    case 'draft': return <DraftDialog onClose={close} />;
    case 'scale': return <ScaleDialog onClose={close} />;
    case 'primitive-box': return <PrimitivesDialog kind="box" onClose={close} />;
    case 'primitive-cylinder': return <PrimitivesDialog kind="cylinder" onClose={close} />;
    case 'primitive-sphere': return <PrimitivesDialog kind="sphere" onClose={close} />;
    case 'primitive-torus': return <PrimitivesDialog kind="torus" onClose={close} />;
    case 'primitive-coil': return <PrimitivesDialog kind="coil" onClose={close} />;
    case 'tessellate': return <TessellateDialog onClose={close} />;
    case 'pattern-on-path': return <PatternOnPathDialog onClose={close} />;
    case 'thread': return <ThreadDialog onClose={close} />;
    case 'parameters': return <ParametersPanel onClose={close} />;
    case 'mesh-reduce': return <MeshReduceDialog onClose={close} />;
    case 'reverse-normal': return <ReverseNormalDialog onClose={close} />;
    case 'silhouette-split': return <SilhouetteSplitDialog onClose={close} />;
    case 'remove-face': return <RemoveFaceDialog onClose={close} />;
    case 'boundary-fill': return <BoundaryFillDialog onClose={close} />;
    case 'offset-surface': return <OffsetSurfaceDialog onClose={close} />;
    case 'surface-trim': return <SurfaceTrimDialog onClose={close} />;
    case 'surface-extend': return <SurfaceExtendDialog onClose={close} />;
    case 'stitch': return <StitchDialog onClose={close} />;
    case 'unstitch': return <UnstitchDialog onClose={close} />;
    case 'surface-split': return <SurfaceSplitDialog onClose={close} />;
    case 'offset-face': return <OffsetFaceDialog onClose={close} />;
    case 'align-dialog': return <AlignDialog onClose={close} />;
    case 'fillet': return <FilletDialog onClose={close} />;
    case 'chamfer': return <ChamferDialog onClose={close} />;
    case 'axis-perp-to-face': return <AxisPerpToFaceDialog onClose={close} />;
    case 'perpendicular-plane': return <PerpendicularPlaneDialog onClose={close} />;
    case 'plane-along-path': return <PlaneAlongPathDialog onClose={close} />;
    case 'point-at-edge-plane': return <PointAtEdgeAndPlaneDialog onClose={close} />;
    case 'point-along-path': return <PointAlongPathDialog onClose={close} />;
    case 'drive-joints': return <DriveJointsDialog onClose={close} />;
    case 'motion-link': return <MotionLinkDialog onClose={close} />;
    case 'rigid-group': return <RigidGroupDialog onClose={close} />;
    case 'untrim': return <UntrimDialog onClose={close} />;
    case 'surface-merge': return <SurfaceMergeDialogConnected onClose={close} />;
    case 'fill': return <FillDialogConnected onClose={close} />;
    case 'offset-curve': return <OffsetCurveDialogConnected onClose={close} />;
    case 'delete-face': return <DeleteFaceDialogConnected onClose={close} />;
    case 'surface-primitives': return <SurfacePrimitivesDialogConnected onClose={close} />;
    case 'mesh-section-sketch': return <MeshSectionSketchDialog onClose={close} />;
    case 'mesh-primitives': return <MeshPrimitivesDialog onClose={close} />;
    case 'remesh': return <RemeshDialog onClose={close} />;
    case 'plane-cut': return <PlaneCutDialog onClose={close} />;
    case 'make-closed-mesh': return <MakeClosedMeshDialog onClose={close} />;
    case 'erase-and-fill': return <EraseAndFillDialog onClose={close} />;
    case 'mesh-smooth': return <MeshSmoothDialog onClose={close} />;
    case 'mesh-shell': return <MeshShellDialog onClose={close} />;
    case 'mesh-combine': return <MeshCombineDialog onClose={close} />;
    case 'mesh-reverse-normal': return <MeshReverseNormalDialog onClose={close} />;
    case 'mesh-align': return <MeshAlignDialog onClose={close} />;
    case 'mesh-separate': return <MeshSeparateDialog onClose={close} />;
    case 'mesh-transform': return <MeshTransformDialog onClose={close} />;
    case 'convert-mesh-to-brep': return <ConvertMeshToBRepDialog onClose={close} />;
    case 'pipe': return <PipeDialog onClose={close} />;
    case 'move-body': return <MoveBodyDialog onClose={close} />;
    case 'split': return <SplitBodyDialog onClose={close} />;
    case 'physical-material': return <PhysicalMaterialDialog onClose={close} />;
    case 'appearance': return <AppearanceDialog onClose={close} />;
    case 'insert-svg': return <InsertSVGDialog onClose={close} />;
    case 'insert-dxf': return <InsertDXFDialog onClose={close} />;
    case 'insert-canvas': return <InsertCanvasDialog onClose={close} />;
    case 'replace-face': return <ReplaceFacePanel />;
    case 'direct-edit': return <DirectEditDialogConnected onClose={close} />;
    case 'texture-extrude': return <TextureExtrudeDialogConnected onClose={close} />;
    case 'decal': return <DecalDialogConnected onClose={close} />;
    case 'attached-canvas': return <AttachedCanvasDialogConnected onClose={close} />;
    case 'split-face': return <SplitFaceDialogConnected onClose={close} />;
    case 'bounding-solid': return <BoundingSolidDialogConnected onClose={close} />;
    case 'joint-origin': return <JointOriginDialogConnected onClose={close} />;
    case 'interference': return <InterferenceDialogConnected onClose={close} />;
    case 'contact-sets': return <ContactSetsDialogConnected onClose={close} />;
    case 'insert-component': return <InsertComponentDialogConnected onClose={close} />;
    case 'snap-fit': return <SnapFitDialogConnected onClose={close} />;
    case 'lip-groove': return <LipGrooveDialogConnected onClose={close} />;
    case 'boss': return <BossDialog onClose={close} />;
    case 'mirror-component': return <MirrorComponentDialogConnected onClose={close} />;
    case 'duplicate-with-joints': return <DuplicateWithJointsDialogConnected onClose={close} />;
    case 'bom': return <BOMDialogConnected onClose={close} />;
    case 'sheet-flange': return <FlangeDialog onClose={close} />;
    case 'sheet-bend': return <BendDialog onClose={close} />;
    case 'sheet-unfold': return <UnfoldDialog onClose={close} />;
    case 'sheet-flat-pattern': return <FlatPatternDialog onClose={close} />;
    default: return null;
  }
}

function App() {
  const workspaceMode = useCADStore((s) => s.workspaceMode);

  return (
    <div className="app">
      <Toolbar />
      {workspaceMode === 'design' ? (
        <div className="workspace">
          <ComponentTree />
          <div className="viewport-container">
            <Viewport />
          </div>
          <DuetPrinterPanel />
          <Timeline />
        </div>
      ) : workspaceMode === 'prepare' ? (
        <SlicerWorkspace />
      ) : (
        <DuetPrinterPanel fullscreen />
      )}
      <StatusBar />
      <ExportDialog />
      <DuetSettings />
      <ActiveDialog />
    </div>
  );
}

export default App;
