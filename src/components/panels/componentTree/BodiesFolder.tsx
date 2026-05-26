import { useState } from 'react';
import { ChevronRight, ChevronDown, Eye, EyeOff, FolderOpen } from 'lucide-react';
import { useComponentStore } from '../../../store/componentStore';
import { BodyNode } from './BodyNode';

const EMPTY_IDS: string[] = [];

/**
 * Collapsible "Bodies" folder in the component tree — mirrors SketchesFolder.
 * Renders all bodies from all components in a single folder at the tree root.
 */
export function BodiesFolder({ componentId }: { componentId?: string }) {
  const bodies = useComponentStore((s) => s.bodies);
  const components = useComponentStore((s) => s.components);
  const componentBodyIds = useComponentStore((s) => (
    componentId ? (s.components[componentId]?.bodyIds ?? EMPTY_IDS) : EMPTY_IDS
  ));
  const activeComponentId = useComponentStore((s) => s.activeComponentId);
  const toggleVis = useComponentStore((s) => s.toggleBodyVisibility);
  const [expanded, setExpanded] = useState(true);

  const bodyIds = Object.keys(bodies).filter((id) => (
    !componentId ||
    bodies[id]?.componentId === componentId ||
    componentBodyIds.includes(id) ||
    (componentId === activeComponentId && (
      !bodies[id]?.componentId || !components[bodies[id]?.componentId]
    ))
  ));
  if (bodyIds.length === 0) return null;

  const allVisible = bodyIds.every((id) => bodies[id]?.visible !== false);

  const getBodyDisplayName = (id: string, index: number) => {
    const body = bodies[id];
    if (!body) return '';
    const hasDuplicateName = bodyIds.some((otherId) => otherId !== id && bodies[otherId]?.name === body.name);
    if (!hasDuplicateName) return body.name;

    const generatedName = /^(Body|Surface)\s+\d+$/.exec(body.name);
    if (generatedName) return `${generatedName[1]} ${index + 1}`;
    return `${body.name} (${index + 1})`;
  };

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
      {expanded && bodyIds.map((id, index) => (
        <BodyNode key={id} bodyId={id} displayName={getBodyDisplayName(id, index)} />
      ))}
    </div>
  );
}
