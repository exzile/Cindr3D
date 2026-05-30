import { lazy, Suspense } from 'react';
import Timeline from '../panels/Timeline';
import ComponentTree from '../panels/ComponentTree';
import DuetPrinterPanel from '../printer/DuetPrinterPanel';
import Viewport from '../viewport/Viewport';
import { useCADStore } from '../../store/cadStore';

const SlicerWorkspace = lazy(() => import('../slicer/SlicerWorkspace'));

export function WorkspaceContent() {
  const workspaceMode = useCADStore((s) => s.workspaceMode);

  if (workspaceMode === 'prepare') {
    return (
      <Suspense fallback={null}>
        <SlicerWorkspace />
      </Suspense>
    );
  }

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
