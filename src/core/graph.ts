import path from 'node:path';
import type { FileGraphMetrics, ParsedFile } from './types.js';

export interface GraphResult {
  graph: Record<string, FileGraphMetrics>;
  cycles: string[][];
}

interface ResolverContext {
  fileSet: Set<string>;
  filesBySuffix: Map<string, string[]>;
  goModule?: string;
}

function buildResolverContext(
  files: Record<string, ParsedFile>,
  rawContents?: Map<string, string>,
): ResolverContext {
  const fileSet = new Set(Object.keys(files));
  const filesBySuffix = new Map<string, string[]>();

  for (const filePath of fileSet) {
    const parts = filePath.split('/');
    // Index by last 2 and 3 path segments for fast Java/Go/Python suffix matching
    for (let len = 1; len <= Math.min(4, parts.length); len++) {
      const suffix = parts.slice(-len).join('/');
      const list = filesBySuffix.get(suffix) ?? [];
      list.push(filePath);
      filesBySuffix.set(suffix, list);
    }
  }

  let goModule: string | undefined;
  if (rawContents?.has('go.mod')) {
    const goMod = rawContents.get('go.mod') ?? '';
    const m = goMod.match(/^\s*module\s+(\S+)/m);
    if (m?.[1]) {
      goModule = m[1].trim();
    }
  }

  return { fileSet, filesBySuffix, goModule };
}

const TS_JS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

function resolveTsJsImport(
  fromFile: string,
  specifier: string,
  ctx: ResolverContext,
): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const fromDir = path.posix.dirname(fromFile);
  const target = path.posix.normalize(path.posix.join(fromDir, specifier));

  if (ctx.fileSet.has(target)) return target;

  // Handle TypeScript NodeNext style imports where .ts is imported as .js/.jsx/.mjs/.cjs
  const extMatch = target.match(/\.(js|jsx|mjs|cjs)$/);
  if (extMatch) {
    const stem = target.slice(0, -extMatch[0].length);
    for (const ext of ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx']) {
      if (ctx.fileSet.has(stem + ext)) return stem + ext;
    }
  }

  for (const ext of TS_JS_EXTENSIONS) {
    if (ctx.fileSet.has(target + ext)) return target + ext;
  }

  for (const ext of TS_JS_EXTENSIONS) {
    const idx = path.posix.join(target, `index${ext}`);
    if (ctx.fileSet.has(idx)) return idx;
  }

  return undefined;
}

function resolvePythonImport(
  fromFile: string,
  specifier: string,
  ctx: ResolverContext,
): string | undefined {
  const fromDir = path.posix.dirname(fromFile);

  if (specifier.startsWith('.')) {
    // Count leading dots
    const match = specifier.match(/^(\.+)(.*)$/);
    if (!match) return undefined;
    const dots = match[1]!.length;
    const rest = (match[2] ?? '').replace(/\./g, '/');

    let baseDir = fromDir;
    for (let i = 1; i < dots; i++) {
      baseDir = path.posix.dirname(baseDir);
    }

    const candidateBase = rest ? path.posix.join(baseDir, rest) : baseDir;
    if (ctx.fileSet.has(`${candidateBase}.py`)) return `${candidateBase}.py`;
    if (ctx.fileSet.has(`${candidateBase}/__init__.py`)) return `${candidateBase}/__init__.py`;
    return undefined;
  }

  const modPath = specifier.replace(/\./g, '/');
  if (ctx.fileSet.has(`${modPath}.py`)) return `${modPath}.py`;
  if (ctx.fileSet.has(`${modPath}/__init__.py`)) return `${modPath}/__init__.py`;
  // Try src/<modPath>
  if (ctx.fileSet.has(`src/${modPath}.py`)) return `src/${modPath}.py`;
  if (ctx.fileSet.has(`src/${modPath}/__init__.py`)) return `src/${modPath}/__init__.py`;

  return undefined;
}

function resolveGoImport(specifier: string, ctx: ResolverContext): string[] {
  if (!ctx.goModule || !specifier.startsWith(ctx.goModule)) return [];
  const sub = specifier.slice(ctx.goModule.length).replace(/^\/+/, '');
  const matches: string[] = [];
  for (const filePath of ctx.fileSet) {
    if (!filePath.endsWith('.go') || filePath.endsWith('_test.go')) continue;
    const dir = path.posix.dirname(filePath);
    if ((sub === '' && dir === '.') || dir === sub) {
      matches.push(filePath);
    }
  }
  return matches;
}

