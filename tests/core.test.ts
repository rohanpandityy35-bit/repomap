import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  estimateTokens,
  findSymbolsOrFiles,
  generateMap,
  getDeps,
  getImpact,
  getOverview,
} from '../src/index.js';

const tempDirs: string[] = [];

async function makeTempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), `repomap-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

describe('repomap core - TypeScript fixture', () => {
  it('scans, parses, builds graph, detects entry points, and supports incremental cache', async () => {
    const repo = await makeTempRepo('ts');
    await mkdir(path.join(repo, 'src', 'utils'), { recursive: true });
    await mkdir(path.join(repo, 'src', 'services'), { recursive: true });
    await mkdir(path.join(repo, 'node_modules', 'pkg'), { recursive: true });

    await writeFile(path.join(repo, '.gitignore'), 'ignored.ts\n');
    await writeFile(path.join(repo, 'ignored.ts'), 'export const secret = 1;\n');
    await writeFile(path.join(repo, 'package-lock.json'), '{"lockfileVersion": 3}\n');
    await writeFile(path.join(repo, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1;\n');

    await writeFile(
      path.join(repo, 'package.json'),
      JSON.stringify({
        name: 'ts-fixture',
        main: './dist/index.js',
        bin: { 'ts-cli': './dist/index.js' },
        scripts: { start: 'node dist/index.js' },
      }),
    );

    await writeFile(
      path.join(repo, 'src', 'utils', 'math.ts'),
      `export function add(a: number, b: number): number {
  return a + b;
}

export interface Point {
  x: number;
  y: number;
}
`,
    );

    await writeFile(
      path.join(repo, 'src', 'services', 'calc.ts'),
      `import { add } from '../utils/math.js';

export class Calculator {
  sum(a: number, b: number): number {
    return add(a, b);
  }
}
`,
    );

    await writeFile(
      path.join(repo, 'src', 'index.ts'),
      `import { Calculator } from './services/calc.js';
import { add } from './utils/math.js';

