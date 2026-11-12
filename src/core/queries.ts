import path from 'node:path';
import { buildArchitectureSummary, computeHotFiles, getModuleKey } from './architecture.js';
import {
  CACHE_SCHEMA_VERSION,
  isRepomapGitignored,
  loadCache,
  partitionIncrementalFiles,
  saveCache,
} from './cache.js';
import { detectEntryPoints } from './entrypoints.js';
import {
  DEFAULT_TOKEN_BUDGET,
  estimateTokens,
  formatMarkdown,
  formatRepoMap,
} from './formatter.js';
import { getGitChurn, getGitHead } from './git.js';
import { buildDependencyGraph } from './graph.js';
import { parseFile } from './parser.js';
import { scanRepository, type ScannedFile } from './scanner.js';
import type { GenerateOptions, GenerateResult, ParsedFile, RepoMap } from './types.js';

/**
 * Generate (or incrementally refresh) a complete RepoMap for the given repository path.
 */
export async function generateMap(
  repoPath: string,
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const root = path.resolve(repoPath);
  const budget = options.budget ?? DEFAULT_TOKEN_BUDGET;
  const format = options.format ?? 'markdown';

  const [scanned, gitHead, churnMap, existingCache, gitignored] = await Promise.all([
    scanRepository(root),
    getGitHead(root),
    getGitChurn(root, 90),
    options.force || options.noCache ? Promise.resolve(null) : loadCache(root),
    isRepomapGitignored(root),
  ]);

  const scannedByPath = new Map<string, ScannedFile>();
  const hashMap = new Map<string, string>();
  const rawContents = new Map<string, string>();

  for (const f of scanned) {
    scannedByPath.set(f.path, f);
    hashMap.set(f.path, f.hash);
    rawContents.set(f.path, f.content);
  }

  const { unchanged, toParse } = partitionIncrementalFiles(hashMap, existingCache);
  const files: Record<string, ParsedFile> = { ...unchanged };

  for (const filePath of toParse) {
    const sf = scannedByPath.get(filePath);
    if (sf) {
      files[filePath] = await parseFile(sf);
    }
  }

  const { graph, cycles } = buildDependencyGraph(files, rawContents);
  const entryPoints = detectEntryPoints(files, rawContents);
  const modules = buildArchitectureSummary(files, graph);
  const hotFiles = computeHotFiles(files, graph, churnMap, 15);

  const languages: Record<string, number> = {};
  let totalLoc = 0;
  let totalBytes = 0;
  for (const f of Object.values(files)) {
    totalLoc += f.loc;
    totalBytes += f.sizeBytes;
    languages[f.language] = (languages[f.language] ?? 0) + 1;
  }

  const generatedAt = new Date().toISOString();
  const map: RepoMap = {
    version: CACHE_SCHEMA_VERSION,
    repoName: path.basename(root),
    rootPath: root,
    generatedAt,
    gitHead,
    stats: {
      totalFiles: Object.keys(files).length,
      totalLoc,
      totalBytes,
      languages,
      cycleCount: cycles.length,
    },
    entryPoints,
    modules,
    hotFiles,
    cycles,
    files,
    graph,
  };

  const gitignoreSuggested = !gitignored;
  const markdownForCache = formatMarkdown(map, DEFAULT_TOKEN_BUDGET, gitignoreSuggested);

  if (!options.noCache) {
    await saveCache(
      root,
      {
        version: CACHE_SCHEMA_VERSION,
        generatedAt,
        gitHead,
        files,
      },
      markdownForCache,
    );
  }

  const output =
    format === 'markdown' && budget === DEFAULT_TOKEN_BUDGET
      ? markdownForCache
      : formatRepoMap(map, format, budget, gitignoreSuggested);

  return {
    map,
    output,
    estimatedTokens: estimateTokens(output),
    cachedFiles: Object.keys(unchanged).length,
    reparsedFiles: toParse.length,
    gitignoreSuggested,
  };
}

/**
 * Return a concise architecture + entry points overview for a repository.
 */
