import path from 'node:path';
import type { FileGraphMetrics, HotFile, ModuleSummary, ParsedFile } from './types.js';

const CONTAINER_DIRS = new Set(['src', 'lib', 'app', 'pkg', 'packages', 'internal', 'cmd']);

/**
 * Determine the logical module key for a file path.
 * Uses top-level directory, or second-level directory if top-level is a common
 * source container like `src/`, `lib/`, `pkg/`, `packages/`, `internal/`, or `cmd/`.
 */
export function getModuleKey(filePath: string): string {
  const parts = filePath.split('/');
  if (parts.length <= 1) return '(root)';
  const first = parts[0]!;
  if (CONTAINER_DIRS.has(first) && parts.length >= 3) {
    return `${first}/${parts[1]!}`;
  }
  return first;
}

const KNOWN_MODULE_HINTS: Record<string, string> = {
  core: 'Core domain logic and shared engine',
  cli: 'Command-line interface',
  mcp: 'Model Context Protocol server',
  api: 'API routes and handlers',
  server: 'Server setup and request handling',
  db: 'Database models and persistence',
  auth: 'Authentication and authorization',
  utils: 'Shared utility helpers',
  lib: 'Reusable library modules',
  types: 'Shared type definitions',
  models: 'Data models and schemas',
  services: 'Business logic services',
  components: 'UI components',
  hooks: 'Lifecycle or UI hooks',
  tests: 'Test suites and fixtures',
  test: 'Test suites and fixtures',
  scripts: 'Automation and build scripts',
  docs: 'Documentation',
  config: 'Configuration files',
  '.github': 'CI/CD workflows and repository templates',
};

function inferPurpose(moduleKey: string, exportsList: string[], symbolNames: string[]): string {
  const leaf = path.posix.basename(moduleKey).toLowerCase();
  const hint = KNOWN_MODULE_HINTS[leaf];
  const highlights = (exportsList.length > 0 ? exportsList : symbolNames).slice(0, 4);
  if (hint && highlights.length > 0) {
    return `${hint} (${highlights.join(', ')})`;
  }
  if (hint) return hint;
  if (highlights.length > 0) {
    return `Provides ${highlights.join(', ')}`;
  }
  return `${moduleKey} module`;
}

/**
 * Group files into modules, compute inter-module dependencies, and summarize each module.
 */
export function buildArchitectureSummary(
  files: Record<string, ParsedFile>,
  graph: Record<string, FileGraphMetrics>,
): ModuleSummary[] {
  const byModule = new Map<string, ParsedFile[]>();
  for (const file of Object.values(files)) {
    const key = getModuleKey(file.path);
    const list = byModule.get(key) ?? [];
    list.push(file);
    byModule.set(key, list);
  }

  const summaries: ModuleSummary[] = [];
  for (const [modKey, modFiles] of byModule.entries()) {
    const depSet = new Set<string>();
    const exportSet = new Set<string>();
    const symbolSet = new Set<string>();
    let totalLoc = 0;

    for (const f of modFiles) {
      totalLoc += f.loc;
      for (const exp of f.exports) exportSet.add(exp);
      for (const sym of f.symbols) symbolSet.add(sym.name);
      const node = graph[f.path];
      if (node) {
        for (const target of node.imports) {
          const targetMod = getModuleKey(target);
          if (targetMod !== modKey) {
            depSet.add(targetMod);
          }
        }
      }
    }

    const topFiles = [...modFiles]
      .sort((a, b) => {
        const fanDiff = (graph[b.path]?.fanIn ?? 0) - (graph[a.path]?.fanIn ?? 0);
        return fanDiff !== 0 ? fanDiff : b.loc - a.loc;
      })
      .slice(0, 3)
      .map((f) => ({
        path: f.path,
        fanIn: graph[f.path]?.fanIn ?? 0,
        loc: f.loc,
      }));

    const keyExports = Array.from(exportSet).slice(0, 8);
    summaries.push({
      name: modKey,
      path: modKey === '(root)' ? '.' : modKey,
      fileCount: modFiles.length,
      totalLoc,
      purpose: inferPurpose(modKey, keyExports, Array.from(symbolSet)),
      dependencies: Array.from(depSet).sort(),
      topFiles,
      keyExports,
    });
  }

  return summaries.sort((a, b) => b.totalLoc - a.totalLoc);
}

/**
 * Rank files by architectural centrality (fan-in) and recent git churn.
 */
export function computeHotFiles(
  files: Record<string, ParsedFile>,
  graph: Record<string, FileGraphMetrics>,
  churnMap: Map<string, number>,
  limit = 15,
): HotFile[] {
  const hot: HotFile[] = [];

  for (const file of Object.values(files)) {
    const metrics = graph[file.path] ?? { fanIn: 0, fanOut: 0, importedBy: [], imports: [] };
    const churn = churnMap.get(file.path) ?? 0;
    const score = metrics.fanIn * 3 + churn * 2 + (metrics.fanOut > 0 ? 1 : 0);
    hot.push({
      path: file.path,
      score,
      fanIn: metrics.fanIn,
      fanOut: metrics.fanOut,
      churn,
      loc: file.loc,
      language: file.language,
    });
  }

  hot.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.fanIn !== a.fanIn) return b.fanIn - a.fanIn;
    return b.loc - a.loc;
  });

  return hot.slice(0, limit);
}
