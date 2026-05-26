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
  const npmCommand = process.platform === 'win32'
    ? process.execPath
    : 'npm';
  const npmArgs = process.platform === 'win32'
    ? [
        join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        'pack',
        '--pack-destination',
        packageRoot
      ]
    : ['pack', '--pack-destination', packageRoot];
  const result = spawnSync(npmCommand, npmArgs, {
    cwd: stageRoot,
    encoding: 'utf8',
    shell: false
  });

  if (result.status !== 0) {
    throw new Error(`npm pack failed:\n${result.stderr ?? result.error?.message}`);
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

rmSync(stageRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
rmSync(tarballPath, { force: true, maxRetries: 5, retryDelay: 100 });
mkdirSync(stageRoot, { recursive: true });

writePackageJson();
writeFileSync(join(stageRoot, 'README.md'), '# Alloycat\n\nCommand-line runner for Alloy agent packages.\n');
writePackagedEntrypoint();
copyRequiredDir(join(repoRoot, 'packages', 'agent-runtime', 'src'), join(stageRoot, 'runtime'));
copyRequiredFile(join(repoRoot, 'catalog.yaml'), join(stageRoot, 'catalog', 'catalog.yaml'));
copyRequiredDir(join(repoRoot, 'agents'), join(stageRoot, 'catalog', 'agents'));

const packedPath = runNpmPack();
console.log(relative(repoRoot, packedPath).replace(/\\/g, '/'));
