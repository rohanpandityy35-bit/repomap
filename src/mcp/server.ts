#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  DEFAULT_TOKEN_BUDGET,
  findSymbolsOrFiles,
  generateMap,
  getDeps,
  getImpact,
  getOverview,
} from '../index.js';

export function createRepomapMcpServer(): McpServer {
  const server = new McpServer({
    name: 'repomap',
    version: '0.1.0',
  });

  server.tool(
    'repomap_generate',
    'Build or incrementally refresh a compact, token-efficient codebase map (architecture, entry points, hot files, key symbols).',
    {
      path: z.string().describe('Absolute or relative path to the repository root'),
      budget: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(`Target token budget (default: ${DEFAULT_TOKEN_BUDGET})`),
      format: z
        .enum(['markdown', 'json', 'mermaid'])
        .optional()
        .describe('Output format (default: markdown)'),
    },
    async ({ path: repoPath, budget, format }) => {
      try {
        const result = await generateMap(repoPath, {
          budget: budget ?? DEFAULT_TOKEN_BUDGET,
          format: format ?? 'markdown',
        });
        return {
          content: [{ type: 'text', text: result.output }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    },
  );

  server.tool(
    'repomap_overview',
    'Get a concise architecture overview, entry points, and top hot files for a repository.',
    {
      path: z.string().describe('Path to the repository root'),
    },
    async ({ path: repoPath }) => {
      try {
        const text = await getOverview(repoPath);
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    },
  );

  server.tool(
    'repomap_find',
    'Find symbols (functions, classes, types, structs) and files matching a query.',
    {
      path: z.string().describe('Path to the repository root'),
      query: z.string().describe('Search query for symbol name, signature, or file path'),
    },
    async ({ path: repoPath, query }) => {
      try {
        const text = await findSymbolsOrFiles(repoPath, query);
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    },
  );

  server.tool(
    'repomap_deps',
    'Inspect the internal dependency neighborhood (incoming, outgoing, or both) of a file.',
    {
      path: z.string().describe('Path to the repository root'),
      file: z.string().describe('Relative file path within the repository'),
      direction: z
        .enum(['in', 'out', 'both'])
        .default('both')
        .describe('Dependency direction: in (importers), out (imports), or both'),
      depth: z.number().int().min(1).max(5).optional().describe('Traversal depth (default: 1)'),
    },
    async ({ path: repoPath, file, direction, depth }) => {
      try {
        const text = await getDeps(repoPath, file, direction, depth ?? 1);
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    },
  );

  server.tool(
    'repomap_impact',
    'Analyze the blast radius (direct/transitive dependents, affected modules, entry points) if a file changes.',
    {
      path: z.string().describe('Path to the repository root'),
      file: z.string().describe('Relative file path within the repository'),
    },
    async ({ path: repoPath, file }) => {
      try {
        const text = await getImpact(repoPath, file);
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    },
  );

  return server;
}

async function main(): Promise<void> {
  const server = createRepomapMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only start stdio transport when executed directly as a binary
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('server.js') || process.argv[1].endsWith('mcp-repomap'));

if (isDirectRun) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
