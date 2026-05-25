import { useState, useCallback } from 'react';
import { Play, Pause, Square, RotateCcw, Plus, X, Film } from 'lucide-react';
import { DialogShell } from '../common/DialogShell';
import { useComponentStore } from '../../../store/componentStore';
import type { JointTrack, Joint } from '../../../types/cad';
import './MotionStudyDialog.css';

const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4] as const;
type PlaybackSpeed = (typeof SPEED_OPTIONS)[number];

function getJointUnit(joint: Joint): string {
  return joint.type === 'slider' || joint.type === 'pin-slot' ? 'mm' : '°';
}

function TrackTimeline({
  tracks,
  joints,
  animationTime,
  animationDuration,
  onScrub,
}: {
  tracks: JointTrack[];
  joints: Record<string, Joint>;
  animationTime: number;
  animationDuration: number;
  onScrub: (t: number) => void;
}) {
  const pct = animationDuration > 0 ? (animationTime / animationDuration) * 100 : 0;

  return (
    <div className="ms-timeline">
      {/* Time ruler */}
      <div className="ms-timeline__ruler">
        <span>0s</span>
        <span>{(animationDuration / 2).toFixed(1)}s</span>
        <span>{animationDuration.toFixed(1)}s</span>
      </div>

      {/* Track rows */}
      <div className="ms-timeline__tracks">
        {tracks.map((track) => {
          const joint = joints[track.jointId];
          if (!joint) return null;
          return (
            <div key={track.jointId} className="ms-timeline__track-row">
              <span className="ms-timeline__track-label" title={joint.name}>
                {joint.name}
              </span>
              <div className="ms-timeline__bar-wrap">
                <div
                  className="ms-timeline__bar"
                  style={{ '--track-ease': track.easing } as React.CSSProperties}
                />
              </div>
            </div>
          );
        })}

        {tracks.length === 0 && (
          <div className="ms-timeline__empty">No tracks — add a joint below.</div>
        )}
      </div>

      {/* Playhead overlay (range input) */}
      <div className="ms-timeline__scrubber-wrap">
        <div className="ms-timeline__playhead" style={{ left: `${pct}%` }} />
        <input
          type="range"
          className="ms-timeline__scrubber"
          min={0}
          max={animationDuration}
          step={0.01}
          value={animationTime}
          onChange={(e) => onScrub(parseFloat(e.target.value))}
          aria-label="Motion study playhead"
        />
      </div>
    </div>
  );
}

