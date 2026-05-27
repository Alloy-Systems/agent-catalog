# Agent Markdown Manifest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace split agent metadata and README files with canonical `agent.md` files that drive runtime loading, validation, packaging, and prompt context.

**Architecture:** `catalog.yaml` remains a small index from agent id to path. `agent.md` becomes the source of truth for metadata, runtime settings, artifact paths, prompt-context sections, and quality gates. `workflow.yaml` remains the phase graph, loaded through `agent.md.runtime.workflow`.

**Tech Stack:** Node.js ESM, built-in `node:test`, custom frontmatter parsing, existing `alloycat` CLI and `agent-runtime` modules.

---

## File Structure

- Create `packages/agent-runtime/src/manifest.js` for frontmatter extraction, a limited YAML subset parser, Markdown section extraction, manifest validation, and artifact path resolution.
- Modify `packages/agent-runtime/src/catalog.js` so `loadAgent()` reads `agent.md` instead of `agent.yaml`.
- Modify `packages/agent-runtime/src/workflow.js` so workflow file paths come from `agent.runtime.workflow`.
- Modify `packages/agent-runtime/src/install.js` and `packages/agent-runtime/src/runs.js` so install paths, run paths, and state file names use manifest artifact settings.
- Modify `packages/agent-runtime/src/prompts.js` so selected `agent.md` sections are included in rendered phase prompts.
- Modify `packages/alloycat/src/index.js` so `alloycat list` displays metadata loaded from `agent.md`.
- Modify interactive install selection so it also displays metadata loaded from `agent.md`.
- Modify `catalog.yaml` so catalog entries only contain package-locating data after `agent.md` becomes canonical.
- Create `agents/interaction-auditor/agent.md`.
- Delete `agents/interaction-auditor/agent.yaml`.
- Delete `agents/interaction-auditor/README.md`.
- Modify `scripts/validate-catalog.mjs` so validation requires `agent.md`, validates frontmatter, validates prompt-context sections, and validates workflow links.
- Modify `scripts/pack-alloycat.mjs` so packaged validation requires `agent.md` and package contents include it.
- Modify tests in `tests/agent-runtime.test.mjs`, `tests/alloycat-cli.test.mjs`, `tests/alloycat-package.test.mjs`, and `tests/validate-catalog.test.mjs`.

---

## Commit Guidance

Tasks 1 through 5 are one migration unit because deleting `agent.yaml` and shrinking `catalog.yaml` before runtime, CLI, validation, and packaging all understand `agent.md` would leave the working tree failing. Commit only after Task 5 checks pass.

---

### Task 1: Add Manifest Parser Tests

**Files:**
- Create: `packages/agent-runtime/src/manifest.js`
- Modify: `tests/agent-runtime.test.mjs`
- Modify: `packages/agent-runtime/src/index.js`

- [ ] **Step 1: Write failing tests for loading `agent.md`**

Add these imports to `tests/agent-runtime.test.mjs`:

```js
import {
  extractMarkdownSection,
  isAnyAbsolute,
  loadAgentDocument,
  parseAgentMarkdown,
  resolveAgentProjectPath,
  resolveArtifactTemplate
} from '../packages/agent-runtime/src/index.js';
```

Add this parser-only test near the catalog tests. Keep file-backed `loadAgentDocument()` coverage for Task 2, after `agent.md` exists:

```js
test('parses agent.md frontmatter and selected Markdown sections', () => {
  const document = parseAgentMarkdown(`---
schema_version: 1
id: interaction-auditor
name: Alloy Interaction Auditor
runtime:
  model: workflow
  workflow: workflow.yaml
artifacts:
  run_root: .alloycat/agents/{agent_id}/runs
prompt_context:
  include_sections:
    - Operating Rules
---

# Alloy Interaction Auditor

## Operating Rules

Follow the phase-gated workflow.
`);

  assert.equal(document.manifest.id, 'interaction-auditor');
  assert.equal(document.manifest.schema_version, 1);
  assert.equal(document.manifest.name, 'Alloy Interaction Auditor');
  assert.equal(document.manifest.runtime.model, 'workflow');
  assert.equal(document.manifest.runtime.workflow, 'workflow.yaml');
  assert.equal(document.manifest.artifacts.run_root, '.alloycat/agents/{agent_id}/runs');
  assert.deepEqual(document.manifest.prompt_context.include_sections, ['Operating Rules']);
  assert.match(
    extractMarkdownSection(document.body, 'Operating Rules'),
    /Follow the phase-gated workflow/
  );
});
```

Add this test after the parser-only test:

If `tests/agent-runtime.test.mjs` does not already import them, add:

```js
import { cpSync } from 'node:fs';
import { sep } from 'node:path';
```

```js
test('resolves manifest artifact templates with restricted placeholders', () => {
  assert.equal(
    resolveArtifactTemplate('.alloycat/agents/{agent_id}/runs', {
      agentId: 'interaction-auditor'
    }),
    '.alloycat/agents/interaction-auditor/runs'
  );

  assert.throws(
    () => resolveArtifactTemplate('.alloycat/{unknown}', {
      agentId: 'interaction-auditor'
    }),
    /Unknown artifact path placeholder: unknown/
  );

  assert.throws(
    () => resolveArtifactTemplate('{project_root}/.alloycat/{agent_id}', {
      agentId: 'interaction-auditor'
    }),
    /Unknown artifact path placeholder: project_root/
  );

  assert.throws(
    () => resolveArtifactTemplate('.alloycat/{agent-id}', {
      agentId: 'interaction-auditor'
    }),
    /Unknown artifact path placeholder: agent-id/
  );

  assert.throws(
    () => resolveArtifactTemplate('.alloycat\\agents\\{agent_id}', {
      agentId: 'interaction-auditor'
    }),
    /must use POSIX separators/
  );

  assert.throws(
    () => resolveArtifactTemplate('C:/outside/{agent_id}', {
      agentId: 'interaction-auditor'
    }),
    /must be relative/
  );

  assert.throws(
    () => resolveAgentProjectPath('/tmp/project', { id: 'interaction-auditor' }, '.'),
    /must not resolve to the project root/
  );
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
node --test tests/agent-runtime.test.mjs
```

Expected: fail because `loadAgentDocument`, `extractMarkdownSection`, `resolveAgentProjectPath`, and `resolveArtifactTemplate` are not exported.

- [ ] **Step 3: Implement minimal manifest parser**

Create `packages/agent-runtime/src/manifest.js`:

