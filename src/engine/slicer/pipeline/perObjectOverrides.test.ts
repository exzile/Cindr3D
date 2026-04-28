import { describe, expect, it } from 'vitest';

import {
  compactOverrides,
  overrideSignature,
  resolveEffectiveProfile,
} from './perObjectOverrides';
import type { PrintProfile } from '../../../types/slicer';

const baseProfile = {
  layerHeight: 0.2,
  wallCount: 3,
  infillDensity: 20,
} as unknown as PrintProfile;

describe('compactOverrides', () => {
  it('drops undefined entries (treated as "inherit")', () => {
    expect(compactOverrides({ a: 1, b: undefined, c: 'x' })).toEqual({ a: 1, c: 'x' });
  });
  it('returns undefined when nothing is left', () => {
    expect(compactOverrides({ a: undefined })).toBeUndefined();
    expect(compactOverrides({})).toBeUndefined();
    expect(compactOverrides(undefined)).toBeUndefined();
  });
});

describe('resolveEffectiveProfile', () => {
  it('returns the profile unchanged when no overrides apply', () => {
    const out = resolveEffectiveProfile(baseProfile);
    expect(out).not.toBe(baseProfile);
    expect(out.wallCount).toBe(3);
  });

  it('applies per-object overrides on top of the profile', () => {
    const out = resolveEffectiveProfile(baseProfile, { wallCount: 5 });
    expect(out.wallCount).toBe(5);
    expect(out.layerHeight).toBe(0.2);
  });

  it('applies modifier overrides on top of per-object overrides (modifier wins)', () => {
    const out = resolveEffectiveProfile(
      baseProfile,
      { wallCount: 5, infillDensity: 30 },
      { wallCount: 8 },
    );
    expect(out.wallCount).toBe(8); // modifier wins
    expect(out.infillDensity).toBe(30); // per-object stands when modifier is silent
  });

  it('does not mutate the base profile', () => {
    const baseClone = { ...baseProfile };
    resolveEffectiveProfile(baseProfile, { wallCount: 99 });
    expect(baseProfile.wallCount).toBe(baseClone.wallCount);
  });

  it('treats undefined values as "inherit" (no override)', () => {
    const out = resolveEffectiveProfile(baseProfile, { wallCount: undefined });
    expect(out.wallCount).toBe(3);
  });
});

describe('overrideSignature', () => {
  it('produces __default__ for empty / undefined overrides', () => {
    expect(overrideSignature(undefined)).toBe('__default__');
    expect(overrideSignature({})).toBe('__default__');
    expect(overrideSignature({ a: undefined })).toBe('__default__');
  });

  it('is stable regardless of key order', () => {
    expect(overrideSignature({ a: 1, b: 2 })).toBe(overrideSignature({ b: 2, a: 1 }));
  });

  it('differs across distinct overrides', () => {
    expect(overrideSignature({ a: 1 })).not.toBe(overrideSignature({ a: 2 }));
  });
});
