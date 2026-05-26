import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = resolve(import.meta.dirname, '..');
const cli = join(repoRoot, 'packages/alloycat/src/index.js');

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    input: options.input
  });
}

test('list prints registered agents', () => {
  const result = runCli(['list']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /interaction-audit/);
});

test('info prints one agent manifest', () => {
  const result = runCli(['info', 'interaction-audit']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Alloy Interaction Audit Agent/);
});

test('install with an agent id writes linked install config without prompting', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-cli-install-direct-'));
  try {
    const result = runCli(['install', 'interaction-audit', '--project', tempRoot]);
    assert.equal(result.status, 0, result.stderr);

    const configPath = join(tempRoot, '.alloycat', 'agents', 'interaction-audit.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));

    assert.match(result.stdout, /Installed agent: interaction-audit/);
    assert.match(result.stdout, /Gitignore: added \.agent-runs\//);
    assert.match(result.stdout, /alloycat init interaction-audit/);
    assert.equal(config.agent_id, 'interaction-audit');
    assert.equal(config.mode, 'linked');
    assert.equal(existsSync(join(tempRoot, '.agent-runs', 'interaction-audit')), true);
    assert.match(readFileSync(join(tempRoot, '.gitignore'), 'utf8'), /^\.agent-runs\/$/m);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('install without an agent id accepts a numbered selection from stdin', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-cli-install-select-'));
  try {
    const result = runCli(['install', '--project', tempRoot], { input: '1\n' });
    const configPath = join(tempRoot, '.alloycat', 'agents', 'interaction-audit.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Select an agent to install:/);
    assert.match(result.stdout, /1\. interaction-audit/);
    assert.match(result.stdout, /Installed agent: interaction-audit/);
    assert.equal(config.agent_id, 'interaction-audit');
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

test('install without project option resolves the project root from nested cwd', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-cli-install-cwd-'));
  try {
    mkdirSync(join(tempRoot, '.git'));
    const nested = join(tempRoot, 'src', 'features');
    mkdirSync(nested, { recursive: true });

    const result = runCli(['install', 'interaction-audit'], { cwd: nested });
    assert.equal(result.status, 0, result.stderr);

    const configPath = join(tempRoot, '.alloycat', 'agents', 'interaction-audit.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));

    assert.equal(result.stdout.includes(`Project root: ${tempRoot}`), true);
    assert.equal(config.agent_id, 'interaction-audit');
    assert.equal(config.run_root, join(tempRoot, '.agent-runs', 'interaction-audit'));
    assert.equal(existsSync(join(nested, '.alloycat')), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('install without an agent id rejects invalid numbered selection', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-cli-install-invalid-selection-'));
  try {
    const result = runCli(['install', '--project', tempRoot], { input: '99\n' });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid agent selection: 99/);
    assert.equal(existsSync(join(tempRoot, '.alloycat')), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('install rejects unsupported install modes before writing project config', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-cli-install-mode-'));
  try {
    const result = runCli(['install', 'interaction-audit', '--project', tempRoot, '--mode', 'vendored']);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported install mode: vendored/);
    assert.equal(existsSync(join(tempRoot, '.alloycat')), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('init, status, and next operate on a durable run folder', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-cli-'));
  try {
    const init = runCli([
      'init',
      'interaction-audit',
      '--project',
      repoRoot,
      '--run-root',
      tempRoot,
      '--run-id',
      'cli-run'
    ]);
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

test('complete advances a run and reports user confirmation gates', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-cli-complete-'));
  try {
    const init = runCli([
      'init',
      'interaction-audit',
      '--project',
      repoRoot,
      '--run-root',
      tempRoot,
      '--run-id',
      'cli-complete-run'
    ]);
    assert.equal(init.status, 0, init.stderr);

    const runDir = join(tempRoot, 'cli-complete-run');
    writeFileSync(join(runDir, '00-project-root.json'), '{}\n');
    let complete = runCli(['complete', '--run', runDir]);
    assert.equal(complete.status, 0, complete.stderr);
    assert.match(complete.stdout, /Completed phase: resolve-project-root/);
    assert.match(complete.stdout, /Current phase: project-discovery/);

    writeFileSync(join(runDir, '01-project-discovery.md'), '# Discovery\n');
    writeFileSync(join(runDir, '02-ui-inventory.json'), '{}\n');
    complete = runCli(['complete', '--run', runDir]);
    assert.equal(complete.status, 0, complete.stderr);
    assert.match(complete.stdout, /Current phase: source-of-truth/);

    writeFileSync(join(runDir, '03-source-of-truth-matrix.md'), '# Matrix\n');
    complete = runCli(['complete', '--run', runDir]);
    assert.equal(complete.status, 0, complete.stderr);
    assert.match(complete.stdout, /Current phase: scope-confirmation/);
    assert.match(complete.stdout, /Workflow stopped at user confirmation gate: scope-confirmation/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('complete exits nonzero when current phase outputs are missing', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-cli-complete-missing-'));
  try {
    const init = runCli([
      'init',
      'interaction-audit',
      '--project',
      repoRoot,
      '--run-root',
      tempRoot,
      '--run-id',
      'cli-missing-run'
    ]);
    assert.equal(init.status, 0, init.stderr);

    const complete = runCli(['complete', '--run', join(tempRoot, 'cli-missing-run')]);
    assert.notEqual(complete.status, 0);
    assert.match(complete.stderr, /Missing output artifacts for phase resolve-project-root/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
