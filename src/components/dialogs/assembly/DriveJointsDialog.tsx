import { useState } from 'react';
import { X, Play, Pause, Square, RotateCcw } from 'lucide-react';
import { useComponentStore } from '../../../store/componentStore';
import type { JointTrack, Joint } from '../../../types/cad';

export function DriveJointsDialog({ onClose }: { onClose: () => void }) {
  const joints = useComponentStore((s) => s.joints);
  const animationTime = useComponentStore((s) => s.animationTime);
  const animationDuration = useComponentStore((s) => s.animationDuration);
  const animationPlaying = useComponentStore((s) => s.animationPlaying);
  const animationLoop = useComponentStore((s) => s.animationLoop);
  const animationTracks = useComponentStore((s) => s.animationTracks);

  const setAnimationPlaying = useComponentStore((s) => s.setAnimationPlaying);
  const setAnimationDuration = useComponentStore((s) => s.setAnimationDuration);
  const setAnimationLoop = useComponentStore((s) => s.setAnimationLoop);
  const setAnimationTime = useComponentStore((s) => s.setAnimationTime);
  const setJointTrack = useComponentStore((s) => s.setJointTrack);
  const removeJointTrack = useComponentStore((s) => s.removeJointTrack);

  const allJoints = Object.values(joints);
  const trackedIds = new Set(animationTracks.map((t) => t.jointId));
  const untrackedJoints = allJoints.filter((j) => !trackedIds.has(j.id));

  const [addJointId, setAddJointId] = useState<string>(untrackedJoints[0]?.id ?? '');

  const handlePlay = () => setAnimationPlaying(true);
  const handlePause = () => setAnimationPlaying(false);
  const handleStop = () => {
    setAnimationPlaying(false);
    setAnimationTime(0);
  };
  const handleScrub = (t: number) => {
    setAnimationPlaying(false);
    setAnimationTime(t);
  };

  const handleAddTrack = () => {
    if (!addJointId) return;
    const joint = joints[addJointId];
    if (!joint) return;
    setJointTrack(addJointId, {
      startValue: 0,
      endValue: joint.type === 'slider' || joint.type === 'cylindrical' ? 10 : 90,
      easing: 'linear',
    });
    // Pick next untracked joint
    const remaining = allJoints.filter(
      (j) => j.id !== addJointId && !animationTracks.find((t) => t.jointId === j.id),
    );
    setAddJointId(remaining[0]?.id ?? '');
  };

  const handleTrackChange = (
    track: JointTrack,
    field: keyof Omit<JointTrack, 'jointId'>,
    value: string | number,
  ) => {
    setJointTrack(track.jointId, {
      startValue: field === 'startValue' ? Number(value) : track.startValue,
      endValue: field === 'endValue' ? Number(value) : track.endValue,
      easing: field === 'easing' ? (value as JointTrack['easing']) : track.easing,
    });
  };

  const getJointLabel = (joint: Joint) =>
    joint.type === 'slider' || joint.type === 'pin-slot' ? 'mm' : '°';

  const timeStr = animationTime.toFixed(1);
  const durStr = animationDuration.toFixed(1);

  return (
    <div className="dialog-overlay">
      <div className="dialog-panel" style={{ minWidth: 460 }}>
        <div className="dialog-header">
          <span className="dialog-title">Drive Joints</span>
          <button className="dialog-close" onClick={onClose}><X size={14} /></button>
        </div>

        <div className="dialog-body">
          {/* Transport bar */}
          <div className="dialog-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <button
              className="btn btn-secondary"
              style={{ padding: '3px 8px' }}
              onClick={handlePlay}
              disabled={animationPlaying}
              title="Play"
            >
              <Play size={14} />
            </button>
            <button
              className="btn btn-secondary"
              style={{ padding: '3px 8px' }}
              onClick={handlePause}
              disabled={!animationPlaying}
              title="Pause"
            >
              <Pause size={14} />
            </button>
            <button
              className="btn btn-secondary"
              style={{ padding: '3px 8px' }}
              onClick={handleStop}
              title="Stop"
            >
              <Square size={14} />
            </button>
            <button
              className="btn btn-secondary"
              style={{ padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
              onClick={() => setAnimationLoop(!animationLoop)}
              title="Toggle loop"
            >
              <RotateCcw size={14} />
              <span style={{ fontSize: 11 }}>Loop</span>
              {animationLoop && (
                <span style={{ fontSize: 11, color: '#4caf50' }}> ON</span>
              )}
            </button>
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-text-secondary, #aaa)' }}>
              {timeStr} / {durStr} s
            </span>
          </div>

          {/* Scrubber */}
          <div className="dialog-field">
            <input
              type="range"
              min={0}
              max={animationDuration}
              step={0.01}
              value={animationTime}
              style={{ width: '100%' }}
              onChange={(e) => handleScrub(parseFloat(e.target.value))}
            />
          </div>

          {/* Joint tracks */}
          {animationTracks.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div className="dialog-label" style={{ marginBottom: 4 }}>Tracks</div>
              {animationTracks.map((track) => {
                const joint = joints[track.jointId];
                if (!joint) return null;
                const unit = getJointLabel(joint);
                return (
                  <div
                    key={track.jointId}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 70px 70px 110px 28px',
                      gap: 4,
                      alignItems: 'center',
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {joint.name}
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ fontSize: 10, color: 'var(--color-text-secondary, #888)' }}>Start ({unit})</span>
                      <input
                        className="dialog-input"
                        type="number"
                        style={{ padding: '2px 4px', fontSize: 12 }}
                        value={track.startValue}
                        onChange={(e) => handleTrackChange(track, 'startValue', e.target.value)}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ fontSize: 10, color: 'var(--color-text-secondary, #888)' }}>End ({unit})</span>
                      <input
                        className="dialog-input"
                        type="number"
                        style={{ padding: '2px 4px', fontSize: 12 }}
                        value={track.endValue}
                        onChange={(e) => handleTrackChange(track, 'endValue', e.target.value)}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ fontSize: 10, color: 'var(--color-text-secondary, #888)' }}>Easing</span>
                      <select
                        className="dialog-input"
                        style={{ padding: '2px 4px', fontSize: 12 }}
                        value={track.easing}
                        onChange={(e) => handleTrackChange(track, 'easing', e.target.value)}
                      >
                        <option value="linear">Linear</option>
                        <option value="ease-in">Ease In</option>
                        <option value="ease-out">Ease Out</option>
                        <option value="ease-in-out">Ease In-Out</option>
                      </select>
                    </div>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '2px 4px' }}
                      title="Remove track"
                      onClick={() => removeJointTrack(track.jointId)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add track */}
          {untrackedJoints.length > 0 && (
            <div className="dialog-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <label className="dialog-label" style={{ whiteSpace: 'nowrap' }}>Add Track</label>
              <select
                className="dialog-input"
                style={{ flex: 1 }}
                value={addJointId}
                onChange={(e) => setAddJointId(e.target.value)}
              >
                {untrackedJoints.map((j) => (
                  <option key={j.id} value={j.id}>{j.name} ({j.type})</option>
                ))}
              </select>
              <button className="btn btn-secondary" onClick={handleAddTrack} disabled={!addJointId}>
                Add
              </button>
            </div>
          )}

          {allJoints.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #888)', padding: '8px 0' }}>
              No joints in the assembly. Add joints first.
            </div>
          )}

          {/* Duration */}
          <div className="dialog-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <label className="dialog-label" style={{ whiteSpace: 'nowrap' }}>Duration (s)</label>
            <input
              className="dialog-input"
              type="number"
              min={0.1}
              step={0.5}
              value={animationDuration}
              style={{ width: 80 }}
              onChange={(e) => setAnimationDuration(Math.max(0.1, parseFloat(e.target.value) || 5))}
            />
          </div>
        </div>

        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
