import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');

function runRelease(args, options = {}) {
  return spawnSync(process.execPath, [join(repoRoot, 'scripts', 'release-alloycat.mjs'), ...args], {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    env: options.env ? { ...process.env, ...options.env } : process.env,
    shell: false
  });
}

function createReleaseFixture(version = '1.2.3') {
  const root = mkdtempSync(join(tmpdir(), 'alloycat-release-'));
  const manifestPath = join(root, 'packages', 'alloycat', 'package.json');

  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify({
    name: 'alloycat',
    version,
    private: true,
    type: 'module'
  }, null, 2)}\n`);

  return { root, manifestPath };
}

function writeFakeCommand(binRoot, name, body) {
  mkdirSync(binRoot, { recursive: true });

  if (process.platform === 'win32') {
    const commandPath = join(binRoot, `${name}.cmd`);
    writeFileSync(commandPath, `@echo off\r\n${body}\r\n`);
    return commandPath;
  }

  const commandPath = join(binRoot, name);
  writeFileSync(commandPath, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return commandPath;
}

function writeFakeReleaseCommands(binRoot) {
  if (process.platform === 'win32') {
    writeFakeCommand(binRoot, 'git', [
      'echo git %*>> "%ALLOYCAT_RELEASE_COMMAND_LOG%"',
      'if "%1"=="status" exit /b 0',
      'if "%1"=="fetch" exit /b 0',
      'if "%1"=="diff" exit /b 0',
      'if "%1"=="add" exit /b 0',
      'if "%1"=="commit" if not "%4"=="" exit /b 9',
      'if "%1"=="commit" exit /b 0',
      'if "%1"=="tag" exit /b 0',
      'if "%1"=="push" exit /b 0',
      'if "%1"=="rev-list" (echo 0 0& exit /b 0)',
      'if "%1"=="rev-parse" if "%2"=="--abbrev-ref" (echo main& exit /b 0)',
      'if "%1"=="rev-parse" if "%2"=="--verify" exit /b 1',
      'exit /b 0'
    ].join('\r\n'));
    writeFakeCommand(binRoot, 'npm', [
      'echo npm %*>> "%ALLOYCAT_RELEASE_COMMAND_LOG%"',
      'exit /b 0'
    ].join('\r\n'));
    return;
  }

  writeFakeCommand(binRoot, 'git', [
    'echo "git $*" >> "$ALLOYCAT_RELEASE_COMMAND_LOG"',
    'case "$1" in',
    '  status|fetch|diff|add|commit|tag|push) exit 0 ;;',
    '  rev-list) echo "0 0"; exit 0 ;;',
    '  rev-parse)',
    '    if [ "$2" = "--abbrev-ref" ]; then echo "main"; exit 0; fi',
    '    if [ "$2" = "--verify" ]; then exit 1; fi',
    '    exit 0 ;;',
    'esac',
    'exit 0'
  ].join('\n'));
  writeFakeCommand(binRoot, 'npm', [
    'echo "npm $*" >> "$ALLOYCAT_RELEASE_COMMAND_LOG"',
    'exit 0'
  ].join('\n'));
}

test('release dry-run prints the patch release plan without modifying package version', () => {
  const fixture = createReleaseFixture('1.2.3');
  try {
    const result = runRelease(['patch', '--dry-run'], {
      env: {
        ALLOYCAT_RELEASE_REPO_ROOT: fixture.root
      }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Current version: 1\.2\.3/);
    assert.match(result.stdout, /Next version: 1\.2\.4/);
    assert.match(result.stdout, /npm test/);
    assert.match(result.stdout, /npm run validate/);
    assert.match(result.stdout, /npm run pack:alloycat/);
    assert.match(result.stdout, /git commit -m "chore: release alloycat 1\.2\.4"/);
    assert.match(result.stdout, /git tag alloycat-v1\.2\.4/);
    assert.match(result.stdout, /git push origin main/);
    assert.match(result.stdout, /git push origin alloycat-v1\.2\.4/);
    assert.equal(JSON.parse(readFileSync(fixture.manifestPath, 'utf8')).version, '1.2.3');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('release patch updates version, commits, tags, and pushes', () => {
  const fixture = createReleaseFixture('1.2.3');
  const binRoot = join(fixture.root, 'bin');
  const commandLog = join(fixture.root, 'commands.log');
  try {
    writeFakeReleaseCommands(binRoot);

    const releasePath = `${binRoot}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`;
    const result = runRelease(['patch'], {
      env: {
        ALLOYCAT_RELEASE_COMMAND_LOG: commandLog,
        ALLOYCAT_RELEASE_REPO_ROOT: fixture.root,
        PATH: releasePath,
        Path: releasePath
      }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(fixture.manifestPath, 'utf8')).version, '1.2.4');

    const log = readFileSync(commandLog, 'utf8');
    assert.match(log, /git status --porcelain/);
    assert.match(log, /git fetch origin main/);
    assert.match(log, /npm test/);
    assert.match(log, /npm run validate/);
    assert.match(log, /npm run pack:alloycat/);
    assert.match(log, /git diff --check/);
    assert.match(log, /git add packages\/alloycat\/package\.json/);
    assert.match(log, /git commit -m "?chore: release alloycat 1\.2\.4"?/);
    assert.match(log, /git tag alloycat-v1\.2\.4/);
    assert.match(log, /git push origin main/);
    assert.match(log, /git push origin alloycat-v1\.2\.4/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('release supports minor and major version increments', () => {
  const fixture = createReleaseFixture('1.2.3');
  try {
    const minor = runRelease(['minor', '--dry-run'], {
      env: {
        ALLOYCAT_RELEASE_REPO_ROOT: fixture.root
      }
    });
    const major = runRelease(['major', '--dry-run'], {
      env: {
        ALLOYCAT_RELEASE_REPO_ROOT: fixture.root
      }
    });

    assert.equal(minor.status, 0, minor.stderr);
    assert.equal(major.status, 0, major.stderr);
    assert.match(minor.stdout, /Next version: 1\.3\.0/);
    assert.match(major.stdout, /Next version: 2\.0\.0/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('release rejects unsupported version increments', () => {
  const result = runRelease(['banana', '--dry-run'], {
    env: {
      ALLOYCAT_RELEASE_REPO_ROOT: repoRoot
    }
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage: npm run release:\{patch\|minor\|major\}/);
});
