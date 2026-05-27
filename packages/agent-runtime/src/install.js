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
import { dirname, join, relative, resolve } from 'node:path';
import { loadAgent } from './catalog.js';
import { isAnyAbsolute, parseAgentMarkdown, resolveAgentProjectPath, resolvePackageRelativePath } from './manifest.js';
import { loadWorkflow, loadWorkflowFromAgentPackage } from './workflow.js';

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

function requireFile(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} does not exist: ${path}`);
  }
  if (!statSync(path).isFile()) {
    throw new Error(`${label} is not a file: ${path}`);
  }
}

function toPosixRelativePath(fromPath, toPath, label) {
  const relativePath = relative(fromPath, toPath);
  if (relativePath === '' || relativePath.startsWith('..') || isAnyAbsolute(relativePath)) {
    throw new Error(`${label} must be inside ${fromPath}.`);
  }
  return relativePath.replaceAll('\\', '/');
}

function resolveInstalledRelativePath(basePath, candidatePath, label, containerLabel) {
  if (isAnyAbsolute(candidatePath)) {
    throw new Error(`${label} must be relative and inside ${containerLabel}. Reinstall the agent to migrate this index.`);
  }

  try {
    return resolvePackageRelativePath(basePath, candidatePath, label);
  } catch (error) {
    throw new Error(`${label} must be relative and inside ${containerLabel}: ${error.message}. Reinstall the agent to migrate this index.`);
  }
}

function requireConfigString(config, key) {
  if (typeof config[key] !== 'string' || config[key].trim() === '') {
    throw new Error(`Installed agent index field must be a non-empty string: ${key}`);
  }
  return config[key];
}

function requirePlainStateFile(stateFile) {
  if (
    stateFile === '.' ||
    stateFile === '..' ||
    /[\\/]/.test(stateFile) ||
    /[{}]/.test(stateFile) ||
    isAnyAbsolute(stateFile)
  ) {
    throw new Error('Installed agent index state_file must be a plain file name.');
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
    for (const output of phase.outputs ?? []) {
      for (const key of ['schema', 'template']) {
        if (output?.[key]) {
          const assetPath = resolvePackageRelativePath(agentRoot, output[key], `${phase.id} ${key}`);
          copyPackageFile(agentRoot, packageRoot, assetPath);
        }
      }
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
        runRoot: typeof config.run_root === 'string' && !isAnyAbsolute(config.run_root)
          ? join(installDir, config.run_root)
          : config.run_root,
        stateFile: config.state_file ?? 'state.json',
        config
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function loadInstalledAgent(projectRoot, agentId) {
  const resolvedProjectRoot = resolve(projectRoot);
  const installedAgent = listInstalledAgents(projectRoot)
    .find((agent) => agent.id === agentId);
  if (!installedAgent) {
    throw new Error(`Agent is not installed: ${agentId}`);
  }

  const config = installedAgent.config;
  if (config.schema_version !== 1) {
    throw new Error(`Installed agent index schema_version must be 1: ${agentId}`);
  }
  if (config.agent_id !== installedAgent.id) {
    throw new Error(`Installed agent index agent_id mismatch: ${config.agent_id} !== ${installedAgent.id}`);
  }
  if (config.manifest_snapshot?.id && config.manifest_snapshot.id !== installedAgent.id) {
    throw new Error(`Installed agent manifest snapshot id mismatch: ${config.manifest_snapshot.id} !== ${installedAgent.id}`);
  }

  const expectedInstallDir = join(resolvedProjectRoot, '.alloycat', 'agents', installedAgent.id);
  if (resolve(installedAgent.installDir) !== expectedInstallDir) {
    throw new Error(`Installed agent directory mismatch for ${installedAgent.id}: ${installedAgent.installDir}`);
  }
  const installDir = requireConfigString(config, 'install_dir');
  const safeInstallDir = resolveInstalledRelativePath(
    resolvedProjectRoot,
    installDir,
    'Installed agent index install_dir',
    'project root'
  );
  if (join(resolvedProjectRoot, safeInstallDir) !== expectedInstallDir) {
    throw new Error(`Installed agent index install_dir must resolve to ${expectedInstallDir}`);
  }

  const safeRunRoot = resolveInstalledRelativePath(
    expectedInstallDir,
    requireConfigString(config, 'run_root'),
    'Installed agent index run_root',
    'install_dir'
  );
  const runRoot = join(expectedInstallDir, safeRunRoot);
  const stateFile = requireConfigString(config, 'state_file');
  requirePlainStateFile(stateFile);

  const packageDir = resolvePackageRelativePath(
    installedAgent.installDir,
    requireConfigString(config, 'installed_package_dir'),
    `${agentId} installed_package_dir`
  );
  const packageRoot = join(installedAgent.installDir, packageDir);
  requireDirectory(packageRoot, `${agentId} installed package directory`);

  const agentDocumentPath = resolvePackageRelativePath(
    packageRoot,
    requireConfigString(config, 'agent_document_path'),
    `${agentId} agent_document_path`
  );
  requireFile(join(packageRoot, agentDocumentPath), `${agentId} agent document`);

  const workflowPath = resolvePackageRelativePath(
    packageRoot,
    requireConfigString(config, 'workflow_path'),
    `${agentId} workflow_path`
  );
  requireFile(join(packageRoot, workflowPath), `${agentId} workflow`);

  const promptRoot = resolvePackageRelativePath(
    packageRoot,
    requireConfigString(config, 'prompt_root'),
    `${agentId} prompt_root`
  );
  requireDirectory(join(packageRoot, promptRoot), `${agentId} prompt root`);

  const document = parseAgentMarkdown(readFileSync(join(packageRoot, agentDocumentPath), 'utf8'));
  const manifest = {
    ...config.manifest_snapshot,
    ...document.manifest,
    documentBody: document.body,
    packageRoot
  };

  if (manifest.id !== installedAgent.id) {
    throw new Error(`Installed agent id mismatch: ${installedAgent.id} !== ${manifest.id}`);
  }

  const workflow = loadWorkflowFromAgentPackage(manifest, packageRoot, workflowPath);
  for (const phase of workflow.phases) {
    if (phase.prompt) {
      const promptPath = resolvePackageRelativePath(packageRoot, phase.prompt, `${phase.id} prompt`);
      requireFile(join(packageRoot, promptPath), `${phase.id} prompt`);
    }
    for (const output of phase.outputs ?? []) {
      for (const key of ['schema', 'template']) {
        if (output?.[key]) {
          const assetPath = resolvePackageRelativePath(packageRoot, output[key], `${phase.id} ${key}`);
          requireFile(join(packageRoot, assetPath), `${phase.id} ${key}`);
        }
      }
    }
  }

  return {
    ...installedAgent,
    runRoot,
    stateFile,
    packageRoot,
    agentDocumentPath,
    workflowPath,
    promptRoot,
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
    install_dir: toPosixRelativePath(projectRoot, installDir, 'Installed agent index install_dir'),
    run_root: toPosixRelativePath(installDir, runRoot, 'Installed agent index run_root'),
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
