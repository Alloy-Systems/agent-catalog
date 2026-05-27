import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractMarkdownSection,
  parseAgentMarkdown,
  resolvePackageRelativePath
} from '../packages/agent-runtime/src/index.js';

const defaultRepoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repoRoot = process.env.ALLOYCAT_VALIDATE_ROOT
  ? resolve(process.env.ALLOYCAT_VALIDATE_ROOT)
  : defaultRepoRoot;

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
    if (id && path) {
      entries.push({ id, path });
    }
  }

  return entries;
}

function extractPromptPaths(workflowText) {
  return [...workflowText.matchAll(/\n\s+prompt:\s+(.+)/g)].map((match) => match[1].trim());
}

function cleanValue(value) {
  return value.trim().replace(/^["']|["']$/g, '');
}

function extractWorkflowId(workflowText) {
  return cleanValue(workflowText.match(/\n\s+id:\s+(.+)/)?.[1] ?? '');
}

function requireManifestField(manifest, path) {
  const value = path.split('.').reduce((current, key) => current?.[key], manifest);
  if (value === undefined || value === null || value === '') {
    fail(`Missing required agent.md frontmatter field: ${path}`);
  }
  return value;
}

function safePackagePath(basePath, candidatePath, label) {
  try {
    return resolvePackageRelativePath(basePath, candidatePath, label);
  } catch (error) {
    fail(error.message);
    return candidatePath;
  }
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
  const agentPath = safePackagePath(repoRoot, agent.path, `catalog.yaml path for ${agent.id}`);
  const agentRoot = join(repoRoot, agentPath);
  requireDirectory(agentPath);
  requireFile(`${agentPath}/agent.md`);
  requireDirectory(`${agentPath}/prompts`);
  requireDirectory(`${agentPath}/schemas`);
  requireDirectory(`${agentPath}/templates`);
  requireDirectory(`${agentPath}/adapters`);
  requireDirectory(`${agentPath}/tests`);
  requireDirectory(`${agentPath}/fixtures`);
  requireDirectory(`${agentPath}/examples`);

  const document = parseAgentMarkdown(readFileSync(join(agentRoot, 'agent.md'), 'utf8'));
  const manifest = document.manifest;
  if (manifest.id !== agent.id) {
    fail(`Agent id mismatch for ${agent.path}: catalog has ${agent.id}, agent.md has ${manifest.id}`);
  }

  for (const field of [
    'name',
    'type',
    'version',
    'status',
    'description',
    'runtime.model',
    'runtime.workflow',
    'artifacts.install_root',
    'artifacts.run_root',
    'artifacts.state_file',
    'supports.hosts'
  ]) {
    requireManifestField(manifest, field);
  }

  const includedSections = manifest.prompt_context?.include_sections;
  if (!Array.isArray(includedSections) || includedSections.length === 0) {
    fail('Missing required agent.md frontmatter field: prompt_context.include_sections');
  } else {
    for (const section of includedSections) {
      if (!extractMarkdownSection(document.body, section)) {
        fail(`Missing agent.md prompt context section: ${section}`);
      }
    }
  }

  const supportedHosts = manifest.supports?.hosts;
  if (!supportedHosts || Array.isArray(supportedHosts) || typeof supportedHosts !== 'object') {
    fail('Missing required agent.md frontmatter field: supports.hosts');
  } else {
    for (const [hostId, host] of Object.entries(supportedHosts)) {
      if (!host || typeof host !== 'object' || Array.isArray(host)) {
        fail(`Invalid host adapter entry for ${hostId}`);
        continue;
      }
      if (!host.adapter_path) {
        fail(`Missing adapter_path for host adapter: ${hostId}`);
        continue;
      }
      if (!['skeleton', 'experimental', 'stable', 'deprecated'].includes(host.status)) {
        fail(`Unsupported adapter status for ${hostId}: ${host.status}`);
      }

      const adapterPath = safePackagePath(agentRoot, host.adapter_path, `${agent.id} supports.hosts.${hostId}.adapter_path`);
      requireDirectory(`${agentPath}/${adapterPath}`);
      const adapterReadme = join(repoRoot, agentPath, adapterPath, 'README.md');
      const adapterEntry = join(repoRoot, agentPath, adapterPath, `${hostId}.md`);
      if (!existsSync(adapterReadme) && !existsSync(adapterEntry)) {
        fail(`Missing adapter README or host entry for ${hostId}: ${agentPath}/${adapterPath}`);
      }
    }
  }

  const workflowPath = safePackagePath(agentRoot, manifest.runtime.workflow, `${agent.id} runtime.workflow`);
  requireFile(`${agentPath}/${workflowPath}`);

  const workflowText = readFileSync(join(agentRoot, workflowPath), 'utf8');
  const workflowId = extractWorkflowId(workflowText);
  if (workflowId !== agent.id) {
    fail(`Workflow id differs from agent id for ${agent.id}: ${workflowId}`);
  }
  for (const promptPath of extractPromptPaths(workflowText)) {
    const safePromptPath = safePackagePath(agentRoot, promptPath, `${agent.id} workflow prompt`);
    requireFile(`${agentPath}/${safePromptPath}`);
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`Validated ${agents.length} agent.`);
