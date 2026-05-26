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
  uninstallAgent,
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

test('loads human-readable phase metadata and output artifact contracts', () => {
  const workflow = loadWorkflow(repoRoot, 'interaction-audit');
  const phase = workflow.phases.find((candidate) => candidate.id === 'project-discovery');

  assert.equal(phase.title, 'Project Discovery');
  assert.match(phase.description, /Discover the target project type/);
  assert.deepEqual(phase.outputs.map((artifact) => artifact.path), [
    '01-project-discovery.md',
    '02-ui-inventory.json'
  ]);
  assert.equal(phase.outputs[0].format, 'markdown');
  assert.match(phase.outputs[0].description, /Discovery notes/);
  assert.equal(phase.outputs[1].format, 'json');
  assert.match(phase.outputs[1].description, /UI inventory/);
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

test('linked install writes project config, run root, readme, and gitignore entry', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-install-runtime-'));
  try {
    const result = installAgent(repoRoot, {
      agentId: 'interaction-audit',
      project: tempRoot
    });

    const configPath = join(tempRoot, '.alloycat', 'agents', 'interaction-audit', 'index.json');
    const readmePath = join(tempRoot, '.alloycat', 'README.md');
    const runRoot = join(tempRoot, '.alloycat', 'agents', 'interaction-audit', 'runs');
    const gitignorePath = join(tempRoot, '.gitignore');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));

    assert.equal(result.agent.id, 'interaction-audit');
    assert.equal(result.projectRoot, tempRoot);
    assert.equal(result.configPath, configPath);
    assert.equal(result.runRoot, runRoot);
    assert.equal(result.gitignoreStatus, 'added');
    assert.equal(result.mode, 'linked');
    assert.equal(config.schema_version, 1);
    assert.equal(config.agent_id, 'interaction-audit');
    assert.equal(config.mode, 'linked');
    assert.equal(config.catalog_root, repoRoot);
    assert.equal(config.agent_path, join(repoRoot, 'agents', 'interaction-audit'));
    assert.equal(config.run_root, runRoot);
    assert.match(config.installed_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(existsSync(readmePath), false);
    assert.equal(existsSync(runRoot), true);
    assert.equal(existsSync(join(tempRoot, '.agent-runs')), false);
    assert.match(readFileSync(gitignorePath, 'utf8'), /^\.alloycat\/$/m);
    assert.doesNotMatch(readFileSync(gitignorePath, 'utf8'), /^\.agent-runs\/$/m);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('linked install does not duplicate an existing alloycat gitignore entry', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-install-idempotent-'));
  try {
    writeFileSync(join(tempRoot, '.gitignore'), 'node_modules/\n/.alloycat/\ndist/\n');

    const first = installAgent(repoRoot, {
      agentId: 'interaction-audit',
      project: tempRoot
    });
    const second = installAgent(repoRoot, {
      agentId: 'interaction-audit',
      project: tempRoot
    });
    const gitignore = readFileSync(join(tempRoot, '.gitignore'), 'utf8');

    assert.equal(first.gitignoreStatus, 'already-present');
    assert.equal(second.gitignoreStatus, 'already-present');
    assert.equal(gitignore.match(/^\/?\.alloycat\/?$/gm).length, 1);
    assert.equal(gitignore.includes('.agent-runs'), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('linked install does not write an alloycat readme', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-install-readme-'));
  try {
    const readmePath = join(tempRoot, '.alloycat', 'README.md');

    installAgent(repoRoot, {
      agentId: 'interaction-audit',
      project: tempRoot
    });

    assert.equal(existsSync(readmePath), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('linked install repeated from an empty project keeps one alloycat gitignore entry', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-install-repeat-'));
  try {
    installAgent(repoRoot, {
      agentId: 'interaction-audit',
      project: tempRoot
    });
    const second = installAgent(repoRoot, {
      agentId: 'interaction-audit',
      project: tempRoot
    });
    const gitignore = readFileSync(join(tempRoot, '.gitignore'), 'utf8');

    assert.equal(second.gitignoreStatus, 'already-present');
    assert.equal(gitignore.match(/^\.alloycat\/$/gm).length, 1);
    assert.equal(gitignore.includes('.agent-runs'), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('uninstall removes an installed agent and cleans project ignore state', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-uninstall-runtime-'));
  try {
    installAgent(repoRoot, {
      agentId: 'interaction-audit',
      project: tempRoot
    });
    const runRoot = join(tempRoot, '.alloycat', 'agents', 'interaction-audit', 'runs');
    writeFileSync(join(runRoot, 'old-run.txt'), 'run artifact\n');

    const result = uninstallAgent(repoRoot, {
      agentId: 'interaction-audit',
      project: tempRoot
    });

    assert.equal(result.agentId, 'interaction-audit');
    assert.equal(result.projectRoot, tempRoot);
    assert.equal(result.gitignoreStatus, 'removed');
    assert.equal(existsSync(join(tempRoot, '.alloycat')), false);
    assert.doesNotMatch(readFileSync(join(tempRoot, '.gitignore'), 'utf8'), /^\.alloycat\/$/m);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('uninstall rejects agents that are not installed', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-uninstall-missing-runtime-'));
  try {
    assert.throws(
      () => uninstallAgent(repoRoot, {
        agentId: 'interaction-audit',
        project: tempRoot
      }),
      /Agent is not installed: interaction-audit/
    );
    assert.equal(existsSync(join(tempRoot, '.alloycat')), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('create run defaults run root to the target project agent runs folder', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-run-default-root-'));
  try {
    const run = createRun(repoRoot, {
      agentId: 'interaction-audit',
      project: tempRoot,
      runId: 'default-root-run'
    });

    assert.equal(run.runDir, join(tempRoot, '.alloycat', 'agents', 'interaction-audit', 'runs', 'default-root-run'));
    assert.equal(loadRunState(run.runDir).project_root, tempRoot);
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

test('renders current phase prompt with phase metadata and artifact contracts', () => {
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
    assert.match(prompt, /Phase: Resolve Project Root \(resolve-project-root\)/);
    assert.match(prompt, /Goal: Identify the target project root/);
    assert.match(prompt, /Output artifacts/);
    assert.match(prompt, /00-project-root\.json/);
    assert.match(prompt, /Format: json/);
    assert.match(prompt, /then run:/);
    assert.match(prompt, /alloycat next/);
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

test('complete validates json output artifacts before advancing', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-complete-invalid-json-'));
  try {
    const run = createRun(repoRoot, {
      agentId: 'interaction-audit',
      project: repoRoot,
      runRoot: tempRoot,
      runId: 'invalid-json-run'
    });
    writeFileSync(join(run.runDir, '00-project-root.json'), '{not json}\n');

    assert.throws(
      () => completeRun(repoRoot, run.runDir),
      /Invalid JSON output artifact for phase resolve-project-root: .*00-project-root\.json/
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
