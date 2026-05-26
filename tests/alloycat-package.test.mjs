import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
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
    env: options.env ? { ...process.env, ...options.env } : process.env,
    input: options.input,
    shell: false
  });
}

function packAlloycat(options = {}) {
  const result = run('npm', ['run', 'pack:alloycat'], options);
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
  const manifest = run('tar', ['-xOf', relative(repoRoot, tarball), 'package/package.json']);
  const readme = run('tar', ['-xOf', relative(repoRoot, tarball), 'package/README.md']);

  assert.equal(listing.status, 0, listing.stderr);
  assert.equal(manifest.status, 0, manifest.stderr);
  assert.equal(readme.status, 0, readme.stderr);
  const parsedManifest = JSON.parse(manifest.stdout);
  const sourceManifest = JSON.parse(readFileSync(join(repoRoot, 'packages', 'alloycat', 'package.json'), 'utf8'));
  assert.equal(parsedManifest.name, 'alloycat');
  assert.equal(parsedManifest.version, sourceManifest.version);
  assert.equal(parsedManifest.description, 'Command-line runner for Alloy agent workflow packages.');
  assert.equal(parsedManifest.license, 'UNLICENSED');
  assert.equal(parsedManifest.publishConfig.access, 'public');
  assert.deepEqual(parsedManifest.bin, {
    alloycat: 'src/index.js',
    cat: 'src/index.js'
  });
  assert.equal(parsedManifest.keywords.includes('agent-workflow'), true);
  assert.match(readme.stdout, /npx alloycat i/);
  assert.match(readme.stdout, /npx alloycat next/);
  assert.match(readme.stdout, /npx alloycat remind/);
  assert.match(readme.stdout, /npx alloycat uninstall/);
  assert.doesNotMatch(readme.stdout, /complete/);
  assert.match(listing.stdout, /package\/package\.json/);
  assert.match(listing.stdout, /package\/src\/index\.js/);
  assert.match(listing.stdout, /package\/runtime\/index\.js/);
  assert.match(listing.stdout, /package\/catalog\/catalog\.yaml/);
  assert.match(listing.stdout, /package\/catalog\/agents\/interaction-audit\/workflow\.yaml/);
  assert.match(listing.stdout, /package\/catalog\/agents\/interaction-audit\/prompts\/00-resolve-project-root\.md/);
});

test('packed alloycat package includes CI repository metadata when provided', () => {
  const tarball = packAlloycat({
    env: {
      ALLOYCAT_PACKAGE_REPOSITORY_URL: 'git+https://github.com/alloy/alloy-agent-catalog.git'
    }
  });
  const manifest = run('tar', ['-xOf', relative(repoRoot, tarball), 'package/package.json']);

  assert.equal(manifest.status, 0, manifest.stderr);
  assert.deepEqual(JSON.parse(manifest.stdout).repository, {
    type: 'git',
    url: 'git+https://github.com/alloy/alloy-agent-catalog.git'
  });
});

test('packed alloycat package can list agents through npx', () => {
  const tarball = packAlloycat();
  const result = run('npx', ['--yes', npxPackageSpec(tarball), 'list']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /interaction-audit/);
});

test('packed alloycat package can validate the packaged catalog through npx', () => {
  const tarball = packAlloycat();
  const result = run('npx', ['--yes', npxPackageSpec(tarball), 'validate']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 1 agent\./);
});

