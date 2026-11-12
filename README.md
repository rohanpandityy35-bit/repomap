# repomap

**Give your AI coding agent a 3k-token map of any codebase in under a second — so it stops re-reading the entire repo every session.**

[![CI](https://github.com/rohanpandityy35-bit/repomap/actions/workflows/ci.yml/badge.svg)](https://github.com/rohanpandityy35-bit/repomap/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/mcp-repomap.svg)](https://www.npmjs.com/package/mcp-repomap)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

`repomap` is an **MCP server**, **CLI**, and **Claude Code plugin** (skill + slash commands + optional `SessionStart` hook) that generates a compact, cached architectural map of any repository: module boundaries, entry points, internal dependency graph, cycle detection, key symbols per file, and "hot files" ranked by fan-in + recent git churn.

**100% local. Zero network calls. Incremental SHA-256 caching.**

---

## Before vs. After (Real Benchmarks)

Measured on real open-source repositories using `mcp-repomap v0.1.0` (default `3500` token budget):

| Repository | Files | LOC | Raw Repo Tokens | `repomap` Tokens | Token Reduction | Cold / Warm Time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| [`sindresorhus/ky`](https://github.com/sindresorhus/ky) (TypeScript) | 114 | 39,314 | 339,885 | **3,462** | **99.0%** | 2.40s / 259ms |
| [`pallets/flask`](https://github.com/pallets/flask) (Python) | 230 | 34,920 | 300,765 | **3,368** | **98.9%** | 0.88s / 429ms |

> Instead of burning ~300k+ tokens and minutes of grep/file-reads on every new session, your agent reads a ~3.4k-token map in <0.5s and opens only the exact files it needs.

---

## Demo

> ![repomap 10-second demo](docs/demo.gif) *(Demo GIF placeholder — record locally with `bash scripts/record-demo.sh` using [VHS](https://github.com/charmbracelet/vhs))*

To record the 10-second demo GIF yourself:

```bash
# Requires VHS (https://github.com/charmbracelet/vhs)
bash scripts/record-demo.sh
```

---

## Quick Install

### Option 1: Claude Code Plugin (MCP + Skill + Slash Commands + Auto-Refresh Hook)

Inside Claude Code:

```text
/plugin marketplace add rohanpandityy35-bit/repomap
/plugin install repomap@repomap
```

This installs:
- **MCP server** (`mcp-repomap`)
- **Skill** (`skills/repomap/SKILL.md`) teaching Claude to read the map before broad exploration or refactors
- **Slash commands**: `/repomap:map`, `/repomap:impact <file>`, `/repomap:refresh`
- **SessionStart hook**: silently refreshes `.repomap/` if stale (>24h or `git HEAD` changed)

### Option 2: MCP Server Only

```bash
claude mcp add repomap -- npx -y mcp-repomap
```

### Option 3: CLI (No MCP Required)

```bash
npx -y --package=mcp-repomap repomap generate .
# or install globally:
npm install -g mcp-repomap
repomap overview .
```

---

## Usage Examples

### MCP Tools

| Tool | Arguments | Description |
| --- | --- | --- |
| `repomap_generate` | `(path, budget?, format?)` | Build or incrementally refresh the map (`markdown`, `json`, `mermaid`) |
| `repomap_overview` | `(path)` | Concise architecture summary, entry points, and top hot files |
| `repomap_find` | `(path, query)` | Search symbols (functions, classes, types) and files |
| `repomap_deps` | `(path, file, direction, depth?)` | Inspect incoming (`in`), outgoing (`out`), or `both` dependencies |
| `repomap_impact` | `(path, file)` | Blast radius analysis: direct/transitive dependents, affected modules & entry points |

### CLI Commands

```bash
# Generate compact Markdown map (default ~3,500 tokens) and cache in .repomap/
repomap generate . --budget 3000

# Export as Mermaid dependency graph or JSON
repomap generate . --format mermaid
repomap generate . --format json

# Quick architecture + entry points overview
repomap overview .

# Find symbols or files matching a query
repomap find Calculator .

# Inspect incoming/outgoing dependencies (depth 2)
repomap deps src/core/graph.ts . --direction both --depth 2

# Check blast radius before editing a shared file
repomap impact src/core/types.ts .
```

---

## Supported Languages

| Language | Parser | Extracted Features |
| --- | --- | --- |
| TypeScript / TSX | `web-tree-sitter` (WASM) | ES imports/exports, CommonJS `require`, functions, classes, interfaces, types, enums |
| JavaScript / JSX | `web-tree-sitter` (WASM) | ES imports/exports, CommonJS `require`, functions, classes, exported constants |
| Python | `web-tree-sitter` (WASM) | `import` / `from ... import` (incl. relative), functions, classes, decorators |
| Go | `web-tree-sitter` (WASM) | `import` specs, `go.mod` internal resolution, structs, interfaces, functions, methods |
| Rust | `web-tree-sitter` (WASM) | `use` / `mod` declarations (`crate::`, `super::`, `self::`), structs, enums, traits, fns |
| Java | `web-tree-sitter` (WASM) | `import` declarations, classes, interfaces, enums, methods |
| Other languages | Regex fallback | Generic `import`/`#include` detection, top-level function/class/struct signatures |

---

## How It Works

1. **Scan**: Walks the repo respecting `.gitignore` (root and nested), skipping `node_modules`, `dist`, `build`, lockfiles, binaries, and files >1MB.
2. **Parse & Cache**: Computes SHA-256 per file and parses only changed files via `web-tree-sitter` WASM grammars. Stores cache in `.repomap/map.json` and `.repomap/REPOMAP.md`.
3. **Graph & Rank**: Resolves internal imports, detects dependency cycles, computes fan-in/fan-out, extracts entry points (`package.json`, `pyproject.toml`, `main.go`, `src/main.rs`, `Dockerfile`, CI workflows), and ranks hot files by fan-in + 90-day `git log` churn.
4. **Budgeted Output**: Emits architecture + entry points + hot files first, then fills remaining token budget with key symbols ordered by file importance.

---

## Roadmap

- [ ] Monorepo workspace awareness (pnpm/npm workspaces, Cargo workspaces, Go multi-module)
- [ ] Language-specific path alias resolution (`tsconfig.json` `paths`, Python `PYTHONPATH`)
- [ ] Tree-sitter WASM support for C/C++, Ruby, C#, and Kotlin
- [ ] Watch mode (`repomap watch`) for live `.repomap/` updates during development

---

## FAQ

**Does `repomap` send my code anywhere?**
No. Everything runs 100% locally on your machine with zero network calls.

**Should I commit `.repomap/` to git?**
Usually no — add `.repomap/` to your `.gitignore` (repomap will remind you if it's not ignored).

**Why is the npm package named `mcp-repomap`?**
`repomap-mcp` was already taken on npm, so we published under `mcp-repomap` (which exposes both `mcp-repomap` and `repomap` binaries).

---

## License

[MIT](LICENSE)