```js
import { readFileSync } from 'node:fs';
import { join, relative, resolve, posix, win32 } from 'node:path';

function cleanValue(value) {
  return value.trim().replace(/^["']|["']$/g, '');
}

function coerceValue(value) {
  const cleaned = cleanValue(value);
  if (cleaned === 'true') return true;
  if (cleaned === 'false') return false;
  if (/^-?\d+$/.test(cleaned)) return Number(cleaned);
  return cleaned;
}

function setNested(target, path, value) {
  let current = target;
  for (const key of path.slice(0, -1)) {
    current[key] ??= {};
    current = current[key];
  }
  current[path.at(-1)] = value;
}

function parseFrontmatterYaml(text) {
  const root = {};
  const stack = [{ indent: -1, path: [] }];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;

    const listItem = line.match(/^(\s*)-\s+(.+)$/);
    if (listItem) {
      const indent = listItem[1].length;
      while (stack.at(-1).indent >= indent) stack.pop();
      const parentPath = stack.at(-1).path;
      const parent = parentPath.reduce((value, key) => value[key], root);
      if (!Array.isArray(parent)) {
        throw new Error(`List item has no list parent: ${line}`);
      }
      parent.push(coerceValue(listItem[2]));
      continue;
    }

    const property = line.match(/^(\s*)([a-z0-9_-]+):\s*(.*)$/);
    if (!property) {
      throw new Error(`Unsupported frontmatter line: ${line}`);
    }

    const [, rawIndent, key, rawValue] = property;
    const indent = rawIndent.length;
    while (stack.at(-1).indent >= indent) stack.pop();
    const path = [...stack.at(-1).path, key];

    if (rawValue === '') {
      const nextLine = lines[index + 1] ?? '';
      const value = /^\s*-\s+/.test(nextLine) ? [] : {};
      setNested(root, path, value);
      stack.push({ indent, path });
    } else {
      setNested(root, path, coerceValue(rawValue));
    }
  }

  return root;
}

export function isAnyAbsolute(candidatePath) {
  return posix.isAbsolute(candidatePath) || win32.isAbsolute(candidatePath);
}

export function resolvePackageRelativePath(basePath, candidatePath, label) {
  if (candidatePath.includes('\\')) {
    throw new Error(`${label} must use POSIX separators: ${candidatePath}`);
  }
  if (isAnyAbsolute(candidatePath)) {
    throw new Error(`${label} must be relative: ${candidatePath}`);
  }
  if (candidatePath.split('/').includes('..')) {
    throw new Error(`${label} must not contain .. segments: ${candidatePath}`);
  }
  const normalizedPath = posix.normalize(candidatePath);
  const fullPath = resolve(basePath, normalizedPath);
  const relativePath = relative(basePath, fullPath);
  if (relativePath === '' || relativePath.startsWith('..') || isAnyAbsolute(relativePath)) {
    throw new Error(`${label} escapes the package root: ${candidatePath}`);
  }
  return normalizedPath;
}

export function parseAgentMarkdown(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error('agent.md must start with YAML frontmatter.');
  }

  return {
    manifest: parseFrontmatterYaml(match[1]),
    body: match[2].trim()
  };
}

export function loadAgentDocument(repoRoot, relativePath) {
  const safePath = resolvePackageRelativePath(repoRoot, relativePath, 'agent document path');
  return parseAgentMarkdown(readFileSync(join(repoRoot, safePath), 'utf8'));
}

export function extractMarkdownSection(markdown, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lines = markdown.split(/\r?\n/);
  const headingPattern = new RegExp(`^## ${escaped}\\s*$`);
  const startIndex = lines.findIndex((line) => headingPattern.test(line));
  if (startIndex === -1) {
    return null;
  }

  const sectionLines = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (/^##\s+/.test(line)) {
      break;
    }
    sectionLines.push(line);
  }
  return sectionLines.join('\n').trim();
}

export function resolveArtifactTemplate(template, values) {
  if (template.includes('\\')) {
    throw new Error(`Agent artifact path template must use POSIX separators: ${template}`);
  }
  if (isAnyAbsolute(template)) {
    throw new Error(`Agent artifact path template must be relative: ${template}`);
  }
  const resolved = template.replace(/\{([^}]+)\}/g, (_, key) => {
    if (key === 'agent_id') return values.agentId;
    throw new Error(`Unknown artifact path placeholder: ${key}`);
  });
  if (/[{}]/.test(resolved)) {
    throw new Error(`Invalid artifact path template: ${template}`);
  }
  return resolved;
}

