#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  completeInstalledRun,
  createInstalledRun,
  extractMarkdownSection,
  installAgent,
  listInstalledAgents,
  loadAgent,
  loadCatalog,
  loadInstalledAgent,
  loadRunState,
  parseAgentMarkdown,
  renderInstalledNextPrompt,
  resolvePackageRelativePath,
  resolveProjectRoot,
  uninstallAgent,
  uninstallProject
} from '../../agent-runtime/src/index.js';

const entrypointPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(entrypointPath), '../../..');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function findNpxRoot(startPath) {
  let current = dirname(startPath);
  while (true) {
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    if (basename(parent) === '_npx') {
      return current;
    }
    current = parent;
  }
}

function normalizeNpxPackageSpec(spec, npxRoot) {
  if (!spec.startsWith('file:')) {
    return spec;
  }

  return new URL(spec, pathToFileURL(`${npxRoot}${sep}`)).href;
}

function inferNpxPackageSpec(startPath) {
  try {
    const npxRoot = findNpxRoot(startPath);
    if (!npxRoot) {
      return null;
    }

    const packageRoot = resolve(dirname(startPath), '..');
    const manifest = readJson(join(packageRoot, 'package.json'));
    const lockfile = readJson(join(npxRoot, 'package-lock.json'));
    const dependencySpec = lockfile.packages?.['']?.dependencies?.[manifest.name];
    if (dependencySpec?.startsWith('file:')) {
      return normalizeNpxPackageSpec(dependencySpec, npxRoot);
    }

    const lockedPackage = lockfile.packages?.[`node_modules/${manifest.name}`];
    if (lockedPackage?.resolved?.startsWith('file:')) {
      return normalizeNpxPackageSpec(lockedPackage.resolved, npxRoot);
    }

    if (lockedPackage?.version) {
      return `${manifest.name}@${lockedPackage.version}`;
    }

    return dependencySpec ? `${manifest.name}@${dependencySpec}` : manifest.name;
  } catch {
    return null;
  }
}

function resolveDefaultCommandPrefix() {
  const explicitPrefix = process.env.ALLOYCAT_COMMAND_PREFIX?.trim();
  if (explicitPrefix) {
    return explicitPrefix;
  }

  const envPackage = process.env.npm_config_package?.trim();
  const npxPackage = envPackage || inferNpxPackageSpec(entrypointPath);
  if (process.env.npm_lifecycle_event === 'npx' && npxPackage) {
    return `npx ${npxPackage}`;
  }

  return 'alloycat';
}

const defaultCommandPrefix = resolveDefaultCommandPrefix();

function parseOptions(args) {
  const options = {};
  const positional = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      options[key] = args[index + 1];
      index += 1;
    } else {
      positional.push(arg);
    }
  }

  return { options, positional };
}

function printUsage() {
  console.log([
    'Usage:',
    '  alloycat list',
    '  alloycat info <agent-id>',
    '  alloycat install [agent-id] [--project <path>] [--mode linked]',
    '  alloycat i [agent-id] [--project <path>] [--mode linked]',
    '  alloycat uninstall [agent-id] [--project <path>]',
    '  alloycat init [agent-id] [--project <path>] [--run-id <id>]',
    '  alloycat status [agent-id] [--project <path>] [--run <path>]',
    '  alloycat remind [agent-id] [--project <path>] [--run <path>]',
    '  alloycat next [agent-id] [--project <path>] [--run <path>]',
    '  alloycat validate'
  ].join('\n'));
}

function commandList() {
  const catalog = loadCatalog(repoRoot);
  for (const entry of catalog.agents) {
    const agent = loadAgent(repoRoot, entry.id);
    console.log(`${agent.id}\t${agent.status}\t${agent.description}`);
  }
}

function commandInfo(agentId) {
  const agent = loadAgent(repoRoot, agentId);
  console.log(JSON.stringify(agent, null, 2));
}

function printInstallResult(result, commandPrefix = defaultCommandPrefix) {
  console.log(`Installed agent: ${result.agent.id}`);
  console.log(`Project root: ${result.projectRoot}`);
  console.log(`Config: ${result.configPath}`);
  console.log(`Gitignore: ${result.gitignoreStatus} .alloycat/`);
  console.log('');
  console.log('Next:');
  console.log(`  ${commandPrefix} init`);
}

