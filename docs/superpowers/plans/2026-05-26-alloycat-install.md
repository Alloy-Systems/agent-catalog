# Alloycat Install MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `alloycat install` so a target project can be prepared for linked agent runs with project-local config, run artifact storage, automatic `.gitignore` updates, and optional interactive agent selection.

**Architecture:** Keep installer filesystem behavior in a new runtime module, `packages/agent-runtime/src/install.js`, and keep `packages/alloycat/src/index.js` responsible only for parsing CLI arguments, selecting an agent, and printing results. The runtime will reuse `loadAgent`/`loadCatalog`, resolve project roots from filesystem markers, write `.alloycat` config, ensure `.agent-runs/<agent-id>/`, and update `.gitignore` idempotently.

**Tech Stack:** Node.js ESM, built-in `node:test`, built-in `node:fs`, `node:path`, and `node:readline/promises`; no new npm dependencies.

---

## Files

- Create: `packages/agent-runtime/src/install.js` - project root resolution and linked agent installation.
- Modify: `packages/agent-runtime/src/index.js` - export installer runtime APIs.
- Modify: `packages/alloycat/src/index.js` - add `install` command, agent selection, and install result output.
- Modify: `tests/agent-runtime.test.mjs` - add project root and installer runtime tests.
- Modify: `tests/alloycat-cli.test.mjs` - add direct install, selection-driven install, and missing agent selection tests.

## Task 1: Project Root Resolution Runtime

**Files:**
- Create: `packages/agent-runtime/src/install.js`
- Modify: `packages/agent-runtime/src/index.js`
- Test: `tests/agent-runtime.test.mjs`

- [ ] **Step 1: Write failing runtime tests for project root resolution**

Update the `node:fs` import in `tests/agent-runtime.test.mjs`:

```js
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
```

Update the runtime import in `tests/agent-runtime.test.mjs`:

```js
import {
  createRun,
  loadAgent,
  loadCatalog,
  loadRunState,
  loadWorkflow,
  completeRun,
  installAgent,
  renderNextPrompt,
  resolveProjectRoot,
  saveRunState
} from '../packages/agent-runtime/src/index.js';
```

Add these tests to `tests/agent-runtime.test.mjs`:

```js
test('resolves project root by walking up to the nearest git directory', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-root-git-'));
  try {
    mkdirSync(join(tempRoot, '.git'));
    const nested = join(tempRoot, 'src', 'features', 'audit');
    mkdirSync(nested, { recursive: true });

    assert.equal(resolveProjectRoot(nested), tempRoot);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolves project root by walking up to package.json when no git directory exists', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-root-package-'));
  try {
    writeFileSync(join(tempRoot, 'package.json'), '{"name":"target"}\n');
    const nested = join(tempRoot, 'app', 'components');
    mkdirSync(nested, { recursive: true });

    assert.equal(resolveProjectRoot(nested), tempRoot);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run runtime tests and verify RED**

Run:

```powershell
node --test tests/agent-runtime.test.mjs
```

Expected: FAIL with an ESM export error because `resolveProjectRoot` is not exported by `packages/agent-runtime/src/index.js`.

- [ ] **Step 3: Implement minimal project root resolver**

Create `packages/agent-runtime/src/install.js`:

```js
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

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

