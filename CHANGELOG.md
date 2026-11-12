# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-11-12

### Added
- **Core engine**: `.gitignore`-aware repository scanner, `web-tree-sitter` WASM parser (TypeScript, TSX, JavaScript, Python, Go, Rust, Java) with regex fallback, internal dependency graph with cycle detection and fan-in/fan-out metrics, entry point detection, module architecture summary, 90-day git churn hot-file ranking, incremental SHA-256 cache (`.repomap/`), and token-budgeted Markdown/JSON/Mermaid formatters.
- **CLI (`repomap`)**: `generate`, `overview`, `find`, `deps`, and `impact` commands.
- **MCP Server (`mcp-repomap`)**: Stdio MCP server exposing `repomap_generate`, `repomap_overview`, `repomap_find`, `repomap_deps`, and `repomap_impact`.
- **Claude Code Plugin**: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.mcp.json`, `skills/repomap/SKILL.md`, slash commands (`/repomap:map`, `/repomap:impact`, `/repomap:refresh`), and `SessionStart` auto-refresh hook.
- **Tests & CI**: Vitest unit/integration tests for TS, Python, Go, CLI, and MCP stdio; ESLint + Prettier; GitHub Actions CI (Node 18/20/22) and tag-based npm publish workflow.
