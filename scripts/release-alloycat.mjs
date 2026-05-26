import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';

const usage = 'Usage: npm run release:{patch|minor|major}';
const validIncrements = new Set(['patch', 'minor', 'major']);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });

  if (options.allowFailure) {
    return {
      status: result.status ?? 1,
      stdout: result.stdout?.trim() ?? '',
      stderr: result.stderr?.trim() ?? ''
    };
  }

  if (result.status !== 0) {
    const details = options.capture
      ? `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
      : '';
    throw new Error(details || `${command} ${args.join(' ')} failed`);
  }

  return result.stdout?.trim() ?? '';
}

function bumpVersion(version, increment) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Unsupported alloycat version: ${version}`);
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  if (increment === 'major') {
    return `${major + 1}.0.0`;
  }
  if (increment === 'minor') {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

function readManifest(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeManifest(path, manifest) {
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

function printDryRunPlan(currentVersion, nextVersion) {
  console.log(`Current version: ${currentVersion}`);
  console.log(`Next version: ${nextVersion}`);
  console.log('');
  console.log('Planned commands:');
  console.log('  git status --porcelain');
  console.log('  git rev-parse --abbrev-ref HEAD');
  console.log('  git fetch origin main');
  console.log('  git rev-list --left-right --count origin/main...HEAD');
  console.log('  npm test');
  console.log('  npm run validate');
  console.log('  npm run pack:alloycat');
  console.log('  git diff --check');
  console.log('  git add packages/alloycat/package.json');
  console.log(`  git commit -m "chore: release alloycat ${nextVersion}"`);
  console.log(`  git tag alloycat-v${nextVersion}`);
  console.log('  git push origin main');
  console.log(`  git push origin alloycat-v${nextVersion}`);
}

function parseArgs(argv) {
  const increment = argv.find((arg) => !arg.startsWith('-'));
  const dryRun = argv.includes('--dry-run');

  if (!increment || !validIncrements.has(increment)) {
    fail(usage);
  }

  return { dryRun, increment };
}

function assertCleanGitState(repoRoot) {
  const status = run('git', ['status', '--porcelain'], { cwd: repoRoot, capture: true });
  if (status) {
    fail(`Release requires a clean worktree:\n${status}`);
  }

  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot, capture: true });
  if (branch !== 'main') {
    fail(`Release must run from main, current branch is ${branch}.`);
  }

  run('git', ['fetch', 'origin', 'main'], { cwd: repoRoot });
  const counts = run('git', ['rev-list', '--left-right', '--count', 'origin/main...HEAD'], {
    cwd: repoRoot,
    capture: true
  }).split(/\s+/);
  const behind = Number(counts[0]);
  const ahead = Number(counts[1]);

  if (behind !== 0 || ahead !== 0) {
    fail(`Release requires main to match origin/main. Behind: ${behind}; ahead: ${ahead}.`);
  }
}

async function main() {
  const { dryRun, increment } = parseArgs(process.argv.slice(2));
  const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const repoRoot = resolve(process.env.ALLOYCAT_RELEASE_REPO_ROOT ?? defaultRepoRoot);
  const manifestPath = join(repoRoot, 'packages', 'alloycat', 'package.json');
  const manifest = readManifest(manifestPath);
  const currentVersion = manifest.version;
  const nextVersion = bumpVersion(currentVersion, increment);
  const tagName = `alloycat-v${nextVersion}`;

  if (dryRun) {
    printDryRunPlan(currentVersion, nextVersion);
    return;
  }

  assertCleanGitState(repoRoot);
  const existingTag = run('git', ['rev-parse', '--verify', '--quiet', tagName], {
    allowFailure: true,
    cwd: repoRoot,
    capture: true
  });
  if (existingTag.status === 0) {
    fail(`Tag already exists: ${tagName}`);
  }

  run('npm', ['test'], { cwd: repoRoot });
  run('npm', ['run', 'validate'], { cwd: repoRoot });

  manifest.version = nextVersion;
  writeManifest(manifestPath, manifest);

  run('npm', ['run', 'pack:alloycat'], { cwd: repoRoot });
  run('git', ['diff', '--check'], { cwd: repoRoot });
  run('git', ['add', 'packages/alloycat/package.json'], { cwd: repoRoot });
  run('git', ['commit', '-m', `chore: release alloycat ${nextVersion}`], { cwd: repoRoot });
  run('git', ['tag', tagName], { cwd: repoRoot });
  run('git', ['push', 'origin', 'main'], { cwd: repoRoot });
  run('git', ['push', 'origin', tagName], { cwd: repoRoot });

  console.log(`Released alloycat ${nextVersion}.`);
}

main().catch((error) => {
  fail(error.message);
});
