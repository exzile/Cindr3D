import './ComponentTree.css';
import { Plus } from 'lucide-react';
import { useComponentStore } from '../../store/componentStore';
import { ComponentNode } from './componentTree/ComponentNode';

export default function ComponentTree() {
  const rootComponentId = useComponentStore((s) => s.rootComponentId);
  const addComponent = useComponentStore((s) => s.addComponent);

  return (
    <div className="component-tree-panel">
      <div className="tree-panel-header">
        <h3>BROWSER</h3>
        <button
          className="icon-btn"
          title="New Component"
          onClick={() => addComponent(rootComponentId)}
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="tree-scroll">
        <ComponentNode componentId={rootComponentId} />
      </div>
    </div>
  );
}