export async function getOverview(repoPath: string): Promise<string> {
  const { map } = await generateMap(repoPath);
  const lines: string[] = [
    `# Overview: ${map.repoName}`,
    `Files: ${map.stats.totalFiles} | LOC: ${map.stats.totalLoc.toLocaleString()} | Cycles: ${map.stats.cycleCount}`,
    '',
    '## Entry Points',
  ];

  if (map.entryPoints.length === 0) {
    lines.push('- (none detected)');
  } else {
    for (const ep of map.entryPoints.slice(0, 12)) {
      lines.push(`- \`${ep.path}\` (${ep.reason})${ep.command ? ` — \`${ep.command}\`` : ''}`);
    }
  }

  lines.push('', '## Architecture');
  for (const mod of map.modules) {
    const deps = mod.dependencies.length > 0 ? ` -> [${mod.dependencies.join(', ')}]` : '';
    lines.push(
      `- **${mod.name}** (${mod.fileCount} files, ${mod.totalLoc} LOC): ${mod.purpose}${deps}`,
    );
  }

  if (map.hotFiles.length > 0) {
    lines.push('', '## Top Hot Files');
    for (const hf of map.hotFiles.slice(0, 8)) {
      lines.push(`- \`${hf.path}\` (fan-in:${hf.fanIn}, churn:${hf.churn}, ${hf.loc} LOC)`);
    }
  }

  return lines.join('\n');
}

/**
 * Find symbols and files matching a case-insensitive query string.
 */
export async function findSymbolsOrFiles(repoPath: string, query: string): Promise<string> {
  const { map } = await generateMap(repoPath);
  const q = query.trim().toLowerCase();
  if (!q) {
    return 'Please provide a non-empty search query.';
  }

  const matchedFiles: Array<{ path: string; fanIn: number; loc: number }> = [];
  const matchedSymbols: Array<{
    file: string;
    line: number;
    kind: string;
    name: string;
    signature: string;
    fanIn: number;
  }> = [];

  for (const file of Object.values(map.files)) {
    const fanIn = map.graph[file.path]?.fanIn ?? 0;
    if (file.path.toLowerCase().includes(q)) {
      matchedFiles.push({ path: file.path, fanIn, loc: file.loc });
    }
    for (const sym of file.symbols) {
      if (sym.name.toLowerCase().includes(q) || sym.signature.toLowerCase().includes(q)) {
        matchedSymbols.push({
          file: file.path,
          line: sym.line,
          kind: sym.kind,
          name: sym.name,
          signature: sym.signature,
          fanIn,
        });
      }
    }
  }

  matchedFiles.sort((a, b) => b.fanIn - a.fanIn || a.path.localeCompare(b.path));
  matchedSymbols.sort((a, b) => {
    const exactA = a.name.toLowerCase() === q ? 1 : 0;
    const exactB = b.name.toLowerCase() === q ? 1 : 0;
    if (exactB !== exactA) return exactB - exactA;
    return b.fanIn - a.fanIn;
  });

  if (matchedFiles.length === 0 && matchedSymbols.length === 0) {
    return `No files or symbols matching "${query}".`;
  }

  const lines: string[] = [`# Search: "${query}"`];
  if (matchedFiles.length > 0) {
    lines.push('', `## Matching Files (${matchedFiles.length})`);
    for (const f of matchedFiles.slice(0, 15)) {
      lines.push(`- \`${f.path}\` (${f.loc} LOC, fan-in:${f.fanIn})`);
    }
  }
  if (matchedSymbols.length > 0) {
    lines.push('', `## Matching Symbols (${matchedSymbols.length})`);
    for (const s of matchedSymbols.slice(0, 25)) {
      lines.push(`- \`${s.file}:${s.line}\` [${s.kind}] \`${s.signature}\``);
    }
    if (matchedSymbols.length > 25) {
      lines.push(`- ... +${matchedSymbols.length - 25} more symbols`);
    }
  }

  return lines.join('\n');
}

function normalizeFileArg(map: RepoMap, fileArg: string): string | undefined {
  const norm = fileArg.replace(/\\/g, '/').replace(/^\.\//, '');
  if (map.files[norm]) return norm;
  // Suffix match if user passed a partial path
  const candidates = Object.keys(map.files).filter((p) => p === norm || p.endsWith(`/${norm}`));
  return candidates[0];
}

function bfsNeighbors(
  map: RepoMap,
  startFile: string,
  edge: 'imports' | 'importedBy',
  maxDepth: number,
): Map<number, string[]> {
  const levels = new Map<number, string[]>();
  const visited = new Set<string>([startFile]);
  let frontier = [startFile];

  for (let d = 1; d <= maxDepth && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const cur of frontier) {
      const neighbors = map.graph[cur]?.[edge] ?? [];
      for (const n of neighbors) {
        if (!visited.has(n)) {
          visited.add(n);
          next.push(n);
        }
      }
    }
    if (next.length > 0) {
      levels.set(d, next.sort());
    }
    frontier = next;
  }

  return levels;
}

