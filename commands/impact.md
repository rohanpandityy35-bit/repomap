---
description: Analyze the blast radius and dependents of a file before modifying it
argument-hint: <file>
---

Run `repomap_impact` on `$ARGUMENTS` in the current repository (or `npx -y --package=mcp-repomap repomap impact "$ARGUMENTS"` if the MCP tool is unavailable) and present the risk level, direct dependents, transitive dependents, and affected entry points.
