import { TABS, type TabKey } from '../printer/duetPrinterPanel/config';

export type WorkspaceMode = 'design' | 'prepare' | 'printer';

const PRINTER_TABS = new Set<string>(['printers', ...TABS.map((tab) => tab.key)]);

export function routeFromPath(pathname: string): {
  workspaceMode?: WorkspaceMode;
  printerTab?: TabKey;
  isHome: boolean;
} {
  if (pathname === '/home' || pathname.startsWith('/home/')) return { isHome: true };
  if (pathname === '/prepare' || pathname === '/prepare/') {
    return { workspaceMode: 'prepare', isHome: false };
  }
  if (pathname === '/') return { isHome: true };
  if (pathname === '/design' || pathname === '/design/') {
    return { workspaceMode: 'design', isHome: false };
  }
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

export function pathForWorkspace(workspaceMode: WorkspaceMode, printerTab: TabKey) {
  if (workspaceMode === 'prepare') return '/prepare';
  if (workspaceMode === 'printer') return `/printer/${printerTab}`;
  return '/design';
}
