import { useState } from 'react';
import { useCADStore } from '../../../store/cadStore';
import { DialogShell } from '../common/DialogShell';

export function BaseFeatureDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('Base Feature 1');
  const openBaseFeature = useCADStore((s) => s.openBaseFeature);

  const handleApply = () => {
    openBaseFeature(name);
    onClose();
  };

  return (
    <DialogShell title="Create Base Feature" onClose={onClose} size="sm" onConfirm={handleApply} confirmDisabled={!name.trim()}>
      <div className="form-group">
        <label>Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <p className="dialog-hint">
        A Base Feature is a non-parametric container. Geometry modeled inside it will not trigger timeline recompute and can be freely edited without constraint. Use it to import or model bodies that shouldn&apos;t participate in the parametric history.
      </p>
    </DialogShell>
  );
}
