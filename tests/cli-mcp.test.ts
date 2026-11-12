import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function makeTempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'repomap-e2e-'));
  tempDirs.push(dir);
  await writeFile(
    path.join(dir, 'index.ts'),
    `import { helper } from './helper.js';\nexport function run() { return helper(); }\n`,
  );
  await writeFile(
    path.join(dir, 'helper.ts'),
    `export function helper(): string { return 'ok'; }\n`,
  );
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('CLI & MCP server integration', () => {
  it('runs CLI commands generate, overview, find, deps, impact', async () => {
    const repo = await makeTempRepo();
    const cliPath = path.resolve('dist/cli/index.js');

    const gen = await execFileAsync(process.execPath, [cliPath, 'generate', repo]);
    expect(gen.stdout).toContain('# RepoMap:');

    const overview = await execFileAsync(process.execPath, [cliPath, 'overview', repo]);
    expect(overview.stdout).toContain('## Entry Points');

    const find = await execFileAsync(process.execPath, [cliPath, 'find', 'helper', repo]);
    expect(find.stdout).toContain('helper.ts');

    const deps = await execFileAsync(process.execPath, [
      cliPath,
      'deps',
      'helper.ts',
      repo,
      '-d',
      'in',
    ]);
    expect(deps.stdout).toContain('index.ts');

    const impact = await execFileAsync(process.execPath, [cliPath, 'impact', 'helper.ts', repo]);
    expect(impact.stdout).toContain('Impact Analysis');
  }, 45000);

  it('exposes all 5 MCP tools over stdio', async () => {
    const repo = await makeTempRepo();
    const serverPath = path.resolve('dist/mcp/server.js');

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
    });

    const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);

    try {
      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'repomap_generate',
          'repomap_overview',
          'repomap_find',
          'repomap_deps',
          'repomap_impact',
        ]),
      );

      const genRes = await client.callTool({
        name: 'repomap_generate',
        arguments: { path: repo, format: 'markdown' },
      });
      const text = (genRes.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
      expect(text).toContain('# RepoMap:');

      const impactRes = await client.callTool({
        name: 'repomap_impact',
        arguments: { path: repo, file: 'helper.ts' },
      });
      const impactText =
        (impactRes.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
      expect(impactText).toContain('index.ts');
    } finally {
      await client.close();
    }
  }, 15000);
});
