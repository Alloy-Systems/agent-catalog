import {
  existsSync,
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadAgent } from './catalog.js';
import { parseAgentMarkdown, resolveAgentProjectPath, resolvePackageRelativePath } from './manifest.js';
import { loadWorkflow } from './workflow.js';

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

function copyPackageFile(sourceRoot, targetRoot, relativePath) {
  const sourcePath = join(sourceRoot, relativePath);
  const targetPath = join(targetRoot, relativePath);
  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath);
}

function copyInstalledPackage(repoRoot, agent, installDir) {
  const packageRoot = join(installDir, 'package');
  const agentRoot = join(repoRoot, agent.path);
  const workflowPath = resolvePackageRelativePath(
    agentRoot,
    agent.runtime.workflow,
    `${agent.id} runtime.workflow`
  );
  const workflow = loadWorkflow(repoRoot, agent.id);

  mkdirSync(packageRoot, { recursive: true });
  copyPackageFile(agentRoot, packageRoot, 'agent.md');
  copyPackageFile(agentRoot, packageRoot, workflowPath);

  for (const phase of workflow.phases) {
    if (phase.prompt) {
      const promptPath = resolvePackageRelativePath(agentRoot, phase.prompt, `${phase.id} prompt`);
      copyPackageFile(agentRoot, packageRoot, promptPath);
    }
  }

  return packageRoot;
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
        stateFile: config.state_file ?? 'state.json',
        config
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function loadInstalledAgent(projectRoot, agentId) {
  const installedAgent = listInstalledAgents(projectRoot)
    .find((agent) => agent.id === agentId);
  if (!installedAgent) {
    throw new Error(`Agent is not installed: ${agentId}`);
  }

  const packageDir = resolvePackageRelativePath(
    installedAgent.installDir,
    installedAgent.config.installed_package_dir ?? 'package',
    `${agentId} installed_package_dir`
  );
  const packageRoot = join(installedAgent.installDir, packageDir);
  const agentDocumentPath = resolvePackageRelativePath(
    packageRoot,
    installedAgent.config.agent_document_path ?? 'agent.md',
    `${agentId} agent_document_path`
  );
  const document = parseAgentMarkdown(readFileSync(join(packageRoot, agentDocumentPath), 'utf8'));
  const manifest = {
    ...installedAgent.config.manifest_snapshot,
    ...document.manifest,
    documentBody: document.body,
    packageRoot
  };

  if (manifest.id !== installedAgent.id) {
    throw new Error(`Installed agent id mismatch: ${installedAgent.id} !== ${manifest.id}`);
  }

  return {
    ...installedAgent,
    packageRoot,
    agentDocumentPath,
    workflowPath: installedAgent.config.workflow_path ?? manifest.runtime?.workflow,
    promptRoot: installedAgent.config.prompt_root ?? 'prompts',
    agent: manifest
  };
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
  const installDir = resolveAgentProjectPath(projectRoot, agent, agent.artifacts.install_root);
  const configPath = join(installDir, 'index.json');
  const runRoot = resolveAgentProjectPath(projectRoot, agent, agent.artifacts.run_root);

  mkdirSync(installDir, { recursive: true });
  mkdirSync(runRoot, { recursive: true });
  copyInstalledPackage(repoRoot, agent, installDir);

  const config = {
    schema_version: 1,
    agent_id: agent.id,
    mode,
    catalog_root: resolve(repoRoot),
    agent_path: agentPath,
    install_dir: installDir,
    run_root: runRoot,
    state_file: agent.artifacts.state_file,
    manifest_snapshot: {
      schema_version: agent.schema_version,
      id: agent.id,
      name: agent.name,
      type: agent.type,
      version: agent.version,
      status: agent.status,
      description: agent.description,
      runtime: agent.runtime,
      artifacts: agent.artifacts,
      prompt_context: agent.prompt_context,
      supports: agent.supports,
      quality_gates: agent.quality_gates
    },
    installed_package_dir: 'package',
    agent_document_path: 'agent.md',
    workflow_path: agent.runtime.workflow,
    prompt_root: 'prompts',
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
