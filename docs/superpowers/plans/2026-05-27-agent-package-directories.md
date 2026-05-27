# Agent Package Directories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the directories inside `agents/interaction-auditor/` into documented, validated, packaged agent assets instead of empty future placeholders.

**Architecture:** Keep `workflow.yaml` as the phase graph and keep `agent.md` as the agent manifest once the manifest migration lands. Add starter schemas, templates, adapter docs, test definitions, fixtures, and examples under the agent package, then extend validation and package smoke tests to prove the assets are referenced and shipped.

**Tech Stack:** Node.js ESM, built-in `node:test`, existing `scripts/validate-catalog.mjs`, existing `scripts/pack-alloycat.mjs`, JSON schema-like files, Markdown templates.

**Prerequisite:** Run this plan after the `agent.md` manifest migration. Host adapter names must stay aligned with the manifest and catalog; the current package uses `primary-cli` and `secondary-cli`.

This prerequisite includes the manifest plan's prompt-context rendering task, so rendered prompts are expected to include the `Agent Context` section before `prompt-contract.test.json` is enforced.

`agents/interaction-auditor/scripts/` is intentionally out of scope for this plan. It remains optional and should not be created, packaged, or validated until an agent-specific deterministic helper is designed.

---

## File Structure

- Create schema files in `agents/interaction-auditor/schemas/`.
- Create template files in `agents/interaction-auditor/templates/`.
- Create adapter docs in `agents/interaction-auditor/adapters/`.
- Create agent-level test definition files in `agents/interaction-auditor/tests/`.
- Create small fixture files in `agents/interaction-auditor/fixtures/`.
- Create example docs in `agents/interaction-auditor/examples/`.
- Keep `agents/interaction-auditor/scripts/` out of scope unless a deterministic helper is introduced later.
- Modify `agents/interaction-auditor/workflow.yaml` so key outputs reference `schema` and `template` files.
- Modify `packages/agent-runtime/src/runs.js` so `next` validates JSON artifacts against declared schemas before phase advancement.
- Modify `scripts/validate-catalog.mjs` so it validates agent package directory contracts.
- Modify `scripts/pack-alloycat.mjs` so packaged validation checks required assets.
- Modify `tests/validate-catalog.test.mjs` and `tests/alloycat-package.test.mjs`.
- Modify `docs/roadmap.md` to include directory activation as a near-term roadmap item.

---

### Task 1: Add Directory Contract Tests

**Files:**
- Create: `scripts/agent-package-assets.mjs`
- Modify: `tests/validate-catalog.test.mjs`

- [ ] **Step 1: Create shared starter asset list**

Create `scripts/agent-package-assets.mjs` as a side-effect-free module:

```js
export const interactionAuditorStarterAssets = [
  'schemas/00-project-root.schema.json',
  'schemas/02-ui-inventory.schema.json',
  'schemas/05-branch-plan.schema.json',
  'schemas/finding.schema.json',
  'templates/scope-confirmation.md',
  'templates/branch-plan.json',
  'templates/finding.md',
  'templates/final-report.md',
  'adapters/alloycat/README.md',
  'adapters/primary-cli/README.md',
  'adapters/secondary-cli/README.md',
  'tests/workflow.test.json',
  'tests/schema-validation.test.json',
  'tests/prompt-contract.test.json',
  'fixtures/no-visual-source-run/05-branch-plan.json',
  'examples/no-visual-source/README.md',
  'examples/no-visual-source/final-report.md',
  'CHANGELOG.md'
];
```

- [ ] **Step 2: Write failing test for required agent package assets**

Add this test to `tests/validate-catalog.test.mjs`:

```js
import { interactionAuditorStarterAssets } from '../scripts/agent-package-assets.mjs';

test('interaction auditor package directories contain starter assets', () => {
  const agentRoot = resolve(repoRoot, 'agents', 'interaction-auditor');

  for (const file of interactionAuditorStarterAssets) {
    assert.equal(
      existsSync(resolve(agentRoot, file)),
      true,
      `Missing agent package asset: ${file}`
    );
  }
});
```

Keep `interactionAuditorStarterAssets` as the single source for starter files in source validation tests, repository validation, packaged validation, and package listing assertions. `tests/validate-catalog.test.mjs`, `scripts/validate-catalog.mjs`, `tests/alloycat-package.test.mjs`, and `scripts/pack-alloycat.mjs` should import this module instead of duplicating the list. If a starter file is added or removed, update this list first and derive the downstream checks from it.

Update or remove the existing placeholder-directory test that requires `.gitkeep` files in activated directories. Once real starter assets exist, the test should check directory contents through `interactionAuditorStarterAssets`, not require placeholder files that should be deleted.

- [ ] **Step 3: Run test to verify RED**

Run:

```bash
node --test tests/validate-catalog.test.mjs
```

Expected: fail with `Missing agent package asset: schemas/00-project-root.schema.json`.

- [ ] **Step 4: Commit only after Task 2 creates starter assets**

Do not commit this test until Task 2 is green.

---

### Task 2: Add Starter Schemas, Templates, Fixtures, Examples, And Adapter Docs

