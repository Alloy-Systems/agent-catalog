#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createRun,
  loadAgent,
  loadCatalog,
  loadRunState,
  renderNextPrompt
} from '../../agent-runtime/src/index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

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
    '  alloycat init <agent-id> --project <path> [--run-root <path>] [--run-id <id>]',
    '  alloycat status --run <path>',
    '  alloycat next --run <path>',
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
