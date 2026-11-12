#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function main() {
  const cwd = process.cwd();
  const distEntry = path.resolve(import.meta.dirname, '..', 'dist', 'index.js');

  try {
    if (existsSync(distEntry)) {
      const { generateMap, getGitHead, isCacheStale } = await import(distEntry);
      const gitHead = await getGitHead(cwd);
      const stale = await isCacheStale(cwd, gitHead);
      if (stale) {
        await generateMap(cwd);
      }
      return;
    }

    // Fallback when running from plugin cache without local build:
    // Refresh silently via npx if .repomap/map.json is missing or >24h old
    const mapJson = path.join(cwd, '.repomap', 'map.json');
    let needsRefresh = !existsSync(mapJson);
    if (!needsRefresh) {
      const { stat } = await import('node:fs/promises');
      const s = await stat(mapJson);
      if (Date.now() - s.mtimeMs > 24 * 60 * 60 * 1000) {
        needsRefresh = true;
      }
    }

    if (needsRefresh) {
      await execFileAsync('npx', ['-y', '--package=mcp-repomap', 'repomap', 'generate', cwd], {
        cwd,
        timeout: 30000,
      });
    }
  } catch {
    // SessionStart hook must fail silently so it never blocks session startup.
  }
}

main();