**Files:**
- Create: `agents/interaction-auditor/schemas/00-project-root.schema.json`
- Create: `agents/interaction-auditor/schemas/02-ui-inventory.schema.json`
- Create: `agents/interaction-auditor/schemas/05-branch-plan.schema.json`
- Create: `agents/interaction-auditor/schemas/finding.schema.json`
- Create: `agents/interaction-auditor/templates/scope-confirmation.md`
- Create: `agents/interaction-auditor/templates/branch-plan.json`
- Create: `agents/interaction-auditor/templates/finding.md`
- Create: `agents/interaction-auditor/templates/final-report.md`
- Create: `agents/interaction-auditor/adapters/alloycat/README.md`
- Create: `agents/interaction-auditor/adapters/primary-cli/README.md`
- Create: `agents/interaction-auditor/adapters/secondary-cli/README.md`
- Create: `agents/interaction-auditor/tests/workflow.test.json`
- Create: `agents/interaction-auditor/tests/schema-validation.test.json`
- Create: `agents/interaction-auditor/tests/prompt-contract.test.json`
- Create: `agents/interaction-auditor/fixtures/no-visual-source-run/05-branch-plan.json`
- Create: `agents/interaction-auditor/examples/no-visual-source/README.md`
- Create: `agents/interaction-auditor/examples/no-visual-source/final-report.md`
- Create: `agents/interaction-auditor/CHANGELOG.md`
- Delete: `.gitkeep` placeholders in activated `schemas/`, `templates/`, `adapters/`, `tests/`, `fixtures/`, and `examples/` directories once each directory has real starter assets.

- [ ] **Step 1: Create schema files**

Create `agents/interaction-auditor/schemas/00-project-root.schema.json`:

```json
{
  "schema_version": 1,
  "artifact": "00-project-root.json",
  "required": ["project_root", "resolved_from", "confidence"],
  "properties": {
    "project_root": { "type": "string" },
    "resolved_from": { "type": "string" },
    "confidence": { "type": "string", "enum": ["low", "medium", "high"] }
  }
}
```

Create `agents/interaction-auditor/schemas/02-ui-inventory.schema.json`:

```json
{
  "schema_version": 1,
  "artifact": "02-ui-inventory.json",
  "required": ["surfaces"],
  "properties": {
    "surfaces": { "type": "array" },
    "notes": { "type": "string" }
  }
}
```

Create `agents/interaction-auditor/schemas/05-branch-plan.schema.json`:

```json
{
  "schema_version": 1,
  "artifact": "05-branch-plan.json",
  "required": [
    "run_interaction_audit",
    "run_visual_conformance_audit",
    "run_e2e_coverage_audit",
    "rationale"
  ],
  "properties": {
    "run_interaction_audit": { "type": "boolean" },
    "run_visual_conformance_audit": { "type": "boolean" },
    "run_e2e_coverage_audit": { "type": "boolean" },
    "rationale": { "type": "string" },
    "blocked_tracks": { "type": "array" }
  }
}
```

Create `agents/interaction-auditor/schemas/finding.schema.json`:

```json
{
  "schema_version": 1,
  "artifact": "finding",
  "required": [
    "id",
    "severity",
    "track",
    "surface",
    "issue",
    "expected",
    "actual",
    "evidence",
    "recommended_fix",
    "required_coverage"
  ],
  "properties": {
    "id": { "type": "string" },
    "severity": { "type": "string" },
    "track": { "type": "string" },
    "surface": { "type": "string" },
    "issue": { "type": "string" },
    "expected": { "type": "string" },
    "actual": { "type": "string" },
    "evidence": { "type": "string" },
    "recommended_fix": { "type": "string" },
    "required_coverage": { "type": "string" }
  }
}
```

- [ ] **Step 2: Create template files**

Create `agents/interaction-auditor/templates/scope-confirmation.md`:

```md
# Scope Confirmation

## Project Root

`<absolute project root>`

## Project Type And Platforms

- `<platform or runtime>`

## Confirmed Surfaces

- `<screen, window, menu, modal, popover, or system surface>`

## Source Classification

| Source | Status | Coverage | Notes |
| --- | --- | --- | --- |
| `<path or reference>` | `<authoritative/reference-only/stale/unclear>` | `<scope>` | `<notes>` |

## Planned Audit Tracks

- Interaction audit: `<enabled/disabled/blocked>`
- Visual conformance audit: `<enabled/disabled/blocked>`
- E2E coverage audit: `<enabled/disabled/blocked>`

## Questions Before Continuing

- `<question needed to avoid auditing the wrong scope>`
```

Create `agents/interaction-auditor/templates/branch-plan.json`:

```json
{
  "run_interaction_audit": true,
  "run_visual_conformance_audit": false,
  "run_e2e_coverage_audit": true,
  "rationale": "Visual conformance is disabled when no authoritative visual source is confirmed.",
  "blocked_tracks": [
    "visual-conformance-audit"
  ]
}
```

Create `agents/interaction-auditor/templates/finding.md`:

```md
## `<finding-id>`: `<short title>`

- Severity: `<Critical|High|Medium|Low|Test Gap>`
- Track: `<interaction|visual|e2e>`
- Surface: `<screen or flow>`
- Issue: `<what is wrong>`
- Expected: `<expected behavior>`
- Actual: `<observed behavior>`
- Evidence: `<file, command, screenshot, log, or runtime observation>`
- Reproduction: `<steps for runtime findings>`
- Recommended fix: `<targeted fix>`
- Required coverage: `<test or evidence needed>`
```

Create `agents/interaction-auditor/templates/final-report.md`:

```md
# Interaction Auditor Final Report

## Executive Summary

`<summary>`

## Confirmed Scope

`<scope summary>`

## Findings By Severity

`<findings>`

## E2E Coverage Matrix

`<coverage matrix>`

## Recommended Fix Order

`<ordered list>`

## User Testing Readiness

`<ready/not ready and why>`
```

- [ ] **Step 3: Create adapter README files**

Create `agents/interaction-auditor/adapters/alloycat/README.md`:

