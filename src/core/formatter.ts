import type { OutputFormat, RepoMap } from './types.js';

export const DEFAULT_TOKEN_BUDGET = 3500;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function formatRepoMap(
  map: RepoMap,
  format: OutputFormat = 'markdown',
  budget = DEFAULT_TOKEN_BUDGET,
  gitignoreSuggested = false,
): string {
  switch (format) {
    case 'json':
      return formatJson(map, budget);
    case 'mermaid':
      return formatMermaid(map);
    case 'markdown':
    default:
      return formatMarkdown(map, budget, gitignoreSuggested);
  }
}

export function formatMarkdown(
  map: RepoMap,
  budget = DEFAULT_TOKEN_BUDGET,
  gitignoreSuggested = false,
): string {
  const maxChars = Math.max(400, budget * 4);
  const sections: string[] = [];

  // 1. Header
  const langSummary = Object.entries(map.stats.languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([lang, count]) => `${lang}:${count}`)
    .join(', ');

  const headerLines = [
    `# RepoMap: ${map.repoName}`,
    `Files: ${map.stats.totalFiles} | LOC: ${map.stats.totalLoc.toLocaleString()} | Languages: ${langSummary || 'n/a'} | Cycles: ${map.stats.cycleCount}${map.gitHead ? ` | HEAD: ${map.gitHead.slice(0, 7)}` : ''}`,
  ];
  if (gitignoreSuggested) {
    headerLines.push(`> Tip: Add \`.repomap/\` to your \`.gitignore\`.`);
  }
  sections.push(headerLines.join('\n'));

  // 2. Entry Points
  if (map.entryPoints.length > 0) {
    const epLines = ['## Entry Points'];
    for (const ep of map.entryPoints.slice(0, 12)) {
      const cmd = ep.command ? ` — \`${ep.command}\`` : '';
      epLines.push(`- \`${ep.path}\` (${ep.reason})${cmd}`);
    }
    if (map.entryPoints.length > 12) {
      epLines.push(`- ... +${map.entryPoints.length - 12} more`);
    }
    sections.push(epLines.join('\n'));
  }

  // 3. Architecture / Modules
  if (map.modules.length > 0) {
    const modLines = ['## Architecture'];
    for (const mod of map.modules.slice(0, 15)) {
      const deps = mod.dependencies.length > 0 ? ` | deps: ${mod.dependencies.join(', ')}` : '';
      const top = mod.topFiles[0] ? ` | key: \`${mod.topFiles[0].path}\`` : '';
      modLines.push(
        `- **${mod.name}** (${mod.fileCount} files, ${mod.totalLoc} LOC): ${mod.purpose}${deps}${top}`,
      );
    }
    sections.push(modLines.join('\n'));
  }

  // 4. Hot Files
  if (map.hotFiles.length > 0) {
    const hotLines = ['## Hot Files (by fan-in + 90d churn)'];
    for (const hf of map.hotFiles.slice(0, 12)) {
      hotLines.push(
        `- \`${hf.path}\` (fan-in:${hf.fanIn}, fan-out:${hf.fanOut}, churn:${hf.churn}, ${hf.loc} LOC)`,
      );
    }
    sections.push(hotLines.join('\n'));
  }

  // 5. Dependency Cycles
  if (map.cycles.length > 0) {
    const cycLines = ['## Dependency Cycles'];
    for (const cycle of map.cycles.slice(0, 5)) {
      cycLines.push(`- ${cycle.join(' -> ')}`);
    }
    if (map.cycles.length > 5) {
      cycLines.push(`- ... +${map.cycles.length - 5} more cycles`);
    }
    sections.push(cycLines.join('\n'));
  }

  let output = sections.join('\n\n');

  // 6. Key Symbols per File (ordered by importance: hot files first, then fan-in, then LOC)
  const fileOrder = Object.values(map.files).sort((a, b) => {
    const scoreA =
      (map.graph[a.path]?.fanIn ?? 0) * 3 +
      (map.hotFiles.find((h) => h.path === a.path)?.churn ?? 0) * 2;
    const scoreB =
      (map.graph[b.path]?.fanIn ?? 0) * 3 +
      (map.hotFiles.find((h) => h.path === b.path)?.churn ?? 0) * 2;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return b.loc - a.loc;
  });

  const filesWithSymbols = fileOrder.filter((f) => f.symbols.length > 0);
  if (filesWithSymbols.length > 0 && output.length < maxChars - 120) {
    const symHeader = '\n\n## Key Symbols';
    output += symHeader;
    let included = 0;

    for (const file of filesWithSymbols) {
      const fanIn = map.graph[file.path]?.fanIn ?? 0;
      const topSyms = file.symbols.slice(0, 10);
      const fileLines = [`### \`${file.path}\` (${file.loc} LOC, fan-in:${fanIn})`];
      for (const s of topSyms) {
        fileLines.push(`- L${s.line}: \`${s.signature}\``);
      }
      if (file.symbols.length > 10) {
        fileLines.push(`- ... +${file.symbols.length - 10} more symbols`);
      }
      const block = '\n' + fileLines.join('\n');

      if (output.length + block.length + 80 > maxChars) {
        const remaining = filesWithSymbols.length - included;
        output += `\n\n_... ${remaining} lower-priority files omitted to fit ~${budget} token budget._`;
        break;
      }
      output += block;
      included++;
    }
  }

  // Final hard guard if header+modules alone exceeded budget
  if (output.length > maxChars) {
    output =
      output.slice(0, Math.max(200, maxChars - 60)) +
      `\n\n_... truncated to fit ~${budget} token budget._`;
  }

  return output;
}

