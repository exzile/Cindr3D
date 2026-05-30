import { useEffect, useRef, useState } from 'react';
import { useCADStore } from '../../store/cadStore';
import { usePrinterStore } from '../../store/printerStore';
import type { TabKey } from '../printer/duetPrinterPanel/config';
import { pathForWorkspace, routeFromPath } from './appRouting';

export function useWorkspaceRouting() {
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

  return isHomeRoute;
}