export function resolveProjectRoot(startPath = process.cwd()) {
  const resolvedStart = resolve(startPath);
  const start = statSync(resolvedStart).isDirectory() ? resolvedStart : dirname(resolvedStart);

  return findUp(start, '.git') ?? findUp(start, 'package.json') ?? start;
}
```

Update `packages/agent-runtime/src/index.js`:

```js
export { loadAgent, loadCatalog } from './catalog.js';
export { installAgent, resolveProjectRoot } from './install.js';
export { completeRun, createRun, getCurrentPhase, loadRunState, saveRunState } from './runs.js';
export { renderNextPrompt } from './prompts.js';
export { loadWorkflow } from './workflow.js';
```

`installAgent` does not exist yet. Export it now only if it is added as a stub:

```js
export function installAgent() {
  throw new Error('installAgent is not implemented');
}
```

- [ ] **Step 4: Run runtime tests and verify GREEN for root resolution**

Run:

```powershell
node --test tests/agent-runtime.test.mjs
```

Expected: root resolution tests PASS; existing tests still PASS. If the test suite fails because `installAgent` is imported but not used yet, keep the stub from Step 3.

## Task 2: Linked Install Runtime

**Files:**
- Modify: `packages/agent-runtime/src/install.js`
- Test: `tests/agent-runtime.test.mjs`

- [ ] **Step 1: Write failing runtime tests for linked install files**

Add these tests to `tests/agent-runtime.test.mjs`:

```js
test('linked install writes project config, run root, readme, and gitignore entry', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-install-runtime-'));
  try {
    const result = installAgent(repoRoot, {
      agentId: 'interaction-auditor',
      project: tempRoot
    });

    const configPath = join(tempRoot, '.alloycat', 'agents', 'interaction-auditor.json');
    const readmePath = join(tempRoot, '.alloycat', 'README.md');
    const runRoot = join(tempRoot, '.agent-runs', 'interaction-auditor');
    const gitignorePath = join(tempRoot, '.gitignore');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));

    assert.equal(result.agent.id, 'interaction-auditor');
    assert.equal(result.projectRoot, tempRoot);
    assert.equal(result.configPath, configPath);
    assert.equal(result.runRoot, runRoot);
    assert.equal(result.gitignoreStatus, 'added');
    assert.equal(result.mode, 'linked');
    assert.equal(config.schema_version, 1);
    assert.equal(config.agent_id, 'interaction-auditor');
    assert.equal(config.mode, 'linked');
    assert.equal(config.catalog_root, repoRoot);
    assert.equal(config.agent_path, join(repoRoot, 'agents', 'interaction-auditor'));
    assert.equal(config.run_root, runRoot);
    assert.match(config.installed_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(existsSync(readmePath), true);
    assert.equal(existsSync(runRoot), true);
    assert.match(readFileSync(gitignorePath, 'utf8'), /^\.agent-runs\/$/m);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('linked install does not duplicate an existing agent runs gitignore entry', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-install-idempotent-'));
  try {
    writeFileSync(join(tempRoot, '.gitignore'), 'node_modules/\n.agent-runs/\ndist/\n');

    const first = installAgent(repoRoot, {
      agentId: 'interaction-auditor',
      project: tempRoot
    });
    const second = installAgent(repoRoot, {
      agentId: 'interaction-auditor',
      project: tempRoot
    });
    const gitignore = readFileSync(join(tempRoot, '.gitignore'), 'utf8');

    assert.equal(first.gitignoreStatus, 'already-present');
    assert.equal(second.gitignoreStatus, 'already-present');
    assert.equal(gitignore.match(/^\.agent-runs\/$/gm).length, 1);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run runtime tests and verify RED**

Run:

```powershell
node --test tests/agent-runtime.test.mjs
```

Expected: FAIL because `installAgent` throws `installAgent is not implemented`.

- [ ] **Step 3: Implement linked install runtime**

Replace `packages/agent-runtime/src/install.js` with:

```js
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
  writeFileSync(readmePath, [
    '# Alloycat',
    '',
    'This project has local Alloy Agent Catalog install configuration.',
    '',
    'Run artifacts are written under `.agent-runs/` and are ignored by git.',
    ''
  ].join('\n'));
}

function ensureGitignoreEntry(projectRoot) {
  const gitignorePath = join(projectRoot, '.gitignore');
  const entry = '.agent-runs/';

  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, `${entry}\n`);
    return 'added';
  }

  const current = readFileSync(gitignorePath, 'utf8');
  const hasEntry = current
    .split(/\r?\n/)
    .some((line) => line.trim() === entry);

  if (hasEntry) {
    return 'already-present';
  }

  const prefix = current === '' || current.endsWith('\n') ? current : `${current}\n`;
  writeFileSync(gitignorePath, `${prefix}${entry}\n`);
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
```

- [ ] **Step 4: Run runtime tests and verify GREEN**

Run:

```powershell
node --test tests/agent-runtime.test.mjs
```

Expected: all runtime tests PASS.

## Task 3: Direct Install CLI

**Files:**
- Modify: `packages/alloycat/src/index.js`
- Test: `tests/alloycat-cli.test.mjs`

- [ ] **Step 1: Write failing CLI test for direct install**

Update the `node:fs` import in `tests/alloycat-cli.test.mjs`:

```js
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
```

Update `runCli` in `tests/alloycat-cli.test.mjs`:

```js
function runCli(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    input: options.input
  });
}
```

Add this test to `tests/alloycat-cli.test.mjs`:

```js
test('install with an agent id writes linked install config without prompting', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-cli-install-direct-'));
  try {
    const result = runCli(['install', 'interaction-auditor', '--project', tempRoot]);
    const configPath = join(tempRoot, '.alloycat', 'agents', 'interaction-auditor.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Installed agent: interaction-auditor/);
    assert.match(result.stdout, /Gitignore: added \.agent-runs\//);
    assert.match(result.stdout, /alloycat init interaction-auditor/);
    assert.equal(config.agent_id, 'interaction-auditor');
    assert.equal(config.mode, 'linked');
    assert.equal(existsSync(join(tempRoot, '.agent-runs', 'interaction-auditor')), true);
    assert.match(readFileSync(join(tempRoot, '.gitignore'), 'utf8'), /^\.agent-runs\/$/m);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run CLI tests and verify RED**

Run:

```powershell
node --test tests/alloycat-cli.test.mjs
```

Expected: FAIL with `Unknown command: install`.

- [ ] **Step 3: Implement direct install CLI command**

Update the import in `packages/alloycat/src/index.js`:

```js
import {
  completeRun,
  createRun,
  installAgent,
  loadAgent,
  loadCatalog,
  loadRunState,
  renderNextPrompt
} from '../../agent-runtime/src/index.js';
```

Add `install` to `printUsage()`:

```js
'  alloycat install [agent-id] [--project <path>] [--mode linked]',
```

Add these functions to `packages/alloycat/src/index.js`:

```js
function printInstallResult(result) {
  console.log(`Installed agent: ${result.agent.id}`);
  console.log(`Project root: ${result.projectRoot}`);
  console.log(`Config: ${result.configPath}`);
  console.log(`Gitignore: ${result.gitignoreStatus} .agent-runs/`);
  console.log('');
  console.log('Next:');
  console.log(`  alloycat init ${result.agent.id} --project ${result.projectRoot} --run-root ${result.runRoot}`);
  console.log('  alloycat next --run <run-dir>');
}

async function commandInstall(agentId, options) {
  if (!agentId) {
    throw new Error('Agent id is required when running non-interactively. Run: alloycat install <agent-id>');
  }

  const result = installAgent(repoRoot, {
    agentId,
    project: options.project,
    mode: options.mode
  });
  printInstallResult(result);
}
```

Add the command branch in `main()` before `validate`:

```js
if (command === 'install') {
  await commandInstall(positional[0], options);
  return;
}
```

- [ ] **Step 4: Run CLI tests and verify GREEN for direct install**

Run:

```powershell
node --test tests/alloycat-cli.test.mjs
```

Expected: the direct install test PASS; existing CLI tests still PASS.

## Task 4: Agent Selection CLI

**Files:**
- Modify: `packages/alloycat/src/index.js`
- Test: `tests/alloycat-cli.test.mjs`

- [ ] **Step 1: Write failing CLI tests for selection-driven and missing-selection installs**

Add these tests to `tests/alloycat-cli.test.mjs`:

```js
test('install without an agent id accepts a numbered selection from stdin', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-cli-install-select-'));
  try {
    const result = runCli(['install', '--project', tempRoot], { input: '1\n' });
    const configPath = join(tempRoot, '.alloycat', 'agents', 'interaction-auditor.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Select an agent to install:/);
    assert.match(result.stdout, /1\. interaction-auditor/);
    assert.match(result.stdout, /Installed agent: interaction-auditor/);
    assert.equal(config.agent_id, 'interaction-auditor');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('install without an agent id exits nonzero when no selection is provided', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-cli-install-missing-selection-'));
  try {
    const result = runCli(['install', '--project', tempRoot], { input: '' });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Agent id is required when running non-interactively/);
    assert.equal(existsSync(join(tempRoot, '.alloycat')), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run CLI tests and verify RED**

Run:

```powershell
node --test tests/alloycat-cli.test.mjs
```

Expected: FAIL because `commandInstall` still requires an explicit agent id and does not read a numbered selection.

- [ ] **Step 3: Implement agent selection**

Add imports to `packages/alloycat/src/index.js`:

```js
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
```

Add these functions:

```js
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
```

Replace `commandInstall` with:

```js
async function commandInstall(agentId, options) {
  const selectedAgentId = agentId ?? await selectAgentId();
  const result = installAgent(repoRoot, {
    agentId: selectedAgentId,
    project: options.project,
    mode: options.mode
  });
  printInstallResult(result);
}
```

- [ ] **Step 4: Run CLI tests and verify GREEN**

Run:

```powershell
node --test tests/alloycat-cli.test.mjs
```

Expected: all CLI tests PASS.

## Task 5: Final Verification And Commit

**Files:**
- Verify all modified implementation and test files.

- [ ] **Step 1: Run full verification**

Run:

```powershell
npm test
npm run validate
git diff --check
$terms = @('co-' + 'authored-by', 'generated' + ' by', 'a' + 'i', 'cod' + 'ex', 'l' + 'lm', 'co' + 'pilot'); rg --hidden --glob '!.git/**' -n -i "\b($($terms -join '|'))\b"
```

Expected:

- `npm test` exits 0 with all tests passing;
- `npm run validate` prints `Validated 1 agent.`;
- `git diff --check` exits 0 with no output;
- the policy-sensitive scan exits 1 with no output, meaning no matches were found.

- [ ] **Step 2: Review diff scope**

Run:

```powershell
git diff -- packages/agent-runtime/src/install.js packages/agent-runtime/src/index.js packages/alloycat/src/index.js tests/agent-runtime.test.mjs tests/alloycat-cli.test.mjs
git status --short
```

Expected:

- diff only includes installer runtime, CLI install handling, and tests;
- no unrelated files are modified.

- [ ] **Step 3: Commit implementation**

Run:

```powershell
git add packages/agent-runtime/src/install.js packages/agent-runtime/src/index.js packages/alloycat/src/index.js tests/agent-runtime.test.mjs tests/alloycat-cli.test.mjs
git commit -m "feat: add alloycat installer"
```

Expected: commit succeeds on `mvp-alloycat-phase-runner`.
