import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadAgent } from './catalog.js';

function findUp(startPath, marker) {
  let current = resolve(startPath);

  while (true) {
    if (existsSync(resolve(current, marker))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function requireDirectory(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} does not exist: ${path}`);
  }
  if (!statSync(path).isDirectory()) {
    throw new Error(`${label} is not a directory: ${path}`);
  }
}

function writeInstallReadme(projectRoot) {
  const readmePath = join(projectRoot, '.alloycat', 'README.md');
  if (existsSync(readmePath)) {
    return;
  }

  writeFileSync(readmePath, [
    '# Alloycat',
    '',
    'This project has local Alloy Agent Catalog install configuration.',
    '',
    'Local install metadata is written under `.alloycat/` and run artifacts are written under `.agent-runs/`.',
    'Both paths are ignored by git for linked installs.',
    ''
  ].join('\n'));
}

function ensureGitignoreEntry(projectRoot) {
  const gitignorePath = join(projectRoot, '.gitignore');
  const entries = ['.agent-runs/', '.alloycat/'];
  const requiredEntries = entries.map((entry) => ({
    entry,
    key: entry.replace(/^\/+/, '').replace(/\/+$/, '')
  }));

  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, `${entries.join('\n')}\n`);
    return 'added';
  }

  const current = readFileSync(gitignorePath, 'utf8');
  const existingEntries = new Set(current
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\/+/, '').replace(/\/+$/, '')));
  const missingEntries = requiredEntries
    .filter(({ key }) => !existingEntries.has(key))
    .map(({ entry }) => entry);

  if (missingEntries.length === 0) {
    return 'already-present';
  }

  const prefix = current === '' || current.endsWith('\n') ? current : `${current}\n`;
  writeFileSync(gitignorePath, `${prefix}${missingEntries.join('\n')}\n`);
  return 'added';
}

export function resolveProjectRoot(startPath = process.cwd()) {
  const resolvedStart = resolve(startPath);
  const start = statSync(resolvedStart).isDirectory() ? resolvedStart : dirname(resolvedStart);

  return findUp(start, '.git') ?? findUp(start, 'package.json') ?? start;
}

export function installAgent(repoRoot, options) {
  const agent = loadAgent(repoRoot, options.agentId);
  const mode = options.mode ?? 'linked';
  if (mode !== 'linked') {
    throw new Error(`Unsupported install mode: ${mode}`);
  }

  const projectRoot = options.project ? resolve(options.project) : resolveProjectRoot();
  requireDirectory(projectRoot, 'Project root');

  const agentPath = resolve(repoRoot, agent.path);
  const configDir = join(projectRoot, '.alloycat', 'agents');
  const configPath = join(configDir, `${agent.id}.json`);
  const runRoot = join(projectRoot, '.agent-runs', agent.id);

  mkdirSync(configDir, { recursive: true });
  mkdirSync(runRoot, { recursive: true });
  writeInstallReadme(projectRoot);

  const config = {
    schema_version: 1,
    agent_id: agent.id,
    mode,
    catalog_root: resolve(repoRoot),
    agent_path: agentPath,
    run_root: runRoot,
    installed_at: new Date().toISOString()
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  return {
    agent,
    projectRoot,
    configPath,
    runRoot,
    gitignoreStatus: ensureGitignoreEntry(projectRoot),
    mode
  };
}
