import { useState } from 'react';
import { X } from 'lucide-react';
import { useComponentStore } from '../../../store/componentStore';
import { useCADStore } from '../../../store/cadStore';

export function MotionLinkDialog({ onClose }: { onClose: () => void }) {
  const addMotionLink    = useComponentStore((s) => s.addMotionLink);
  const motionLinks      = useComponentStore((s) => s.motionLinks);
  const joints           = useComponentStore((s) => s.joints);
  const setStatusMessage = useCADStore((s) => s.setStatusMessage);

  const jointList = Object.values(joints);

  const [sourceJointId, setSourceJointId] = useState(jointList[0]?.id ?? '');
  const [targetJointId, setTargetJointId] = useState(jointList[1]?.id ?? jointList[0]?.id ?? '');
  const [ratio, setRatio]   = useState(1.0);
  const [offset, setOffset] = useState(0);

  const handleOK = () => {
    if (!sourceJointId || !targetJointId) {
      setStatusMessage('Motion Link: select source and target joints');
      return;
    }
    const n = motionLinks.length + 1;
    const name = `Motion Link ${n}`;
    addMotionLink({ name, sourceJointId, targetJointId, ratio, offset });
    setStatusMessage(`Created motion link: ${name}`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog-panel">
        <div className="dialog-header">
          <span className="dialog-title">Motion Link</span>
          <button className="dialog-close" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="dialog-body">
          <div className="dialog-field">
            <label className="dialog-label">Source Joint</label>
            <select
              className="dialog-input"
              value={sourceJointId}
              onChange={(e) => setSourceJointId(e.target.value)}
            >
              {jointList.length === 0
                ? <option value="">— no joints —</option>
                : jointList.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)
              }
            </select>
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Target Joint</label>
            <select
              className="dialog-input"
              value={targetJointId}
              onChange={(e) => setTargetJointId(e.target.value)}
            >
              {jointList.length === 0
                ? <option value="">— no joints —</option>
                : jointList.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)
              }
            </select>
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Ratio</label>
            <input
              className="dialog-input"
              type="number"
              step={0.1}
              value={ratio}
              onChange={(e) => setRatio(parseFloat(e.target.value) || 1.0)}
            />
          </div>
          <div className="dialog-field">
            <label className="dialog-label">Offset</label>
            <input
              className="dialog-input"
              type="number"
              step={0.1}
              value={offset}
              onChange={(e) => setOffset(parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleOK}>OK</button>
        </div>
      </div>
    </div>
  );
}
