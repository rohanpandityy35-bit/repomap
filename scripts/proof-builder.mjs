import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';

async function buildFeatureWithMcp() {
  const client = new Client({ name: 'feature-builder', version: '1.0.0' }, { capabilities: {} });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('./dist/mcp/server.js')],
    }),
  );

  console.log('🤖 AGENT WORKFLOW: Using repomap MCP to safely inspect before coding...\n');

  // 1. Locate symbol
  const findRes = await client.callTool({
    name: 'repomap_find',
    arguments: { path: '.', query: 'formatRepoMap' },
  });
  console.log('1. [repomap_find result]:\n' + findRes.content[0].text + '\n');

  // 2. Check impact of touching formatter.ts
  const impactRes = await client.callTool({
    name: 'repomap_impact',
    arguments: { path: '.', file: 'src/core/formatter.ts' },
  });
  console.log('2. [repomap_impact result]:\n' + impactRes.content[0].text + '\n');

  // 3. Generate Mermaid diagram using repomap_generate
  const mmdRes = await client.callTool({
    name: 'repomap_generate',
    arguments: { path: '.', format: 'mermaid' },
  });
  const mermaidGraph = mmdRes.content[0].text;
  console.log('3. [repomap_generate (mermaid) result]:\n' + mermaidGraph + '\n');

  // 4. Build a visual standalone HTML dashboard using this MCP output
  const overviewRes = await client.callTool({
    name: 'repomap_overview',
    arguments: { path: '.' },
  });
  const overviewText = overviewRes.content[0].text;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>repomap Live Architecture Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  <script>mermaid.initialize({ startOnLoad: true, theme: 'dark' });</script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1117; color: #e6edf3; margin: 0; padding: 2rem; }
    .container { max-width: 1000px; margin: auto; }
    h1 { color: #58a6ff; }
    .badge { display: inline-block; background: #238636; color: white; padding: 4px 10px; border-radius: 12px; font-size: 0.85rem; font-weight: bold; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1.5rem; margin-top: 1.5rem; }
    pre { background: #0d1117; padding: 1rem; border-radius: 6px; overflow-x: auto; color: #7ee787; font-size: 0.9rem; }
    .mermaid { background: #0d1117; padding: 1.5rem; border-radius: 8px; margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🗺️ repomap Live Architecture Dashboard</h1>
    <span class="badge">Generated via repomap MCP Server</span>
    <div class="card">
      <h2>System Architecture Diagram</h2>
      <div class="mermaid">
${mermaidGraph}
      </div>
    </div>
    <div class="card">
      <h2>Live Overview & Hot Files</h2>
      <pre>${overviewText.replace(/</g, '&lt;')}</pre>
    </div>
  </div>
</body>
</html>`;

  await mkdir('docs', { recursive: true });
  await writeFile('docs/dashboard.html', html, 'utf8');
  console.log('4. [SUCCESS] Built docs/dashboard.html verified by repomap MCP output!');

  await client.close();
}

buildFeatureWithMcp().catch((e) => {
  console.error(e);
  process.exit(1);
});