````md
# Alloycat Adapter

This adapter uses the shared `alloycat` CLI directly.

## Responsibilities

- Install the agent into a target project.
- Initialize or resume a run.
- Render the current phase prompt.
- Advance only after required artifacts exist.
- Stop at user gates.

## Commands

```sh
alloycat install interaction-auditor
alloycat init
alloycat remind
alloycat next
alloycat uninstall interaction-auditor
```
````

Create `agents/interaction-auditor/adapters/primary-cli/README.md`:

```md
# Primary CLI Adapter

This adapter is a skeleton for the primary CLI host integration.

It must call the shared `alloycat` runtime and must not duplicate workflow prompts, schemas, or branch decisions.
```

Create `agents/interaction-auditor/adapters/secondary-cli/README.md`:

```md
# Secondary CLI Adapter

This adapter is a skeleton for the secondary CLI host integration.

It documents compatibility expectations and must consume the shared `agent.md`, `workflow.yaml`, prompts, schemas, templates, and run artifacts.
```

- [ ] **Step 4: Create agent-level test definition files**

Create `agents/interaction-auditor/tests/workflow.test.json`:

```json
{
  "schema_version": 1,
  "assertions": [
    {
      "type": "phase_exists",
      "phase_id": "resolve-project-root"
    },
    {
      "type": "phase_has_user_gate",
      "phase_id": "scope-confirmation"
    },
    {
      "type": "phase_has_branch_key",
      "phase_id": "visual-conformance-audit",
      "branch_key": "run_visual_conformance_audit"
    }
  ]
}
```

Create `agents/interaction-auditor/tests/schema-validation.test.json`:

```json
{
  "schema_version": 1,
  "fixtures": [
    {
      "schema": "schemas/05-branch-plan.schema.json",
      "valid": "fixtures/no-visual-source-run/05-branch-plan.json"
    }
  ]
}
```

Create `agents/interaction-auditor/tests/prompt-contract.test.json`:

```json
{
  "schema_version": 1,
  "required_sections": [
    "Agent Context",
    "Input artifacts",
    "Output artifacts",
    "Phase Instructions",
    "Next"
  ]
}
```

- [ ] **Step 5: Create fixture and example files**

Create `agents/interaction-auditor/fixtures/no-visual-source-run/05-branch-plan.json`:

```json
{
  "run_interaction_audit": true,
  "run_visual_conformance_audit": false,
  "run_e2e_coverage_audit": true,
  "rationale": "No authoritative visual source was confirmed for this run.",
  "blocked_tracks": [
    "visual-conformance-audit"
  ]
}
```

Create `agents/interaction-auditor/examples/no-visual-source/README.md`:

```md
# No Visual Source Example

This example shows an Interaction Auditor run where source discovery found no authoritative visual source. The branch plan disables visual conformance and keeps interaction and e2e coverage checks enabled.
```

Create `agents/interaction-auditor/examples/no-visual-source/final-report.md`:

```md
# Interaction Auditor Final Report

## Executive Summary

The run completed interaction and e2e coverage review. Visual conformance was not evaluated because no authoritative visual source was confirmed.

## Confirmed Scope

Example scope for a project with runtime UI surfaces and no authoritative design source.

## Findings By Severity

No findings are included in this minimal example.

## E2E Coverage Matrix

Example coverage matrix omitted for the starter package.

## Recommended Fix Order

No fixes are included in this minimal example.

## User Testing Readiness

Not assessed in this minimal example.
```

Create `agents/interaction-auditor/CHANGELOG.md`:

```md
# Changelog

## 0.1.0

- Initial Interaction Auditor package skeleton with schemas, templates, adapters, tests, fixtures, and examples.
```

- [ ] **Step 6: Run directory contract tests**

Run:

```bash
node --test tests/validate-catalog.test.mjs
```

Expected: the new directory asset test passes.

- [ ] **Step 7: Commit starter assets**

```bash
git add scripts/agent-package-assets.mjs agents/interaction-auditor tests/validate-catalog.test.mjs
git commit -m "feat: add interaction auditor package assets"
```

---

### Task 3: Reference Schemas And Templates From Workflow

**Files:**
- Modify: `agents/interaction-auditor/workflow.yaml`
- Modify: `packages/agent-runtime/src/prompts.js`
- Modify: `tests/agent-runtime.test.mjs`

- [ ] **Step 1: Write failing workflow metadata test**

Add this assertion to the `loads human-readable phase metadata and output artifact contracts` test in `tests/agent-runtime.test.mjs`:

```js
const branchPlanning = workflow.phases.find((candidate) => candidate.id === 'branch-planning');
assert.equal(branchPlanning.outputs[0].schema, 'schemas/05-branch-plan.schema.json');
assert.equal(branchPlanning.outputs[0].template, 'templates/branch-plan.json');
```

Add this assertion to the same test:

```js
const scopeConfirmation = workflow.phases.find((candidate) => candidate.id === 'scope-confirmation');
assert.equal(scopeConfirmation.outputs[0].template, 'templates/scope-confirmation.md');
```

Also assert every new output contract by artifact path so phase ordering changes do not hide omissions:

```js
const outputsByPath = new Map(
  workflow.phases.flatMap((phase) => phase.outputs.map((output) => [output.path, output]))
);
assert.equal(outputsByPath.get('00-project-root.json').schema, 'schemas/00-project-root.schema.json');
assert.equal(outputsByPath.get('02-ui-inventory.json').schema, 'schemas/02-ui-inventory.schema.json');
assert.equal(outputsByPath.get('04-confirmed-scope.md').template, 'templates/scope-confirmation.md');
assert.equal(outputsByPath.get('05-branch-plan.json').schema, 'schemas/05-branch-plan.schema.json');
assert.equal(outputsByPath.get('05-branch-plan.json').template, 'templates/branch-plan.json');
assert.equal(outputsByPath.get('07-final-report.md').template, 'templates/final-report.md');
```

