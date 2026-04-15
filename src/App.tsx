import Viewport from './components/viewport/Viewport';
import Toolbar from './components/toolbar/Toolbar';
import Timeline from './components/panels/Timeline';
import ComponentTree from './components/panels/ComponentTree';
import StatusBar from './components/panels/StatusBar';
import ExportDialog from './components/dialogs/ExportDialog';
import DuetPrinterPanel from './components/printer/DuetPrinterPanel';
import DuetSettings from './components/printer/DuetSettings';
import SlicerWorkspace from './components/slicer/SlicerWorkspace';
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
} from './components/dialogs/FeatureDialogs';
import ParametersPanel from './components/panels/ParametersPanel';
import { useCADStore } from './store/cadStore';
import './App.css';

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
    case 'web': return <WebDialog onClose={close} />;
    case 'emboss': return <EmbossDialog onClose={close} />;
    case 'rest': return <RestDialog onClose={close} />;
    case 'redefine-sketch-plane': return <RedefineSketchPlaneDialog onClose={close} />;
    case 'rename-sketch': return <RenameSketchDialog sketchId={dialogPayload} onClose={close} />;
    case 'base-feature': return <BaseFeatureDialog onClose={close} />;
    case 'joint': return <JointDialog onClose={close} />;
    case 'draft': return <DraftDialog onClose={close} />;
    case 'scale': return <ScaleDialog onClose={close} />;
    case 'primitive-box': return <PrimitivesDialog kind="box" onClose={close} />;
    case 'primitive-cylinder': return <PrimitivesDialog kind="cylinder" onClose={close} />;
    case 'primitive-sphere': return <PrimitivesDialog kind="sphere" onClose={close} />;
    case 'primitive-torus': return <PrimitivesDialog kind="torus" onClose={close} />;
    case 'pattern-on-path': return <PatternOnPathDialog onClose={close} />;
    case 'thread': return <ThreadDialog onClose={close} />;
    case 'parameters': return <ParametersPanel onClose={close} />;
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
