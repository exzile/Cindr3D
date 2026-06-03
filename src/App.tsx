import { lazy, Suspense, useEffect } from 'react';
import OccLoadingModal from './components/app/OccLoadingModal';
import { WorkspaceContent } from './components/app/WorkspaceContent';
import { useDeviceMode } from './components/app/useDeviceMode';
import { useOccPreload } from './components/app/useOccPreload';
import { useWorkspaceRouting } from './components/app/useWorkspaceRouting';
import Toolbar from './components/toolbar/Toolbar';
import StatusBar from './components/panels/StatusBar';
import DuetNotifications from './components/printer/DuetNotifications';
import GCodeToast from './components/printer/GCodeToast';
import { PrintSessionResumeBanner } from './components/printer/PrintSessionResumeBanner';
import { useCADStore } from './store/cadStore';
import { DevFixtureLoader } from './devFixtures/orangePi3LtsCase';
import { McpBridgeService } from './services/mcp/McpBridgeService';
import AiAssistantPanel from './components/ai/AiAssistantPanel';
import './App.css';

const ActiveDialog = lazy(() => import('./app/ActiveDialog'));
const ExportDialog = lazy(() => import('./components/dialogs/ExportDialog'));
const HomePage = lazy(() => import('./components/home/HomePage'));

export default function App() {
  const workspaceMode = useCADStore((s) => s.workspaceMode);
  const showExportDialog = useCADStore((s) => s.showExportDialog);
  const activeDialog = useCADStore((s) => s.activeDialog);
  const isHomeRoute = useWorkspaceRouting();

  useOccPreload();
  useDeviceMode();

  useEffect(() => {
    if (isHomeRoute || !import.meta.env.DEV) return undefined;
    McpBridgeService.start();
    return () => McpBridgeService.stop();
  }, [isHomeRoute]);

  if (isHomeRoute) {
    return (
      <div className="app app--home">
        <Suspense fallback={null}>
          <HomePage />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="app">
      <DevFixtureLoader />
      <Toolbar />
      <PrintSessionResumeBanner />
      <WorkspaceContent />
      {workspaceMode === 'design' && <StatusBar />}
      {showExportDialog && (
        <Suspense fallback={null}>
          <ExportDialog />
        </Suspense>
      )}
      {activeDialog && (
        <Suspense fallback={null}>
          <ActiveDialog />
        </Suspense>
      )}
      <DuetNotifications />
      <GCodeToast />
      {import.meta.env.DEV && <AiAssistantPanel />}
      <OccLoadingModal />
    </div>
  );
}