export function main(): number {
  const c = new Calculator();
  return c.sum(1, add(2, 3));
}
`,
    );

    // First run
    const res1 = await generateMap(repo);
    expect(res1.map.stats.totalFiles).toBe(5); // .gitignore + package.json + 3 ts files
    expect(res1.map.files['ignored.ts']).toBeUndefined();
    expect(res1.map.files['package-lock.json']).toBeUndefined();
    expect(res1.reparsedFiles).toBe(5);
    expect(res1.cachedFiles).toBe(0);
    expect(res1.gitignoreSuggested).toBe(true);

    // Graph fan-in check: math.ts is imported by calc.ts and index.ts
    expect(res1.map.graph['src/utils/math.ts']?.fanIn).toBe(2);
    expect(res1.map.graph['src/services/calc.ts']?.fanIn).toBe(1);
    expect(res1.map.cycles.length).toBe(0);

    // Entry points check
    expect(res1.map.entryPoints.some((e) => e.path === 'src/index.ts')).toBe(true);
    expect(res1.map.entryPoints.some((e) => e.reason.includes('package.json'))).toBe(true);

    // Symbols check
    const mathSyms = res1.map.files['src/utils/math.ts']?.symbols.map((s) => s.name) ?? [];
    expect(mathSyms).toContain('add');
    expect(mathSyms).toContain('Point');

    // Second run without changes -> 100% cached
    const res2 = await generateMap(repo);
    expect(res2.cachedFiles).toBe(5);
    expect(res2.reparsedFiles).toBe(0);

    // Modify 1 file -> only 1 reparsed
    await writeFile(
      path.join(repo, 'src', 'utils', 'math.ts'),
      `export function add(a: number, b: number): number { return a + b; }\nexport function sub(a: number, b: number): number { return a - b; }\n`,
    );
    const res3 = await generateMap(repo);
    expect(res3.reparsedFiles).toBe(1);
    expect(res3.cachedFiles).toBe(4);

    // Query functions
    const overview = await getOverview(repo);
    expect(overview).toContain('Entry Points');
    expect(overview).toContain('src/utils');

    const found = await findSymbolsOrFiles(repo, 'Calculator');
    expect(found).toContain('src/services/calc.ts');

    const deps = await getDeps(repo, 'src/utils/math.ts', 'in', 2);
    expect(deps).toContain('src/services/calc.ts');
    expect(deps).toContain('src/index.ts');

    const impact = await getImpact(repo, 'src/utils/math.ts');
    expect(impact).toContain('src/index.ts');
    expect(impact).toContain('HIGH'); // affects entry point src/index.ts

    // Budget truncation
    const budgeted = await generateMap(repo, { budget: 120 });
    expect(estimateTokens(budgeted.output)).toBeLessThanOrEqual(160);
  }, 30000);

  it('detects dependency cycles', async () => {
    const repo = await makeTempRepo('cycles');
    await writeFile(
      path.join(repo, 'a.ts'),
      `import { b } from './b.js'; export const a = () => b();\n`,
    );
    await writeFile(
      path.join(repo, 'b.ts'),
      `import { a } from './a.js'; export const b = () => a();\n`,
    );

    const res = await generateMap(repo);
    expect(res.map.cycles.length).toBe(1);
    expect(res.map.stats.cycleCount).toBe(1);
    expect(res.output).toContain('Dependency Cycles');
  });
});

describe('repomap core - Python fixture', () => {
  it('parses Python modules, relative imports, and pyproject entry points', async () => {
    const repo = await makeTempRepo('py');
    await mkdir(path.join(repo, 'core'), { recursive: true });

    await writeFile(
      path.join(repo, 'pyproject.toml'),
      `[project]\nname = "py-fixture"\n\n[project.scripts]\nrun-app = "app:main"\n`,
    );
    await writeFile(path.join(repo, 'core', '__init__.py'), '');
    await writeFile(
      path.join(repo, 'core', 'engine.py'),
      `class Engine:\n    def run(self):\n        return True\n\ndef helper(x: int) -> int:\n    return x + 1\n`,
    );
    await writeFile(
      path.join(repo, 'app.py'),
      `from core.engine import Engine\n\ndef main():\n    return Engine().run()\n`,
    );

    const res = await generateMap(repo);
    expect(res.map.graph['core/engine.py']?.fanIn).toBe(1);
    expect(res.map.files['core/engine.py']?.symbols.map((s) => s.name)).toContain('Engine');
    expect(res.map.entryPoints.some((e) => e.path === 'app.py')).toBe(true);
    expect(res.map.entryPoints.some((e) => e.reason.includes('pyproject'))).toBe(true);
  });
});

describe('repomap core - Go fixture', () => {
  it('parses Go packages, internal imports, structs, and main.go entry point', async () => {
    const repo = await makeTempRepo('go');
    await mkdir(path.join(repo, 'internal', 'store'), { recursive: true });

    await writeFile(path.join(repo, 'go.mod'), 'module example.com/mygo\n\ngo 1.22\n');
    await writeFile(
      path.join(repo, 'internal', 'store', 'store.go'),
      `package store\n\ntype Store struct {\n\tName string\n}\n\nfunc NewStore(name string) *Store {\n\treturn &Store{Name: name}\n}\n`,
    );
    await writeFile(
      path.join(repo, 'main.go'),
      `package main\n\nimport (\n\t"fmt"\n\t"example.com/mygo/internal/store"\n)\n\nfunc main() {\n\ts := store.NewStore("demo")\n\tfmt.Println(s.Name)\n}\n`,
    );

    const res = await generateMap(repo);
    expect(res.map.graph['internal/store/store.go']?.fanIn).toBe(1);
    expect(res.map.files['internal/store/store.go']?.symbols.map((s) => s.name)).toContain('Store');
    expect(res.map.files['internal/store/store.go']?.symbols.map((s) => s.name)).toContain(
      'NewStore',
    );
    expect(res.map.entryPoints.some((e) => e.path === 'main.go')).toBe(true);
  });
});