Add a prompt-rendering assertion for schema visibility:

```js
const run = createRun(repoRoot, {
  agentId: 'interaction-auditor',
  project: tempRoot,
  runId: 'prompt-schema-test'
});
const state = loadRunState(run.runDir);
state.current_phase = 'branch-planning';
saveRunState(run.runDir, state);
const prompt = renderNextPrompt(repoRoot, run.runDir);
assert.match(prompt, /Schema: schemas\/05-branch-plan\.schema\.json/);
assert.match(prompt, /Template: templates\/branch-plan\.json/);
```

Also render prompts for a schema-only output and a template-only output so every output contract style is covered:

```js
state.current_phase = 'resolve-project-root';
saveRunState(run.runDir, state);
const rootPrompt = renderNextPrompt(repoRoot, run.runDir);
assert.match(rootPrompt, /00-project-root\.json/);
assert.match(rootPrompt, /Schema: schemas\/00-project-root\.schema\.json/);

state.current_phase = 'scope-confirmation';
saveRunState(run.runDir, state);
const scopePrompt = renderNextPrompt(repoRoot, run.runDir);
assert.match(scopePrompt, /04-confirmed-scope\.md/);
assert.match(scopePrompt, /Template: templates\/scope-confirmation\.md/);
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
node --test tests/agent-runtime.test.mjs
```

Expected: fail because workflow output metadata does not yet include `schema` or `template`, and rendered output artifacts do not show schema paths.

- [ ] **Step 3: Update `workflow.yaml` outputs**

Add schema/template metadata:

```yaml
- path: 00-project-root.json
  format: json
  schema: schemas/00-project-root.schema.json
  description: Resolved project root metadata and confidence.
```

```yaml
- path: 02-ui-inventory.json
  format: json
  schema: schemas/02-ui-inventory.schema.json
  description: Structured UI inventory with screens, selectors, source files, and e2e coverage.
```

```yaml
- path: 04-confirmed-scope.md
  format: markdown
  template: templates/scope-confirmation.md
  description: User-confirmed audit scope and exclusions.
```

```yaml
- path: 05-branch-plan.json
  format: json
  schema: schemas/05-branch-plan.schema.json
  template: templates/branch-plan.json
  description: Branch execution plan with audit branch flags and rationale.
```

```yaml
- path: 07-final-report.md
  format: markdown
  template: templates/final-report.md
  description: Final interaction audit report.
```

Update prompt rendering so each output artifact with a schema or template shows that contract next to the artifact path, for example:

```text
- 05-branch-plan.json
  Schema: schemas/05-branch-plan.schema.json
  Template: templates/branch-plan.json
```

- [ ] **Step 4: Run runtime tests**

Run:

```bash
node --test tests/agent-runtime.test.mjs
```

Expected: workflow metadata tests pass.

- [ ] **Step 5: Commit workflow metadata**

```bash
git add agents/interaction-auditor/workflow.yaml packages/agent-runtime/src/prompts.js tests/agent-runtime.test.mjs
git commit -m "feat: link workflow outputs to schemas and templates"
```

---

### Task 4: Validate JSON Artifacts Against Schemas During Advancement

**Files:**
- Create: `packages/agent-runtime/src/schema-validation.js`
- Modify: `packages/agent-runtime/src/install.js`
- Modify: `packages/agent-runtime/src/runs.js`
- Modify: `packages/agent-runtime/src/workflow.js`
- Modify: `packages/agent-runtime/src/index.js`
- Modify: `tests/agent-runtime.test.mjs`

- [ ] **Step 1: Write failing runtime schema tests**

Add a test that creates a run at `resolve-project-root`, writes `00-project-root.json` with missing required fields, and asserts `completeRun()` fails with a schema validation message instead of advancing.

Add a second test with a minimal valid `00-project-root.json` and assert advancement succeeds.

Add an installed-package regression test before implementing schema validation:

- install `interaction-auditor` into a temporary target project;
- assert every `interactionAuditorStarterAssets` entry exists under `.alloycat/agents/interaction-auditor/package/`;
- create a run from the installed agent package;
- delete or rename the source catalog's `agents/interaction-auditor/schemas/` directory in a copied fixture repository, or run the installed command from a target project whose source catalog path is unavailable;
- write invalid `00-project-root.json`;
- assert `completeRun()` still finds the schema from `.alloycat/agents/interaction-auditor/package/schemas/00-project-root.schema.json` and fails with a schema validation message.

Add a valid-artifact installed-package test with the same source-unavailable setup and assert advancement succeeds.

Add RED tests for the full initial schema subset before implementing the validator:

- enum mismatch is rejected;
- wrong `string`, `boolean`, and `array` primitive types are rejected;
- an optional array field is accepted when present with the right type and accepted when omitted.
- syntactically valid JSON that is not an accepted schema object for the supported subset is rejected.

Add runtime path-safety RED tests before schema files are read:

- a workflow output `schema:` path that is absolute fails before file reads;
- a workflow output `schema:` path containing backslashes fails before file reads;
- a workflow output `schema:` path containing `..` fails before file reads;
- a workflow output `schema:` path like `schemas/../schemas/example.schema.json` fails before normalization even though it normalizes back under `schemas/`;
- a workflow output `schema:` path whose normalized path leaves `schemas/` fails before file reads.

