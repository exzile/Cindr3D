import { useState, useRef, useEffect, useMemo } from 'react';
import './Timeline.css';
import {
  CheckSquare,
  ChevronRight,
  PauseCircle,
  PlayCircle,
  SkipBack,
} from 'lucide-react';
import { useCADStore } from '../../store/cadStore';
import type { FeatureGroup } from '../../types/cad';
import { FeatureItem } from './timeline/FeatureItem';
import { GroupHeader } from './timeline/GroupHeader';

export default function Timeline() {
  const allFeatures = useCADStore((s) => s.features);
  const historyEnabled = useCADStore((s) => s.historyEnabled);
  const featureGroups = useCADStore((s) => s.featureGroups);
  const rollbackIndex = useCADStore((s) => s.rollbackIndex);
  const setRollbackIndex = useCADStore((s) => s.setRollbackIndex);
  const baseFeatureActive = useCADStore((s) => s.baseFeatureActive);
  const finishBaseFeature = useCADStore((s) => s.finishBaseFeature);
  const reorderFeature = useCADStore((s) => s.reorderFeature);
  const [dragOverEnd, setDragOverEnd] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playIndexRef = useRef(0);

  const stopPlayback = () => {
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    setIsPlaying(false);
  };

  const features = useMemo(
    () => allFeatures.filter((f) => !f.suppressTimeline),
    [allFeatures],
  );

  const startPlayback = () => {
    const currentFeatures = useCADStore.getState().features.filter((f) => !f.suppressTimeline);
    if (currentFeatures.length === 0) return;
    stopPlayback();
    playIndexRef.current = 0;
    setRollbackIndex(0);
    setIsPlaying(true);
    playIntervalRef.current = setInterval(() => {
      const liveFeatures = useCADStore.getState().features.filter((f) => !f.suppressTimeline);
      playIndexRef.current += 1;
      if (playIndexRef.current >= liveFeatures.length) {
        setRollbackIndex(-1);
        stopPlayback();
      } else {
        setRollbackIndex(playIndexRef.current);
      }
    }, 400);
  };

  useEffect(() => () => {
    if (playIntervalRef.current) clearInterval(playIntervalRef.current);
  }, []);

  const handleEndDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData('text/feature-id');
    if (!id) return;
    e.preventDefault();
    reorderFeature(id, features.length);
    setDragOverEnd(false);
  };

  const groupMap = useMemo(
    () => new Map(featureGroups.map((g) => [g.id, g])),
    [featureGroups],
  );

  const renderGroup = (group: FeatureGroup, depth: number, collapsedAncestor: boolean): React.ReactNode[] => {
    const rows: React.ReactNode[] = [];
    if (collapsedAncestor) return rows;

    rows.push(<GroupHeader key={`group-${group.id}`} group={group} depth={depth} />);
    if (group.collapsed) return rows;

    features.forEach((feature, i) => {
      if (feature.groupId === group.id) {
        rows.push(<FeatureItem key={feature.id} feature={feature} index={i} indented />);
      }
    });

    featureGroups
      .filter((g) => g.parentGroupId === group.id)
      .forEach((subGroup) => {
        rows.push(...renderGroup(subGroup, depth + 1, false));
      });

    return rows;
  };

  const renderFeatureList = () => {
    const rows: React.ReactNode[] = [];

    featureGroups
      .filter((g) => !g.parentGroupId || !groupMap.has(g.parentGroupId))
      .forEach((group) => {
        const hasMembers = features.some((f) => f.groupId === group.id)
          || featureGroups.some((g) => g.parentGroupId === group.id);
        if (hasMembers) {
          rows.push(...renderGroup(group, 0, false));
        }
      });

    features.forEach((feature, i) => {
      if (!feature.groupId) {
        rows.push(<FeatureItem key={feature.id} feature={feature} index={i} />);
      }
    });

    return rows;
  };

  return (
    <div className="timeline-panel">
      {!historyEnabled && (
        <div className="timeline-banner timeline-banner--direct-modeling">
          Design history not captured (Direct Modeling mode)
        </div>
      )}
      {baseFeatureActive && (
        <div className="timeline-banner timeline-banner--base-feature">
          <span className="timeline-banner__label">Base Feature open - parametric recompute suppressed</span>
          <button onClick={finishBaseFeature} title="Finish Base Feature" className="timeline-banner__finish-btn">
            <CheckSquare size={12} />
            Finish
          </button>
        </div>
      )}

      <div className="timeline-header">
        <h3>Timeline</h3>
        <div className="timeline-header__controls">
          <div className="timeline-nav">
            <button
              className="timeline-nav__btn"
              onClick={() => { setRollbackIndex(0); }}
              title="Beginning - roll back to first feature"
              aria-label="Roll timeline back to first feature"
              disabled={features.length === 0}
            >
              <SkipBack size={11} />
            </button>
            <button
              className="timeline-nav__btn"
              onClick={() => {
                const cur = rollbackIndex < 0 ? features.length - 1 : rollbackIndex;
                setRollbackIndex(Math.max(0, cur - 1));
              }}
              title="Previous feature"
              aria-label="Move rollback marker to previous feature"
              disabled={features.length === 0 || rollbackIndex === 0}
            >
              <ChevronRight size={11} className="timeline-nav__icon--flip" />
            </button>
            <button
              className="timeline-nav__btn"
              onClick={() => {
                if (rollbackIndex < 0 || rollbackIndex >= features.length - 1) {
                  setRollbackIndex(-1);
                } else {
                  setRollbackIndex(rollbackIndex + 1);
                }
              }}
              title="Next feature"
              aria-label="Move rollback marker to next feature"
              disabled={features.length === 0 || rollbackIndex < 0}
            >
              <ChevronRight size={11} />
            </button>
            <button
              className="timeline-nav__btn"
              onClick={() => setRollbackIndex(-1)}
              title="End - show all features"
              aria-label="Show all timeline features"
              disabled={rollbackIndex < 0}
            >
              <PlayCircle size={11} />
            </button>
          </div>
          {rollbackIndex >= 0 && (
            <button className="timeline-action-btn active timeline-action-btn--small" onClick={() => setRollbackIndex(-1)} title="Clear rollback marker">
              @ {rollbackIndex + 1}/{features.length}
            </button>
          )}
          <button
            className={`timeline-nav__btn${isPlaying ? ' active' : ''}`}
            title={isPlaying ? 'Stop playback' : 'Play from beginning (400ms/step)'}
            aria-label={isPlaying ? 'Stop timeline playback' : 'Play timeline from beginning'}
            disabled={features.length === 0}
            onClick={isPlaying ? stopPlayback : startPlayback}
            style={{ marginLeft: 2 }}
          >
            {isPlaying ? <PauseCircle size={11} /> : <PlayCircle size={11} />}
          </button>
          <span className="feature-count">{features.length} features</span>
        </div>
      </div>

      <div className="timeline-list">
        {features.length === 0 ? (
          <div className="timeline-empty">
            <p>No features yet</p>
            <p className="timeline-hint">Start by creating a sketch</p>
          </div>
        ) : (
          <>
            {renderFeatureList()}
            <div
              className={`timeline-drop-target ${dragOverEnd ? 'active' : ''}`}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('text/feature-id')) {
                  e.preventDefault();
                  setDragOverEnd(true);
                }
              }}
              onDragLeave={() => setDragOverEnd(false)}
              onDrop={handleEndDrop}
            />
          </>
        )}
      </div>
    </div>
  );
}
