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
const sourceManifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
const packageSlug = sourceManifest.name.replace(/^@/, '').replace(/\//g, '-');
const tarballName = `${packageSlug}-${sourceManifest.version}.tgz`;
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
    name: sourceManifest.name,
    version: sourceManifest.version,
    description: 'Command-line runner for Alloy agent workflow packages.',
    license: 'UNLICENSED',
    type: 'module',
    bin: {
      alloycat: 'src/index.js',
      cat: 'src/index.js'
    },
    engines: {
      node: '>=20'
    },
    keywords: [
      'alloy',
      'agent-workflow',
      'workflow-runner',
      'cli'
    ],
    publishConfig: {
      access: 'public'
    },
    files: [
      'src/',
      'runtime/',
      'catalog/',
      'package.json',
      'README.md'
    ]
  };
  const repositoryUrl = process.env.ALLOYCAT_PACKAGE_REPOSITORY_URL?.trim();
  if (repositoryUrl) {
    manifest.repository = {
      type: 'git',
      url: repositoryUrl
    };
  }

  writeFileSync(join(stageRoot, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function writePackageReadme() {
  const readme = `# alloycat

Command-line runner for Alloy agent workflow packages.

## Usage

\`\`\`sh
npx alloycat i
npx alloycat init interaction-audit --project .
npx alloycat next --run <run-dir>
npx alloycat complete --run <run-dir>
npx alloycat uninstall
\`\`\`

The installer writes project-local agent state under \`.alloycat/\` and updates \`.gitignore\` for that directory. Run \`npx alloycat uninstall\` from the target project to remove an installed agent.
`;

  writeFileSync(join(stageRoot, 'README.md'), readme);
}

function replaceRequired(source, search, replacement) {
  if (!source.includes(search)) {
    throw new Error(`Expected source string was not found: ${search}`);
  }
  return source.replace(search, replacement);
}

function validateStagedEntrypoint(source) {
  const requiredStrings = [
    "from '../runtime/index.js';",
    "const repoRoot = resolve(dirname(entrypointPath), '../catalog');",
    "process.env.npm_config_package?.trim()"
  ];
  const forbiddenStrings = [
    '../../agent-runtime/src/index.js',
    '../../../scripts/validate-catalog.mjs'
  ];

  for (const requiredString of requiredStrings) {
    if (!source.includes(requiredString)) {
      throw new Error(`Staged entrypoint is missing required string: ${requiredString}`);
    }
  }

  for (const forbiddenString of forbiddenStrings) {
    if (source.includes(forbiddenString)) {
      throw new Error(`Staged entrypoint contains source-only string: ${forbiddenString}`);
    }
  }
}

function packagedValidateSource() {
  return `
function failValidation(message) {
  console.error(message);
  process.exitCode = 1;
}

function requirePackagedFile(catalogRoot, path) {
  const fullPath = resolve(catalogRoot, path);
  if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
    failValidation(\`Missing required file: \${path}\`);
  }
}

function requirePackagedDirectory(catalogRoot, path) {
  const fullPath = resolve(catalogRoot, path);
  if (!existsSync(fullPath) || !statSync(fullPath).isDirectory()) {
    failValidation(\`Missing required directory: \${path}\`);
  }
}

function extractPackagedAgentEntries(catalogText) {
  const entries = [];
  const blocks = catalogText.split(/\\n\\s*-\\s+id:\\s+/).slice(1);

  for (const block of blocks) {
    const id = block.split(/\\r?\\n/, 1)[0]?.trim();
    const path = block.match(/\\n\\s+path:\\s+(.+)/)?.[1]?.trim();
    const status = block.match(/\\n\\s+status:\\s+(.+)/)?.[1]?.trim();
    const version = block.match(/\\n\\s+version:\\s+(.+)/)?.[1]?.trim();
    if (id && path && status && version) {
      entries.push({ id, path, status, version });
    }
  }

  return entries;
}

function extractPackagedPromptPaths(workflowText) {
  return [...workflowText.matchAll(/\\n\\s+prompt:\\s+(.+)/g)].map((match) => match[1].trim());
}

function validatePackagedCatalog(catalogRoot) {
  requirePackagedFile(catalogRoot, 'catalog.yaml');

  const catalogText = readFileSync(resolve(catalogRoot, 'catalog.yaml'), 'utf8');
  const agents = extractPackagedAgentEntries(catalogText);

  if (agents.length === 0) {
    failValidation('catalog.yaml must list at least one agent.');
  }

  for (const agent of agents) {
    requirePackagedDirectory(catalogRoot, agent.path);
    requirePackagedFile(catalogRoot, \`\${agent.path}/agent.yaml\`);
    requirePackagedFile(catalogRoot, \`\${agent.path}/README.md\`);
    requirePackagedFile(catalogRoot, \`\${agent.path}/workflow.yaml\`);
    requirePackagedDirectory(catalogRoot, \`\${agent.path}/prompts\`);

    const workflowText = readFileSync(resolve(catalogRoot, agent.path, 'workflow.yaml'), 'utf8');
    for (const promptPath of extractPackagedPromptPaths(workflowText)) {
      requirePackagedFile(catalogRoot, \`\${agent.path}/\${promptPath}\`);
    }
  }

  if (process.exitCode) {
    process.exit(process.exitCode);
  }

  console.log(\`Validated \${agents.length} agent.\`);
}
`;
}

function writePackagedEntrypoint() {
  const source = readFileSync(join(packageRoot, 'src', 'index.js'), 'utf8');
  let patched = replaceRequired(
    source,
    "import { readFileSync } from 'node:fs';",
    "import { existsSync, readFileSync, statSync } from 'node:fs';"
  );
  patched = replaceRequired(
    patched,
    "from '../../agent-runtime/src/index.js';",
    "from '../runtime/index.js';"
  );
  patched = replaceRequired(
    patched,
    "const repoRoot = resolve(dirname(entrypointPath), '../../..');",
    "const repoRoot = resolve(dirname(entrypointPath), '../catalog');"
  );
  patched = replaceRequired(
    patched,
    "    await import('../../../scripts/validate-catalog.mjs');\n    return;",
    "    validatePackagedCatalog(repoRoot);\n    return;"
  );
  patched = replaceRequired(
    patched,
    '\nasync function main() {',
    `${packagedValidateSource()}\nasync function main() {`
  );

  validateStagedEntrypoint(patched);

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
writePackageReadme();
writePackagedEntrypoint();
copyRequiredDir(join(repoRoot, 'packages', 'agent-runtime', 'src'), join(stageRoot, 'runtime'));
copyRequiredFile(join(repoRoot, 'catalog.yaml'), join(stageRoot, 'catalog', 'catalog.yaml'));
copyRequiredDir(join(repoRoot, 'agents'), join(stageRoot, 'catalog', 'agents'));

const packedPath = runNpmPack();
console.log(relative(repoRoot, packedPath).replace(/\\/g, '/'));