/**
 * Inspect the dependency neighborhood of a file (incoming, outgoing, or both).
 */
export async function getDeps(
  repoPath: string,
  file: string,
  direction: 'in' | 'out' | 'both' = 'both',
  depth = 1,
): Promise<string> {
  const { map } = await generateMap(repoPath);
  const resolved = normalizeFileArg(map, file);
  if (!resolved) {
    return `File not found in repo map: "${file}".`;
  }

  const maxDepth = Math.max(1, Math.min(depth, 5));
  const metrics = map.graph[resolved]!;
  const lines: string[] = [
    `# Dependencies: \`${resolved}\``,
    `Fan-in: ${metrics.fanIn} | Fan-out: ${metrics.fanOut} | Depth: ${maxDepth}`,
  ];

  if (direction === 'out' || direction === 'both') {
    const outLevels = bfsNeighbors(map, resolved, 'imports', maxDepth);
    lines.push('', '## Outgoing (imports)');
    if (outLevels.size === 0) {
      lines.push('- (none)');
    } else {
      for (const [d, list] of outLevels.entries()) {
        const prefix = maxDepth > 1 ? `[d=${d}] ` : '';
        for (const p of list) lines.push(`- ${prefix}\`${p}\``);
      }
    }
  }

  if (direction === 'in' || direction === 'both') {
    const inLevels = bfsNeighbors(map, resolved, 'importedBy', maxDepth);
    lines.push('', '## Incoming (imported by)');
    if (inLevels.size === 0) {
      lines.push('- (none)');
    } else {
      for (const [d, list] of inLevels.entries()) {
        const prefix = maxDepth > 1 ? `[d=${d}] ` : '';
        for (const p of list) lines.push(`- ${prefix}\`${p}\``);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Analyze the blast radius / impact of modifying a given file.
 */
export async function getImpact(repoPath: string, file: string): Promise<string> {
  const { map } = await generateMap(repoPath);
  const resolved = normalizeFileArg(map, file);
  if (!resolved) {
    return `File not found in repo map: "${file}".`;
  }

  const levels = bfsNeighbors(map, resolved, 'importedBy', 10);
  const direct = levels.get(1) ?? [];
  const transitive: string[] = [];
  for (const [d, list] of levels.entries()) {
    if (d > 1) transitive.push(...list);
  }

  const allAffected = new Set([resolved, ...direct, ...transitive]);
  const affectedModules = new Set<string>();
  for (const p of allAffected) {
    affectedModules.add(getModuleKey(p));
  }

  const affectedEntryPoints = map.entryPoints.filter((ep) => allAffected.has(ep.path));
  const totalAffected = direct.length + transitive.length;
  const risk =
    totalAffected >= 10 || affectedEntryPoints.length > 0
      ? 'HIGH'
      : totalAffected >= 3
        ? 'MEDIUM'
        : 'LOW';

  const lines: string[] = [
    `# Impact Analysis: \`${resolved}\``,
    `Risk: **${risk}** | Direct dependents: ${direct.length} | Transitive dependents: ${transitive.length} | Modules affected: ${affectedModules.size}`,
  ];

  if (affectedEntryPoints.length > 0) {
    lines.push('', '## Affected Entry Points');
    for (const ep of affectedEntryPoints) {
      lines.push(`- \`${ep.path}\` (${ep.reason})`);
    }
  }

  lines.push('', `## Direct Dependents (${direct.length})`);
  if (direct.length === 0) {
    lines.push('- (none)');
  } else {
    for (const p of direct.slice(0, 20)) lines.push(`- \`${p}\``);
    if (direct.length > 20) lines.push(`- ... +${direct.length - 20} more`);
  }

  if (transitive.length > 0) {
    lines.push('', `## Transitive Dependents (${transitive.length})`);
    for (const p of transitive.slice(0, 20)) lines.push(`- \`${p}\``);
    if (transitive.length > 20) lines.push(`- ... +${transitive.length - 20} more`);
  }

  return lines.join('\n');
}
