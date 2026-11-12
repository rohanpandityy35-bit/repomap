import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Retrieve the current git HEAD commit hash, or undefined if not a git repository.
 */
export async function getGitHead(repoPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: repoPath,
      timeout: 5000,
    });
    const head = stdout.trim();
    return head || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Compute per-file commit counts over the last 90 days using local git history.
 * Returns an empty map if git is unavailable or the directory is not a git repo.
 */
export async function getGitChurn(repoPath: string, days = 90): Promise<Map<string, number>> {
  const churn = new Map<string, number>();
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', `--since=${days}.days`, '--name-only', '--pretty=format:'],
      {
        cwd: repoPath,
        timeout: 15000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    for (const rawLine of stdout.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const normalized = line.replace(/\\/g, '/');
      churn.set(normalized, (churn.get(normalized) ?? 0) + 1);
    }
  } catch {
    // Non-git repo or empty git history — gracefully return empty churn map.
  }
  return churn;
}