- [ ] **Step 2: Run runtime tests to verify RED**

Run:

```bash
node --test tests/agent-runtime.test.mjs
```

Expected: fail because `completeRun()` currently checks JSON syntax but not declared schema fields.

- [ ] **Step 3: Implement shared minimal schema validation**

Create `packages/agent-runtime/src/schema-validation.js` as a side-effect-free module exporting `validateJsonAgainstSchema(value, schema, label)`. Import it from `runs.js` for phase advancement, export it from `packages/agent-runtime/src/index.js`, and later import the same helper from repository validation and package validation. Do not duplicate schema validation logic in `runs.js`, `validate-catalog.mjs`, and `pack-alloycat.mjs`.

Update `install.js` so the installed package copy includes runtime assets needed after installation: `agent.md`, the manifest-referenced workflow file, referenced prompt files, and package directories containing starter runtime assets (`schemas/`, `templates/`, `tests/`, `fixtures/`, `examples/`, `adapters/`, `CHANGELOG.md`) when they exist. Installed-project commands must resolve workflow `schema:` and `template:` paths relative to the installed package directory, not the source catalog checkout.

Load each current phase output's `schema` file before phase advancement from the same package root as the workflow file being executed. For source-catalog runs this is `agents/interaction-auditor/`; for installed-project runs this is `.alloycat/agents/interaction-auditor/package/`. Runtime schema path resolution must reject absolute paths, backslashes, `..`, and normalized paths outside `schemas/` before file reads. For the first implementation, support the schema shape used by this package:

```json
{
  "required": ["field"],
  "properties": {
    "field": { "type": "string" }
  }
}
```

Reject missing required fields, wrong primitive types, and enum mismatches. The initial supported type subset is `string`, `boolean`, and `array`. Keep this validator small and deterministic; do not add a schema dependency until the local schema subset becomes a blocker.

Update any existing phase-advancement tests that currently write placeholder `{}` JSON artifacts so they write minimal valid artifacts once schemas are enforced.

- [ ] **Step 4: Run runtime tests**

Run:

```bash
node --test tests/agent-runtime.test.mjs
```

Expected: invalid schema-shaped JSON blocks advancement and valid JSON advances.

- [ ] **Step 5: Commit runtime schema validation**

```bash
git add packages/agent-runtime/src tests/agent-runtime.test.mjs
git commit -m "feat: validate phase artifacts against schemas"
```

---

### Task 5: Validate Directory Assets

**Files:**
- Modify: `scripts/validate-catalog.mjs`
- Modify: `tests/validate-catalog.test.mjs`

- [ ] **Step 1: Refactor validator for fixture roots**

Refactor `scripts/validate-catalog.mjs` to export a `validateCatalog(root, options = {})` function while preserving the CLI entrypoint behavior. `options.starterAssets` defaults to the source `interactionAuditorStarterAssets` list, so tests can inject unsafe or incomplete starter asset lists without mutating module-global state.

Run existing validation tests before adding new behavior tests:

```bash
node --test tests/validate-catalog.test.mjs
npm run validate
```

Expected: existing behavior still passes.

- [ ] **Step 2: Write failing validation tests for referenced files**

Add tests that prove validation behavior, not just workflow text:

- the real repository passes when every referenced `schema:` and `template:` file exists;
- temporary copied catalogs fail validation when each starter asset category from `interactionAuditorStarterAssets` is omitted, including `CHANGELOG.md`, examples, fixtures, test definition files, adapters, schemas, and templates;
- starter asset list entries are rejected before existence checks when they are absolute, contain `..`, contain backslashes, or resolve outside `agents/interaction-auditor/`;
- a temporary copied catalog with `schema: schemas/missing.schema.json` fails validation;
- a temporary copied catalog with `template: templates/missing.md` fails validation;
- a temporary copied catalog with `schema: ../outside.schema.json` fails validation;
- a temporary copied catalog with `template: ../outside.md` fails validation;
- a temporary copied catalog with `schema: schemas/../schemas/00-project-root.schema.json` fails validation before normalization can hide the `..` segment;
- a temporary copied catalog with `template: templates/../templates/branch-plan.json` fails validation before normalization can hide the `..` segment;
- a temporary copied catalog with an absolute `schema:` or `template:` path fails validation;
- absolute `schema:` and `template:` rejection covers both `/outside` and `C:/outside` forms on every platform;
- a temporary copied catalog with backslashes in a `schema:` or `template:` path fails validation;
- a temporary copied catalog with a `schema:` path outside `schemas/` fails validation;
- a temporary copied catalog with a `template:` path outside `templates/` fails validation;
- a temporary copied catalog with an extra prompt file not referenced by `workflow.yaml` fails validation;
- an invalid JSON schema file fails validation.
- an invalid JSON template file fails validation.
- a JSON template referenced by a workflow output fails validation when it parses but does not satisfy the paired output schema.
- a host adapter README referenced by `agent.md` is missing and validation fails.
- `finding.schema.json` is missing or invalid and validation fails, and `templates/finding.md` is missing and validation fails, even though they are starter assets rather than direct workflow output references.
- a failing `workflow.test.json` assertion fails validation.
- a schema-validation fixture that does not satisfy its schema fails validation.
- `schema-validation.test.json` entries with absolute paths, backslashes, `..`, schemas outside `schemas/`, or fixtures outside `fixtures/` fail validation before file reads.
- a prompt-contract test that requires a missing prompt section fails validation.

After this refactor, validation helpers must accept the root and injected starter asset list explicitly. Avoid module-level `repoRoot` or module-global starter asset reads inside helpers that need to validate copied fixture catalogs.