export function formatJson(map: RepoMap, budget = DEFAULT_TOKEN_BUDGET): string {
  const full = JSON.stringify(map, null, 2);
  if (estimateTokens(full) <= budget) {
    return full;
  }

  // Trim least-important file entries first
  const hotSet = new Set(map.hotFiles.map((h) => h.path));
  const trimmedFiles: Record<string, unknown> = {};
  for (const h of map.hotFiles) {
    const f = map.files[h.path];
    if (f) trimmedFiles[h.path] = f;
  }

  const compact = {
    version: map.version,
    repoName: map.repoName,
    generatedAt: map.generatedAt,
    gitHead: map.gitHead,
    stats: map.stats,
    entryPoints: map.entryPoints,
    modules: map.modules,
    hotFiles: map.hotFiles,
    cycles: map.cycles,
    files: trimmedFiles,
    truncated: Object.keys(map.files).length - hotSet.size,
  };

  return JSON.stringify(compact, null, 2);
}

export function formatMermaid(map: RepoMap): string {
  const lines = ['flowchart LR'];
  const idMap = new Map<string, string>();
  let idx = 0;
  const getId = (name: string): string => {
    let id = idMap.get(name);
    if (!id) {
      id = `M${idx++}`;
      idMap.set(name, id);
    }
    return id;
  };

  for (const mod of map.modules) {
    const id = getId(mod.name);
    lines.push(`  ${id}["${mod.name} (${mod.fileCount}f)"]`);
  }

  for (const mod of map.modules) {
    const fromId = getId(mod.name);
    for (const dep of mod.dependencies) {
      const toId = getId(dep);
      lines.push(`  ${fromId} --> ${toId}`);
    }
  }

  if (map.modules.every((m) => m.dependencies.length === 0)) {
    // Fallback to file-level edges among top hot files
    const topPaths = new Set(map.hotFiles.slice(0, 12).map((h) => h.path));
    for (const p of topPaths) {
      const fromId = getId(p);
      lines.push(`  ${fromId}["${p}"]`);
      for (const target of map.graph[p]?.imports ?? []) {
        if (topPaths.has(target)) {
          lines.push(`  ${fromId} --> ${getId(target)}`);
        }
      }
    }
  }

  return lines.join('\n');
}
