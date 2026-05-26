import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('catalog validation accepts the seeded Interaction Audit agent', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/validate-catalog.mjs'],
    {
      cwd: repoRoot,
      encoding: 'utf8'
    }
  );

  assert.equal(
    result.status,
    0,
    `Expected validation to pass.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
  );
  assert.match(result.stdout, /Validated 1 agent/);
});

test('required empty agent directories have tracked placeholders', () => {
  for (const directory of [
    'schemas',
    'templates',
    'adapters',
    'tests',
    'fixtures',
    'examples'
  ]) {
    assert.equal(
      existsSync(resolve(repoRoot, 'agents', 'interaction-audit', directory, '.gitkeep')),
      true,
      `Missing tracked placeholder for agents/interaction-audit/${directory}`
    );
  }
});
