<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **DesignCAD** (17427 symbols, 25115 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/DesignCAD/context` | Codebase overview, check index freshness |
| `gitnexus://repo/DesignCAD/clusters` | All functional areas |
| `gitnexus://repo/DesignCAD/processes` | All execution flows |
| `gitnexus://repo/DesignCAD/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

# Verification & Debug Hygiene

## Always Do

- **MUST run `npm run verify` before claiming a change is safe to ship.** Plain `tsc --noEmit` skips files that only the composite build (`tsc -b`) checks — every project-references error caught by `npm run build` would slip through. `verify` runs `tsc -b && vitest run`. Use it instead of `tsc --noEmit` or `vitest run` alone.
- **MUST use `npm run dev:fresh` when starting a debug session after profile-default changes, WASM rebuilds, or anything that touches persisted state** (`src/types/slicer/defaultProfiles.ts`, `src/store/slicer/persistConfig.ts`, anything in `wasm/dist/`). Plain `npm run dev` reuses Vite's optimized-deps cache (`node_modules/.vite/`) which holds onto pre-bundled npm dep snapshots — `dev:fresh` wipes that cache before starting so the first page load runs against everything we just wrote.
- **MUST run `npx tsc -b` (NOT `npx tsc --noEmit`) for any standalone typecheck.** Same reason: composite mode catches what plain mode misses.

## Never Do

- NEVER claim "typecheck clean" or "tests pass" based on `tsc --noEmit` alone — it lies about errors in test-only configs and project-reference subprojects.
- NEVER tell the user "hard reload should fix it" before checking that the dev server is actually serving fresh source. Use `curl http://localhost:5173/src/<path-to-file>` to verify; the dev server now sends `Cache-Control: no-cache` for all source assets so every reload validates against the server.

## Cache layers a debug session has to clear

| Layer | When stale | How to clear |
|---|---|---|
| Vite optimized-deps (`node_modules/.vite/`) | After dependency changes, sometimes after large refactors | `npm run dev:fresh` |
| Browser HTTP cache for `.ts/.js/.css/.wasm` | Should never be stale anymore | Vite plugin sends `Cache-Control: no-cache` on every dev asset |
| Slicer-worker bundled code | When `src/workers/SlicerWorker.ts` or its imports change | Auto: URL-mismatch check in `getSlicerWorker` terminates stale workers |
| WASM binary (`wasm/dist/*.wasm`) | After `wasm/build.ps1` rebuild | Auto: `Cache-Control: no-cache` from the dev plugin |
| IndexedDB persisted profile | When `defaultProfiles.ts` or migration logic changes | Bump `slicerPersistConfig.version`; or DevTools → Application → IndexedDB → delete `dzign3d-slicer-plate` |