- [ ] **Step 3: Run validation tests to verify RED**

Run:

```bash
node --test tests/validate-catalog.test.mjs
```

Expected: fail because the validator does not yet inspect workflow schema/template references through an exported validation function.

- [ ] **Step 4: Extend validator to require referenced schema and template files**

In `scripts/validate-catalog.mjs`, add:

```js
function extractWorkflowAssetPaths(workflowText, key) {
  return [...workflowText.matchAll(new RegExp(`\\n\\s+${key}:\\s+(.+)`, 'g'))]
    .map((match) => match[1].trim());
}
```

After validating prompt paths, ensure the validator imports `posix` and `win32` from `node:path` and add:

```js
function isAnyAbsolute(candidatePath) {
  return posix.isAbsolute(candidatePath) || win32.isAbsolute(candidatePath);
}

function requirePackageRelativePath(basePath, candidatePath, label) {
  if (candidatePath.includes('\\')) {
    fail(`${label} must use POSIX separators: ${candidatePath}`);
    return false;
  }
  if (isAnyAbsolute(candidatePath)) {
    fail(`${label} must be relative: ${candidatePath}`);
    return false;
  }
  if (candidatePath.split('/').includes('..')) {
    fail(`${label} must not contain .. segments: ${candidatePath}`);
    return false;
  }
  const fullPath = resolve(basePath, candidatePath);
  const relativePath = relative(basePath, fullPath);
  if (relativePath.startsWith('..') || isAnyAbsolute(relativePath)) {
    fail(`${label} escapes its package root: ${candidatePath}`);
    return false;
  }
  return true;
}

for (const schemaPath of extractWorkflowAssetPaths(workflowText, 'schema')) {
  if (schemaPath.includes('\\')) {
    fail(`${agent.path} workflow schema must use POSIX separators: ${schemaPath}`);
    continue;
  }
  if (schemaPath.split('/').includes('..')) {
    fail(`${agent.path} workflow schema must not contain .. segments: ${schemaPath}`);
    continue;
  }
  const normalizedPath = posix.normalize(schemaPath);
  if (!normalizedPath.startsWith('schemas/')) {
    fail(`${agent.path} workflow schema must be under schemas/: ${schemaPath}`);
    continue;
  }
  if (requirePackageRelativePath(join(root, agent.path), normalizedPath, `${agent.path} workflow schema`)) {
    requireJsonFile(root, `${agent.path}/${normalizedPath}`);
  }
}

for (const templatePath of extractWorkflowAssetPaths(workflowText, 'template')) {
  if (templatePath.includes('\\')) {
    fail(`${agent.path} workflow template must use POSIX separators: ${templatePath}`);
    continue;
  }
  if (templatePath.split('/').includes('..')) {
    fail(`${agent.path} workflow template must not contain .. segments: ${templatePath}`);
    continue;
  }
  const normalizedPath = posix.normalize(templatePath);
  if (!normalizedPath.startsWith('templates/')) {
    fail(`${agent.path} workflow template must be under templates/: ${templatePath}`);
    continue;
  }
  if (requirePackageRelativePath(join(root, agent.path), normalizedPath, `${agent.path} workflow template`)) {
    if (normalizedPath.endsWith('.json')) {
      requireJsonFile(root, `${agent.path}/${normalizedPath}`);
    } else {
      requireFile(root, `${agent.path}/${normalizedPath}`);
    }
  }
}
```

Also validate JSON files in `schemas/`, JSON templates, and JSON templates against their paired workflow output schemas:

```js
function requireJsonFile(root, path) {
  requireFile(root, path);
  try {
    JSON.parse(readFileSync(join(root, path), 'utf8'));
  } catch {
    fail(`Invalid JSON file: ${path}`);
  }
}
```

Use `requireJsonFile()` for `schema` paths and for `template` paths ending in `.json`. When a workflow output declares both `schema:` and a JSON `template:`, load both files and validate the parsed template with `validateJsonAgainstSchema(templateValue, schemaValue, templatePath)` so template drift is caught during source and packaged validation.

Also validate every path in `interactionAuditorStarterAssets`, not only workflow-referenced files. Each starter asset path must be POSIX-relative, must not contain `..` or backslashes, and must resolve inside `agents/interaction-auditor/` before existence checks. Schema and JSON template files must parse as JSON, Markdown templates/examples must exist, adapter README files must exist, and both `examples/no-visual-source/README.md` and `examples/no-visual-source/final-report.md` must be included even when examples are not direct workflow outputs.

Validate every starter schema and every workflow-referenced schema against the supported schema-definition contract, not only with `JSON.parse()`. Syntactically valid JSON that is not an accepted schema object must fail both source and packaged validation.

Also validate prompt directory strictness from the directory spec: every `.md` file in `prompts/` must be referenced by a `workflow.yaml` phase `prompt:` path, and every workflow prompt path must exist inside `prompts/`.

Also load `agents/interaction-auditor/tests/*.test.json` and validate the known starter test definition shapes so these files are executable contracts rather than inert documentation.

Execution rules:

- `workflow.test.json`: `phase_exists` requires a matching workflow phase id, `phase_has_user_gate` requires that phase to have `user_gate: true`, and `phase_has_branch_key` requires the expected `branch_key` value.
- `schema-validation.test.json`: each `schema` path must be POSIX-relative under `schemas/`, each `valid` fixture path must be POSIX-relative under `fixtures/`, and each valid fixture must parse as JSON and pass the referenced schema.
- `prompt-contract.test.json`: for each workflow phase, create a fixture run state at that phase, render the current prompt, and assert every listed section heading is present.

