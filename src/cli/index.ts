#!/usr/bin/env node
import { Command } from 'commander';
import {
  DEFAULT_TOKEN_BUDGET,
  findSymbolsOrFiles,
  generateMap,
  getDeps,
  getImpact,
  getOverview,
  type OutputFormat,
} from '../index.js';

const program = new Command();

program
  .name('repomap')
  .description('Generate a compact, cached codebase map for AI agents and developers')
  .version('0.1.0');

program
  .command('generate [path]')
  .description('Build or refresh the repository map')
  .option('-b, --budget <tokens>', 'Target token budget', String(DEFAULT_TOKEN_BUDGET))
  .option('-f, --format <format>', 'Output format: markdown, json, mermaid', 'markdown')
  .option('--force', 'Ignore cache and re-parse all files', false)
  .option('--no-cache', 'Do not read or write .repomap/ cache')
  .action(
    async (
      repoPath = '.',
      opts: { budget: string; format: string; force: boolean; cache: boolean },
    ) => {
      const budget = Number.parseInt(opts.budget, 10);
      if (Number.isNaN(budget) || budget <= 0) {
        console.error(`Invalid budget: ${opts.budget}`);
        process.exitCode = 1;
        return;
      }
      const format = opts.format as OutputFormat;
      if (!['markdown', 'json', 'mermaid'].includes(format)) {
        console.error(`Invalid format: ${opts.format}. Expected markdown, json, or mermaid.`);
        process.exitCode = 1;
        return;
      }

      const result = await generateMap(repoPath, {
        budget,
        format,
        force: opts.force,
        noCache: !opts.cache,
      });
      console.log(result.output);
    },
  );

program
  .command('overview [path]')
  .description('Show architecture summary and entry points')
  .action(async (repoPath = '.') => {
    const out = await getOverview(repoPath);
    console.log(out);
  });

program
  .command('find <query> [path]')
  .description('Find symbols or files matching a query')
  .action(async (query: string, repoPath = '.') => {
    const out = await findSymbolsOrFiles(repoPath, query);
    console.log(out);
  });

program
  .command('deps <file> [path]')
  .description('Inspect dependency neighborhood of a file')
  .option('-d, --direction <dir>', 'Direction: in, out, both', 'both')
  .option('--depth <n>', 'Traversal depth', '1')
  .action(async (file: string, repoPath = '.', opts: { direction: string; depth: string }) => {
    const dir = opts.direction as 'in' | 'out' | 'both';
    if (!['in', 'out', 'both'].includes(dir)) {
      console.error(`Invalid direction: ${opts.direction}. Expected in, out, or both.`);
      process.exitCode = 1;
      return;
    }
    const depth = Number.parseInt(opts.depth, 10) || 1;
    const out = await getDeps(repoPath, file, dir, depth);
    console.log(out);
  });

program
  .command('impact <file> [path]')
  .description('Analyze what could break if a file changes')
  .action(async (file: string, repoPath = '.') => {
    const out = await getImpact(repoPath, file);
    console.log(out);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
