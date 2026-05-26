# Distributable Alloycat Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a self-contained `@alloy/alloycat` package that can be run from a target project with `npx <tarball> install` without absolute source paths or local link setup.

**Architecture:** Add a pack script that stages a standalone package under `packages/alloycat/dist-package/`, copying the CLI, runtime source, `catalog.yaml`, and bundled agent files. The staged CLI entrypoint will import `../runtime/index.js` and use `../catalog` as its catalog root, while source checkout tests keep using the existing monorepo entrypoint.

**Tech Stack:** Node.js ESM, built-in `node:test`, built-in filesystem/process/path modules, `npm pack`, and `npx`; no new npm dependencies.

---

## Files

- Create: `scripts/pack-alloycat.mjs` - stages and packs the self-contained CLI package.
- Create: `tests/alloycat-package.test.mjs` - package smoke tests against the real packed tarball.
- Modify: `package.json` - add `pack:alloycat` and `smoke:alloycat-pack` scripts.
- Modify: `.gitignore` - ignore `packages/alloycat/dist-package/` and created tarballs.

## Task 1: Package Smoke Test Skeleton

**Files:**
- Create: `tests/alloycat-package.test.mjs`

- [ ] **Step 1: Write the failing package smoke test**

Create `tests/alloycat-package.test.mjs`:

```js
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = resolve(import.meta.dirname, '..');

function commandName(command) {
  return process.platform === 'win32' ? `${command}.cmd` : command;
}

function run(command, args, options = {}) {
  return spawnSync(commandName(command), args, {
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

test('packed alloycat package contains standalone catalog and runtime files', () => {
  const tarball = packAlloycat();
  const listing = run('tar', ['-tf', tarball]);

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
  const result = run('npx', ['--yes', tarball, 'list']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /interaction-audit/);
});

test('packed alloycat package installs into a target project through npx', () => {
  const tarball = packAlloycat();
  const targetRoot = mkdtempSync(join(tmpdir(), 'alloycat-packed-target-'));
  try {
    const result = run('npx', ['--yes', tarball, 'install', 'interaction-audit'], {
      cwd: targetRoot
    });
    assert.equal(result.status, 0, result.stderr);

    const configPath = join(targetRoot, '.alloycat', 'agents', 'interaction-audit.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));

    assert.equal(config.agent_id, 'interaction-audit');
    assert.equal(config.mode, 'linked');
    assert.equal(existsSync(join(targetRoot, '.agent-runs', 'interaction-audit')), true);
    assert.match(readFileSync(join(targetRoot, '.gitignore'), 'utf8'), /^\.agent-runs\/$/m);
    assert.equal(basename(config.catalog_root), 'catalog');
    assert.notEqual(config.catalog_root, repoRoot);
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the package smoke test and verify RED**

Run:

```powershell
node --test tests/alloycat-package.test.mjs
```

Expected: FAIL because `npm run pack:alloycat` is missing.

- [ ] **Step 3: Commit the failing test**

Do not commit this failing test separately. Continue to Task 2 and commit only after the pack script makes the test pass.

## Task 2: Pack Script And Package Scripts

**Files:**
- Create: `scripts/pack-alloycat.mjs`
- Modify: `package.json`
- Modify: `.gitignore`
- Test: `tests/alloycat-package.test.mjs`

- [ ] **Step 1: Implement the pack script**

Create `scripts/pack-alloycat.mjs`:

```js
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = join(repoRoot, 'packages', 'alloycat');
const stageRoot = join(packageRoot, 'dist-package');
const tarballName = 'alloy-alloycat-0.1.0.tgz';
const tarballPath = join(packageRoot, tarballName);

function copyRequiredFile(from, to) {
  if (!existsSync(from)) {
    throw new Error(`Required file is missing: ${from}`);
  }
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
}

function copyRequiredDir(from, to) {
  if (!existsSync(from)) {
    throw new Error(`Required directory is missing: ${from}`);
  }
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}

