import Toolbar from './components/toolbar/Toolbar';
import Viewport from './components/viewport/Viewport';
import Timeline from './components/panels/Timeline';
import ComponentTree from './components/panels/ComponentTree';
import StatusBar from './components/panels/StatusBar';
import ExportDialog from './components/dialogs/ExportDialog';
import DuetPrinterPanel from './components/printer/DuetPrinterPanel';
import SlicerWorkspace from './components/slicer/SlicerWorkspace';
import UpdatePanel from './components/updater/UpdatePanel';
import { useCADStore } from './store/cadStore';
import ActiveDialog from './app/ActiveDialog';
import { DevFixtureLoader } from './devFixtures/orangePi3LtsCase';
import './App.css';

function WorkspaceContent() {
  const workspaceMode = useCADStore((s) => s.workspaceMode);

  if (workspaceMode === 'prepare') return <SlicerWorkspace />;
  if (workspaceMode === 'printer') return <DuetPrinterPanel fullscreen />;

  return (
    <div className="workspace">
      <ComponentTree />
      <div className="viewport-container">
        <Viewport />
      </div>
      <DuetPrinterPanel />
      <Timeline />
    </div>
  );
}

export default function App() {
  const workspaceMode = useCADStore((s) => s.workspaceMode);

  return (
    <div className="app">
      <DevFixtureLoader />
      <Toolbar />
      <WorkspaceContent />
      {workspaceMode === 'design' && <StatusBar />}
      <ExportDialog />
      <ActiveDialog />
      <UpdatePanel />
    </div>
  );
}
