---
name: repomap
description: Generate and query a compact, cached codebase map (~2-4k tokens) before reading files. Use when starting work in an unfamiliar repo, before broad exploration or search, and before refactoring or modifying shared modules.
---

# RepoMap — Read the Map Before Reading the Code

Always orient yourself with `repomap` before running broad `grep`, `find`, or reading multiple files.

## When to Use This Skill
1. **Starting work in an unfamiliar repository**: Call `repomap_overview` or `repomap_generate` first to see the architecture, entry points, and hot files in ~2-4k tokens.
2. **Before broad exploration**: Instead of listing directories or reading many files, call `repomap_find` to locate relevant symbols, signatures, and file paths.
3. **Before refactoring or editing shared code**: Call `repomap_impact` on the target file to see its blast radius (direct & transitive dependents, affected entry points) and `repomap_deps` to inspect its neighborhood.

## Workflow
1. Call `repomap_generate` (or read `.repomap/REPOMAP.md` if present) to get the high-level map.
2. Use `repomap_find` to pinpoint exact symbol locations and line numbers.
3. Use `repomap_deps` / `repomap_impact` to understand coupling before making edits.
4. **Only open specific files** after you know which exact files and line ranges you need.
