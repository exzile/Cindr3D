import { useEffect, useState } from 'react';
import Toolbar from './components/toolbar/Toolbar';
import Viewport from './components/viewport/Viewport';
import Timeline from './components/panels/Timeline';
import ComponentTree from './components/panels/ComponentTree';
import StatusBar from './components/panels/StatusBar';
import ExportDialog from './components/dialogs/ExportDialog';
import DuetPrinterPanel from './components/printer/DuetPrinterPanel';
import SlicerWorkspace from './components/slicer/SlicerWorkspace';
import DuetNotifications from './components/printer/DuetNotifications';
import { useCADStore } from './store/cadStore';
import ActiveDialog from './app/ActiveDialog';
import { DevFixtureLoader } from './devFixtures/orangePi3LtsCase';
import { McpBridgeService } from './services/mcp/McpBridgeService';
import AiAssistantPanel from './components/ai/AiAssistantPanel';
import HomePage from './components/home/HomePage';
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
  const [path, setPath] = useState(() => window.location.pathname);
  const isWorkspaceRoute = path === '/app' || path.startsWith('/app/');

  useEffect(() => {
    const handlePopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!isWorkspaceRoute) return undefined;
    McpBridgeService.start();
    return () => McpBridgeService.stop();
  }, [isWorkspaceRoute]);

  if (!isWorkspaceRoute) {
    return (
      <div className="app app--home">
        <HomePage />
      </div>
    );
  }

  return (
    <div className="app">
      <DevFixtureLoader />
      <Toolbar />
      <WorkspaceContent />
      {workspaceMode === 'design' && <StatusBar />}
      <ExportDialog />
      <ActiveDialog />
      <DuetNotifications />
      <AiAssistantPanel />
    </div>
  );
}
