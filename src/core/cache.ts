import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CacheData, ParsedFile } from './types.js';

export const REPOMAP_DIR = '.repomap';
export const CACHE_JSON_FILE = 'map.json';
export const CACHE_MD_FILE = 'REPOMAP.md';
export const CACHE_SCHEMA_VERSION = '0.1.0';

export function getRepomapDir(repoPath: string): string {
  return path.join(path.resolve(repoPath), REPOMAP_DIR);
}

/**
 * Load cached parsed files from .repomap/map.json if present and compatible.
 */
export async function loadCache(repoPath: string): Promise<CacheData | null> {
  const cachePath = path.join(getRepomapDir(repoPath), CACHE_JSON_FILE);
  try {
    const raw = await readFile(cachePath, 'utf8');
    const data = JSON.parse(raw) as CacheData;
    if (!data || data.version !== CACHE_SCHEMA_VERSION || !data.files) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Save parsed file cache and rendered REPOMAP.md into .repomap/.
 */
export async function saveCache(
  repoPath: string,
  cacheData: CacheData,
  markdownOutput: string,
): Promise<void> {
  const dir = getRepomapDir(repoPath);
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeFile(path.join(dir, CACHE_JSON_FILE), JSON.stringify(cacheData, null, 2), 'utf8'),
    writeFile(path.join(dir, CACHE_MD_FILE), markdownOutput, 'utf8'),
  ]);
}

/**
 * Check whether .repomap/ is already ignored in the repository's .gitignore.
 */
export async function isRepomapGitignored(repoPath: string): Promise<boolean> {
  try {
    const raw = await readFile(path.join(path.resolve(repoPath), '.gitignore'), 'utf8');
    return raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .some(
        (l) => l === '.repomap' || l === '.repomap/' || l === '/.repomap' || l === '/.repomap/',
      );
  } catch {
    return false;
  }
}

/**
 * Check if the cached map is stale (> maxAgeMs or git HEAD changed).
 */
export async function isCacheStale(
  repoPath: string,
  currentGitHead?: string,
  maxAgeMs = 24 * 60 * 60 * 1000,
): Promise<boolean> {
  const cachePath = path.join(getRepomapDir(repoPath), CACHE_JSON_FILE);
  try {
    const s = await stat(cachePath);
    if (Date.now() - s.mtimeMs > maxAgeMs) {
      return true;
    }
    const cache = await loadCache(repoPath);
    if (!cache) return true;
    if (currentGitHead && cache.gitHead && cache.gitHead !== currentGitHead) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

export function partitionIncrementalFiles(
  scannedHashes: Map<string, string>,
  cache: CacheData | null,
): { unchanged: Record<string, ParsedFile>; toParse: string[] } {
  const unchanged: Record<string, ParsedFile> = {};
  const toParse: string[] = [];

  for (const [filePath, hash] of scannedHashes.entries()) {
    const cached = cache?.files[filePath];
    if (cached && cached.hash === hash) {
      unchanged[filePath] = cached;
    } else {
      toParse.push(filePath);
    }
  }

  return { unchanged, toParse };
}
