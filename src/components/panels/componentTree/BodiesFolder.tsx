import { useState } from 'react';
import { ChevronRight, ChevronDown, Eye, EyeOff, FolderOpen } from 'lucide-react';
import { useComponentStore } from '../../../store/componentStore';
import { BodyNode } from './BodyNode';

/**
 * Collapsible "Bodies" folder in the component tree — mirrors SketchesFolder.
 * Renders all bodies from all components in a single folder at the tree root.
 */
export function BodiesFolder({ componentId }: { componentId?: string }) {
  const bodies = useComponentStore((s) => s.bodies);
  const toggleVis = useComponentStore((s) => s.toggleBodyVisibility);
  const [expanded, setExpanded] = useState(true);

  const bodyIds = Object.keys(bodies).filter((id) => !componentId || bodies[id]?.componentId === componentId);
  if (bodyIds.length === 0) return null;

  const allVisible = bodyIds.every((id) => bodies[id]?.visible !== false);

  const handleToggleAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Toggle all bodies to the opposite of current "allVisible" state
    for (const id of bodyIds) {
      const body = bodies[id];
      if (body && body.visible === allVisible) {
        toggleVis(id);
      }
    }
  };

  return (
    <div className="sketches-tree-node">
      {/* Folder header */}
      <div className="browser-row" onClick={() => setExpanded(!expanded)}>
        <button
          className="browser-vis-btn"
          onClick={handleToggleAll}
          title={allVisible ? 'Hide Bodies' : 'Show Bodies'}
        >
          {allVisible ? <Eye size={11} /> : <EyeOff size={11} />}
        </button>
        <span className="browser-chevron">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span className="browser-item-icon origin-axis-icon">
          <FolderOpen size={13} />
        </span>
        <span className="browser-item-label">Bodies</span>
      </div>

      {/* Body rows */}
      {expanded && bodyIds.map((id) => (
        <BodyNode key={id} bodyId={id} />
      ))}
    </div>
  );
}