function writePackageJson() {
  const manifest = {
    name: '@alloy/alloycat',
    version: '0.1.0',
    type: 'module',
    bin: {
      alloycat: './src/index.js'
    },
    engines: {
      node: '>=20'
    },
    files: [
      'src/',
      'runtime/',
      'catalog/',
      'package.json',
      'README.md'
    ]
  };

  writeFileSync(join(stageRoot, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function writePackagedEntrypoint() {
  const source = readFileSync(join(packageRoot, 'src', 'index.js'), 'utf8');
  const patched = source
    .replace(
      "from '../../agent-runtime/src/index.js';",
      "from '../runtime/index.js';"
    )
    .replace(
      "const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');",
      "const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../catalog');"
    );

  mkdirSync(join(stageRoot, 'src'), { recursive: true });
  writeFileSync(join(stageRoot, 'src', 'index.js'), patched);
}

function runNpmPack() {
  const result = spawnSync('npm', ['pack', '--pack-destination', packageRoot], {
    cwd: stageRoot,
    encoding: 'utf8',
    shell: false
  });

  if (result.status !== 0) {
    throw new Error(`npm pack failed:\n${result.stderr}`);
  }

  const packedName = result.stdout.trim().split(/\r?\n/).at(-1);
  const packedPath = join(packageRoot, packedName);
  if (packedPath !== tarballPath && existsSync(packedPath)) {
    rmSync(tarballPath, { force: true });
    cpSync(packedPath, tarballPath);
    rmSync(packedPath, { force: true });
  }

  return tarballPath;
}

rmSync(stageRoot, { recursive: true, force: true });
rmSync(tarballPath, { force: true });
mkdirSync(stageRoot, { recursive: true });

writePackageJson();
writeFileSync(join(stageRoot, 'README.md'), '# Alloycat\n\nCommand-line runner for Alloy agent packages.\n');
writePackagedEntrypoint();
copyRequiredDir(join(repoRoot, 'packages', 'agent-runtime', 'src'), join(stageRoot, 'runtime'));
copyRequiredFile(join(repoRoot, 'catalog.yaml'), join(stageRoot, 'catalog', 'catalog.yaml'));
copyRequiredDir(join(repoRoot, 'agents'), join(stageRoot, 'catalog', 'agents'));

const packedPath = runNpmPack();
console.log(relative(repoRoot, packedPath).replace(/\\/g, '/'));
```

- [ ] **Step 2: Add root scripts**

Modify `package.json` scripts:

```json
{
  "scripts": {
    "test": "node --test tests/*.test.mjs",
    "validate": "node scripts/validate-catalog.mjs",
    "pack:alloycat": "node scripts/pack-alloycat.mjs",
    "smoke:alloycat-pack": "node --test tests/alloycat-package.test.mjs"
  }
}
```

- [ ] **Step 3: Ignore package staging output**

Add these entries to `.gitignore`:

```text
packages/alloycat/dist-package/
packages/alloycat/*.tgz
```

If `.gitignore` does not exist, create it with those two lines.

- [ ] **Step 4: Run package smoke tests and verify GREEN**

Run:

```powershell
node --test tests/alloycat-package.test.mjs
```

Expected: PASS. The tests should create a package tarball, inspect its contents, run `npx <tarball> list`, and run `npx <tarball> install interaction-audit` from a temporary target project.

- [ ] **Step 5: Run full existing verification**

Run:

```powershell
npm test
npm run validate
git diff --check
```

Expected:

- all tests pass, including the package smoke tests;
- validation prints `Validated 1 agent.`;
- whitespace check exits 0.

- [ ] **Step 6: Commit package implementation**

Run:

```powershell
git add .gitignore package.json scripts/pack-alloycat.mjs tests/alloycat-package.test.mjs
git commit -m "feat: add distributable alloycat package"
```

Expected: commit succeeds on `mvp-alloycat-phase-runner`.

## Task 3: Real Target Smoke With Packed Package

**Files:**
- No repository source files should change.

- [ ] **Step 1: Pack the package**

Run from the catalog repository:

```powershell
npm run pack:alloycat
```

Expected: stdout contains `packages/alloycat/alloy-alloycat-0.1.0.tgz`.

- [ ] **Step 2: Run install from the Alloy Sync project with the tarball**

Run with the real Alloy Sync project path substituted for `<alloy-sync-project>`:

```powershell
cd <alloy-sync-project>
npx --yes C:\Users\pritex\Desktop\projects\alloy-agent-catalog\packages\alloycat\alloy-alloycat-0.1.0.tgz install interaction-audit
```

Expected:

- command exits 0;
- output includes `Installed agent: interaction-audit`;
- output includes the Alloy Sync project root;
- `.alloycat/agents/interaction-audit.json` exists in the Alloy Sync project;
- `.agent-runs/interaction-audit/` exists in the Alloy Sync project;
- `.gitignore` contains `.agent-runs/`.

- [ ] **Step 3: Inspect target project changes**

Run:

```powershell
git -C <alloy-sync-project> status --short
```

Expected:

- target project changes are limited to `.alloycat/` and `.gitignore`;
- `.agent-runs/` is ignored and does not appear as tracked output.

- [ ] **Step 4: Report smoke outcome**

Report:

- exact command used;
- installer stdout summary;
- target project files changed;
- whether `.agent-runs/` is ignored;
- any follow-up issue found.

Do not commit changes in the Alloy Sync project unless explicitly requested.

## Task 4: Final Verification

**Files:**
- Verify repository state.

- [ ] **Step 1: Run final verification**

Run:

```powershell
npm test
npm run validate
npm run smoke:alloycat-pack
git diff --check
$terms = @('co-' + 'authored-by', 'generated' + ' by', 'a' + 'i', 'cod' + 'ex', 'l' + 'lm', 'co' + 'pilot'); rg --hidden --glob '!.git/**' -n -i "\b($($terms -join '|'))\b"
```

Expected:

- `npm test` exits 0;
- `npm run validate` prints `Validated 1 agent.`;
- `npm run smoke:alloycat-pack` exits 0;
- `git diff --check` exits 0;
- policy-sensitive scan exits 1 with no output.

- [ ] **Step 2: Review diff scope**

Run:

```powershell
git status --short
git log --oneline --decorate --graph -12
```

Expected:

- no uncommitted source changes remain except ignored package artifacts;
- recent commits include the package implementation commit.

- [ ] **Step 3: Decide integration**

After verification and real target smoke, present integration choices:

```text
Implementation complete. What would you like to do?

1. Merge back to main locally
2. Push and create a Pull Request
3. Keep the branch as-is
4. Discard this work
```
