import { useEffect, useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { ProfileSnapshot, ProfileSnapshotKind, ProfileSnapshotProfile } from '../../../../store/slicer/types';
import { diffProfiles, formatProfileDiffValue } from '../../../../utils/profileDiff';
import { colors } from '../../../../utils/theme';

interface SnapshotOption {
  id: string;
  label: string;
  profile: ProfileSnapshotProfile;
  snapshot?: ProfileSnapshot;
}

function formatSnapshotTime(createdAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(createdAt));
}

function createOptions(
  snapshots: ProfileSnapshot[],
  currentProfile: ProfileSnapshotProfile,
): SnapshotOption[] {
  const snapshotOptions = snapshots
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((snapshot) => ({
      id: snapshot.id,
      label: `${formatSnapshotTime(snapshot.createdAt)} - ${snapshot.profileName}`,
      profile: snapshot.profile,
      snapshot,
    }));
  return [
    { id: '__current', label: 'Current unsaved state', profile: currentProfile },
    ...snapshotOptions,
  ];
}

export function ProfileSnapshotDiffPanel({
  kind,
  currentProfile,
  snapshots,
  restoreProfileSnapshot,
  restoreProfileSnapshotKey,
}: {
  kind: ProfileSnapshotKind;
  currentProfile: ProfileSnapshotProfile;
  snapshots: ProfileSnapshot[];
  restoreProfileSnapshot: (snapshotId: string) => void;
  restoreProfileSnapshotKey: (snapshotId: string, keyPath: string) => void;
}) {
  const relevantSnapshots = useMemo(
    () => snapshots.filter((snapshot) => snapshot.kind === kind && snapshot.profileId === currentProfile.id),
    [currentProfile.id, kind, snapshots],
  );
  const options = useMemo(
    () => createOptions(relevantSnapshots, currentProfile),
    [currentProfile, relevantSnapshots],
  );
  const [leftId, setLeftId] = useState(options[1]?.id ?? options[0]?.id ?? '');
  const [rightId, setRightId] = useState(options[0]?.id ?? '');
  useEffect(() => {
    if (!options.some((option) => option.id === leftId)) setLeftId(options[1]?.id ?? options[0]?.id ?? '');
    if (!options.some((option) => option.id === rightId)) setRightId(options[0]?.id ?? '');
  }, [leftId, options, rightId]);
  const left = options.find((option) => option.id === leftId) ?? options[0];
  const right = options.find((option) => option.id === rightId) ?? options[0];
  const diff = left && right ? diffProfiles(left.profile, right.profile) : [];

  if (relevantSnapshots.length === 0) {
    return (
      <section style={{ padding: '12px 16px', borderTop: `1px solid ${colors.panelBorder}`, color: colors.textDim, fontSize: 12 }}>
        Profile history will appear here after the next save.
      </section>
    );
  }

  return (
    <section style={{ padding: '12px 16px', borderTop: `1px solid ${colors.panelBorder}`, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ color: colors.text, fontSize: 12, fontWeight: 600 }}>Profile history</span>
        {left?.snapshot && (
          <button
            type="button"
            onClick={() => restoreProfileSnapshot(left.snapshot!.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              border: `1px solid ${colors.panelBorder}`,
              background: colors.elevated,
              color: colors.text,
              borderRadius: 6,
              padding: '5px 8px',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            <RotateCcw size={14} />
            Restore selected
          </button>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <select value={leftId} onChange={(event) => setLeftId(event.target.value)} style={{ background: colors.elevated, color: colors.text, border: `1px solid ${colors.panelBorder}`, borderRadius: 6, padding: 8 }}>
          {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <select value={rightId} onChange={(event) => setRightId(event.target.value)} style={{ background: colors.elevated, color: colors.text, border: `1px solid ${colors.panelBorder}`, borderRadius: 6, padding: 8 }}>
          {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </div>
      <div style={{ display: 'grid', maxHeight: 180, overflow: 'auto', border: `1px solid ${colors.panelBorder}`, borderRadius: 6 }}>
        {diff.length === 0 ? (
          <div style={{ padding: 10, color: colors.textDim, fontSize: 12 }}>No changed keys between these versions.</div>
        ) : diff.map((entry) => (
          <div key={entry.keyPath} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 1fr auto', gap: 8, alignItems: 'center', padding: '7px 8px', borderBottom: `1px solid ${colors.panelBorder}` }}>
            <code style={{ color: colors.text, fontSize: 11 }}>{entry.keyPath}</code>
            <span style={{ color: colors.textDim, fontSize: 11, overflowWrap: 'anywhere' }}>{formatProfileDiffValue(entry.before)}</span>
            <span style={{ color: colors.text, fontSize: 11, overflowWrap: 'anywhere' }}>{formatProfileDiffValue(entry.after)}</span>
            {left?.snapshot ? (
              <button
                type="button"
                onClick={() => restoreProfileSnapshotKey(left.snapshot!.id, entry.keyPath)}
                title="Restore this value from the selected snapshot"
                style={{ border: 'none', background: 'transparent', color: colors.accent, cursor: 'pointer', display: 'flex' }}
              >
                <RotateCcw size={14} />
              </button>
            ) : <span />}
          </div>
        ))}
      </div>
    </section>
  );
}
