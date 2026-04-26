import { describe, expect, it } from 'vitest';
import type { PrintProfile } from '../../../../types/slicer';

import { applyPostProcessingScripts } from '../postProcessing';

function makeProfile(scripts: string[] = []): PrintProfile {
  return { postProcessingScripts: scripts } as unknown as PrintProfile;
}

const sampleGCode = `; sample
G28
G90
M82
G1 X10 Y10 E1
M104 S210`;

describe('applyPostProcessingScripts', () => {
  it('returns the input unchanged when no scripts are configured', () => {
    expect(applyPostProcessingScripts(sampleGCode, makeProfile())).toBe(sampleGCode);
  });

  it('treats blank-string scripts as no-ops', () => {
    expect(applyPostProcessingScripts(sampleGCode, makeProfile(['', '   ']))).toBe(sampleGCode);
  });

  it('appends literal lines (default behavior, no prefix)', () => {
    const out = applyPostProcessingScripts(sampleGCode, makeProfile(['M84 ; motors off']));
    expect(out.endsWith('M84 ; motors off\n')).toBe(true);
  });

  it('prepends lines marked with the `prepend:` prefix', () => {
    const out = applyPostProcessingScripts(sampleGCode, makeProfile([
      'prepend:; HEADER LINE',
    ]));
    expect(out.startsWith('; HEADER LINE\n')).toBe(true);
  });

  it('appends lines marked with the `append:` prefix', () => {
    const out = applyPostProcessingScripts(sampleGCode, makeProfile([
      'append:; FOOTER LINE',
    ]));
    expect(out.endsWith('; FOOTER LINE\n')).toBe(true);
  });

  it('runs `replace:/pattern/flags=>replacement` on the g-code body', () => {
    const out = applyPostProcessingScripts(sampleGCode, makeProfile([
      'replace:/M104 S210/=>M104 S205 ; tweaked',
    ]));
    expect(out).toMatch(/M104 S205 ; tweaked/);
    expect(out).not.toMatch(/M104 S210/);
  });

  it('honors regex flags on replace (e.g. global)', () => {
    const inputGCode = 'G1 X1\nG1 X2\nG1 X3';
    const out = applyPostProcessingScripts(inputGCode, makeProfile([
      'replace:/G1/g=>G0',
    ]));
    expect(out.match(/G0/g)?.length).toBe(3);
    expect(out).not.toMatch(/G1/);
  });

  it('skips comment-only lines (lines starting with `;`)', () => {
    const out = applyPostProcessingScripts(sampleGCode, makeProfile([
      '; this is a comment in the script\nappend:; FOOTER',
    ]));
    // The "; this is a comment" line should NOT appear in output.
    expect(out).not.toMatch(/; this is a comment/);
    expect(out.endsWith('; FOOTER\n')).toBe(true);
  });

  it('silently ignores malformed replace patterns', () => {
    // Invalid regex shouldn't crash; line is treated as plain append.
    expect(() => applyPostProcessingScripts(sampleGCode, makeProfile([
      'replace:/[unclosed/=>oops',
    ]))).not.toThrow();
  });

  it('chains multiple scripts in order (replace then append)', () => {
    const out = applyPostProcessingScripts(sampleGCode, makeProfile([
      'replace:/G28/=>; HOMED',
      'append:; END',
    ]));
    expect(out).toMatch(/; HOMED/);
    expect(out).not.toMatch(/G28/);
    expect(out.endsWith('; END\n')).toBe(true);
  });

  it('handles multi-line scripts (split on newlines, trimmed)', () => {
    const out = applyPostProcessingScripts(sampleGCode, makeProfile([
      'prepend:; LINE 1\nprepend:; LINE 2',
    ]));
    expect(out.startsWith('; LINE 1\n; LINE 2\n')).toBe(true);
  });
});
