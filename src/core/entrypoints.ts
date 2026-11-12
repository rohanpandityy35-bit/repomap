import path from 'node:path';
import type { EntryPoint, ParsedFile } from './types.js';

/**
 * Detect repository entry points from package.json, pyproject.toml, standard
 * main/index/app/server files, Dockerfiles, and CI workflows.
 */
export function detectEntryPoints(
  files: Record<string, ParsedFile>,
  rawContents: Map<string, string>,
): EntryPoint[] {
  const entryPoints: EntryPoint[] = [];
  const seen = new Set<string>();

  const add = (ep: EntryPoint): void => {
    const key = `${ep.path}::${ep.reason}::${ep.command ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      entryPoints.push(ep);
    }
  };

  // 1. package.json
  const pkgRaw = rawContents.get('package.json');
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as {
        main?: string;
        module?: string;
        bin?: string | Record<string, string>;
        scripts?: Record<string, string>;
      };
      if (pkg.main) {
        add({ path: normalizeRel(pkg.main), reason: 'package.json main' });
      }
      if (pkg.module && pkg.module !== pkg.main) {
        add({ path: normalizeRel(pkg.module), reason: 'package.json module' });
      }
      if (typeof pkg.bin === 'string') {
        add({ path: normalizeRel(pkg.bin), reason: 'package.json bin' });
      } else if (pkg.bin && typeof pkg.bin === 'object') {
        for (const [binName, binPath] of Object.entries(pkg.bin)) {
          add({ path: normalizeRel(binPath), reason: `package.json bin (${binName})` });
        }
      }
      if (pkg.scripts) {
        for (const key of ['start', 'dev', 'serve', 'build']) {
          if (pkg.scripts[key]) {
            add({
              path: 'package.json',
              reason: `npm script "${key}"`,
              command: pkg.scripts[key],
            });
          }
        }
      }
    } catch {
      // Ignore malformed package.json
    }
  }

  // 2. pyproject.toml
  const pyprojectRaw = rawContents.get('pyproject.toml');
  if (pyprojectRaw) {
    const scriptSection = pyprojectRaw.match(
      /\[(?:project\.scripts|tool\.poetry\.scripts)\]([\s\S]*?)(?:\n\[|$)/,
    );
    if (scriptSection?.[1]) {
      for (const line of scriptSection[1].split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*["']([^"']+)["']/);
        if (m?.[1] && m[2]) {
          add({
            path: 'pyproject.toml',
            reason: `pyproject script "${m[1]}"`,
            command: m[2],
          });
        }
      }
    }
  }

  // 3. Standard entry point filenames
  for (const filePath of Object.keys(files).sort()) {
    const base = path.posix.basename(filePath);
    const dir = path.posix.dirname(filePath);

    if (filePath === 'main.go' || /^cmd\/[^/]+\/main\.go$/.test(filePath)) {
      add({ path: filePath, reason: 'Go main package' });
    } else if (filePath === 'src/main.rs' || filePath === 'src/lib.rs') {
      add({ path: filePath, reason: 'Rust crate root' });
    } else if (
      (dir === '.' || dir === 'src') &&
      /^(index|app|server|main)\.(ts|tsx|js|jsx|mjs|py)$/.test(base)
    ) {
      add({ path: filePath, reason: 'Standard entry file' });
    } else if (base === '__main__.py') {
      add({ path: filePath, reason: 'Python module entry' });
    }
  }

  // 4. Dockerfile CMD / ENTRYPOINT
  for (const [filePath, content] of rawContents.entries()) {
    const base = path.posix.basename(filePath).toLowerCase();
    if (base === 'dockerfile' || base.startsWith('dockerfile.')) {
      for (const line of content.split(/\r?\n/)) {
        const m = line.match(/^\s*(CMD|ENTRYPOINT)\s+(.+)$/i);
        if (m?.[1] && m[2]) {
          add({
            path: filePath,
            reason: `Docker ${m[1].toUpperCase()}`,
            command: m[2].trim(),
          });
        }
      }
    }
  }

  // 5. CI workflows (.github/workflows/*.yml|yaml)
  for (const filePath of Object.keys(files).sort()) {
    if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(filePath)) {
      add({ path: filePath, reason: 'GitHub Actions workflow' });
    }
  }

  return entryPoints;
}

function normalizeRel(p: string): string {
  return p.replace(/^\.\//, '').replace(/\\/g, '/');
}