function printUninstallResult(result) {
  console.log(`Uninstalled agent: ${result.agentId}`);
  console.log(`Project root: ${result.projectRoot}`);
  console.log(`Removed: ${result.installDir}`);
  console.log(`Gitignore: ${result.gitignoreStatus} .alloycat/`);
}

function printProjectUninstallResult(result) {
  console.log('Uninstalled all alloycat project state');
  console.log(`Project root: ${result.projectRoot}`);
  console.log(`Removed: ${result.installRoot}`);
  console.log(`Gitignore: ${result.gitignoreStatus} .alloycat/`);
}

function printAgentChoices(catalog, action = 'install') {
  console.log(`Select an agent to ${action}:`);
  console.log('');
  catalog.agents.forEach((entry, index) => {
    const agent = loadAgent(repoRoot, entry.id);
    console.log(`${index + 1}. ${agent.id}\t${agent.status}\t${agent.description}`);
  });
  console.log('');
}

async function readSelection() {
  if (process.stdin.isTTY) {
    const readline = createInterface({
      input: process.stdin,
      output: process.stdout
    });
    try {
      return await readline.question('Enter number: ');
    } finally {
      readline.close();
    }
  }

  return readFileSync(0, 'utf8').split(/\r?\n/)[0] ?? '';
}

async function selectAgentId() {
  const catalog = loadCatalog(repoRoot);
  printAgentChoices(catalog, 'install');

  const rawSelection = (await readSelection()).trim();
  if (!rawSelection) {
    throw new Error('Agent id is required when running non-interactively. Run: alloycat install <agent-id>');
  }

  const selection = Number(rawSelection);
  if (!Number.isInteger(selection) || selection < 1 || selection > catalog.agents.length) {
    throw new Error(`Invalid agent selection: ${rawSelection}`);
  }

  return catalog.agents[selection - 1].id;
}

function resolveCommandProjectRoot(options) {
  return options.project ? resolve(options.project) : resolveProjectRoot();
}

function selectSingleInstalledAgentId(projectRoot, explicitAgentId, action) {
  if (explicitAgentId) {
    return explicitAgentId;
  }

  const installedAgents = listInstalledAgents(projectRoot);
  if (installedAgents.length === 0) {
    throw new Error(`No installed agents found in project: ${projectRoot}`);
  }

  if (installedAgents.length > 1) {
    throw new Error(`Agent id is required for ${action} because multiple agents are installed: ${installedAgents.map((agent) => agent.id).join(', ')}`);
  }

  return installedAgents[0].id;
}

function listRunStatesForInstalledAgent(installedAgent) {
  if (!installedAgent.runRoot || !existsSync(installedAgent.runRoot)) {
    return [];
  }

  const stateFile = installedAgent.stateFile ?? installedAgent.config?.state_file ?? 'state.json';
  return readdirSync(installedAgent.runRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(installedAgent.runRoot, entry.name))
    .filter((runDir) => existsSync(join(runDir, stateFile)))
    .map((runDir) => ({
      runDir,
      installedAgent,
      state: loadRunState(runDir, { stateFile }),
      mtimeMs: statSync(join(runDir, stateFile)).mtimeMs
    }));
}

function findActiveRuns(projectRoot, agentId) {
  return listInstalledAgents(projectRoot)
    .filter((agent) => !agentId || agent.id === agentId)
    .flatMap(listRunStatesForInstalledAgent)
    .filter((run) => run.state.status === 'running')
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
}