export function resolveAgentProjectPath(projectRoot, agent, template) {
  const fullPath = resolve(projectRoot, resolveArtifactTemplate(template, {
    agentId: agent.id,
    projectRoot
  }));
  const relativePath = relative(projectRoot, fullPath);
  if (relativePath === '') {
    throw new Error(`Agent artifact path must not resolve to the project root: ${template}`);
  }
  if (relativePath.startsWith('..') || isAnyAbsolute(relativePath)) {
    throw new Error(`Agent artifact path escapes the project root: ${template}`);
  }
  return fullPath;
}
```

Update `packages/agent-runtime/src/index.js` by adding these exports alongside the existing runtime exports. Do not replace existing exports such as `loadAgent`, `installAgent`, `createRun`, or `renderNextPrompt`:

```js
export {
  extractMarkdownSection,
  isAnyAbsolute,
  loadAgentDocument,
  parseAgentMarkdown,
  resolvePackageRelativePath,
  resolveAgentProjectPath,
  resolveArtifactTemplate
} from './manifest.js';
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
node --test tests/agent-runtime.test.mjs
```

Expected: parser and artifact-template tests pass without requiring `agents/interaction-auditor/agent.md` to exist yet.

- [ ] **Step 5: Hold parser changes for the migration commit**

Do not commit yet. Hold these changes for the single Task 1-5 migration commit after runtime, CLI, repository validation, and packaged validation are all green.

---

### Task 2: Migrate Interaction Auditor To `agent.md`

**Files:**
- Create: `agents/interaction-auditor/agent.md`
- Create: `agents/interaction-auditor/adapters/primary-cli/README.md`
- Create: `agents/interaction-auditor/adapters/secondary-cli/README.md`
- Delete: `agents/interaction-auditor/agent.yaml`
- Delete: `agents/interaction-auditor/README.md`
- Modify: `README.md`
- Modify: `tests/agent-runtime.test.mjs`
- Modify: `tests/validate-catalog.test.mjs`

- [ ] **Step 1: Write failing tests for canonical `agent.md` package files**

In `tests/validate-catalog.test.mjs`, update agent package checks to require `agent.md` and not require agent README placeholders. Do not add adapter placeholder assertions here; adapter path validation belongs to Task 5 after the validator reads `agent.md`:

```js
test('interaction auditor uses canonical agent.md', () => {
  assert.equal(
    existsSync(resolve(repoRoot, 'agents', 'interaction-auditor', 'agent.md')),
    true,
    'Missing canonical agent.md for interaction-auditor'
  );
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
node --test tests/validate-catalog.test.mjs
```

Expected: fail with `Missing canonical agent.md for interaction-auditor`.

- [ ] **Step 3: Create `agent.md`**

Create `agents/interaction-auditor/agent.md`:

```md
---
schema_version: 1
id: interaction-auditor
name: Alloy Interaction Auditor
type: phase-gated-agent
version: 0.1.0
status: draft
description: Agent that audits visible UI behavior, source-of-truth conformance, and e2e coverage.

runtime:
  model: workflow
  workflow: workflow.yaml

artifacts:
  install_root: .alloycat/agents/{agent_id}
  run_root: .alloycat/agents/{agent_id}/runs
  state_file: state.json

prompt_context:
  include_sections:
    - Operating Rules
    - Evidence Rules
    - Forbidden Actions

supports:
  hosts:
    primary-cli:
      adapter_path: adapters/primary-cli
      status: skeleton
    secondary-cli:
      adapter_path: adapters/secondary-cli
      status: skeleton

quality_gates:
  requires_project_discovery: true
  requires_user_scope_confirmation: true
  requires_persistent_artifacts: true
  forbids_single_prompt_full_run: true
  requires_tests: true
---

# Alloy Interaction Auditor

Audits visible UI behavior, source-of-truth conformance, and e2e coverage through a phase-gated workflow.

## Scope

The agent is designed for desktop, web, and mobile UI products. It does not assume the target project is a prototype. The target project type, UI surfaces, runtime commands, and source-of-truth materials are discovered before audit execution.

## Runtime Model

This agent uses a phase-gated workflow:

1. Resolve project root.
2. Discover project structure and UI inventory.
3. Classify source-of-truth materials.
4. Confirm scope with the user.
5. Build a branch plan.
6. Run selected audit tracks.
7. Assemble the final report.

Run artifacts are durable and live under `.alloycat/agents/interaction-auditor/runs/<run-id>` unless the user chooses a different run root.

## Operating Rules

Follow the phase-gated workflow. Do not skip discovery, source classification, branch planning, or user confirmation gates. Use run artifacts as the durable source of context between phases.

## Evidence Rules

Findings must cite concrete evidence from runtime behavior, source files, tests, screenshots, logs, or authoritative project materials. Do not invent missing evidence during report assembly.

## Forbidden Actions

Do not fix product code during audit mode. Do not treat static source assertions as a substitute for required runtime or e2e evidence. Do not claim visual drift from reference-only or stale design sources.
```

Create skeletal adapter README files for each host declared in `agent.md`. Each README should name the host, declare that the adapter is a skeleton, and state which future host-specific entry file will own native install/use instructions. Empty directories or `.gitkeep` placeholders do not satisfy the manifest contract.

- [ ] **Step 4: Add file-backed manifest loading coverage**

Add this test to `tests/agent-runtime.test.mjs` now that `agent.md` exists:

```js
test('loads agent.md frontmatter and selected Markdown sections from disk', () => {
  const document = loadAgentDocument(repoRoot, 'agents/interaction-auditor/agent.md');

  assert.equal(document.manifest.id, 'interaction-auditor');
  assert.equal(document.manifest.name, 'Alloy Interaction Auditor');
  assert.equal(document.manifest.runtime.model, 'workflow');
  assert.equal(document.manifest.runtime.workflow, 'workflow.yaml');
  assert.equal(document.manifest.artifacts.run_root, '.alloycat/agents/{agent_id}/runs');
  assert.deepEqual(document.manifest.prompt_context.include_sections, [
    'Operating Rules',
    'Evidence Rules',
    'Forbidden Actions'
  ]);
  assert.match(
    extractMarkdownSection(document.body, 'Operating Rules'),
    /Follow the phase-gated workflow/
  );
});
```

- [ ] **Step 5: Remove split metadata files**

Run:

```bash
git rm agents/interaction-auditor/agent.yaml agents/interaction-auditor/README.md
```

- [ ] **Step 6: Update root README shape**

In `README.md`, change the agent package shape from:

```text
    agent.yaml
    workflow.yaml
    prompts/
```

to:

```text
    agent.md
    workflow.yaml
    prompts/
```

- [ ] **Step 7: Run migration tests to verify expected transitional failure**

Run:

```bash
node --test tests/agent-runtime.test.mjs
```

Expected: `agent.md` migration changes are present, while runtime-loading tests may still fail until Task 3 makes the runtime manifest-driven. Do not run validation tests in this transitional step because adapter placeholder coverage and validator migration are intentionally deferred to Task 5.

- [ ] **Step 8: Hold migration changes for the migration commit**

Do not commit yet. Deleting `agent.yaml` is only safe after Task 3 updates runtime loading.

---

### Task 3: Make Runtime Manifest-Driven

**Files:**
- Modify: `packages/agent-runtime/src/catalog.js`
- Modify: `packages/agent-runtime/src/workflow.js`
- Modify: `packages/agent-runtime/src/install.js`
- Modify: `packages/agent-runtime/src/index.js`
- Modify: `packages/agent-runtime/src/prompts.js`
- Modify: `packages/agent-runtime/src/runs.js`
- Modify: `packages/alloycat/src/index.js`
- Modify: `catalog.yaml`
- Modify: `tests/agent-runtime.test.mjs`
- Modify: `tests/alloycat-cli.test.mjs`

- [ ] **Step 1: Write failing tests for manifest-driven paths**

Add this test to `tests/agent-runtime.test.mjs`:

```js
test('install and run paths are derived from agent.md artifacts', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-manifest-paths-'));
  try {
    const install = installAgent(repoRoot, {
      agentId: 'interaction-auditor',
      project: tempRoot
    });
    const run = createRun(repoRoot, {
      agentId: 'interaction-auditor',
      project: tempRoot,
      runId: 'manifest-run'
    });

    assert.equal(install.runRoot, join(tempRoot, '.alloycat', 'agents', 'interaction-auditor', 'runs'));
    assert.equal(run.runDir, join(tempRoot, '.alloycat', 'agents', 'interaction-auditor', 'runs', 'manifest-run'));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
```

Add state-file coverage to the same test:

```js
assert.equal(run.statePath, join(run.runDir, 'state.json'));
assert.equal(loadRunState(run.runDir, { stateFile: run.stateFile }).run_id, 'manifest-run');
```

Add a fixture-copy test that changes `state_file: state.json` to `state_file: run-state.json`, then asserts `createRun()` returns `stateFile: 'run-state.json'` and `statePath` ending in `run-state.json`, and that `loadRunState(runDir, { stateFile: 'run-state.json' })` plus `saveRunState(runDir, state, { stateFile: 'run-state.json' })` use that file.

Add a companion runtime test that temporarily changes the manifest run root to `../outside` in a fixture copy and asserts `installAgent()` rejects manifest-derived run paths outside the project root before any installed run is created.

Add source-loading regression tests that mutate copied fixtures before `loadAgent()` or workflow loading runs:

- a `catalog.yaml` entry with `path: C:/outside`, `path: ../outside`, `path: agents\\interaction-auditor`, or `path: .` is rejected before `agent.md` is read;
- an `agent.md` with `runtime.workflow: C:/outside.yaml`, `runtime.workflow: ../outside.yaml`, `runtime.workflow: workflow\\bad.yaml`, or `runtime.workflow: .` is rejected before the workflow file is read.

Use a copied repo fixture so the real catalog is untouched:

```js
function copyRepoFixture(sourceRoot, prefix) {
  const targetRoot = mkdtempSync(join(tmpdir(), prefix));
  cpSync(sourceRoot, targetRoot, {
    recursive: true,
    filter: (path) => !path.includes(`${sep}.git${sep}`) && !path.includes(`${sep}node_modules${sep}`)
  });
  return targetRoot;
}

test('manifest artifact paths cannot escape the project root', () => {
  const tempRepo = copyRepoFixture(repoRoot, 'alloycat-manifest-escape-');
  const tempProject = mkdtempSync(join(tmpdir(), 'alloycat-project-'));
  try {
    const agentPath = join(tempRepo, 'agents', 'interaction-auditor', 'agent.md');
    writeFileSync(
      agentPath,
      readFileSync(agentPath, 'utf8').replace(
        'run_root: .alloycat/agents/{agent_id}/runs',
        'run_root: ../outside'
      )
    );

    assert.throws(
      () => installAgent(tempRepo, {
        agentId: 'interaction-auditor',
        project: tempProject
      }),
      /escapes the project root/
    );
  } finally {
    rmSync(tempRepo, { recursive: true, force: true });
    rmSync(tempProject, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
node --test tests/agent-runtime.test.mjs
```

Expected: fail before runtime reads `agent.md`.

- [ ] **Step 3: Update `loadAgent()`**

Replace `loadAgent()` internals in `packages/agent-runtime/src/catalog.js` so it reads `agent.md`:

```js
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAgentMarkdown, resolvePackageRelativePath } from './manifest.js';

export function loadAgent(repoRoot, agentId) {
  const catalog = loadCatalog(repoRoot);
  const catalogEntry = catalog.agents.find((agent) => agent.id === agentId);
  if (!catalogEntry) {
    throw new Error(`Unknown agent: ${agentId}`);
  }

  const agentPath = resolvePackageRelativePath(repoRoot, catalogEntry.path, `catalog.yaml path for ${agentId}`);
  const document = parseAgentMarkdown(readFileSync(join(repoRoot, agentPath, 'agent.md'), 'utf8'));
  const manifest = {
    ...catalogEntry,
    ...document.manifest,
    path: agentPath,
    documentBody: document.body
  };

  if (manifest.id !== catalogEntry.id) {
    throw new Error(`Agent id mismatch for ${catalogEntry.path}: catalog has ${catalogEntry.id}, agent.md has ${manifest.id}`);
  }

  return manifest;
}
```

Update existing runtime metadata assertions that still expect flat `runtime_model` fields. They should assert the manifest-backed shape:

```js
assert.equal(agent.runtime.model, 'workflow');
assert.equal(agent.runtime.workflow, 'workflow.yaml');
assert.equal(agent.status, 'draft');
```

Also add a catalog-shape assertion that raw `catalog.yaml` entries contain only package-locating data after migration:

```js
assert.deepEqual(catalog.agents[0], {
  id: 'interaction-auditor',
  path: 'agents/interaction-auditor'
});
```

- [ ] **Step 4: Write failing CLI tests for manifest-backed catalog output**

Add CLI tests before implementation for:

- `alloycat list` prints status and description from `agent.md` after `catalog.yaml` drops display metadata;
- `alloycat info interaction-auditor` prints manifest metadata and useful Markdown body fields from `agent.md`;
- interactive `alloycat install` without an agent id prints choice rows from loaded manifests, not raw catalog entries.

Run the CLI test file and verify these tests fail until command output is manifest-backed.

- [ ] **Step 5: Update catalog shape and CLI list output**

Change `catalog.yaml` entries so they keep only package-locating data:

```yaml
agents:
  - id: interaction-auditor
    path: agents/interaction-auditor
```

Do not update `scripts/validate-catalog.mjs` or packaged validation in this step. Task 5 writes failing validation/package tests first, then updates those validators. For runtime and CLI behavior here, status, version, description, supported hosts, and quality gates must come from `agent.md`.

Update `packages/alloycat/src/index.js` so `commandList()` loads each agent manifest before printing display metadata:

```js
function commandList() {
  const catalog = loadCatalog(repoRoot);
  for (const entry of catalog.agents) {
    const agent = loadAgent(repoRoot, entry.id);
    console.log(`${agent.id}\t${agent.status}\t${agent.description}`);
  }
}
```

Update interactive install selection the same way, so `alloycat install` without an agent id does not print `undefined` after `catalog.yaml` drops display metadata:

```js
function printAgentChoices(catalog, action = 'install') {
  console.log(`Select an agent to ${action}:`);
  console.log('');
  catalog.agents.forEach((entry, index) => {
    const agent = loadAgent(repoRoot, entry.id);
    console.log(`${index + 1}. ${agent.id}\t${agent.status}\t${agent.description}`);
  });
  console.log('');
}
```

Keep `commandInfo()` manifest-backed as well:

```js
function commandInfo(agentId) {
  const agent = loadAgent(repoRoot, agentId);
  console.log(JSON.stringify(agent, null, 2));
}
```

- [ ] **Step 6: Update workflow loading**

In `packages/agent-runtime/src/workflow.js`, change the workflow path:

```js
const workflowPath = resolvePackageRelativePath(
  join(repoRoot, agent.path),
  agent.runtime?.workflow ?? 'workflow.yaml',
  `${agent.id} runtime.workflow`
);
const text = readFileSync(join(repoRoot, agent.path, workflowPath), 'utf8');
```

Import `resolvePackageRelativePath` from `./manifest.js` in this module. Also return `id: agent.id` instead of `id: agentId`.

- [ ] **Step 7: Write failing installed-project CLI and runtime tests**

Before changing install/run code, add CLI/runtime tests with a copied catalog fixture using `state_file: run-state.json`:

- `install` persists on-disk `state_file` in `.alloycat/agents/<agent-id>/index.json`, and `loadInstalledAgent()` exposes it as `stateFile`;
- `install` copies `agent.md`, the runtime workflow file, phase prompt files, and any workflow-referenced `schema:` or `template:` runtime assets under `.alloycat/agents/<agent-id>/package/`;
- installed commands honor persisted `run_root` from `index.json` even if `manifest_snapshot.artifacts.run_root` later differs;
- installed commands reject `index.json` before use when `agent_id` mismatches the install directory or manifest snapshot;
- installed commands reject `index.json` before use when `install_dir`, `run_root`, `installed_package_dir`, `agent_document_path`, `workflow_path`, or `prompt_root` is absolute, contains backslashes, resolves to the allowed parent/root itself, or escapes its allowed parent;
- installed-index absolute-path rejection covers both `/outside` and `C:/outside` forms on every platform;
- installed commands reject `index.json` before use when `state_file` is missing, empty, `.`, `..`, absolute, contains path separators, or contains placeholders;
- `init` writes `run-state.json`, not `state.json`;
- `status`, `remind`, and `next` find the active run without `--run` when exactly one installed agent and active run exist;
- explicit `--run <run-dir>` works when the run belongs to the installed agent;
- agent-scoped `uninstall` removes only that agent directory and full-project `uninstall` removes `.alloycat`;
- after `install`, deleting or mutating source `catalog.yaml`, source `agent.md`, source `workflow.yaml`, source `prompts/`, and any source `schemas/` or `templates/` referenced by workflow outputs does not break `init`, `status`, `remind`, `next`, explicit `--run`, `completeRun()`, or active-run discovery because those commands read the installed package and `.alloycat/agents/<agent-id>/index.json`.

Run:

```bash
node --test tests/alloycat-cli.test.mjs tests/agent-runtime.test.mjs
```

Expected: fail until installed-project commands use the installed agent contract.

- [ ] **Step 8: Update install and run path resolution**

In `packages/agent-runtime/src/install.js`, import `resolveAgentProjectPath` and derive paths from manifest artifacts:

```js
import { resolveAgentProjectPath } from './manifest.js';
```

Use it in `installAgent()`. Keep `install_root` fixed to `.alloycat/agents/{agent_id}` for this migration; `listInstalledAgents()`, `uninstall`, implicit `init/status/remind/next`, and active-run lookup still discover installed agents from `.alloycat/agents/<agent-id>`.

```js
const installDir = resolveAgentProjectPath(projectRoot, agent, agent.artifacts.install_root);
const runRoot = resolveAgentProjectPath(projectRoot, agent, agent.artifacts.run_root);
```

Add a helper for values persisted into installed `index.json`:

```js
function toProjectRelativePosix(projectRoot, absolutePath) {
  return relative(projectRoot, absolutePath).split(sep).join('/');
}
```

Import `sep` from `node:path` wherever this helper is defined.

Add a Windows-path regression assertion using a project fixture path that would make native `relative()` return backslashes, then assert persisted `install_dir` and `run_root` use `/`.

When `install` succeeds, write `.alloycat/agents/<agent-id>/index.json` with the installed runtime contract:

```js
{
  agent_id: agent.id,
  install_dir: toProjectRelativePosix(projectRoot, installDir),
  run_root: toProjectRelativePosix(projectRoot, runRoot),
  state_file: agent.artifacts.state_file,
  manifest_snapshot: agent,
  installed_package_dir: 'package',
  agent_document_path: 'agent.md',
  workflow_path: agent.runtime.workflow,
  prompt_root: 'prompts'
}
```

Also copy the runtime files needed by installed-project commands into `.alloycat/agents/<agent-id>/package/`. At minimum this includes `agent.md`, the workflow file referenced by `agent.runtime.workflow`, every prompt file referenced by that workflow, and every workflow-referenced `schema:` or `template:` runtime asset when those fields are present. Installed prompt rendering and phase advancement must resolve package paths from this copied package directory rather than the source catalog checkout.

In `packages/agent-runtime/src/runs.js`, load the agent before computing default `runRoot`:

```js
import { findInstalledAgent } from './install.js';

const installedAgent = options.installedAgent ?? findInstalledAgent(projectRoot, agentId);
const agent = installedAgent?.manifestSnapshot ?? loadAgent(repoRoot, agentId);
const defaultRunRoot = installedAgent
  ? resolve(projectRoot, installedAgent.runRoot)
  : resolveAgentProjectPath(projectRoot, agent, agent.artifacts.run_root);
const runRoot = options.runRoot ? resolve(projectRoot, options.runRoot) : defaultRunRoot;
const stateFile = installedAgent?.stateFile ?? agent.artifacts.state_file;
```

Explicit `--run-root` values are user-directed overrides and may point outside `.alloycat`; manifest-derived defaults must stay inside the target project. The installed agent config must persist on-disk `install_dir`, `run_root`, and `state_file`; the loader may expose camelCase `installDir`, `runRoot`, and `stateFile`. Installed commands must use those persisted values instead of re-deriving paths from manifest templates.

Use `stateFile` wherever run state paths are built:

```js
function statePathForRun(runDir, stateFile = 'state.json') {
  return join(runDir, stateFile);
}

function loadRunState(runDir, options = {}) {
  return JSON.parse(readFileSync(statePathForRun(runDir, options.stateFile), 'utf8'));
}

function saveRunState(runDir, state, options = {}) {
  writeFileSync(statePathForRun(runDir, options.stateFile), `${JSON.stringify(state, null, 2)}\n`);
}
```

Add `loadInstalledAgent(projectRoot, agentId)` for commands that require an installed agent and `findInstalledAgent(projectRoot, agentId)` for source-catalog runtime tests or explicit source runs where installation may not exist yet. Update `listInstalledAgents()` to read each `.alloycat/agents/<agent-id>/index.json` and expose `installDir`, `runRoot`, `stateFile`, `manifestSnapshot`, `installedPackageDir`, `workflowPath`, and `promptRoot`. Installed-agent loading must fail before returning when ids mismatch or any installed index path is absolute or escapes its allowed parent. Update `createRun()` to return both `stateFile` and `statePath`. Update `loadRunState(runDir, { stateFile })`, `saveRunState(runDir, state, { stateFile })`, `completeRun()`, prompt rendering, `status`, `remind`, `next`, and CLI active-run discovery so commands use the installed agent config when one exists and fall back to the source manifest only for source-catalog execution. Source `loadAgent(repoRoot, agentId)` remains for source catalog commands and install source resolution only. The installed config persists on-disk `state_file` next to `run_root`; installed-agent loaders expose those as `stateFile` and `runRoot`. If an explicit `--run` path is outside installed config, the CLI must either use the default `state.json` or require the caller to provide enough context to identify the installed agent rather than guessing every possible state file name.

- [ ] **Step 9: Run runtime and CLI tests**

Run:

```bash
node --test tests/agent-runtime.test.mjs
node --test tests/alloycat-cli.test.mjs
```

Expected: runtime and CLI tests pass.

- [ ] **Step 10: Hold runtime migration changes for the migration commit**

Do not commit yet. Commit after Task 5 validates runtime, CLI, repository validation, and packaged validation together.

---

### Task 4: Render Agent-Level Prompt Context

**Files:**
- Modify: `packages/agent-runtime/src/prompts.js`
- Modify: `tests/agent-runtime.test.mjs`

- [ ] **Step 1: Write failing prompt context test**

In `tests/agent-runtime.test.mjs`, extend the prompt rendering test:

```js
assert.match(prompt, /## Agent Context/);
assert.match(prompt, /### Operating Rules/);
assert.match(prompt, /Follow the phase-gated workflow/);
assert.match(prompt, /### Evidence Rules/);
assert.match(prompt, /Findings must cite concrete evidence/);
assert.match(prompt, /### Forbidden Actions/);
assert.doesNotMatch(prompt, /## Runtime Model/);
```

Add an installed-project prompt context test after Task 3's installed package support exists:

- install `interaction-auditor` into a temporary project;
- mutate or remove the source `agent.md`;
- render the current prompt from the installed run;
- assert `## Agent Context` and the selected sections still render from installed state.

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
node --test tests/agent-runtime.test.mjs
```

Expected: fail because rendered prompts do not include agent-level context.

- [ ] **Step 3: Implement selected section rendering**

In `packages/agent-runtime/src/prompts.js`, import and use `extractMarkdownSection`:

```js
import { extractMarkdownSection } from './manifest.js';
```

Add helper:

```js
function renderAgentContext(agent) {
  const sectionNames = agent.prompt_context?.include_sections ?? [];
  if (sectionNames.length === 0) {
    return '';
  }

  const lines = ['## Agent Context', ''];
  for (const sectionName of sectionNames) {
    const section = extractMarkdownSection(agent.documentBody ?? '', sectionName);
    if (!section) {
      throw new Error(`Agent prompt context section is missing: ${sectionName}`);
    }
    lines.push(`### ${sectionName}`, '', section, '');
  }
  return lines.join('\n').trim();
}
```

Insert it before phase artifacts in `renderNextPrompt()`:

```js
const agentContext = renderAgentContext(workflow.agent);
if (agentContext) {
  lines.push('', agentContext);
}
```

- [ ] **Step 4: Run prompt tests**

Run:

```bash
node --test tests/agent-runtime.test.mjs
```

Expected: all runtime tests pass.

- [ ] **Step 5: Hold prompt context changes for the migration commit**

Do not commit yet. Commit after Task 5 validates runtime, CLI, repository validation, and packaged validation together.

---

### Task 5: Update Validation And Packaging

**Files:**
- Modify: `agents/interaction-auditor/workflow.yaml`
- Create/Modify: `agents/interaction-auditor/schemas/00-project-root.schema.json`
- Create/Modify: `agents/interaction-auditor/schemas/02-ui-inventory.schema.json`
- Create/Modify: `agents/interaction-auditor/schemas/05-branch-plan.schema.json`
- Create/Modify: `agents/interaction-auditor/templates/scope-confirmation.md`
- Create/Modify: `agents/interaction-auditor/templates/branch-plan.json`
- Create/Modify: `agents/interaction-auditor/templates/final-report.md`
- Modify: `scripts/validate-catalog.mjs`
- Modify: `scripts/pack-alloycat.mjs`
- Modify: `tests/validate-catalog.test.mjs`
- Modify: `tests/alloycat-package.test.mjs`

- [ ] **Step 1: Write failing validation tests**

In `tests/validate-catalog.test.mjs`, update test names and assertions:

```js
test('catalog validation accepts the Interaction Auditor markdown manifest', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-catalog.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 1 agent\./);
});
```

In `tests/alloycat-package.test.mjs`, update package listing assertions:

```js
assert.match(listing.stdout, /package\/catalog\/agents\/interaction-auditor\/agent\.md/);
assert.match(listing.stdout, /package\/catalog\/agents\/interaction-auditor\/adapters\/primary-cli\/README\.md/);
assert.match(listing.stdout, /package\/catalog\/agents\/interaction-auditor\/adapters\/secondary-cli\/README\.md/);
assert.doesNotMatch(listing.stdout, /package\/catalog\/agents\/interaction-auditor\/agent\.yaml/);
assert.doesNotMatch(listing.stdout, /package\/catalog\/agents\/interaction-auditor\/README\.md/);
```

Also add packaged-validation negative tests. Each case should stage or extract the package catalog, mutate only the staged package contents, run the packaged validator path, and assert the package is rejected. Cover at least:

- every repository negative validation rule listed below, using packaged paths instead of source paths;
- malformed `package/catalog/agents/interaction-auditor/agent.md` frontmatter;
- catalog id mismatch, non-string catalog `id`, non-string catalog `path`, catalog path escape, and extra catalog metadata;
- scalar field type errors, invalid `schema_version`, invalid `type`, invalid `version`, invalid `status`, and invalid `runtime.model`;
- `runtime.workflow` path escape, backslashes, package-root resolution, workflow id mismatch, workflow `prompt:` path escape/backslashes/package-root resolution, and missing or unsafe workflow `schema:` or `template:` paths;
- prompt-context shape errors and missing headings;
- malformed artifact fields, including unknown placeholders, bad `install_root`, escaped `run_root`, `state_file` path separators, and `state_file` values `.` or `..`;
- supported host adapter validation and quality gate validation, including scalar or array `quality_gates`.

Add negative validator tests using temporary copied catalogs for:

- malformed `agents/interaction-auditor/agent.md` frontmatter;
- catalog id differs from `agent.md` id;
- catalog `id` or `path` is not a string;
- catalog `path` is absolute, contains backslashes, resolves to the catalog root, or escapes the catalog root with `..`;
- catalog entry contains metadata keys other than `id` and `path`, such as `status`, `version`, or `description`;
- `schema_version` is not `1`;
- non-string scalar fields appear where strings are required, including `id`, `name`, `description`, `runtime.workflow`, artifact templates, `artifacts.state_file`, host `adapter_path`, and host `status`;
- `type` is not `phase-gated-agent`;
- `version` is not semver;
- `status` is not `draft`, `experimental`, `stable`, or `deprecated`;
- `runtime.model` is not `workflow`;
- `runtime.workflow` is absolute, contains backslashes, resolves to the package root, or escapes the agent package with `..`;
- the workflow id differs from `agent.md` id;
- a workflow `prompt:` path is absolute, contains backslashes, resolves to the package root, or escapes the agent package with `..`;
- a workflow `schema:` or `template:` path is missing, absolute, contains backslashes, resolves to the package root, or escapes the agent package with `..`;
- a required Interaction Auditor workflow output is missing required metadata: `00-project-root.json` and `02-ui-inventory.json` require `schema:`, `04-confirmed-scope.md` and `07-final-report.md` require `template:`, and `05-branch-plan.json` requires both `schema:` and `template:`;
- `prompt_context.include_sections` is missing, empty, or not a list;
- `prompt_context.include_sections` references a missing heading;
- artifact templates are absolute, contain unknown placeholders, or escape the expected project-local hierarchy;
- `artifacts.install_root` differs from `.alloycat/agents/{agent_id}`;
- artifact templates contain backslashes or resolve to the project root;
- `artifacts.state_file` is `.`, `..`, or contains path separators or placeholders;
- `supports.hosts` is missing, empty, or not an object;
- a supported host omits `adapter_path` or `status`;
- a supported host adapter path is absolute or escapes the agent package with `..`;
- a supported host adapter path contains backslashes or resolves to the package root;
- a supported host adapter directory lacks both `README.md` and a host-specific entry file;
- adapter status is not one of `skeleton`, `experimental`, `stable`, or `deprecated`;
- `quality_gates` is a scalar or array instead of an object;
- a required quality gate key is missing;
- a quality gate value is not boolean.

Every absolute-path negative group must include both POSIX-style (`/outside`) and Windows-style (`C:/outside`) examples, even when tests run on POSIX. Cover catalog paths, `runtime.workflow`, workflow `prompt:`/`schema:`/`template:` references, artifact templates, adapter paths, packaged catalog paths, and installed-index paths.

Also update `agents/interaction-auditor/workflow.yaml` and the owned schema/template files in this task so the required metadata has real package assets to validate and package. The workflow outputs must reference:

- `00-project-root.json` -> `schemas/00-project-root.schema.json`;
- `02-ui-inventory.json` -> `schemas/02-ui-inventory.schema.json`;
- `04-confirmed-scope.md` -> `templates/scope-confirmation.md`;
- `05-branch-plan.json` -> `schemas/05-branch-plan.schema.json` and `templates/branch-plan.json`;
- `07-final-report.md` -> `templates/final-report.md`.

For these negative tests, do not rely on changing the current working directory. Either copy the whole repository and execute the copied `scripts/validate-catalog.mjs`, or update `scripts/validate-catalog.mjs` to accept an explicit root through CLI/env and pass that copied root from tests.

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
node --test tests/validate-catalog.test.mjs tests/alloycat-package.test.mjs
```

Expected: fail until validator and package validator require `agent.md`.

- [ ] **Step 3: Update repository validator**

In `scripts/validate-catalog.mjs`, replace raw agent file requirements with the safe-path flow below. Do not call `requireFile()` with `agent.path` until catalog `id` and `path` are type-checked and `requirePackageRelativePath()` has returned a safe package-relative path.

Remove:

```js
requireFile(`${agent.path}/agent.yaml`);
requireFile(`${agent.path}/README.md`);
```

Use the shared manifest parser in `scripts/validate-catalog.mjs` instead of regex-only frontmatter checks. Replace the existing `node:path` import with one consolidated import; do not add a second path import that redeclares names:

```js
import {
  extractMarkdownSection,
  parseAgentMarkdown,
  resolveAgentProjectPath,
  resolveArtifactTemplate,
  isAnyAbsolute
} from '../packages/agent-runtime/src/manifest.js';
import { join, relative, resolve, sep } from 'node:path';

function loadAgentDocument(path) {
  let text = '';
  try {
    text = readFileSync(join(repoRoot, path), 'utf8');
  } catch (error) {
    fail(`${path}: ${error.message}`);
    return { manifest: {}, body: '' };
  }
  try {
    return parseAgentMarkdown(text);
  } catch (error) {
    fail(`${path}: ${error.message}`);
    return { manifest: {}, body: '' };
  }
}

function requireManifestField(manifest, path, field) {
  const value = field.split('.').reduce((current, key) => current?.[key], manifest);
  if (value === undefined || value === '') {
    fail(`${path} is missing required manifest field: ${field}`);
  }
  return value;
}

function requireStringManifestField(manifest, path, field) {
  const value = requireManifestField(manifest, path, field);
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${path} manifest field must be a non-empty string: ${field}`);
    return '';
  }
  return value;
}

function requirePackageRelativePath(basePath, candidatePath, label) {
  if (candidatePath.includes('\\')) {
    fail(`${label} must use POSIX separators: ${candidatePath}`);
    return null;
  }
  if (isAnyAbsolute(candidatePath)) {
    fail(`${label} must be relative: ${candidatePath}`);
    return null;
  }
  if (candidatePath.split('/').includes('..')) {
    fail(`${label} must not contain .. segments: ${candidatePath}`);
    return null;
  }
  const fullPath = resolve(basePath, candidatePath);
  const relativePath = relative(basePath, fullPath);
  if (relativePath === '') {
    fail(`${label} must not resolve to the package root.`);
    return null;
  }
  if (relativePath.startsWith('..') || isAnyAbsolute(relativePath)) {
    fail(`${label} escapes its package root: ${candidatePath}`);
    return null;
  }
  return relativePath.replace(/\\/g, '/');
}
```

Use them per agent and cover every manifest rule from the spec:

```js
if (typeof agent.id !== 'string' || agent.id.trim() === '') {
  fail('catalog.yaml agent id must be a non-empty string.');
  continue;
}
if (typeof agent.path !== 'string' || agent.path.trim() === '') {
  fail(`catalog.yaml path for ${agent.id} must be a non-empty string.`);
  continue;
}
const agentPath = requirePackageRelativePath(repoRoot, agent.path, `catalog.yaml path for ${agent.id}`);
if (agentPath === null) {
  continue;
}
for (const key of Object.keys(agent)) {
  if (!['id', 'path'].includes(key)) {
    fail(`catalog.yaml entry for ${agent.id} must contain only id and path, found: ${key}`);
  }
}

const agentDocumentPath = `${agentPath}/agent.md`;
const document = loadAgentDocument(agentDocumentPath);
const manifest = document.manifest;

for (const field of [
  'schema_version',
  'id',
  'name',
  'type',
  'version',
  'status',
  'description',
  'runtime.model',
  'runtime.workflow',
  'artifacts.install_root',
  'artifacts.run_root',
  'artifacts.state_file',
  'prompt_context.include_sections',
  'supports.hosts'
]) {
  requireManifestField(manifest, agentDocumentPath, field);
}

const manifestId = requireStringManifestField(manifest, agentDocumentPath, 'id');
requireStringManifestField(manifest, agentDocumentPath, 'name');
const manifestType = requireStringManifestField(manifest, agentDocumentPath, 'type');
const manifestVersion = requireStringManifestField(manifest, agentDocumentPath, 'version');
const manifestStatus = requireStringManifestField(manifest, agentDocumentPath, 'status');
requireStringManifestField(manifest, agentDocumentPath, 'description');
const workflowPath = requireStringManifestField(manifest, agentDocumentPath, 'runtime.workflow');
const installRootTemplate = requireStringManifestField(manifest, agentDocumentPath, 'artifacts.install_root');
const runRootTemplate = requireStringManifestField(manifest, agentDocumentPath, 'artifacts.run_root');
const stateFile = requireStringManifestField(manifest, agentDocumentPath, 'artifacts.state_file');

if (manifestId !== agent.id) {
  fail(`${agentDocumentPath} id differs from catalog id: ${manifestId} !== ${agent.id}`);
}
if (manifest.schema_version !== 1) {
  fail(`${agentDocumentPath} schema_version must be 1.`);
}
if (manifestType !== 'phase-gated-agent') {
  fail(`${agentDocumentPath} type must be phase-gated-agent.`);
}
if (!/^\d+\.\d+\.\d+$/.test(manifestVersion)) {
  fail(`${agentDocumentPath} version must be semver.`);
}
if (!['draft', 'experimental', 'stable', 'deprecated'].includes(manifestStatus)) {
  fail(`${agentDocumentPath} status is unsupported: ${manifestStatus}`);
}
if (manifest.runtime?.model !== 'workflow') {
  fail(`${agentDocumentPath} runtime.model must be workflow.`);
}

if (workflowPath) {
  const workflowRelativePath = requirePackageRelativePath(join(repoRoot, agentPath), workflowPath, `${agentDocumentPath} runtime.workflow`);
  if (workflowRelativePath !== null) {
    requireFile(`${agentPath}/${workflowRelativePath}`);
  }
}

if (!Array.isArray(manifest.prompt_context?.include_sections) || manifest.prompt_context.include_sections.length === 0) {
  fail(`${agentDocumentPath} prompt_context.include_sections must be a non-empty list.`);
}

if (
  !manifest.supports?.hosts ||
  Array.isArray(manifest.supports.hosts) ||
  typeof manifest.supports.hosts !== 'object' ||
  Object.keys(manifest.supports.hosts).length === 0
) {
  fail(`${agentDocumentPath} supports.hosts must be a non-empty object.`);
}

let installRoot = null;
let runRoot = null;
for (const template of [installRootTemplate, runRootTemplate].filter(Boolean)) {
  try {
    resolveArtifactTemplate(template, { agentId: manifestId, projectRoot: repoRoot });
    const resolvedPath = resolveAgentProjectPath(repoRoot, { id: manifestId }, template);
    if (template === installRootTemplate) {
      installRoot = resolvedPath;
    }
    if (template === runRootTemplate) {
      runRoot = resolvedPath;
    }
  } catch (error) {
    fail(`${agentDocumentPath}: ${error.message}`);
  }
}

if (installRootTemplate && runRootTemplate && stateFile) {
  if (installRootTemplate !== '.alloycat/agents/{agent_id}') {
    fail(`${agentDocumentPath} artifacts.install_root must be .alloycat/agents/{agent_id}.`);
  }
  if (installRoot && runRoot && !runRoot.startsWith(`${installRoot}${sep}`)) {
    fail(`${agentDocumentPath} artifacts.run_root must be inside artifacts.install_root.`);
  }
  if (stateFile === '.' || stateFile === '..' || /[\\/]/.test(stateFile) || /[{}]/.test(stateFile)) {
    fail(`${agentDocumentPath} artifacts.state_file must be a plain file name, not . or .., and without path separators or placeholders.`);
  }
}

for (const heading of manifest.prompt_context?.include_sections ?? []) {
  if (typeof heading !== 'string' || heading.trim() === '') {
    fail(`${agentDocumentPath} prompt_context.include_sections values must be non-empty strings.`);
    continue;
  }
  if (!extractMarkdownSection(document.body, heading)) {
    fail(`${agentDocumentPath} is missing Markdown section: ${heading}`);
  }
}

for (const [hostId, host] of Object.entries(manifest.supports?.hosts ?? {})) {
  if (!host || typeof host !== 'object' || Array.isArray(host)) {
    fail(`${agentDocumentPath} supports.hosts.${hostId} must be an object.`);
    continue;
  }
  if (!host.adapter_path) {
    fail(`${agentDocumentPath} supports.hosts.${hostId}.adapter_path is required.`);
    continue;
  }
  if (typeof host.adapter_path !== 'string' || host.adapter_path.trim() === '') {
    fail(`${agentDocumentPath} supports.hosts.${hostId}.adapter_path must be a non-empty string.`);
    continue;
  }
  if (!host.status) {
    fail(`${agentDocumentPath} supports.hosts.${hostId}.status is required.`);
    continue;
  }
  if (typeof host.status !== 'string' || host.status.trim() === '') {
    fail(`${agentDocumentPath} supports.hosts.${hostId}.status must be a non-empty string.`);
    continue;
  }
  const adapterRelativePath = requirePackageRelativePath(join(repoRoot, agentPath), host.adapter_path, `${agentDocumentPath} supports.hosts.${hostId}.adapter_path`);
  if (adapterRelativePath !== null) {
    requireDirectory(`${agentPath}/${adapterRelativePath}`);
    requireAdapterEntry(`${agentPath}/${adapterRelativePath}`, hostId);
  }
  if (!['skeleton', 'experimental', 'stable', 'deprecated'].includes(host.status)) {
    fail(`${agentDocumentPath} has unsupported adapter status for ${hostId}: ${host.status}`);
  }
}

const qualityGates = manifest.quality_gates;
if (!qualityGates || Array.isArray(qualityGates) || typeof qualityGates !== 'object') {
  fail(`${agentDocumentPath} quality_gates must be an object.`);
} else {
  for (const key of [
    'requires_project_discovery',
    'requires_user_scope_confirmation',
    'requires_persistent_artifacts',
    'forbids_single_prompt_full_run',
    'requires_tests'
  ]) {
    if (!(key in qualityGates)) {
      fail(`${agentDocumentPath} is missing required quality gate: ${key}`);
    }
  }

  for (const [key, value] of Object.entries(qualityGates)) {
    if (typeof value !== 'boolean') {
      fail(`${agentDocumentPath} quality gate must be boolean: ${key}`);
    }
  }
}
```

`requireAdapterEntry(adapterPath, hostId)` should accept `README.md` or a documented host-specific entry file such as `${hostId}.md`; an empty directory or `.gitkeep` alone must fail repository and packaged validation.

Validate the workflow file referenced by `manifest.runtime.workflow`, not a hardcoded `workflow.yaml`. Apply `requirePackageRelativePath()` to `manifest.runtime.workflow`, require the returned safe path only when the helper returns a non-null value, parse that file's workflow id, and verify the workflow id matches `manifest.id`. Then validate every `prompt:` path, every declared `schema:` path, and every declared `template:` path referenced by that same workflow file. Required workflow outputs for the Interaction Auditor must declare this metadata before path validation runs: `00-project-root.json` and `02-ui-inventory.json` require `schema:`, `04-confirmed-scope.md` and `07-final-report.md` require `template:`, and `05-branch-plan.json` requires both `schema:` and `template:`.

For each `prompt:`, `schema:`, and `template:` path, also apply `requirePackageRelativePath()` before `requireFile()` and skip file reads when the helper returns `null`, so workflow references cannot be absolute or escape the agent package.

- [ ] **Step 4: Update packaged validator**

In `scripts/pack-alloycat.mjs`, update `validatePackagedCatalog()` to mirror the repository safe-path flow before requiring `agent.md`:

```js
if (typeof agent.id !== 'string' || agent.id.trim() === '') {
  fail('catalog.yaml agent id must be a non-empty string.');
  continue;
}
if (typeof agent.path !== 'string' || agent.path.trim() === '') {
  fail(`catalog.yaml path for ${agent.id} must be a non-empty string.`);
  continue;
}
const safeAgentPath = requirePackagedRelativePath(catalogRoot, agent.path, `catalog.yaml path for ${agent.id}`);
if (safeAgentPath !== null) {
  requirePackagedFile(catalogRoot, `${safeAgentPath}/agent.md`);
}
```

The packaged helper should return a safe package-relative path or `null`, not only a boolean, so callers can avoid raw path reads after a validation failure.

Remove packaged requirements for:

```js
requirePackagedFile(catalogRoot, `${agent.path}/agent.yaml`);
requirePackagedFile(catalogRoot, `${agent.path}/README.md`);
```

Mirror the repository validator's manifest checks in packaged validation: malformed frontmatter, extra catalog metadata keys, catalog path escape, catalog id mismatch, scalar field types, `schema_version`, `type`, `version`, `status`, `runtime.model`, `runtime.workflow` safe path and file presence, workflow id, every workflow `prompt:`/`schema:`/`template:` safe path including package-root resolution and file presence, required Interaction Auditor output schema/template metadata, prompt-context shape and headings, artifact placeholders, absolute artifact templates, path escape checks, fixed `install_root`, artifact hierarchy checks, plain `state_file`, supported adapter directories with README or host-specific entry files, required quality gate keys, and boolean quality gates must fail before a tarball is accepted.

Make the packaged validator executable by sharing the same helper code path. Either import the manifest parser/path helpers from `packages/agent-runtime/src/manifest.js` before staging, or embed the same helpers in `packagedValidateSource()`. Do not rely on imports from the staged package unless those helper modules are already copied and addressable from the generated validator.

The packaged negative tests in `tests/alloycat-package.test.mjs` must fail before this step and pass after it. They are the guard that package assembly mirrors repository validation rather than only checking file presence.

- [ ] **Step 5: Run validation and package tests**

Run:

```bash
node --test tests/validate-catalog.test.mjs tests/alloycat-package.test.mjs
npm run validate
npm run pack:alloycat
```

Expected: tests pass, validation prints `Validated 1 agent.`, and package listing includes `agent.md`.

- [ ] **Step 6: Commit migration, validation, and packaging**

```bash
git add agents/interaction-auditor README.md catalog.yaml packages/agent-runtime/src packages/alloycat/src/index.js scripts/validate-catalog.mjs scripts/pack-alloycat.mjs tests/agent-runtime.test.mjs tests/alloycat-cli.test.mjs tests/validate-catalog.test.mjs tests/alloycat-package.test.mjs
git commit -m "feat: validate packaged agent markdown manifests"
```

---

### Task 6: Final Verification

**Files:**
- Modify: `docs/roadmap.md`
- Verify: all changed files

- [ ] **Step 1: Verify or update the existing roadmap item**

In `docs/roadmap.md`, verify that the near-term `agent.md` manifest item already exists. If it is missing, add it before branch plan enforcement. If it exists, update it without duplicating or weakening its acceptance checks:

```md
### 2. Make `agent.md` the canonical agent manifest

Goal: replace split agent metadata and agent README files with one canonical Markdown manifest.

Why this matters:

- keeps agent metadata and human-readable documentation together;
- lets runtime derive workflow paths, run artifact roots, and host adapter references from the manifest;
- lets prompt rendering include explicitly selected agent-level rules.

Acceptance checks:

- `alloycat list` and `alloycat info` read display metadata from `agent.md`;
- `install`, `init`, `status`, `remind`, `next`, and agent-scoped `uninstall` use manifest-backed agent paths; full-project `uninstall` continues to remove the runtime project state root;
- adapter directories with README or host-specific entry files exist for hosts declared in `agent.md`;
- validation rejects malformed frontmatter, missing prompt-context sections, unsafe artifact paths, and workflow id mismatches.
```

Renumber later near-term roadmap sections.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test
npm run validate
git diff --check
node -e "const {spawnSync}=require('node:child_process'); const p=['Co-'+'Authored-By','Generated '+'by','Co'+'dex','L'+'LM','Co'+'pilot','A'+'I assistance'].join('|'); const r=spawnSync('rg',['-n',p,'--glob','!AGENTS.md','--glob','!node_modules/**','--glob','!packages/alloycat/*.tgz','--glob','!packages/alloycat/dist-package/**','.'],{stdio:'inherit'}); process.exit(r.status===0?1:r.status===1?0:r.status??1)"
```

Expected:

- `npm test` passes all tests.
- `npm run validate` prints `Validated 1 agent.`
- `git diff --check` prints nothing.
- The attribution scan exits with no matches.

- [ ] **Step 3: Smoke the local CLI**

Run:

```bash
node packages/alloycat/src/index.js list
node packages/alloycat/src/index.js info interaction-auditor
```

Expected:

- `list` prints `interaction-auditor`.
- `info` includes `Alloy Interaction Auditor`.
- `info` includes runtime metadata loaded from `agent.md`.

- [ ] **Step 4: Commit final docs and verification updates**

```bash
git add docs/roadmap.md
git commit -m "docs: track agent markdown manifest migration"
```
