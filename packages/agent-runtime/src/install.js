import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
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

function ensureGitignoreEntry(projectRoot) {
  const gitignorePath = join(projectRoot, '.gitignore');
  const entries = ['.alloycat/'];
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

function normalizeGitignoreEntry(line) {
  return line.trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

function removeGitignoreEntry(projectRoot) {
  const gitignorePath = join(projectRoot, '.gitignore');
  if (!existsSync(gitignorePath)) {
    return 'absent';
  }

  const current = readFileSync(gitignorePath, 'utf8');
  const lines = current.split(/\r?\n/);
  const nextLines = lines.filter((line) => normalizeGitignoreEntry(line) !== '.alloycat');
  if (nextLines.length === lines.length) {
    return 'absent';
  }

  const next = nextLines.join('\n');
  writeFileSync(gitignorePath, next && !next.endsWith('\n') ? `${next}\n` : next);
  return 'removed';
}

export function resolveProjectRoot(startPath = process.cwd()) {
  const resolvedStart = resolve(startPath);
  const start = statSync(resolvedStart).isDirectory() ? resolvedStart : dirname(resolvedStart);

  return findUp(start, '.git') ?? findUp(start, 'package.json') ?? start;
}

export function listInstalledAgents(projectRoot) {
  const agentsRoot = join(resolve(projectRoot), '.alloycat', 'agents');
  if (!existsSync(agentsRoot)) {
    return [];
  }

  return readdirSync(agentsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const installDir = join(agentsRoot, entry.name);
      const configPath = join(installDir, 'index.json');
      if (!existsSync(configPath)) {
        return null;
      }

      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      return {
        id: config.agent_id ?? entry.name,
        installDir,
        configPath,
        runRoot: config.run_root,
        config
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.id.localeCompare(right.id));
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
  const installDir = join(projectRoot, '.alloycat', 'agents', agent.id);
  const configPath = join(installDir, 'index.json');
  const runRoot = join(installDir, 'runs');

  mkdirSync(installDir, { recursive: true });
  mkdirSync(runRoot, { recursive: true });

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

export function uninstallAgent(_repoRoot, options) {
  const projectRoot = options.project ? resolve(options.project) : resolveProjectRoot();
  requireDirectory(projectRoot, 'Project root');

  const installedAgent = listInstalledAgents(projectRoot)
    .find((agent) => agent.id === options.agentId);
  if (!installedAgent) {
    throw new Error(`Agent is not installed: ${options.agentId}`);
  }

  rmSync(installedAgent.installDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

  return {
    agentId: installedAgent.id,
    projectRoot,
    installDir: installedAgent.installDir,
    gitignoreStatus: 'kept',
    installRootStatus: 'kept'
  };
}

export function uninstallProject(options = {}) {
  const projectRoot = options.project ? resolve(options.project) : resolveProjectRoot();
  requireDirectory(projectRoot, 'Project root');

  const alloycatRoot = join(projectRoot, '.alloycat');
  const installRootStatus = existsSync(alloycatRoot) ? 'removed' : 'absent';
  rmSync(alloycatRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

  return {
    projectRoot,
    installRoot: alloycatRoot,
    gitignoreStatus: removeGitignoreEntry(projectRoot),
    installRootStatus
  };
}