function resolveActiveRun(options, explicitAgentId, action) {
  if (options.run) {
    const projectRoot = resolveCommandProjectRoot(options);
    const runDir = resolve(options.run);
    const installedAgents = listInstalledAgents(projectRoot)
      .filter((agent) => !explicitAgentId || agent.id === explicitAgentId)
      .filter((agent) => {
        const relativePath = runDir.startsWith(agent.runRoot) ? runDir.slice(agent.runRoot.length) : null;
        return relativePath !== null && (relativePath === '' || relativePath.startsWith(sep));
      });
    if (installedAgents.length !== 1) {
      throw new Error(`Agent id is required for ${action} because the run does not identify exactly one installed agent: ${runDir}`);
    }
    return {
      runDir,
      installedAgent: loadInstalledAgent(projectRoot, installedAgents[0].id)
    };
  }

  const projectRoot = resolveCommandProjectRoot(options);
  const activeRuns = findActiveRuns(projectRoot, explicitAgentId);
  if (activeRuns.length === 0) {
    throw new Error(`No active runs found for ${action} in project: ${projectRoot}`);
  }

  if (activeRuns.length > 1) {
    throw new Error(`Run is required for ${action} because multiple active runs exist: ${activeRuns.map((run) => run.runDir).join(', ')}`);
  }

  return {
    runDir: activeRuns[0].runDir,
    installedAgent: loadInstalledAgent(projectRoot, activeRuns[0].installedAgent.id)
  };
}

async function commandInstall(agentId, options) {
  const selectedAgentId = agentId ?? await selectAgentId();
  const result = installAgent(repoRoot, {
    agentId: selectedAgentId,
    project: options.project,
    mode: options.mode
  });
  printInstallResult(result);
}

async function commandUninstall(agentId, options) {
  const projectRoot = resolveCommandProjectRoot(options);
  if (!agentId) {
    const result = uninstallProject({
      project: projectRoot
    });
    printProjectUninstallResult(result);
    return;
  }

  const result = uninstallAgent(repoRoot, {
    agentId,
    project: projectRoot
  });
  printUninstallResult(result);
}

function commandInit(agentId, options) {
  const project = resolveCommandProjectRoot(options);
  const selectedAgentId = selectSingleInstalledAgentId(project, agentId, 'init');
  const installedAgent = loadInstalledAgent(project, selectedAgentId);
  const run = createInstalledRun(installedAgent, {
    project,
    runRoot: options.runRoot,
    runId: options.runId
  });
  console.log(`Initialized ${run.state.run_id}`);
  console.log(`Run directory: ${run.runDir}`);
  console.log('');
  console.log(renderInstalledNextPrompt(installedAgent, run.runDir, { commandPrefix: defaultCommandPrefix }));
}

function commandStatus(agentId, options) {
  const activeRun = resolveActiveRun(options, agentId, 'status');
  const state = loadRunState(activeRun.runDir, { stateFile: activeRun.installedAgent.stateFile });
  console.log(`Run: ${state.run_id}`);
  console.log(`Agent: ${state.agent_id}`);
  console.log(`Project: ${state.project_root}`);
  console.log(`Current phase: ${state.current_phase}`);
}

function commandRemind(agentId, options) {
  const activeRun = resolveActiveRun(options, agentId, 'remind');
  console.log(renderInstalledNextPrompt(activeRun.installedAgent, activeRun.runDir, { commandPrefix: defaultCommandPrefix }));
}

function commandNext(agentId, options) {
  const activeRun = resolveActiveRun(options, agentId, 'next');
  const result = completeInstalledRun(activeRun.installedAgent, activeRun.runDir);

  console.log(`Completed phase: ${result.completedPhase.id}`);
  if (result.workflowCompleted) {
    console.log('Workflow completed.');
    return;
  }

  if (result.userGate) {
    console.log(`Workflow stopped at user confirmation gate: ${result.nextPhase.id}`);
  }
  console.log('');
  console.log(renderInstalledNextPrompt(activeRun.installedAgent, activeRun.runDir, { commandPrefix: defaultCommandPrefix }));
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { options, positional } = parseOptions(rest);

  if (!command) {
    printUsage();
    return;
  }

  if (command === 'list') {
    commandList();
    return;
  }

  if (command === 'info') {
    commandInfo(positional[0]);
    return;
  }

  if (command === 'install' || command === 'i') {
    await commandInstall(positional[0], options);
    return;
  }

  if (command === 'uninstall') {
    await commandUninstall(positional[0], options);
    return;
  }

  if (command === 'init') {
    commandInit(positional[0], options);
    return;
  }

  if (command === 'status') {
    commandStatus(positional[0], options);
    return;
  }

  if (command === 'remind') {
    commandRemind(positional[0], options);
    return;
  }

  if (command === 'next') {
    commandNext(positional[0], options);
    return;
  }

  if (command === 'validate') {
    await import('../../../scripts/validate-catalog.mjs');
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
