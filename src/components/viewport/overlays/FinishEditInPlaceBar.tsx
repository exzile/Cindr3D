import { useEffect } from 'react';
import { useComponentStore } from '../../../store/componentStore';

const editingInPlaceClass = 'cad-editing-in-place';

export default function FinishEditInPlaceBar() {
  const activeComponentId = useComponentStore((s) => s.activeComponentId);
  const setActiveComponentId = useComponentStore((s) => s.setActiveComponentId);
  const rootComponentId = useComponentStore((s) => s.rootComponentId);
  const components = useComponentStore((s) => s.components);

  const comp = activeComponentId ? components[activeComponentId] : undefined;
  const isStale = !!activeComponentId && activeComponentId !== rootComponentId && !comp;

  // Stale persisted ID — component was deleted; reset silently
  useEffect(() => {
    if (isStale) setActiveComponentId(null);
  }, [isStale, setActiveComponentId]);

  useEffect(() => {
    const active = !!activeComponentId && activeComponentId !== rootComponentId && !!comp;
    document.documentElement.classList.toggle(editingInPlaceClass, active);
    return () => {
      document.documentElement.classList.remove(editingInPlaceClass);
    };
  }, [activeComponentId, comp, rootComponentId]);

  if (!activeComponentId || activeComponentId === rootComponentId || !comp) return null;

  return (
    <div className="finish-edit-in-place-bar">
      <span className="finish-edit-in-place-title">Editing in context: <strong>{comp?.name || 'Untitled Component'}</strong></span>
      <button
        onClick={() => setActiveComponentId(null)}
        className="finish-edit-in-place-button"
      >
        ✓ Finish Edit In Place
      </button>
    </div>
  );
}
