import { useState } from 'react';
import { useComponentStore } from '../../../store/componentStore';
import { DialogShell } from '../common/DialogShell';
import { useCADStore } from '../../../store/cadStore';
import * as THREE from 'three';
import type { JointType } from '../../../types/cad';

interface Props {
  onClose: () => void;
}

const JOINT_TYPES: { value: JointType; label: string }[] = [
  { value: 'rigid',       label: 'Rigid' },
  { value: 'revolute',    label: 'Revolute' },
  { value: 'slider',      label: 'Slider' },
  { value: 'cylindrical', label: 'Cylindrical' },
  { value: 'pin-slot',    label: 'Pin-Slot' },
  { value: 'planar',      label: 'Planar' },
  { value: 'ball',        label: 'Ball' },
];

export default function AsBuiltJointDialog({ onClose }: Props) {
  const addJoint          = useComponentStore((s) => s.addJoint);
  const joints            = useComponentStore((s) => s.joints);
  const components        = useComponentStore((s) => s.components);
  const activeComponentId = useComponentStore((s) => s.activeComponentId);
  const rootComponentId   = useComponentStore((s) => s.rootComponentId);
  const setStatusMessage  = useCADStore((s) => s.setStatusMessage);

  const componentList = Object.values(components);

  const defaultCompId = activeComponentId ?? rootComponentId;
  const [componentId1, setComponentId1] = useState(defaultCompId);
  const [componentId2, setComponentId2] = useState(defaultCompId);
  const [jointType, setJointType]       = useState<JointType>('rigid');

  function handleOK() {
    const n    = Object.values(joints).filter((j) => j.asBuilt).length + 1;
    const name = `As-Built Joint ${n}`;
    addJoint({
      name,
      type:       jointType,
      componentId1,
      componentId2,
      origin:     new THREE.Vector3(0, 0, 0),
      axis:       new THREE.Vector3(0, 1, 0),
      rotationValue:    0,
      translationValue: 0,
      locked:     false,
      asBuilt:    true,
    });
    setStatusMessage(`Created as-built ${jointType} joint: ${name}`);
    onClose();
  }

  return (
    <DialogShell title="As-Built Joint" onClose={onClose} onConfirm={handleOK}>
          <div className="form-group">
            <label>Component 1</label>
            <select value={componentId1} onChange={(e) => setComponentId1(e.target.value)}>
              {componentList.length === 0
                ? <option value="">— no components —</option>
                : componentList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)
              }
            </select>
          </div>

          <div className="form-group">
            <label>Component 2</label>
            <select value={componentId2} onChange={(e) => setComponentId2(e.target.value)}>
              {componentList.length === 0
                ? <option value="">— no components —</option>
                : componentList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)
              }
            </select>
          </div>

          <div className="form-group">
            <label>Joint Type</label>
            <select
              value={jointType}
              onChange={(e) => setJointType(e.target.value as JointType)}
            >
              {JOINT_TYPES.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <p className="form-note">Locks current positions of selected components.</p>
    </DialogShell>
  );
}
