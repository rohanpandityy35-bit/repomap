import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';

export interface ScannedFile {
  path: string; // POSIX relative path
  absolutePath: string;
  sizeBytes: number;
  hash: string;
  language: string;
  content: string;
}

const MAX_FILE_SIZE_BYTES = 1024 * 1024; // 1MB

const ALWAYS_IGNORED_DIRS = new Set([
  '.git',
  '.repomap',
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'coverage',
  '.cache',
  '.turbo',
  '.idea',
  '.vscode',
]);

const LOCKFILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
  'cargo.lock',
  'go.sum',
  'poetry.lock',
  'pipfile.lock',
  'gemfile.lock',
  'composer.lock',
  'shrinkwrap.yaml',
  'npm-shrinkwrap.json',
]);

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.bmp',
  '.tiff',
  '.svgz',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.xz',
  '.7z',
  '.rar',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.o',
  '.a',
  '.lib',
  '.wasm',
  '.pyc',
  '.pyo',
  '.class',
  '.jar',
  '.war',
  '.mp3',
  '.mp4',
  '.wav',
  '.ogg',
  '.webm',
  '.avi',
  '.mov',
  '.sqlite',
  '.db',
  '.lock',
]);

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.pyw': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.scala': 'scala',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.sql': 'sql',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
};

export function detectLanguage(filePath: string): string {
  const base = path.basename(filePath).toLowerCase();
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile';
  if (base === 'makefile') return 'makefile';
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext] ?? 'other';
}

function isBinaryBuffer(buf: Buffer): boolean {
  const checkLen = Math.min(buf.length, 8192);
  for (let i = 0; i < checkLen; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

async function loadGitignore(dirPath: string): Promise<string | null> {
  try {
    return await readFile(path.join(dirPath, '.gitignore'), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Walk a repository directory respecting .gitignore and skipping binaries,
 * lockfiles, build artifacts, and files larger than 1MB.
 */
export async function scanRepository(repoPath: string): Promise<ScannedFile[]> {
  const root = path.resolve(repoPath);
  const results: ScannedFile[] = [];

  async function walk(
    currentDir: string,
    igStack: Array<{ baseRel: string; ig: Ignore }>,
  ): Promise<void> {
    const dirRel = path.relative(root, currentDir).replace(/\\/g, '/');
    const gitignoreContent = await loadGitignore(currentDir);
    let nextStack = igStack;
    if (gitignoreContent !== null) {
      const ig = ignore().add(gitignoreContent);
      nextStack = [...igStack, { baseRel: dirRel, ig }];
    }

    const entries = await readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const nameLower = entry.name.toLowerCase();
      const absPath = path.join(currentDir, entry.name);
      const relPosix = path.relative(root, absPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (ALWAYS_IGNORED_DIRS.has(entry.name) || ALWAYS_IGNORED_DIRS.has(nameLower)) {
          continue;
        }
        if (isIgnored(relPosix + '/', nextStack)) {
          continue;
        }
        await walk(absPath, nextStack);
        continue;
      }

      if (!entry.isFile()) continue;

      if (LOCKFILES.has(nameLower)) continue;
      if (isIgnored(relPosix, nextStack)) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) continue;

      let fileStat;
      try {
        fileStat = await stat(absPath);
      } catch {
        continue;
      }

      if (fileStat.size > MAX_FILE_SIZE_BYTES) continue;

      let buf: Buffer;
      try {
        buf = await readFile(absPath);
      } catch {
        continue;
      }

      if (isBinaryBuffer(buf)) continue;

      const hash = createHash('sha256').update(buf).digest('hex');
      const content = buf.toString('utf8');

      results.push({
        path: relPosix,
        absolutePath: absPath,
        sizeBytes: fileStat.size,
        hash,
        language: detectLanguage(relPosix),
        content,
      });
    }
  }

  await walk(root, []);
  return results;
}

function isIgnored(relPosix: string, stack: Array<{ baseRel: string; ig: Ignore }>): boolean {
  for (const { baseRel, ig } of stack) {
    const relToBase = baseRel ? relPosix.slice(baseRel.length + 1) : relPosix;
    if (!relToBase) continue;
    if (ig.ignores(relToBase)) {
      return true;
    }
  }
  return false;
}
