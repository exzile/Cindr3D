import Viewport from './components/viewport/Viewport';
import Toolbar from './components/toolbar/Toolbar';
import Timeline from './components/panels/Timeline';
import ComponentTree from './components/panels/ComponentTree';
import StatusBar from './components/panels/StatusBar';
import ExtrudeDialog from './components/dialogs/ExtrudeDialog';
import ExportDialog from './components/dialogs/ExportDialog';
import DuetPrinterPanel from './components/printer/DuetPrinterPanel';
import DuetSettings from './components/printer/DuetSettings';
import SlicerWorkspace from './components/slicer/SlicerWorkspace';
import {
  ShellDialog,
  LinearPatternDialog,
  CircularPatternDialog,
  MirrorDialog,
  CombineDialog,
  HoleDialog,
  ConstructionPlaneDialog,
  JointDialog,
} from './components/dialogs/FeatureDialogs';
import ParametersPanel from './components/panels/ParametersPanel';
import { useCADStore } from './store/cadStore';
import './App.css';

function ActiveDialog() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const setActiveDialog = useCADStore((s) => s.setActiveDialog);
  const close = () => setActiveDialog(null);

  switch (activeDialog) {
    case 'shell': return <ShellDialog onClose={close} />;
    case 'linear-pattern': return <LinearPatternDialog onClose={close} />;
    case 'circular-pattern': return <CircularPatternDialog onClose={close} />;
    case 'mirror': return <MirrorDialog onClose={close} />;
    case 'combine': return <CombineDialog onClose={close} />;
    case 'hole': return <HoleDialog onClose={close} />;
    case 'construction-plane': return <ConstructionPlaneDialog onClose={close} />;
    case 'joint': return <JointDialog onClose={close} />;
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
      ) : (
        <SlicerWorkspace />
      )}
      <StatusBar />
      <ExtrudeDialog />
      <ExportDialog />
      <DuetSettings />
      <ActiveDialog />
    </div>
  );
}

export default App;
