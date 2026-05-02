import { useEffect, useState } from 'react';
import { ChevronRight, ChevronDown, Eye, EyeOff, FolderOpen } from 'lucide-react';
import { useCADStore } from '../../../store/cadStore';
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
  const activeComponentId = useComponentStore((s) => s.activeComponentId);
  const features = useCADStore((s) => s.features);
  const addBody = useComponentStore((s) => s.addBody);
  const addFeatureToBody = useComponentStore((s) => s.addFeatureToBody);
  const componentBodyIds = useComponentStore((s) => (
    componentId ? (s.components[componentId]?.bodyIds ?? EMPTY_IDS) : EMPTY_IDS
  ));
  const toggleVis = useComponentStore((s) => s.toggleBodyVisibility);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (!componentId || !components[componentId]) return;

    let recoveredCount = 0;
    for (const feature of features) {
      if (feature.type !== 'extrude') continue;
      if ((feature.params?.operation as string | undefined) !== 'new-body') continue;
      if (feature.suppressed || feature.visible === false) continue;

      const featureComponentId = feature.componentId;
      const belongsHere =
        featureComponentId === componentId ||
        (componentId === activeComponentId && (!featureComponentId || !components[featureComponentId]));
      if (!belongsHere) continue;

      const alreadyIndexed = Object.values(bodies).some((body) => body.featureIds.includes(feature.id));
      if (alreadyIndexed) continue;

      const bodyName = feature.bodyKind === 'surface'
        ? `Surface ${Object.keys(bodies).length + recoveredCount + 1}`
        : `Body ${Object.keys(bodies).length + recoveredCount + 1}`;
      const bodyId = addBody(componentId, bodyName);
      if (bodyId) {
        addFeatureToBody(bodyId, feature.id);
        recoveredCount += 1;
      }
    }
  }, [activeComponentId, addBody, addFeatureToBody, bodies, componentId, components, features]);

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
