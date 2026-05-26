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
  assert.match(result.stdout, /interaction-audit/);
});

test('info prints one agent manifest', () => {
  const result = runCli(['info', 'interaction-audit']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Alloy Interaction Audit Agent/);
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
