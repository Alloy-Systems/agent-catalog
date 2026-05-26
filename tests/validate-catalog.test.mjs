import { spawnSync } from 'node:child_process';
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
