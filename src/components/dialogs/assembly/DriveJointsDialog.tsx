import { useState } from 'react';
import { X, Play, Pause, Square, RotateCcw } from 'lucide-react';
import { useComponentStore } from '../../../store/componentStore';
import type { JointTrack, Joint } from '../../../types/cad';
import './DriveJointsDialog.css';

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
      <div className="dialog-panel">
        <div className="dialog-header">
          <span className="dialog-title">Drive Joints</span>
          <button className="dialog-close" onClick={onClose} aria-label="Close drive joints dialog"><X size={14} /></button>
        </div>

        <div className="dialog-body">
          {/* Transport bar */}
          <div className="dialog-field drive-joints-transport">
            <button
              className="btn btn-secondary drive-joints-btn"
              onClick={handlePlay}
              disabled={animationPlaying}
              title="Play"
              aria-label="Play joint animation"
            >
              <Play size={14} />
            </button>
            <button
              className="btn btn-secondary drive-joints-btn"
              onClick={handlePause}
              disabled={!animationPlaying}
              title="Pause"
              aria-label="Pause joint animation"
            >
              <Pause size={14} />
            </button>
            <button
              className="btn btn-secondary drive-joints-btn"
              onClick={handleStop}
              title="Stop"
              aria-label="Stop joint animation"
            >
              <Square size={14} />
            </button>
            <button
              className="btn btn-secondary drive-joints-loop-btn"
              onClick={() => setAnimationLoop(!animationLoop)}
              title="Toggle loop"
              aria-label={`${animationLoop ? 'Disable' : 'Enable'} joint animation loop`}
            >
              <RotateCcw size={14} />
              <span className="drive-joints-loop-label">Loop</span>
              {animationLoop && (
                <span className="drive-joints-loop-on"> ON</span>
              )}
            </button>
            <span className="drive-joints-time">
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
              className="drive-joints-scrubber"
              onChange={(e) => handleScrub(parseFloat(e.target.value))}
              aria-label="Joint animation time"
            />
          </div>

          {/* Joint tracks */}
          {animationTracks.length > 0 && (
            <div className="drive-joints-tracks">
              <div className="dialog-label drive-joints-tracks__heading">Tracks</div>
              {animationTracks.map((track) => {
                const joint = joints[track.jointId];
                if (!joint) return null;
                const unit = getJointLabel(joint);
                return (
                  <div
                    key={track.jointId}
                    className="drive-joints-track-row"
                  >
                    <span className="drive-joints-track-name">
                      {joint.name}
                    </span>
                    <div className="drive-joints-track-col">
                      <span className="drive-joints-track-col__label">Start ({unit})</span>
                      <input
                        className="dialog-input drive-joints-track-input"
                        type="number"
                        value={track.startValue}
                        onChange={(e) => handleTrackChange(track, 'startValue', e.target.value)}
                      />
                    </div>
                    <div className="drive-joints-track-col">
                      <span className="drive-joints-track-col__label">End ({unit})</span>
                      <input
                        className="dialog-input drive-joints-track-input"
                        type="number"
                        value={track.endValue}
                        onChange={(e) => handleTrackChange(track, 'endValue', e.target.value)}
                      />
                    </div>
                    <div className="drive-joints-track-col">
                      <span className="drive-joints-track-col__label">Easing</span>
                      <select
                        className="dialog-input drive-joints-track-input"
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
                      className="btn btn-secondary drive-joints-btn"
                      title="Remove track"
                      aria-label={`Remove ${joint.name} animation track`}
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
            <div className="dialog-field drive-joints-add-row">
              <label className="dialog-label drive-joints-add-label">Add Track</label>
              <select
                className="dialog-input drive-joints-add-select"
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
            <div className="drive-joints-empty">
              No joints in the assembly. Add joints first.
            </div>
          )}

          {/* Duration */}
          <div className="dialog-field drive-joints-duration-row">
            <label className="dialog-label drive-joints-duration-label">Duration (s)</label>
            <input
              className="dialog-input drive-joints-duration-input"
              type="number"
              min={0.1}
              step={0.5}
              value={animationDuration}
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