If `Agent Context` is missing, do not weaken the contract here; complete the prerequisite manifest prompt-context rendering task first.

For `schema-validation.test.json`, load each listed fixture and validate it against its referenced schema using `validateJsonAgainstSchema()` from `packages/agent-runtime/src/schema-validation.js`.

- [ ] **Step 5: Run validation**

Run:

```bash
npm run validate
node --test tests/validate-catalog.test.mjs
```

Expected: validation prints `Validated 1 agent.` and tests pass.

- [ ] **Step 6: Commit validator update**

```bash
git add scripts/validate-catalog.mjs tests/validate-catalog.test.mjs
git commit -m "feat: validate agent package asset references"
```

---

### Task 6: Package Required Agent Assets

**Files:**
- Modify: `scripts/pack-alloycat.mjs`
- Modify: `tests/alloycat-package.test.mjs`

- [ ] **Step 1: Write failing package listing assertions**

In `tests/alloycat-package.test.mjs`, extend the packed listing test before running the command:

```js
const listingPaths = new Set(
  listing.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
);
const expectedListingPaths = new Set([
  'package/package.json',
  'package/README.md',
  'package/catalog/catalog.yaml',
  'package/catalog/agents/interaction-auditor/agent.md',
  'package/catalog/agents/interaction-auditor/workflow.yaml',
  'package/catalog/agents/interaction-auditor/prompts/00-resolve-project-root.md',
  'package/catalog/agents/interaction-auditor/prompts/01-project-discovery.md',
  'package/catalog/agents/interaction-auditor/prompts/02-source-of-truth.md',
  'package/catalog/agents/interaction-auditor/prompts/03-scope-confirmation.md',
  'package/catalog/agents/interaction-auditor/prompts/04-branch-planning.md',
  'package/catalog/agents/interaction-auditor/prompts/05A-interaction-auditor.md',
  'package/catalog/agents/interaction-auditor/prompts/05B-visual-conformance-audit.md',
  'package/catalog/agents/interaction-auditor/prompts/05C-e2e-coverage-audit.md',
  'package/catalog/agents/interaction-auditor/prompts/06-report-assembly.md',
  'package/runtime/index.js',
  'package/src/index.js',
  ...interactionAuditorStarterAssets.map((asset) => `package/catalog/agents/interaction-auditor/${asset}`)
]);

for (const asset of interactionAuditorStarterAssets) {
  assert.ok(
    listingPaths.has(`package/catalog/agents/interaction-auditor/${asset}`),
    `Missing packaged asset: ${asset}`
  );
}

assert.deepEqual(listingPaths, expectedListingPaths);
```

- [ ] **Step 2: Refactor package validator for importable staged validation**

In `scripts/pack-alloycat.mjs`, add a real exported `validateStagedCatalog(catalogRoot)` helper that can run after staging and before `runNpmPack()`. Guard script execution behind a main check, so tests can import `validateStagedCatalog()` without running a pack.

Run the existing package tests after this refactor and keep behavior unchanged.

- [ ] **Step 3: Write failing packaged-validation tests**

Add separate or parameterized negative packaged-validation tests that import `validateStagedCatalog()`, build temporary staged catalogs, and assert pre-pack validation fails without mutating the source repository when each required asset category is omitted:

- a starter asset from `interactionAuditorStarterAssets`;
- a workflow-referenced schema;
- a workflow-referenced template;
- an agent-level test definition;
- a fixture referenced by a test definition;
- an example listed in `interactionAuditorStarterAssets`;
- a host adapter README.

Also add staged-catalog negative tests for executable test definition failures:

- malformed or failing `workflow.test.json`;
- invalid schema-validation fixture data;
- syntactically valid JSON that is not an accepted schema object;
- prompt-contract section requirements that rendered prompts do not satisfy.

Also add staged-catalog negative tests for packaged path-safety parity:

- unsafe workflow `schema:` and `template:` paths that are absolute, contain backslashes, contain `..`, or normalize outside `schemas/` or `templates/`;
- unsafe `schema-validation.test.json` schema or fixture paths that are absolute, contain backslashes, contain `..`, or use the wrong required prefix.

- [ ] **Step 4: Run package test to verify RED**

Run:

```bash
node --test tests/alloycat-package.test.mjs
```

Expected: the negative packaged-validation test fails until packaged validation checks referenced assets and agent-level test fixtures.

- [ ] **Step 5: Update packaged validation**

Use the same rules when generating packaged CLI validation; do not define validation only inside generated source that the pack script itself cannot call.

Add packaged validation for workflow asset references:

```js
function extractPackagedWorkflowAssetPaths(workflowText, key) {
  return [...workflowText.matchAll(new RegExp(`\\n\\s+${key}:\\s+(.+)`, 'g'))]
    .map((match) => match[1].trim());
}
```

Inside `validatePackagedCatalog()`, after prompt validation:

Ensure the packaged validator also imports `posix` and `win32` from `node:path` before applying these checks.

