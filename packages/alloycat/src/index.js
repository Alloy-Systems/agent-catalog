#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  completeRun,
  createRun,
  installAgent,
  loadAgent,
  loadCatalog,
  loadRunState,
  renderNextPrompt
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
    return `npx --yes ${npxPackage}`;
  }

  return 'alloycat';
}

const defaultCommandPrefix = resolveDefaultCommandPrefix();

function portablePath(path) {
  return path.replace(/\\/g, '/');
}

function pathRelativeToCwd(path) {
  const target = resolve(path);
  const cwd = resolve(process.cwd());
  const relativePath = relative(cwd, target);

  if (relativePath === '') {
    return '.';
  }

  return portablePath(isAbsolute(relativePath) ? target : relativePath);
}

function usesPosixShell() {
  const shell = (process.env.SHELL ?? '').toLowerCase();
  return Boolean(process.env.MSYSTEM) || /(^|\/)(ba|z|fi)?sh$/.test(shell);
}

function posixShellArg(text) {
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function powershellArg(text) {
  return `'${text.replace(/'/g, "''")}'`;
}

function shellArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@%+-]+$/.test(text)) {
    return text;
  }

  return usesPosixShell() ? posixShellArg(text) : powershellArg(text);
}

function shellPathArg(path) {
  return shellArg(pathRelativeToCwd(path));
}

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
    '  alloycat init <agent-id> --project <path> [--run-root <path>] [--run-id <id>]',
    '  alloycat status --run <path>',
    '  alloycat next --run <path>',
    '  alloycat complete --run <path>',
    '  alloycat validate'
  ].join('\n'));
}

function requireOption(options, key) {
  if (!options[key]) {
    throw new Error(`Missing required option: --${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`);
  }
  return options[key];
}

function commandList() {
  const catalog = loadCatalog(repoRoot);
  for (const agent of catalog.agents) {
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
  console.log(`  ${commandPrefix} init ${result.agent.id} --project ${shellPathArg(result.projectRoot)}`);
  console.log(`  ${commandPrefix} next --run <run-dir>`);
}

function printAgentChoices(catalog) {
  console.log('Select an agent to install:');
  console.log('');
  catalog.agents.forEach((agent, index) => {
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
  printAgentChoices(catalog);

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

async function commandInstall(agentId, options) {
  const selectedAgentId = agentId ?? await selectAgentId();
  const result = installAgent(repoRoot, {
    agentId: selectedAgentId,
    project: options.project,
    mode: options.mode
  });
  printInstallResult(result);
}

function commandInit(agentId, options) {
  const project = requireOption(options, 'project');
  const run = createRun(repoRoot, {
    agentId,
    project,
    runRoot: options.runRoot,
    runId: options.runId
  });
  console.log(`Initialized ${run.state.run_id}`);
  console.log(`Run directory: ${run.runDir}`);
  console.log('');
  console.log('Next:');
  console.log(`  ${defaultCommandPrefix} next --run ${shellPathArg(run.runDir)}`);
}

function commandStatus(options) {
  const runDir = requireOption(options, 'run');
  const state = loadRunState(runDir);
  console.log(`Run: ${state.run_id}`);
  console.log(`Agent: ${state.agent_id}`);
  console.log(`Project: ${state.project_root}`);
  console.log(`Current phase: ${state.current_phase}`);
}

function commandNext(options) {
  const runDir = requireOption(options, 'run');
  console.log(renderNextPrompt(repoRoot, runDir));
}

function commandComplete(options) {
  const runDir = requireOption(options, 'run');
  const result = completeRun(repoRoot, runDir);

  console.log(`Completed phase: ${result.completedPhase.id}`);
  if (result.workflowCompleted) {
    console.log('Workflow completed.');
    return;
  }

  console.log(`Current phase: ${result.nextPhase.id}`);
  if (result.userGate) {
    console.log(`Workflow stopped at user confirmation gate: ${result.nextPhase.id}`);
  }
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

  if (command === 'install') {
    await commandInstall(positional[0], options);
    return;
  }

  if (command === 'init') {
    commandInit(positional[0], options);
    return;
  }

  if (command === 'status') {
    commandStatus(options);
    return;
  }

  if (command === 'next') {
    commandNext(options);
    return;
  }

  if (command === 'complete') {
    commandComplete(options);
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