function resolveRustImport(
  fromFile: string,
  specifier: string,
  ctx: ResolverContext,
): string | undefined {
  const fromDir = path.posix.dirname(fromFile);
  if (specifier.startsWith('crate::')) {
    const modPath =
      specifier.slice('crate::'.length).split('::').slice(0, -1).join('/') ||
      specifier.slice('crate::'.length).replace(/::/g, '/');
    const fullPath = specifier.slice('crate::'.length).replace(/::/g, '/');
    for (const candidate of [
      `src/${fullPath}.rs`,
      `src/${fullPath}/mod.rs`,
      `src/${modPath}.rs`,
      `src/${modPath}/mod.rs`,
    ]) {
      if (ctx.fileSet.has(candidate)) return candidate;
    }
  } else if (specifier.startsWith('super::') || specifier.startsWith('self::')) {
    const clean = specifier
      .replace(/^self::/, '')
      .replace(/^super::/, '../')
      .replace(/::/g, '/');
    const base = path.posix.normalize(path.posix.join(fromDir, clean));
    if (ctx.fileSet.has(`${base}.rs`)) return `${base}.rs`;
    if (ctx.fileSet.has(`${base}/mod.rs`)) return `${base}/mod.rs`;
  } else if (!specifier.includes('::')) {
    // `mod foo;`
    for (const candidate of [
      path.posix.join(fromDir, `${specifier}.rs`),
      path.posix.join(fromDir, specifier, 'mod.rs'),
    ]) {
      if (ctx.fileSet.has(candidate)) return candidate;
    }
  }
  return undefined;
}

function resolveJavaImport(specifier: string, ctx: ResolverContext): string | undefined {
  if (specifier.endsWith('.*')) return undefined;
  const rel = `${specifier.replace(/\./g, '/')}.java`;
  if (ctx.fileSet.has(rel)) return rel;
  const parts = rel.split('/');
  const suffix = parts.slice(-Math.min(4, parts.length)).join('/');
  const candidates = ctx.filesBySuffix.get(suffix);
  if (candidates) {
    return candidates.find((c) => c.endsWith(rel));
  }
  return undefined;
}

function resolveImportTargets(file: ParsedFile, specifier: string, ctx: ResolverContext): string[] {
  switch (file.language) {
    case 'typescript':
    case 'tsx':
    case 'javascript': {
      const target = resolveTsJsImport(file.path, specifier, ctx);
      return target ? [target] : [];
    }
    case 'python': {
      const target = resolvePythonImport(file.path, specifier, ctx);
      return target ? [target] : [];
    }
    case 'go':
      return resolveGoImport(specifier, ctx);
    case 'rust': {
      const target = resolveRustImport(file.path, specifier, ctx);
      return target ? [target] : [];
    }
    case 'java': {
      const target = resolveJavaImport(specifier, ctx);
      return target ? [target] : [];
    }
    default: {
      if (specifier.startsWith('.')) {
        const target = resolveTsJsImport(file.path, specifier, ctx);
        return target ? [target] : [];
      }
      return [];
    }
  }
}

/**
 * Build internal dependency graph, resolve internal imports, compute fan-in/fan-out,
 * and detect dependency cycles.
 */
export function buildDependencyGraph(
  files: Record<string, ParsedFile>,
  rawContents?: Map<string, string>,
): GraphResult {
  const ctx = buildResolverContext(files, rawContents);
  const graph: Record<string, FileGraphMetrics> = {};

  for (const filePath of Object.keys(files)) {
    graph[filePath] = {
      fanIn: 0,
      fanOut: 0,
      importedBy: [],
      imports: [],
    };
  }

  for (const file of Object.values(files)) {
    const outSet = new Set<string>();
    for (const imp of file.imports) {
      const targets = resolveImportTargets(file, imp.specifier, ctx);
      if (targets.length > 0) {
        imp.resolvedPath = targets[0];
        for (const t of targets) {
          if (t !== file.path) {
            outSet.add(t);
          }
        }
      }
    }

    const sortedOut = Array.from(outSet).sort();
    const node = graph[file.path]!;
    node.imports = sortedOut;
    node.fanOut = sortedOut.length;

    for (const target of sortedOut) {
      const targetNode = graph[target];
      if (targetNode) {
        targetNode.importedBy.push(file.path);
      }
    }
  }

  for (const node of Object.values(graph)) {
    node.importedBy.sort();
    node.fanIn = node.importedBy.length;
  }

  const cycles = detectCycles(graph);
  return { graph, cycles };
}

function detectCycles(graph: Record<string, FileGraphMetrics>, maxCycles = 50): string[][] {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;

  const color = new Map<string, number>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seenSignatures = new Set<string>();

  function dfs(u: string): void {
    if (cycles.length >= maxCycles) return;
    color.set(u, GRAY);
    stack.push(u);

    const neighbors = graph[u]?.imports ?? [];
    for (const v of neighbors) {
      if (cycles.length >= maxCycles) break;
      const vColor = color.get(v) ?? WHITE;
      if (vColor === GRAY) {
        const idx = stack.indexOf(v);
        if (idx !== -1) {
          const cycle = [...stack.slice(idx), v];
          // Canonicalize cycle signature to avoid duplicates
          const core = cycle.slice(0, -1);
          const minIdx = core.reduce((best, cur, i, arr) => (cur < arr[best]! ? i : best), 0);
          const rotated = [...core.slice(minIdx), ...core.slice(0, minIdx)];
          const sig = rotated.join('->');
          if (!seenSignatures.has(sig)) {
            seenSignatures.add(sig);
            cycles.push(cycle);
          }
        }
      } else if (vColor === WHITE) {
        dfs(v);
      }
    }

    stack.pop();
    color.set(u, BLACK);
  }

  for (const node of Object.keys(graph).sort()) {
    if ((color.get(node) ?? WHITE) === WHITE) {
      dfs(node);
    }
  }

  return cycles;
}
