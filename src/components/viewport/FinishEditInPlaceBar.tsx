import { useEffect } from 'react';
import { useComponentStore } from '../../store/componentStore';

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

  if (!activeComponentId || activeComponentId === rootComponentId || !comp) return null;

  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100,
      background: '#b45309', color: '#fff', padding: '6px 16px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontSize: 13, fontWeight: 500,
    }}>
      <span>Editing in context: <strong>{comp?.name || 'Untitled Component'}</strong></span>
      <button
        onClick={() => setActiveComponentId(null)}
        style={{ background: '#92400e', border: 'none', color: '#fff', borderRadius: 4, padding: '3px 10px', cursor: 'pointer' }}
      >
        ✓ Finish Edit In Place
      </button>
    </div>
  );
}
