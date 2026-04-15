---
name: Read memory before exploring
description: Always read the project memory files before launching Explore agents — they answer most "where is X" questions and save tokens
type: feedback
---

Always read `memory/MEMORY.md` and the relevant memory files (especially `code_graph.md` and `gotchas.md`) **before** launching Explore agents to find files or learn the codebase.

**Why:** The user explicitly called this out after a session where Explore agents burned tokens re-discovering things (which file holds component X, where is store action Y) that the memory files already documented. The memory files are a curated index — using them first is the difference between a 60k-token plan and a 250k-token plan.

**How to apply:**
1. At the start of any plan or non-trivial task, read `memory/MEMORY.md` to see what topic files exist.
2. For "where is X" / "what file owns Y" / "how does Z work" questions, look in `memory/code_graph.md` first — it's a flat lookup table of every important file and what it does.
3. For known bug classes (memory leaks, hooks, plane math, deprecation warnings) read `memory/gotchas.md`.
4. Only fall back to an Explore agent when:
   - The question is about NEW code that isn't in the memory yet
   - You need exact line numbers or current code, not just "which file"
   - The memory file is stale (verify with a quick targeted Read before launching an agent)
5. When you discover a new durable fact about the codebase (file moves, new architectural patterns, refactor results), **update `code_graph.md` or create a new memory file** so the next session benefits.
6. Cite memory in plans: instead of "I'll explore to find the extrude flow," say "Per `code_graph.md`, the extrude flow lives in `Viewport.tsx ExtrudeTool` + `ExtrudePanel.tsx` + `cadStore.ts startExtrudeTool`."
