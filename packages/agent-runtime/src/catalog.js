import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAgentMarkdown, resolvePackageRelativePath } from './manifest.js';

function cleanValue(value) {
  return value.trim().replace(/^["']|["']$/g, '');
}

function readText(path) {
  return readFileSync(path, 'utf8');
}

export function loadCatalog(repoRoot) {
  const text = readText(join(repoRoot, 'catalog.yaml'));
  const agents = [];
  const blocks = text.split(/\n\s*-\s+id:\s+/).slice(1);

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const agent = { id: cleanValue(lines[0]) };
    for (const line of lines.slice(1)) {
      const match = line.match(/^\s+([a-z_]+):\s*(.*)$/);
      if (!match) {
        continue;
      }
      const [, key, rawValue] = match;
      if (rawValue !== '') {
        agent[key] = cleanValue(rawValue);
      }
    }
    agents.push(agent);
  }

  return { agents };
}

export function loadAgent(repoRoot, agentId) {
  const catalog = loadCatalog(repoRoot);
  const catalogEntry = catalog.agents.find((agent) => agent.id === agentId);
  if (!catalogEntry) {
    throw new Error(`Unknown agent: ${agentId}`);
  }

  const agentPath = resolvePackageRelativePath(repoRoot, catalogEntry.path, `catalog.yaml path for ${agentId}`);
  const document = parseAgentMarkdown(readText(join(repoRoot, agentPath, 'agent.md')));
  const manifest = {
    ...catalogEntry,
    ...document.manifest,
    path: agentPath,
    documentBody: document.body
  };

  if (manifest.id !== catalogEntry.id) {
    throw new Error(`Agent id mismatch for ${catalogEntry.path}: catalog has ${catalogEntry.id}, agent.md has ${manifest.id}`);
  }

  return manifest;
}
