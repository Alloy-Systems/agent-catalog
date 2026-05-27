# Alloycat Phase Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first usable `alloycat` MVP that can list agents, show agent metadata, initialize an Interaction Audit run, report run status, and render the next phase prompt from durable run artifacts.

**Architecture:** Keep the CLI thin in `packages/alloycat/src/index.js`, with reusable filesystem/catalog/run logic in `packages/agent-runtime/src/`. The runtime reads `catalog.yaml`, `agent.yaml`, and `workflow.yaml` through small YAML subset parsers tailored to the current manifests, writes `.agent-runs/<agent-id>/<run-id>/state.json`, and renders phase prompts from workflow metadata plus exact input/output artifact paths.

**Tech Stack:** Node.js ESM, built-in `node:test`, built-in filesystem/path modules, no external dependencies for the MVP.

---

## Files

- Create: `packages/agent-runtime/src/catalog.js` - catalog and agent manifest loading.
- Create: `packages/agent-runtime/src/workflow.js` - workflow phase loading and phase lookup.
- Create: `packages/agent-runtime/src/runs.js` - run folder creation, state loading/saving, and next phase selection.
- Create: `packages/agent-runtime/src/prompts.js` - phase prompt rendering.
- Create: `packages/agent-runtime/src/index.js` - runtime exports.
- Create: `packages/alloycat/src/index.js` - CLI entrypoint.
- Modify: `package.json` - add test script coverage for all tests.
- Modify: `packages/alloycat/package.json` - point `bin` to the CLI entrypoint.
- Test: `tests/alloycat-cli.test.mjs` - CLI behavior.
- Test: `tests/agent-runtime.test.mjs` - runtime behavior.

## Task 1: Catalog And Workflow Runtime

- [ ] **Step 1: Write failing runtime tests**

Create `tests/agent-runtime.test.mjs` with tests that import runtime functions and assert:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadCatalog, loadAgent, loadWorkflow } from '../packages/agent-runtime/src/index.js';

const repoRoot = resolve(import.meta.dirname, '..');

test('loads catalog and Interaction Audit agent metadata', () => {
  const catalog = loadCatalog(repoRoot);
  assert.equal(catalog.agents.length, 1);
  assert.equal(catalog.agents[0].id, 'interaction-auditor');

  const agent = loadAgent(repoRoot, 'interaction-auditor');
  assert.equal(agent.name, 'Alloy Interaction Auditor');
  assert.equal(agent.runtime_model, 'workflow');
});

test('loads ordered workflow phases', () => {
  const workflow = loadWorkflow(repoRoot, 'interaction-auditor');
  assert.equal(workflow.phases[0].id, 'resolve-project-root');
  assert.equal(workflow.phases.at(-1).id, 'report-assembly');
});
```

- [ ] **Step 2: Run runtime tests and verify RED**

Run: `node --test tests/agent-runtime.test.mjs`

Expected: FAIL because `packages/agent-runtime/src/index.js` does not exist.

- [ ] **Step 3: Implement catalog/workflow loaders**

Create the runtime files listed above. Implement enough YAML parsing for the current manifests:

- top-level scalar keys;
- nested maps;
- list entries with `- id:`;
- phase objects with `inputs`, `outputs`, `prompt`, `branch_key`, and `user_gate`.

- [ ] **Step 4: Run runtime tests and verify GREEN**

Run: `node --test tests/agent-runtime.test.mjs`

Expected: PASS.

## Task 2: Run State And Prompt Rendering

- [ ] **Step 1: Extend failing runtime tests**

Add tests to `tests/agent-runtime.test.mjs` that assert:

```js
import { createRun, loadRunState, renderNextPrompt } from '../packages/agent-runtime/src/index.js';

