import { useState } from 'react';
import * as React from 'react';
import './SlicerWorkspace.css';
import { SlicerWorkspaceBottomBar } from './workspace/bottom/SlicerWorkspaceBottomBar';
import { SlicerWorkspaceViewport } from './workspace/canvas/SlicerWorkspaceViewport';
import { SlicerProfileEditorModal } from './workspace/modals/SlicerProfileEditorModal';
import { SlicerWorkspaceTopNav, type SlicerPage } from './workspace/nav/SlicerWorkspaceTopNav';
import { SlicerWorkspaceObjectsPanel } from './workspace/panels/SlicerWorkspaceObjectsPanel';
import { SlicerWorkspaceSettingsPanel } from './workspace/panels/SlicerWorkspaceSettingsPanel';
import { SlicerWorkspacePluginsPage } from './workspace/plugins/SlicerWorkspacePluginsPage';


// =============================================================================
// Main Export: SlicerWorkspace
// ============================================================================= 
export default function SlicerWorkspace() {
  const [editingProfile, setEditingProfile] = useState<'printer' | 'material' | 'print' | null>(null);
  const [currentPage, setCurrentPage] = useState<SlicerPage>('prepare');

  return (
    <React.Fragment>
      <div className="slicer-workspace">
        {/* Workspace navigation tabs */}
        <SlicerWorkspaceTopNav currentPage={currentPage} onChangePage={setCurrentPage} />

        {/* Plugins page */}
        {currentPage === 'plugins' && <SlicerWorkspacePluginsPage />}

        {/* Prepare page: left panel + 3D view + right panel (hidden when plugins active) */}
        <div className={`slicer-workspace__prepare ${currentPage === 'prepare' ? '' : 'is-hidden'}`}>
          {/* Left Panel - Objects */}
          <SlicerWorkspaceObjectsPanel />

          {/* Center - 3D Canvas */}
          <SlicerWorkspaceViewport />

          {/* Right Panel - Settings */}
          <SlicerWorkspaceSettingsPanel onEditProfile={(type) => setEditingProfile(type)} />
        </div>

        {/* Bottom Bar — only shown on Prepare page */}
        {currentPage === 'prepare' && <SlicerWorkspaceBottomBar />}

        {/* Profile Editor Modal */}
        {editingProfile && (
          <SlicerProfileEditorModal type={editingProfile} onClose={() => setEditingProfile(null)} />
        )}
      </div>
    </React.Fragment>
  );
}