export function MotionStudyDialog({ onClose }: { onClose: () => void }) {
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

  const [speed, setSpeed] = useState<PlaybackSpeed>(1);

  const allJoints = Object.values(joints);
  const trackedIds = new Set(animationTracks.map((t) => t.jointId));
  const untrackedJoints = allJoints.filter((j) => !trackedIds.has(j.id));
  const [addJointId, setAddJointId] = useState<string>(untrackedJoints[0]?.id ?? '');

  const handleScrub = useCallback(
    (t: number) => {
      setAnimationPlaying(false);
      setAnimationTime(t);
    },
    [setAnimationPlaying, setAnimationTime],
  );

  const handleStop = useCallback(() => {
    setAnimationPlaying(false);
    setAnimationTime(0);
  }, [setAnimationPlaying, setAnimationTime]);

  const handleAddTrack = useCallback(() => {
    if (!addJointId) return;
    const joint = joints[addJointId];
    if (!joint) return;
    setJointTrack(addJointId, {
      startValue: 0,
      endValue: joint.type === 'slider' || joint.type === 'cylindrical' ? 10 : 90,
      easing: 'linear',
    });
    const remaining = allJoints.filter(
      (j) => j.id !== addJointId && !animationTracks.find((t) => t.jointId === j.id),
    );
    setAddJointId(remaining[0]?.id ?? '');
  }, [addJointId, joints, setJointTrack, allJoints, animationTracks]);

  const handleTrackChange = useCallback(
    (track: JointTrack, field: keyof Omit<JointTrack, 'jointId'>, value: string | number) => {
      setJointTrack(track.jointId, {
        startValue: field === 'startValue' ? Number(value) : track.startValue,
        endValue: field === 'endValue' ? Number(value) : track.endValue,
        easing: field === 'easing' ? (value as JointTrack['easing']) : track.easing,
      });
    },
    [setJointTrack],
  );

  const timeStr = animationTime.toFixed(2);
  const durStr = animationDuration.toFixed(1);

  return (
    <DialogShell title="Motion Study" onClose={onClose} cancelLabel="Close">
      {/* Transport bar */}
      <div className="dialog-field ms-transport">
        <button
          className="btn btn-secondary ms-transport__btn"
          onClick={() => setAnimationPlaying(true)}
          disabled={animationPlaying}
          title="Play"
          aria-label="Play motion study"
        >
          <Play size={13} />
        </button>
        <button
          className="btn btn-secondary ms-transport__btn"
          onClick={() => setAnimationPlaying(false)}
          disabled={!animationPlaying}
          title="Pause"
          aria-label="Pause motion study"
        >
          <Pause size={13} />
        </button>
        <button
          className="btn btn-secondary ms-transport__btn"
          onClick={handleStop}
          title="Stop"
          aria-label="Stop motion study"
        >
          <Square size={13} />
        </button>
        <button
          className={`btn btn-secondary ms-transport__btn ms-loop-btn${animationLoop ? ' ms-loop-btn--on' : ''}`}
          onClick={() => setAnimationLoop(!animationLoop)}
          title="Toggle loop"
          aria-label={`${animationLoop ? 'Disable' : 'Enable'} loop`}
        >
          <RotateCcw size={13} />
        </button>

        <span className="ms-transport__time">
          {timeStr} / {durStr}s
        </span>

        {/* Speed selector */}
        <label className="dialog-label ms-transport__speed-label">Speed</label>
        <select
          className="dialog-input ms-transport__speed"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value) as PlaybackSpeed)}
          aria-label="Playback speed"
        >
          {SPEED_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>

        {/* Export stub */}
        <button
          className="btn btn-secondary ms-transport__btn ms-export-btn"
          title="Export video (coming soon)"
          aria-label="Export motion study video"
          onClick={() => {/* stub — video export TBD */}}
        >
          <Film size={13} />
          <span className="ms-export-label">Export</span>
        </button>
      </div>

      {/* Timeline */}
      <TrackTimeline
        tracks={animationTracks}
        joints={joints}
        animationTime={animationTime}
        animationDuration={animationDuration}
        onScrub={handleScrub}
      />

      {/* Track editor */}
      {animationTracks.length > 0 && (
        <div className="ms-tracks">
          <div className="dialog-label ms-tracks__heading">Tracks</div>
          {animationTracks.map((track) => {
            const joint = joints[track.jointId];
            if (!joint) return null;
            const unit = getJointUnit(joint);
            return (
              <div key={track.jointId} className="ms-track-row">
                <span className="ms-track-row__name" title={joint.name}>
                  {joint.name}
                </span>
                <div className="ms-track-row__col">
                  <span className="ms-track-row__col-label">Start ({unit})</span>
                  <input
                    className="dialog-input ms-track-row__input"
                    type="number"
                    value={track.startValue}
                    onChange={(e) => handleTrackChange(track, 'startValue', e.target.value)}
                  />
                </div>
                <div className="ms-track-row__col">
                  <span className="ms-track-row__col-label">End ({unit})</span>
                  <input
                    className="dialog-input ms-track-row__input"
                    type="number"
                    value={track.endValue}
                    onChange={(e) => handleTrackChange(track, 'endValue', e.target.value)}
                  />
                </div>
                <div className="ms-track-row__col">
                  <span className="ms-track-row__col-label">Easing</span>
                  <select
                    className="dialog-input ms-track-row__input"
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
                  className="btn btn-secondary ms-transport__btn"
                  title={`Remove ${joint.name} track`}
                  aria-label={`Remove ${joint.name} animation track`}
                  onClick={() => removeJointTrack(track.jointId)}
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add track */}
      {untrackedJoints.length > 0 && (
        <div className="dialog-field ms-add-row">
          <Plus size={13} className="ms-add-row__icon" />
          <select
            className="dialog-input ms-add-row__select"
            value={addJointId}
            onChange={(e) => setAddJointId(e.target.value)}
            aria-label="Joint to add"
          >
            {untrackedJoints.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name} ({j.type})
              </option>
            ))}
          </select>
          <button
            className="btn btn-primary ms-add-row__btn"
            onClick={handleAddTrack}
            disabled={!addJointId}
          >
            Add Track
          </button>
        </div>
      )}

      {allJoints.length === 0 && (
        <div className="ms-empty">No joints in the assembly. Add joints first.</div>
      )}

      {/* Duration */}
      <div className="dialog-field ms-duration-row">
        <label className="dialog-label ms-duration-row__label">Duration (s)</label>
        <input
          className="dialog-input ms-duration-row__input"
          type="number"
          min={0.1}
          step={0.5}
          value={animationDuration}
          onChange={(e) =>
            setAnimationDuration(Math.max(0.1, parseFloat(e.target.value) || 5))
          }
          aria-label="Motion study duration in seconds"
        />
      </div>
    </DialogShell>
  );
}
