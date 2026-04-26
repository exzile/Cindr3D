// ARACHNE-9.4C — bundle-size budget for WASM artifacts.
//
// The .wasm files in wasm/dist/ are checked into git and shipped to the
// browser. Without a budget, an unwatched libArachne addition (9.2C) or
// a debug-info regression could quietly blow up the JS payload.
//
// Budget rationale:
//   - voronoi.wasm     :  60 KB raw — current 50 KB, headroom for
//                         parabolic-edge discretisation (9.X.2) + minor
//                         additions during 9.2A.
//   - clipper2.wasm    : 200 KB raw — current 76 KB; libArachne's
//                         polygon ops will live in this module if we
//                         consolidate, otherwise this stays generous.
//   - arachne.wasm     : 350 KB raw (allocated; module not yet built).
//                         libArachne + transitive Cura geometry is
//                         estimated 250-300 KB compiled with -Oz.
//   - total raw budget : 500 KB across all .wasm modules combined.
//
// All numbers are *raw* .wasm bytes (the file on disk). gzipped sizes
// are typically ~30-40% smaller — Vite serves them gzipped/brotli'd in
// production, so the wire size is well under the soft 500 KB cap.

import { describe, expect, it } from 'vitest';

const MODULE_BUDGETS_KB: Record<string, number> = {
  'voronoi.wasm': 60,
  'clipper2.wasm': 200,
  'arachne.wasm': 350,
};
const TOTAL_BUDGET_KB = 500;

describe('WASM bundle budget', () => {
  it('keeps each module under its individual budget', async () => {
    const fs = await import('node:fs/promises');
    const url = await import('node:url');
    const path = await import('node:path');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const distDir = path.resolve(here, '../dist');

    let totalKb = 0;
    const offenders: string[] = [];
    const present: string[] = [];
    for (const [name, budgetKb] of Object.entries(MODULE_BUDGETS_KB)) {
      const filePath = path.join(distDir, name);
      try {
        const stat = await fs.stat(filePath);
        const kb = stat.size / 1024;
        totalKb += kb;
        present.push(`${name}=${kb.toFixed(1)}KB`);
        if (kb > budgetKb) {
          offenders.push(`${name}: ${kb.toFixed(1)}KB > budget ${budgetKb}KB`);
        }
      } catch (err) {
        // Module not built yet (e.g. arachne.wasm pre-9.2C). Skip
        // silently — the test still enforces budgets on what *is*
        // present. CI must run `wasm/build.sh` before vitest to catch
        // regressions on built modules.
        const e = err as NodeJS.ErrnoException;
        if (e.code !== 'ENOENT') throw err;
      }
    }

    expect(offenders).toEqual([]);
    expect(totalKb, `total raw .wasm size ${totalKb.toFixed(1)}KB across ${present.join(', ')}`)
      .toBeLessThanOrEqual(TOTAL_BUDGET_KB);
  });
});
