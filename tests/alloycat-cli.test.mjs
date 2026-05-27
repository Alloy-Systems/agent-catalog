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
    input: options.input,
    env: options.env ? { ...process.env, ...options.env } : process.env
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

test('install with an agent id writes linked install config without prompting', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-cli-install-direct-'));
  try {
    const result = runCli(['install', 'interaction-auditor', '--project', tempRoot]);
    assert.equal(result.status, 0, result.stderr);

    const configPath = join(tempRoot, '.alloycat', 'agents', 'interaction-auditor', 'index.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));

    assert.match(result.stdout, /Installed agent: interaction-auditor/);
    assert.match(result.stdout, /Gitignore: added \.alloycat\//);
    assert.match(result.stdout, /^  alloycat init$/m);
    assert.doesNotMatch(result.stdout, /--run <run-dir>/);
    assert.doesNotMatch(result.stdout, /npx @alloy\/alloycat/);
    assert.equal(config.agent_id, 'interaction-auditor');
    assert.equal(config.mode, 'linked');
    assert.equal(existsSync(join(tempRoot, '.alloycat', 'agents', 'interaction-auditor', 'runs')), true);
    assert.equal(existsSync(join(tempRoot, '.agent-runs')), false);
    assert.match(readFileSync(join(tempRoot, '.gitignore'), 'utf8'), /^\.alloycat\/$/m);
    assert.doesNotMatch(readFileSync(join(tempRoot, '.gitignore'), 'utf8'), /^\.agent-runs\/$/m);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('i alias installs an agent like install', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-cli-install-alias-'));
  try {
    const result = runCli(['i', 'interaction-auditor', '--project', tempRoot]);
    assert.equal(result.status, 0, result.stderr);

    const configPath = join(tempRoot, '.alloycat', 'agents', 'interaction-auditor', 'index.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));

    assert.match(result.stdout, /Installed agent: interaction-auditor/);
    assert.equal(config.agent_id, 'interaction-auditor');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('install from project root prints a copy-safe init command', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-cli-install-copy-safe-'));
  try {
    mkdirSync(join(tempRoot, '.git'));

    const result = runCli(['install', 'interaction-auditor'], { cwd: tempRoot });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^  alloycat init$/m);
    assert.doesNotMatch(result.stdout, /--run-root/);
    assert.doesNotMatch(result.stdout, /--project/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('install prints the short init command for PowerShell projects with quoted paths', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-cli-install-pwsh-'));
  try {
    const projectRoot = join(tempRoot, "John's App");
    mkdirSync(projectRoot, { recursive: true });

    const result = runCli(['install', 'interaction-auditor', '--project', projectRoot], {
      env: {
        MSYSTEM: '',
        SHELL: ''
      }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^  alloycat init$/m);
    assert.doesNotMatch(result.stdout, /'\\''/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('install prints the short init command for Git Bash projects with quoted paths', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-cli-install-bash-'));
  try {
    const projectRoot = join(tempRoot, "John's App");
    mkdirSync(projectRoot, { recursive: true });

    const result = runCli(['install', 'interaction-auditor', '--project', projectRoot], {
      env: {
        MSYSTEM: 'MINGW64',
        SHELL: '/usr/bin/bash'
      }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^  alloycat init$/m);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('install without an agent id accepts a numbered selection from stdin', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-cli-install-select-'));
  try {
    const result = runCli(['install', '--project', tempRoot], { input: '1\n' });
    const configPath = join(tempRoot, '.alloycat', 'agents', 'interaction-auditor', 'index.json');
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

test('install without project option resolves the project root from nested cwd', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-cli-install-cwd-'));
  try {
    mkdirSync(join(tempRoot, '.git'));
    const nested = join(tempRoot, 'src', 'features');
    mkdirSync(nested, { recursive: true });

    const result = runCli(['install', 'interaction-auditor'], { cwd: nested });
    assert.equal(result.status, 0, result.stderr);

    const configPath = join(tempRoot, '.alloycat', 'agents', 'interaction-auditor', 'index.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));

    assert.equal(result.stdout.includes(`Project root: ${tempRoot}`), true);
    assert.equal(config.agent_id, 'interaction-auditor');
    assert.equal(config.run_root, join(tempRoot, '.alloycat', 'agents', 'interaction-auditor', 'runs'));
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
    const result = runCli(['install', 'interaction-auditor', '--project', tempRoot, '--mode', 'vendored']);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported install mode: vendored/);
    assert.equal(existsSync(join(tempRoot, '.alloycat')), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('uninstall with an agent id removes only that agent install', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-cli-uninstall-direct-'));
  try {
    const install = runCli(['install', 'interaction-auditor', '--project', tempRoot]);
    assert.equal(install.status, 0, install.stderr);

    const result = runCli(['uninstall', 'interaction-auditor', '--project', tempRoot]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Uninstalled agent: interaction-auditor/);
    assert.match(result.stdout, /Gitignore: kept \.alloycat\//);
    assert.equal(existsSync(join(tempRoot, '.alloycat')), true);
    assert.equal(existsSync(join(tempRoot, '.alloycat', 'agents', 'interaction-auditor')), false);
    assert.match(readFileSync(join(tempRoot, '.gitignore'), 'utf8'), /^\.alloycat\/$/m);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('uninstall without an agent id removes all alloycat project state', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-cli-uninstall-project-'));
  try {
    const install = runCli(['install', 'interaction-auditor', '--project', tempRoot]);
    assert.equal(install.status, 0, install.stderr);

    const result = runCli(['uninstall', '--project', tempRoot]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Uninstalled all alloycat project state/);
    assert.match(result.stdout, /Gitignore: removed \.alloycat\//);
    assert.equal(existsSync(join(tempRoot, '.alloycat')), false);
    assert.doesNotMatch(readFileSync(join(tempRoot, '.gitignore'), 'utf8'), /^\.alloycat\/$/m);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('uninstall without an agent id is idempotent when alloycat is absent', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-cli-uninstall-empty-'));
  try {
    const result = runCli(['uninstall', '--project', tempRoot]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Uninstalled all alloycat project state/);
    assert.match(result.stdout, /Gitignore: absent \.alloycat\//);
    assert.equal(existsSync(join(tempRoot, '.alloycat')), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('init, status, remind, and next operate on the active installed run without run arguments', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-cli-'));
  try {
    mkdirSync(join(tempRoot, '.git'));
    const install = runCli(['install', 'interaction-auditor'], { cwd: tempRoot });
    assert.equal(install.status, 0, install.stderr);

    const init = runCli([
      'init',
      '--run-id',
      'cli-run'
    ], { cwd: tempRoot });
    assert.equal(init.status, 0, init.stderr);
    assert.match(init.stdout, /cli-run/);
    assert.match(init.stdout, /Phase: Resolve Project Root \(resolve-project-root\)/);
    assert.match(init.stdout, /then run:\n  alloycat next/);

    const runDir = join(tempRoot, '.alloycat', 'agents', 'interaction-auditor', 'runs', 'cli-run');
    const status = runCli(['status'], { cwd: tempRoot });
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /resolve-project-root/);

    const remind = runCli(['remind'], { cwd: tempRoot });
    assert.equal(remind.status, 0, remind.stderr);
    assert.match(remind.stdout, /Phase: Resolve Project Root \(resolve-project-root\)/);

    writeFileSync(join(runDir, '00-project-root.json'), '{}\n');
    const next = runCli(['next'], { cwd: tempRoot });
    assert.equal(next.status, 0, next.stderr);
    assert.match(next.stdout, /Completed phase: resolve-project-root/);
    assert.match(next.stdout, /Phase: Project Discovery \(project-discovery\)/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('init without run root writes under the target project and prints the first task', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-cli-init-default-root-'));
  try {
    const install = runCli(['install', 'interaction-auditor'], { cwd: tempRoot });
    assert.equal(install.status, 0, install.stderr);

    const init = runCli([
      'init',
      '--run-id',
      'cli-default-root-run'
    ], { cwd: tempRoot });

    assert.equal(init.status, 0, init.stderr);
    const runDir = join(tempRoot, '.alloycat', 'agents', 'interaction-auditor', 'runs', 'cli-default-root-run');

    assert.equal(existsSync(join(runDir, 'state.json')), true);
    assert.match(init.stdout, /Phase: Resolve Project Root \(resolve-project-root\)/);
    assert.doesNotMatch(init.stdout, /--run/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('next advances a run and reports user confirmation gates', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'alloycat-cli-complete-project-'));
  try {
    const install = runCli(['install', 'interaction-auditor'], { cwd: projectRoot });
    assert.equal(install.status, 0, install.stderr);

    const init = runCli([
      'init',
      '--run-id',
      'cli-complete-run'
    ], { cwd: projectRoot });
    assert.equal(init.status, 0, init.stderr);

    const runDir = join(projectRoot, '.alloycat', 'agents', 'interaction-auditor', 'runs', 'cli-complete-run');
    writeFileSync(join(runDir, '00-project-root.json'), '{}\n');
    let next = runCli(['next'], { cwd: projectRoot });
    assert.equal(next.status, 0, next.stderr);
    assert.match(next.stdout, /Completed phase: resolve-project-root/);
    assert.match(next.stdout, /Phase: Project Discovery \(project-discovery\)/);

    writeFileSync(join(runDir, '01-project-discovery.md'), '# Discovery\n');
    writeFileSync(join(runDir, '02-ui-inventory.json'), '{}\n');
    next = runCli(['next'], { cwd: projectRoot });
    assert.equal(next.status, 0, next.stderr);
    assert.match(next.stdout, /Phase: Source of Truth \(source-of-truth\)/);

    writeFileSync(join(runDir, '03-source-of-truth-matrix.md'), '# Matrix\n');
    next = runCli(['next'], { cwd: projectRoot });
    assert.equal(next.status, 0, next.stderr);
    assert.match(next.stdout, /Phase: Scope Confirmation \(scope-confirmation\)/);
    assert.match(next.stdout, /Workflow stopped at user confirmation gate: scope-confirmation/);

  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('next exits nonzero when current phase outputs are missing', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'alloycat-cli-complete-missing-project-'));
  try {
    const install = runCli(['install', 'interaction-auditor'], { cwd: projectRoot });
    assert.equal(install.status, 0, install.stderr);

    const init = runCli([
      'init',
      '--run-id',
      'cli-missing-run'
    ], { cwd: projectRoot });
    assert.equal(init.status, 0, init.stderr);

    const next = runCli(['next'], { cwd: projectRoot });
    assert.notEqual(next.status, 0);
    assert.match(next.stderr, /Missing output artifacts for phase resolve-project-root/);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
