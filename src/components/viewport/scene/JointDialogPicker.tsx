import { useCADStore } from '../../../store/cadStore';
import { useVertexPicker } from '../../../hooks/useVertexPicker';

export default function JointDialogPicker() {
  const activeDialog = useCADStore((s) => s.activeDialog);
  const jointDialogPickMode = useCADStore((s) => s.jointDialogPickMode);
  const setJointDialogPickedOrigin = useCADStore((s) => s.setJointDialogPickedOrigin);

  useVertexPicker({
    enabled: activeDialog === 'joint' && jointDialogPickMode,
    onClick: (result) => {
      const p = result.position.toArray() as [number, number, number];
      setJointDialogPickedOrigin(p);
    },
  });

  return null;
}
