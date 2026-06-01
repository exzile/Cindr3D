import { useState } from 'react';
import { Box, Eye, EyeOff } from 'lucide-react';
import { useComponentStore } from '../../../store/componentStore';
import { BodyContextMenu } from './BodyContextMenu';
import type { BodyCtxMenu } from './BodyContextMenu';
import { MaterialPicker } from './MaterialPicker';

export function BodyNode({
  bodyId,
  inheritedVisible = true,
  displayName,
}: {
  bodyId: string;
  inheritedVisible?: boolean;
  displayName?: string;
}) {
  const body = useComponentStore((s) => s.bodies[bodyId]);
  const renameBody = useComponentStore((s) => s.renameBody);
  const toggleVisibility = useComponentStore((s) => s.toggleBodyVisibility);
  const selectedBodyId = useComponentStore((s) => s.selectedBodyId);
  const setSelectedBodyId = useComponentStore((s) => s.setSelectedBodyId);
  const [showMaterial, setShowMaterial] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<BodyCtxMenu | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  if (!body) return null;
  const effectiveVisible = inheritedVisible && body.visible !== false;
  const bodyLabel = displayName ?? body.name;

  const startRename = () => {
    setRenameDraft(bodyLabel);
    setRenaming(true);
  };

  const commitRename = () => {
    if (renameDraft.trim()) renameBody(bodyId, renameDraft.trim());
    setRenaming(false);
  };

  return (
    <div className="tree-leaf">
      <div
        className={`browser-row browser-row-child body-item ${selectedBodyId === bodyId ? 'selected' : ''}`}
        onClick={() => setSelectedBodyId(selectedBodyId === bodyId ? null : bodyId)}
        onDoubleClick={() => startRename()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setSelectedBodyId(bodyId);
          setCtxMenu({ bodyId, x: e.clientX, y: e.clientY });
        }}
      >
        <button
          className="browser-vis-btn"
          title={!inheritedVisible ? 'Hidden by Component' : body.visible ? 'Hide Body' : 'Show Body'}
          onClick={(e) => {
            e.stopPropagation();
            if (inheritedVisible) toggleVisibility(bodyId);
          }}
        >
          {effectiveVisible ? <Eye size={11} /> : <EyeOff size={11} />}
        </button>
        <span className="browser-chevron" />
        <span className="browser-item-icon body-icon" style={{ opacity: effectiveVisible ? 1 : 0.5 }}>
          <Box size={12} />
        </span>
        {renaming ? (
          <input
            className="tree-rename-input"
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="browser-item-label" style={{ opacity: effectiveVisible ? 1 : 0.5 }}>{bodyLabel}</span>
        )}
        <span className="browser-kind-badge">Body</span>
        {/* background is dynamic (per-body material color) — must stay inline */}
        <div
          className="body-color-dot"
          style={{ background: body.material.color }}
          title={body.material.name}
          onClick={(e) => { e.stopPropagation(); setShowMaterial(!showMaterial); }}
        />
      </div>
      {showMaterial && (
        <MaterialPicker bodyId={bodyId} onClose={() => setShowMaterial(false)} />
      )}
      {ctxMenu && (
        <BodyContextMenu
          menu={ctxMenu}
          bodyName={bodyLabel}
          onClose={() => setCtxMenu(null)}
          onOpenMaterial={() => setShowMaterial(true)}
          onStartRename={() => { setCtxMenu(null); startRename(); }}
        />
      )}
    </div>
  );
}
