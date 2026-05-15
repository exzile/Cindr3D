/**
 * OverConstraintDialog — Fusion-360-style over-constraint prompt.
 *
 * Surfaces when a non-driven sketch dimension would over-constrain the sketch
 * (intercepted by `commitDimension` on the add path and `commitSketchDimEdit`
 * on the edit path, BEFORE any geometry mutation). Offers the Fusion choice:
 * convert it to a driven (reference) dimension, or cancel.
 *
 * Composes the shared `ui/Modal` (portal + overlay + chrome + Escape via
 * `useModalKeys`). Escape = Cancel (the modal's onClose). Reads/clears the
 * transient `pendingOverConstraint` store state.
 */
import { TriangleAlert } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../../ui/Modal';
import { useCADStore } from '../../../store/cadStore';

export default function OverConstraintDialog() {
  const pending = useCADStore((s) => s.pendingOverConstraint);
  const resolveAsDriven = useCADStore((s) => s.resolveOverConstraintAsDriven);
  const cancel = useCADStore((s) => s.cancelOverConstraint);

  if (!pending) return null;

  const { dimension, mode } = pending;
  const valueLabel = `${dimension.value.toFixed(2)}`;
  const typeLabel = dimension.type.charAt(0).toUpperCase() + dimension.type.slice(1);

  return (
    <Modal
      onClose={cancel}
      title="Over-constrained sketch"
      titleIcon={<TriangleAlert size={15} className="bc-modal-warn-icon" />}
      ariaLabelledBy="over-constraint-title"
      size="md"
    >
      <ModalBody>
        <p className="bc-modal-desc">
          This dimension would over-constrain the sketch. Create a driven
          (reference) dimension instead?
        </p>
        <div className="bc-modal-steps">
          <div className="bc-modal-step">
            <span className="bc-modal-step-label">{typeLabel} dimension</span>
            <span className="bc-modal-step-cmd">{valueLabel}</span>
          </div>
        </div>
        <p className="bc-modal-auto-hint">
          {mode === 'edit'
            ? 'A driven dimension keeps the new value as a reference only — geometry is not resized and the solver is not run.'
            : 'A driven dimension is a reference annotation only — it does not drive geometry or feed the solver.'}
        </p>
      </ModalBody>
      <ModalFooter>
        <button className="bc-modal-btn bc-modal-btn--cancel" onClick={cancel}>
          Cancel
        </button>
        <button
          className="bc-modal-btn bc-modal-btn--confirm"
          onClick={resolveAsDriven}
          autoFocus
        >
          Create driven dimension
        </button>
      </ModalFooter>
    </Modal>
  );
}
