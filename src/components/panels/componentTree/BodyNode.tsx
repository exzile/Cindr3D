import { useState } from 'react';
import { Box, Eye, EyeOff } from 'lucide-react';
import { useComponentStore } from '../../../store/componentStore';
import { BodyContextMenu } from './BodyContextMenu';
import type { BodyCtxMenu } from './BodyContextMenu';
import { MaterialPicker } from './MaterialPicker';

export function BodyNode({ bodyId, inheritedVisible = true }: { bodyId: string; inheritedVisible?: boolean }) {
  const body = useComponentStore((s) => s.bodies[bodyId]);
  const toggleVisibility = useComponentStore((s) => s.toggleBodyVisibility);
  const selectedBodyId = useComponentStore((s) => s.selectedBodyId);
  const setSelectedBodyId = useComponentStore((s) => s.setSelectedBodyId);
  const [showMaterial, setShowMaterial] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<BodyCtxMenu | null>(null);

  if (!body) return null;
  const effectiveVisible = inheritedVisible && body.visible !== false;

  return (
    <div className="tree-leaf">
      <div
        className={`browser-row browser-row-child body-item ${selectedBodyId === bodyId ? 'selected' : ''}`}
        onClick={() => setSelectedBodyId(selectedBodyId === bodyId ? null : bodyId)}
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
        <span className="browser-item-label" style={{ opacity: effectiveVisible ? 1 : 0.5 }}>{body.name}</span>
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
          bodyName={body.name}
          onClose={() => setCtxMenu(null)}
          onOpenMaterial={() => setShowMaterial(true)}
        />
      )}
    </div>
  );
}
