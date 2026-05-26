import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = resolve(import.meta.dirname, '..');

function commandSpec(command, args) {
  if (process.platform === 'win32' && (command === 'npm' || command === 'npx')) {
    return {
      command: process.execPath,
      args: [
        join(dirname(process.execPath), 'node_modules', 'npm', 'bin', `${command}-cli.js`),
        ...args
      ]
    };
  }

  return { command, args };
}

function run(command, args, options = {}) {
  const spec = commandSpec(command, args);
  return spawnSync(spec.command, spec.args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    input: options.input,
    shell: false
  });
}

function packAlloycat() {
  const result = run('npm', ['run', 'pack:alloycat']);
  assert.equal(result.status, 0, result.stderr);

  const tarball = result.stdout
    .trim()
    .split(/\r?\n/)
    .find((line) => line.endsWith('.tgz'));
  assert.ok(tarball, `Expected tarball path in stdout:\n${result.stdout}`);

  return resolve(repoRoot, tarball);
}

function npxPackageSpec(tarball) {
  return process.platform === 'win32' ? pathToFileURL(tarball).href : tarball;
}

test('packed alloycat package contains standalone catalog and runtime files', () => {
  const tarball = packAlloycat();
  const listing = run('tar', ['-tf', relative(repoRoot, tarball)]);

  assert.equal(listing.status, 0, listing.stderr);
  assert.match(listing.stdout, /package\/package\.json/);
  assert.match(listing.stdout, /package\/src\/index\.js/);
  assert.match(listing.stdout, /package\/runtime\/index\.js/);
  assert.match(listing.stdout, /package\/catalog\/catalog\.yaml/);
  assert.match(listing.stdout, /package\/catalog\/agents\/interaction-audit\/workflow\.yaml/);
  assert.match(listing.stdout, /package\/catalog\/agents\/interaction-audit\/prompts\/00-resolve-project-root\.md/);
});

test('packed alloycat package can list agents through npx', () => {
  const tarball = packAlloycat();
  const result = run('npx', ['--yes', npxPackageSpec(tarball), 'list']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /interaction-audit/);
});

test('packed alloycat package installs into a target project through npx', () => {
  const tarball = packAlloycat();
  const targetRoot = mkdtempSync(join(tmpdir(), 'alloycat-packed-target-'));
  try {
    const result = run('npx', ['--yes', npxPackageSpec(tarball), 'install', 'interaction-audit'], {
      cwd: targetRoot
    });
    assert.equal(result.status, 0, result.stderr);

    const configPath = join(targetRoot, '.alloycat', 'agents', 'interaction-audit.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));

    assert.equal(config.agent_id, 'interaction-audit');
    assert.equal(config.mode, 'linked');
    assert.equal(existsSync(join(targetRoot, '.agent-runs', 'interaction-audit')), true);
    assert.match(readFileSync(join(targetRoot, '.gitignore'), 'utf8'), /^\.agent-runs\/$/m);
    const catalogRoot = resolve(config.catalog_root);
    const sourceCatalogRoot = join(repoRoot, 'catalog');
    const relativeToRepo = relative(repoRoot, catalogRoot);

    assert.equal(basename(catalogRoot), 'catalog');
    assert.notEqual(catalogRoot, sourceCatalogRoot);
    assert.equal(relativeToRepo.startsWith('..') || isAbsolute(relativeToRepo), true);
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
  }
});
