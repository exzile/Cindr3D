import type { ProfileSnapshotProfile } from '../store/slicer/types';

export interface ProfileDiffEntry {
  keyPath: string;
  before: unknown;
  after: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if ((isPlainObject(left) || Array.isArray(left)) && (isPlainObject(right) || Array.isArray(right))) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return false;
}

export function getProfileValue(profile: ProfileSnapshotProfile, keyPath: string): unknown {
  return keyPath.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[key];
  }, profile);
}

export function createProfilePatchForKey<T extends ProfileSnapshotProfile>(
  currentProfile: T,
  keyPath: string,
  value: unknown,
): Partial<T> {
  const keys = keyPath.split('.');
  const [rootKey] = keys;
  if (!rootKey) return {};
  if (keys.length === 1) return { [rootKey]: value } as Partial<T>;

  const rootValue = (currentProfile as unknown as Record<string, unknown>)[rootKey];
  const clonedRoot = isPlainObject(rootValue) ? { ...rootValue } : {};
  let cursor = clonedRoot;
  for (const key of keys.slice(1, -1)) {
    const next = cursor[key];
    cursor[key] = isPlainObject(next) ? { ...next } : {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]] = value;
  return { [rootKey]: clonedRoot } as Partial<T>;
}

export function diffProfiles(
  before: ProfileSnapshotProfile,
  after: ProfileSnapshotProfile,
  prefix = '',
): ProfileDiffEntry[] {
  const beforeRecord = before as unknown as Record<string, unknown>;
  const afterRecord = after as unknown as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])).sort();
  const entries: ProfileDiffEntry[] = [];

  for (const key of keys) {
    const keyPath = prefix ? `${prefix}.${key}` : key;
    const beforeValue = beforeRecord[key];
    const afterValue = afterRecord[key];
    if (isPlainObject(beforeValue) && isPlainObject(afterValue)) {
      entries.push(...diffProfiles(
        beforeValue as unknown as ProfileSnapshotProfile,
        afterValue as unknown as ProfileSnapshotProfile,
        keyPath,
      ));
    } else if (!valuesEqual(beforeValue, afterValue)) {
      entries.push({ keyPath, before: beforeValue, after: afterValue });
    }
  }

  return entries;
}

export function formatProfileDiffValue(value: unknown): string {
  if (value === undefined) return 'unset';
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  return JSON.stringify(value);
}
