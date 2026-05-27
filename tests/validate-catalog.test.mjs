import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function copyRepoFixture(sourceRoot, prefix) {
  const targetRoot = mkdtempSync(join(tmpdir(), prefix));
  cpSync(sourceRoot, targetRoot, {
    recursive: true,
    filter: (path) => {
      if (path.includes(`${sep}.git${sep}`) || path.includes(`${sep}node_modules${sep}`)) {
        return false;
      }
      if (path.includes(`${sep}packages${sep}alloycat${sep}dist-package`)) {
        return false;
      }
      return !path.endsWith('.tgz');
    }
  });
  return targetRoot;
}

function runValidation(options = {}) {
  return spawnSync(
    process.execPath,
    ['scripts/validate-catalog.mjs'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: options.env ? { ...process.env, ...options.env } : process.env
    }
  );
}

test('catalog validation accepts the seeded Interaction Audit agent', () => {
  const result = runValidation();

  assert.equal(
    result.status,
    0,
    `Expected validation to pass.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
  );
  assert.match(result.stdout, /Validated 1 agent/);
});

test('catalog validation rejects workflow id mismatches', () => {
  const tempRepo = copyRepoFixture(repoRoot, 'alloycat-validator-workflow-id-');
  try {
    const workflowPath = join(tempRepo, 'agents', 'interaction-auditor', 'workflow.yaml');
    writeFileSync(
      workflowPath,
      readFileSync(workflowPath, 'utf8').replace('id: interaction-auditor', 'id: wrong-agent')
    );

    const result = runValidation({
      env: {
        ALLOYCAT_VALIDATE_ROOT: tempRepo
      }
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /workflow id differs from agent id/i);
  } finally {
    rmSync(tempRepo, { recursive: true, force: true });
  }
});

test('interaction auditor uses canonical agent.md', () => {
  assert.equal(
    existsSync(resolve(repoRoot, 'agents', 'interaction-auditor', 'agent.md')),
    true,
    'Missing canonical agent.md for interaction-auditor'
  );
  assert.equal(
    existsSync(resolve(repoRoot, 'agents', 'interaction-auditor', 'agent.yaml')),
    false,
    'agent.yaml should not remain after agent.md becomes canonical'
  );
  assert.equal(
    existsSync(resolve(repoRoot, 'agents', 'interaction-auditor', 'README.md')),
    false,
    'agent README should be folded into agent.md'
  );
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
      existsSync(resolve(repoRoot, 'agents', 'interaction-auditor', directory, '.gitkeep')),
      true,
      `Missing tracked placeholder for agents/interaction-auditor/${directory}`
    );
  }
});

test('declared interaction auditor host adapters have package readmes', () => {
  for (const host of ['primary-cli', 'secondary-cli']) {
    assert.equal(
      existsSync(resolve(repoRoot, 'agents', 'interaction-auditor', 'adapters', host, 'README.md')),
      true,
      `Missing adapter README for agents/interaction-auditor/adapters/${host}`
    );
  }
});