test('creates run state for the first phase', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-run-'));
  try {
    const run = createRun(repoRoot, {
      agentId: 'interaction-auditor',
      project: repoRoot,
      runRoot: tempRoot,
      runId: 'test-run'
    });

    assert.equal(run.state.agent_id, 'interaction-auditor');
    assert.equal(run.state.current_phase, 'resolve-project-root');
    assert.equal(loadRunState(run.runDir).current_phase, 'resolve-project-root');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('renders next phase prompt with exact artifact paths', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-prompt-'));
  try {
    const run = createRun(repoRoot, {
      agentId: 'interaction-auditor',
      project: repoRoot,
      runRoot: tempRoot,
      runId: 'prompt-run'
    });

    const prompt = renderNextPrompt(repoRoot, run.runDir);
    assert.match(prompt, /You are executing Alloy Interaction Auditor/);
    assert.match(prompt, /Phase: resolve-project-root/);
    assert.match(prompt, /Output artifacts/);
    assert.match(prompt, /00-project-root\.json/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run runtime tests and verify RED**

Run: `node --test tests/agent-runtime.test.mjs`

Expected: FAIL because run state and prompt rendering functions do not exist.

- [ ] **Step 3: Implement run state and prompt rendering**

Implement:

- `createRun(repoRoot, options)`;
- `loadRunState(runDir)`;
- `saveRunState(runDir, state)`;
- `getCurrentPhase(repoRoot, state)`;
- `renderNextPrompt(repoRoot, runDir)`.

The rendered prompt must include:

- agent name;
- project root;
- run directory;
- phase id;
- input artifacts;
- output artifacts;
- embedded phase prompt file contents.

- [ ] **Step 4: Run runtime tests and verify GREEN**

Run: `node --test tests/agent-runtime.test.mjs`

Expected: PASS.

## Task 3: Alloycat CLI

- [ ] **Step 1: Write failing CLI tests**

Create `tests/alloycat-cli.test.mjs` with tests that spawn the CLI:

```js
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = resolve(import.meta.dirname, '..');
const cli = join(repoRoot, 'packages/alloycat/src/index.js');

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

test('list prints registered agents', () => {
  const result = runCli(['list']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /interaction-auditor/);
});

test('info prints one agent manifest', () => {
  const result = runCli(['info', 'interaction-auditor']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Alloy Interaction Auditor/);
});

test('init, status, and next operate on a durable run folder', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-cli-'));
  try {
    const init = runCli(['init', 'interaction-auditor', '--project', repoRoot, '--run-root', tempRoot, '--run-id', 'cli-run']);
    assert.equal(init.status, 0, init.stderr);
    assert.match(init.stdout, /cli-run/);

    const runDir = join(tempRoot, 'cli-run');
    const status = runCli(['status', '--run', runDir]);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /resolve-project-root/);

    const next = runCli(['next', '--run', runDir]);
    assert.equal(next.status, 0, next.stderr);
    assert.match(next.stdout, /Phase: resolve-project-root/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run CLI tests and verify RED**

Run: `node --test tests/alloycat-cli.test.mjs`

Expected: FAIL because `packages/alloycat/src/index.js` does not implement commands.

- [ ] **Step 3: Implement CLI commands**

Implement:

- `alloycat list`;
- `alloycat info <agent-id>`;
- `alloycat init <agent-id> --project <path> [--run-root <path>] [--run-id <id>]`;
- `alloycat status --run <path>`;
- `alloycat next --run <path>`;
- `alloycat validate`.

- [ ] **Step 4: Run CLI tests and verify GREEN**

Run: `node --test tests/alloycat-cli.test.mjs`

Expected: PASS.

## Task 4: Final Verification And Commit

- [ ] **Step 1: Run full verification**

Run:

```powershell
npm test
npm run validate
git diff --check
```

Expected:

- tests pass;
- validation prints `Validated 1 agent.`;
- `git diff --check` exits 0;
- local policy-sensitive text scan has no matches.

- [ ] **Step 2: Commit**

Run:

```powershell
git add .
git commit -m "feat: add alloycat phase runner"
```

Expected: commit succeeds on `mvp-alloycat-phase-runner`.