test('packed alloycat package installs into a target project through npx', () => {
  const tarball = packAlloycat();
  const targetRoot = mkdtempSync(join(tmpdir(), 'alloycat-packed-target-'));
  try {
    const result = run('npx', ['--yes', npxPackageSpec(tarball), 'install', 'interaction-audit'], {
      cwd: targetRoot
    });
    assert.equal(result.status, 0, result.stderr);

    const configPath = join(targetRoot, '.alloycat', 'agents', 'interaction-audit', 'index.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));

    assert.equal(config.agent_id, 'interaction-audit');
    assert.equal(config.mode, 'linked');
    const commandPrefix = `npx ${npxPackageSpec(tarball)}`;
    assert.equal(result.stdout.includes(`${commandPrefix} init`), true);
    assert.equal(result.stdout.includes('--run-root'), false);
    assert.equal(result.stdout.includes('--run <run-dir>'), false);
    assert.doesNotMatch(result.stdout, /npx --yes/);
    assert.equal(existsSync(join(targetRoot, '.alloycat', 'agents', 'interaction-audit', 'runs')), true);
    assert.equal(existsSync(join(targetRoot, '.agent-runs')), false);
    assert.match(readFileSync(join(targetRoot, '.gitignore'), 'utf8'), /^\.alloycat\/$/m);
    assert.doesNotMatch(readFileSync(join(targetRoot, '.gitignore'), 'utf8'), /^\.agent-runs\/$/m);
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

test('packed alloycat package installs with the i alias through npx', () => {
  const tarball = packAlloycat();
  const targetRoot = mkdtempSync(join(tmpdir(), 'alloycat-packed-alias-target-'));
  try {
    const result = run('npx', ['--yes', npxPackageSpec(tarball), 'i', 'interaction-audit'], {
      cwd: targetRoot
    });
    assert.equal(result.status, 0, result.stderr);

    const configPath = join(targetRoot, '.alloycat', 'agents', 'interaction-audit', 'index.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));

    assert.equal(config.agent_id, 'interaction-audit');
    assert.equal(config.mode, 'linked');
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
  }
});

test('packed alloycat package uninstalls from a target project through npx', () => {
  const tarball = packAlloycat();
  const targetRoot = mkdtempSync(join(tmpdir(), 'alloycat-packed-uninstall-target-'));
  try {
    const packageSpec = npxPackageSpec(tarball);
    const install = run('npx', ['--yes', packageSpec, 'i', 'interaction-audit'], {
      cwd: targetRoot
    });
    assert.equal(install.status, 0, install.stderr);

    const result = run('npx', ['--yes', packageSpec, 'uninstall', 'interaction-audit'], {
      cwd: targetRoot
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Uninstalled agent: interaction-audit/);
    assert.equal(existsSync(join(targetRoot, '.alloycat')), false);
    assert.doesNotMatch(readFileSync(join(targetRoot, '.gitignore'), 'utf8'), /^\.alloycat\/$/m);
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
  }
});

test('packed alloycat package infers registry npx command prefix from lockfile', () => {
  packAlloycat();
  const cacheRoot = mkdtempSync(join(tmpdir(), 'alloycat-npx-cache-'));
  const targetRoot = mkdtempSync(join(tmpdir(), 'alloycat-packed-registry-target-'));
  try {
    const npxRoot = join(cacheRoot, '_npx', 'registry-run');
    const packageRoot = join(npxRoot, 'node_modules', '@alloy', 'cat');

    mkdirSync(dirname(packageRoot), { recursive: true });
    cpSync(join(repoRoot, 'packages', 'alloycat', 'dist-package'), packageRoot, { recursive: true });
    writeFileSync(join(npxRoot, 'package-lock.json'), `${JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': {
          dependencies: {
            alloycat: '^0.1.0'
          }
        },
        'node_modules/alloycat': {
          version: '0.1.0',
          resolved: 'https://registry.npmjs.org/alloycat/-/alloycat-0.1.0.tgz',
          bin: {
            alloycat: 'src/index.js'
          }
        }
      }
    }, null, 2)}\n`);

    const result = spawnSync(process.execPath, [join(packageRoot, 'src', 'index.js'), 'install', 'interaction-audit'], {
      cwd: targetRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        npm_lifecycle_event: 'npx',
        npm_config_package: ''
      },
      shell: false
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^  npx alloycat@0\.1\.0 init$/m);
    assert.doesNotMatch(result.stdout, /--run-root/);
    assert.doesNotMatch(result.stdout, /--run <run-dir>/);
    assert.doesNotMatch(result.stdout, /npx --yes/);
  } finally {
    rmSync(cacheRoot, { recursive: true, force: true });
    rmSync(targetRoot, { recursive: true, force: true });
  }
});
