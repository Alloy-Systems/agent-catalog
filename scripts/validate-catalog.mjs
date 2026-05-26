import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function requireFile(path) {
  const fullPath = join(repoRoot, path);
  if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
    fail(`Missing required file: ${path}`);
  }
}

function requireDirectory(path) {
  const fullPath = join(repoRoot, path);
  if (!existsSync(fullPath) || !statSync(fullPath).isDirectory()) {
    fail(`Missing required directory: ${path}`);
  }
}

function extractAgentEntries(catalogText) {
  const entries = [];
  const blocks = catalogText.split(/\n\s*-\s+id:\s+/).slice(1);

  for (const block of blocks) {
    const id = block.split(/\r?\n/, 1)[0]?.trim();
    const path = block.match(/\n\s+path:\s+(.+)/)?.[1]?.trim();
    const status = block.match(/\n\s+status:\s+(.+)/)?.[1]?.trim();
    const version = block.match(/\n\s+version:\s+(.+)/)?.[1]?.trim();
    if (id && path && status && version) {
      entries.push({ id, path, status, version });
    }
  }

  return entries;
}

function extractPromptPaths(workflowText) {
  return [...workflowText.matchAll(/\n\s+prompt:\s+(.+)/g)].map((match) => match[1].trim());
}

requireFile('catalog.yaml');
requireFile('README.md');
requireFile('package.json');

const catalogText = readFileSync(join(repoRoot, 'catalog.yaml'), 'utf8');
const agents = extractAgentEntries(catalogText);

if (agents.length === 0) {
  fail('catalog.yaml must list at least one agent.');
}

for (const agent of agents) {
  requireDirectory(agent.path);
  requireFile(`${agent.path}/agent.yaml`);
  requireFile(`${agent.path}/README.md`);
  requireFile(`${agent.path}/workflow.yaml`);
  requireDirectory(`${agent.path}/prompts`);
  requireDirectory(`${agent.path}/schemas`);
  requireDirectory(`${agent.path}/templates`);
  requireDirectory(`${agent.path}/adapters`);
  requireDirectory(`${agent.path}/tests`);
  requireDirectory(`${agent.path}/fixtures`);
  requireDirectory(`${agent.path}/examples`);

  const workflowText = readFileSync(join(repoRoot, agent.path, 'workflow.yaml'), 'utf8');
  for (const promptPath of extractPromptPaths(workflowText)) {
    requireFile(`${agent.path}/${promptPath}`);
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`Validated ${agents.length} agent.`);
