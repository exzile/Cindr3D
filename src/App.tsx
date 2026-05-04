import { useEffect, useRef, useState } from 'react';
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
import { TABS, type TabKey } from './components/printer/duetPrinterPanel/config';
import { usePrinterStore } from './store/printerStore';
import './App.css';

type WorkspaceMode = 'design' | 'prepare' | 'printer';

const PRINTER_TABS = new Set<string>(['printers', ...TABS.map((tab) => tab.key)]);

function routeFromPath(pathname: string): { workspaceMode?: WorkspaceMode; printerTab?: TabKey; isHome: boolean } {
  if (pathname === '/home' || pathname.startsWith('/home/')) return { isHome: true };
  if (pathname === '/prepare') return { workspaceMode: 'prepare', isHome: false };
  if (pathname === '/design' || pathname === '/') return { workspaceMode: 'design', isHome: false };
  if (pathname === '/printer' || pathname.startsWith('/printer/')) {
    const candidate = pathname.split('/')[2] || 'dashboard';
    return {
      workspaceMode: 'printer',
      printerTab: (PRINTER_TABS.has(candidate) ? candidate : 'dashboard') as TabKey,
      isHome: false,
    };
  }
  return { workspaceMode: 'design', isHome: false };
}

function pathForWorkspace(workspaceMode: WorkspaceMode, printerTab: TabKey) {
  if (workspaceMode === 'prepare') return '/prepare';
  if (workspaceMode === 'printer') return `/printer/${printerTab}`;
  return '/design';
}

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
  const setWorkspaceMode = useCADStore((s) => s.setWorkspaceMode);
  const activePrinterTab = usePrinterStore((s) => s.activeTab as TabKey);
  const setActivePrinterTab = usePrinterStore((s) => s.setActiveTab);
  const [path, setPath] = useState(() => window.location.pathname);
  const skipNextUrlSyncRef = useRef(false);
  const route = routeFromPath(path);
  const isHomeRoute = route.isHome;

  useEffect(() => {
    const handlePopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const nextRoute = routeFromPath(path);
    if (nextRoute.isHome) return;
    const currentWorkspaceMode = useCADStore.getState().workspaceMode;
    const currentPrinterTab = usePrinterStore.getState().activeTab as TabKey;

    if (nextRoute.workspaceMode && nextRoute.workspaceMode !== currentWorkspaceMode) {
      skipNextUrlSyncRef.current = true;
      setWorkspaceMode(nextRoute.workspaceMode);
    }
    if (nextRoute.printerTab && nextRoute.printerTab !== currentPrinterTab) {
      skipNextUrlSyncRef.current = true;
      setActivePrinterTab(nextRoute.printerTab);
    }
  }, [path, setActivePrinterTab, setWorkspaceMode]);

  useEffect(() => {
    if (isHomeRoute) return;
    if (skipNextUrlSyncRef.current) {
      skipNextUrlSyncRef.current = false;
      return;
    }

    const nextPath = pathForWorkspace(workspaceMode, activePrinterTab);
    if (window.location.pathname === nextPath) return;
    window.history.replaceState({}, '', nextPath);
  }, [activePrinterTab, isHomeRoute, workspaceMode]);

  useEffect(() => {
    if (isHomeRoute) return undefined;
    McpBridgeService.start();
    return () => McpBridgeService.stop();
  }, [isHomeRoute]);

  if (isHomeRoute) {
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
