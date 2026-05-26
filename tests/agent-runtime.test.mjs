import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createRun,
  loadAgent,
  loadCatalog,
  loadRunState,
  loadWorkflow,
  completeRun,
  resolveProjectRoot,
  installAgent,
  renderNextPrompt,
  saveRunState
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

test('complete requires current phase output artifacts before advancing', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-complete-missing-'));
  try {
    const run = createRun(repoRoot, {
      agentId: 'interaction-audit',
      project: repoRoot,
      runRoot: tempRoot,
      runId: 'missing-output-run'
    });

    assert.throws(
      () => completeRun(repoRoot, run.runDir),
      /Missing output artifacts for phase resolve-project-root: .*00-project-root\.json/
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('complete advances to the next workflow phase after outputs exist', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-complete-next-'));
  try {
    const run = createRun(repoRoot, {
      agentId: 'interaction-audit',
      project: repoRoot,
      runRoot: tempRoot,
      runId: 'next-phase-run'
    });
    writeFileSync(join(run.runDir, '00-project-root.json'), '{}\n');

    const result = completeRun(repoRoot, run.runDir);
    const state = loadRunState(run.runDir);

    assert.equal(result.completedPhase.id, 'resolve-project-root');
    assert.equal(result.nextPhase.id, 'project-discovery');
    assert.equal(result.workflowCompleted, false);
    assert.equal(state.current_phase, 'project-discovery');
    assert.deepEqual(state.completed_phases, ['resolve-project-root']);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('complete reports when the next phase is a user gate', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-complete-gate-'));
  try {
    const run = createRun(repoRoot, {
      agentId: 'interaction-audit',
      project: repoRoot,
      runRoot: tempRoot,
      runId: 'gate-run'
    });
    const state = loadRunState(run.runDir);
    state.current_phase = 'source-of-truth';
    state.completed_phases = ['resolve-project-root', 'project-discovery'];
    saveRunState(run.runDir, state);
    writeFileSync(join(run.runDir, '03-source-of-truth-matrix.md'), '# Matrix\n');

    const result = completeRun(repoRoot, run.runDir);

    assert.equal(result.nextPhase.id, 'scope-confirmation');
    assert.equal(result.userGate, true);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('complete marks the run completed after the final phase', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-complete-final-'));
  try {
    const run = createRun(repoRoot, {
      agentId: 'interaction-audit',
      project: repoRoot,
      runRoot: tempRoot,
      runId: 'final-run'
    });
    const state = loadRunState(run.runDir);
    state.current_phase = 'report-assembly';
    state.completed_phases = [
      'resolve-project-root',
      'project-discovery',
      'source-of-truth',
      'scope-confirmation',
      'branch-planning',
      'interaction-audit',
      'visual-conformance-audit',
      'e2e-coverage-audit'
    ];
    saveRunState(run.runDir, state);
    writeFileSync(join(run.runDir, '07-final-report.md'), '# Report\n');

    const result = completeRun(repoRoot, run.runDir);
    const completedState = loadRunState(run.runDir);

    assert.equal(result.workflowCompleted, true);
    assert.equal(result.nextPhase, null);
    assert.equal(completedState.status, 'completed');
    assert.equal(completedState.current_phase, null);
    assert.deepEqual(completedState.completed_phases, [
      'resolve-project-root',
      'project-discovery',
      'source-of-truth',
      'scope-confirmation',
      'branch-planning',
      'interaction-audit',
      'visual-conformance-audit',
      'e2e-coverage-audit',
      'report-assembly'
    ]);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
