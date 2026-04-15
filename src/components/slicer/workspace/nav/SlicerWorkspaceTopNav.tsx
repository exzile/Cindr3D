import * as React from 'react';
import { Layers, Puzzle } from 'lucide-react';

export type SlicerPage = 'prepare' | 'plugins';

export function SlicerWorkspaceTopNav({
  currentPage,
  onChangePage,
}: {
  currentPage: SlicerPage;
  onChangePage: (page: SlicerPage) => void;
}) {
  return (
    <div className="slicer-workspace-nav">
      <button
        className={`slicer-workspace-nav__tab ${currentPage === 'prepare' ? 'is-active' : ''}`}
        onClick={() => onChangePage('prepare')}
      >
        <Layers size={13} />
        Prepare
      </button>
      <button
        className={`slicer-workspace-nav__tab ${currentPage === 'plugins' ? 'is-active' : ''}`}
        onClick={() => onChangePage('plugins')}
      >
        <Puzzle size={13} />
        Plugins
      </button>
    </div>
  );
}