```js
function isAnyAbsolute(candidatePath) {
  return posix.isAbsolute(candidatePath) || win32.isAbsolute(candidatePath);
}

function requirePackagedRelativePath(basePath, candidatePath, label) {
  if (candidatePath.includes('\\')) {
    fail(`${label} must use POSIX separators: ${candidatePath}`);
    return false;
  }
  if (isAnyAbsolute(candidatePath)) {
    fail(`${label} must be relative: ${candidatePath}`);
    return false;
  }
  if (candidatePath.split('/').includes('..')) {
    fail(`${label} must not contain .. segments: ${candidatePath}`);
    return false;
  }
  const fullPath = resolve(basePath, candidatePath);
  const relativePath = relative(basePath, fullPath);
  if (relativePath.startsWith('..') || isAnyAbsolute(relativePath)) {
    fail(`${label} escapes its package root: ${candidatePath}`);
    return false;
  }
  return true;
}

function requirePackagedJsonFile(root, path) {
  requirePackagedFile(root, path);
  try {
    JSON.parse(readFileSync(join(root, path), 'utf8'));
  } catch {
    fail(`Invalid JSON file: ${path}`);
  }
}

for (const schemaPath of extractPackagedWorkflowAssetPaths(workflowText, 'schema')) {
  if (schemaPath.includes('\\')) {
    fail(`${agent.path} workflow schema must use POSIX separators: ${schemaPath}`);
    continue;
  }
  if (schemaPath.split('/').includes('..')) {
    fail(`${agent.path} workflow schema must not contain .. segments: ${schemaPath}`);
    continue;
  }
  const normalizedPath = posix.normalize(schemaPath);
  if (!normalizedPath.startsWith('schemas/')) {
    fail(`${agent.path} workflow schema must be under schemas/: ${schemaPath}`);
    continue;
  }
  if (requirePackagedRelativePath(join(catalogRoot, agent.path), normalizedPath, `${agent.path} workflow schema`)) {
    requirePackagedJsonFile(catalogRoot, `${agent.path}/${normalizedPath}`);
  }
}

for (const templatePath of extractPackagedWorkflowAssetPaths(workflowText, 'template')) {
  if (templatePath.includes('\\')) {
    fail(`${agent.path} workflow template must use POSIX separators: ${templatePath}`);
    continue;
  }
  if (templatePath.split('/').includes('..')) {
    fail(`${agent.path} workflow template must not contain .. segments: ${templatePath}`);
    continue;
  }
  const normalizedPath = posix.normalize(templatePath);
  if (!normalizedPath.startsWith('templates/')) {
    fail(`${agent.path} workflow template must be under templates/: ${templatePath}`);
    continue;
  }
  if (requirePackagedRelativePath(join(catalogRoot, agent.path), normalizedPath, `${agent.path} workflow template`)) {
    if (normalizedPath.endsWith('.json')) {
      requirePackagedJsonFile(catalogRoot, `${agent.path}/${normalizedPath}`);
    } else {
      requirePackagedFile(catalogRoot, `${agent.path}/${normalizedPath}`);
    }
  }
}
```

Also require packaged adapter README files for hosts listed in `agent.md`, the `adapters/alloycat/README.md` file, every starter asset path from `interactionAuditorStarterAssets`, packaged agent-level test definition files, and packaged fixtures/examples referenced by those tests. Pre-pack validation may import `interactionAuditorStarterAssets` from the source `scripts/agent-package-assets.mjs`; generated packaged validation must embed the resolved starter asset list. Packaged validation must mirror the Task 5 agent-level test execution rules, including workflow assertions, prompt-contract sections for every workflow phase, and schema-validation fixtures passing the shared schema validator.

Use two import paths for that shared schema validator:

- pre-pack `validateStagedCatalog()` runs from the source repo and imports `validateJsonAgainstSchema()` from `packages/agent-runtime/src/schema-validation.js`;
- generated packaged validation runs from the staged package and must import the copied runtime export from the packaged runtime index, or embed generated validation code from the same helper.

Defer status-promotion rules to the later catalog validation milestone unless this plan explicitly implements them.

After `pack-alloycat.mjs` copies runtime and catalog assets into `stageRoot`, call `validateStagedCatalog(join(stageRoot, 'catalog'))` before `runNpmPack()`. The negative test above must exercise this pre-pack path so a broken staged catalog cannot still produce a tarball.

- [ ] **Step 6: Run package tests**

Run:

```bash
node --test tests/alloycat-package.test.mjs
npm run pack:alloycat
```

Expected: package tests pass and `npm run pack:alloycat` prints a tarball path.

- [ ] **Step 7: Commit package update**

```bash
git add scripts/pack-alloycat.mjs tests/alloycat-package.test.mjs
git commit -m "feat: package interaction auditor assets"
```

---

### Task 7: Update Roadmap And Final Verification

**Files:**
- Modify: `docs/roadmap.md`

- [ ] **Step 1: Update roadmap item**

In `docs/roadmap.md`, add this item after the critical schema item if it does not exist yet. If it already exists, update it instead of duplicating it:

```md
### 4. Activate agent package directories

Goal: turn schemas, templates, adapters, tests, fixtures, examples, and package changelog from placeholders into validated package assets.

Why this matters:

- makes each directory's role clear;
- gives runtime and validation real contracts to enforce;
- supports promotion from draft to experimental status.

Acceptance checks:

- workflow outputs reference schema and template files;
- package validation checks referenced files;
- JSON workflow output templates are validated against their paired schemas;
- package smoke tests prove assets are shipped.
- agent-level test definitions are executed by source and packaged validation.
- starter directories and assets exist for schemas, templates, adapters, tests, fixtures, examples, and `CHANGELOG.md`.
- phase advancement rejects invalid JSON artifacts and advances valid JSON artifacts for both source-catalog runs and installed-package runs, resolving schemas from the copied installed package when present.
```

Renumber the later near-term sections.

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
- The policy-sensitive scan exits with no matches.

- [ ] **Step 3: Commit roadmap update**

```bash
git add docs/roadmap.md
git commit -m "docs: track agent package directory activation"
```

