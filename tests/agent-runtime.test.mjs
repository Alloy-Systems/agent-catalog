import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createRun,
  loadAgent,
  loadCatalog,
  loadRunState,
  loadWorkflow,
  renderNextPrompt
} from '../packages/agent-runtime/src/index.js';

const repoRoot = resolve(import.meta.dirname, '..');

test('loads catalog and Interaction Audit agent metadata', () => {
  const catalog = loadCatalog(repoRoot);
  assert.equal(catalog.agents.length, 1);
  assert.equal(catalog.agents[0].id, 'interaction-audit');

  const agent = loadAgent(repoRoot, 'interaction-audit');
  assert.equal(agent.name, 'Alloy Interaction Audit Agent');
  assert.equal(agent.runtime_model, 'workflow');
});

test('loads ordered workflow phases', () => {
  const workflow = loadWorkflow(repoRoot, 'interaction-audit');
  assert.equal(workflow.phases[0].id, 'resolve-project-root');
  assert.equal(workflow.phases.at(-1).id, 'report-assembly');
});

test('creates run state for the first phase', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-run-'));
  try {
    const run = createRun(repoRoot, {
      agentId: 'interaction-audit',
      project: repoRoot,
      runRoot: tempRoot,
      runId: 'test-run'
    });

    assert.equal(run.state.agent_id, 'interaction-audit');
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
      agentId: 'interaction-audit',
      project: repoRoot,
      runRoot: tempRoot,
      runId: 'prompt-run'
    });

    const prompt = renderNextPrompt(repoRoot, run.runDir);
    assert.match(prompt, /You are executing Alloy Interaction Audit Agent/);
    assert.match(prompt, /Phase: resolve-project-root/);
    assert.match(prompt, /Output artifacts/);
    assert.match(prompt, /00-project-root\.json/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
