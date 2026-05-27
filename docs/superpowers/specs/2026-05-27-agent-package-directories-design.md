# Agent Package Directories Design

## Purpose

Define the role of every directory inside `agents/interaction-auditor/` so the package stops looking like a set of future placeholders and becomes a clear contract for authoring, validation, packaging, and host integration.

This spec complements the `agent.md` manifest design. `agent.md` describes the agent and its runtime contract. The directories described here hold the reusable assets that make the contract testable and portable.

This spec assumes the `agent.md` manifest migration has landed. Until then, current `agent.yaml` and agent README files remain transitional inputs.

## Post-Migration Target Package Shape

```text
agents/interaction-auditor/
  agent.md
  workflow.yaml
  prompts/
  schemas/
  templates/
  adapters/
  tests/
  fixtures/
  examples/
  CHANGELOG.md
  scripts/        # optional
```

The current repository may still contain transitional `agent.yaml` and agent README files until the `agent.md` migration lands. After that migration, `agent.md` is the canonical replacement for those two files, while `workflow.yaml` remains the required phase graph:

```text
agents/interaction-auditor/
  agent.md
  workflow.yaml
```

The remaining directories should each have a narrow responsibility.

## Directory Responsibilities

### `prompts/`

Phase-specific execution instructions.

Rules:

- one prompt file per workflow phase;
- prompt paths are referenced from `workflow.yaml`;
- prompts describe only the current phase;
- prompts do not duplicate agent-level operating rules from `agent.md`;
- prompts do not include templates for output artifacts.

Runtime use:

- `renderNextPrompt()` reads the current phase prompt and combines it with agent context, phase metadata, inputs, outputs, and next-step guidance.

Validation:

- every `workflow.yaml` phase must reference an existing prompt file;
- no extra prompt file should exist unless it is referenced from `workflow.yaml`.

### `schemas/`

Machine-checkable contracts for structured artifacts.

Initial schema files:

```text
schemas/
  00-project-root.schema.json
  02-ui-inventory.schema.json
  05-branch-plan.schema.json
  finding.schema.json
```

Rules:

- schemas are required for JSON output artifacts that control later workflow behavior;
- Markdown artifacts may remain schema-free until they become machine-read;
- schema file names should match artifact names when practical;
- schema files are reusable across runtime validation, fixtures, and examples.

Runtime use:

- `next` validates JSON output artifacts that declare schemas before phase advancement. Schema-free noncritical JSON keeps syntax-only validation until promoted to schema-backed.
- branch-controlled phases use the branch plan schema before reading branch decisions.

Validation:

- every critical JSON output artifact in `workflow.yaml` must declare a schema after the initial schema system is enabled;
- noncritical JSON outputs may stay schema-free until they become machine-read by runtime, validators, fixtures, or branch logic;
- workflow `schema:` references must be relative, must not contain backslashes, must not contain `..` path segments, must remain inside the agent package, must stay under `schemas/`, and must exist;
- schema files must be valid JSON and must match the supported schema subset used by runtime validation;
- fixture artifacts must pass their declared schemas.

### `templates/`

Reusable skeletons for output artifacts.

Initial template files:

```text
templates/
  scope-confirmation.md
  branch-plan.json
  finding.md
  final-report.md
```

Rules:

- templates show the required structure of phase outputs;
- templates are referenced by `workflow.yaml` output metadata;
- templates should contain placeholders for values that the current run must fill;
- templates must not contain project-specific facts.

Runtime use:

- rendered prompts can show template paths next to output artifact paths;
- a later `alloycat template` command can print or copy a template for the current phase.

Validation:

- every `template:` reference in `workflow.yaml` must exist;
- workflow `template:` references must be relative, must not contain backslashes, must not contain `..` path segments, must remain inside the agent package, must stay under `templates/`, and must exist;
- templates should be packaged with `alloycat`;
- examples should follow template structure.

### `adapters/`

Thin host integration assets.

Recommended structure:

```text
adapters/
  alloycat/
    README.md
  primary-cli/
    README.md
  secondary-cli/
    README.md
```

Rules:

- adapters locate and invoke the shared runtime;
- adapters do not duplicate workflow phase prompts;
- adapters do not fork schemas or templates;
- adapters stop at user gates;
- adapters document host-specific limitations.

Runtime use:

- `alloycat install` can later install or print adapter instructions for a selected host.
- host-native integrations consume the same `agent.md`, `workflow.yaml`, prompts, schemas, templates, and run artifacts.

Validation:

- every host listed in `agent.md` must have an adapter directory;
- each adapter directory must include a README or host-specific entry file;
- adapter status must be one of `skeleton`, `experimental`, `stable`, or `deprecated`.

### `tests/`

Agent-package tests and verification definitions.

Recommended structure:

```text
tests/
  workflow.test.json
  schema-validation.test.json
  prompt-contract.test.json
```

Rules:

- tests in this directory describe agent-level expectations;
- repository-level test files in `/tests` execute these expectations;
- agent-level tests should stay data-driven where possible;
- tests should cover workflow graph, schemas, templates, prompt contract, fixtures, and example runs.

Runtime use:

- `npm test` can load agent-level test definitions and verify them through shared test helpers.
- a later `alloycat validate-agent <agent-id>` command can run only one agent package's checks.

Validation:

- `draft` agents require the directory shape with meaningful starter files, README files, or test definitions; bare tracked placeholders do not satisfy required draft directories;
- each agent-level test definition must declare `kind: executable` or `kind: documentation_fixture`;
- executable test definitions must use a known test file shape and pass validation;
- documentation fixtures must be accepted only as documented examples and must not satisfy executable coverage requirements;
- `experimental` agents require at least one fixture-backed verification;
- `stable` agents require schema, template, prompt, fixture, and example validation.

### `fixtures/`

Small, deterministic inputs for tests.

Recommended structure:

```text
fixtures/
  minimal-web-app/
  desktop-shell-app/
  no-visual-source-run/
```

Rules:

- fixtures are intentionally small;
- fixtures may be sample projects or curated run artifact sets;
- fixtures must not contain normal generated run output unless that output is intentionally curated for tests;
- fixture names should describe the scenario they prove.

Runtime use:

- tests use fixtures to verify project discovery assumptions, branch planning, schema validation, and report assembly.

Validation:

- fixtures used by tests must be referenced by test definitions;
- fixture run artifacts must pass declared schemas;
- fixture projects must not require external services.

### `examples/`

Human-readable sample runs, reports, and usage notes.

Recommended structure:

```text
examples/
  minimal-web-app/
    README.md
    final-report.md
  no-visual-source/
    README.md
    final-report.md
```

Rules:

- examples explain what a good completed run looks like;
- examples may include curated artifacts, but they are documentation assets, not active run state;
- examples should be understandable without running the target project;
- examples must not contain project-private facts.

Runtime use:

- `alloycat info` can link to examples for the agent.
- package users can inspect examples to understand expected outputs.

Validation:

- examples required by status rules must exist;
- example artifacts should follow templates and schemas;
- `experimental` or `stable` status requires at least one example or documented verification run.

### `CHANGELOG.md`

Package-level change history for the agent.

Rules:

- the file lives at the agent package root;
- entries are grouped by agent package version;
- breaking workflow, artifact, schema, template, or adapter changes must be recorded before promotion beyond `draft`.

Validation:

- `draft` agents require the file to exist;
- `stable` agents require an entry for the promoted version.

### `scripts/`

Optional agent-specific deterministic helpers.

Rules:

- scripts are optional;
- scripts are only for behavior that belongs to the agent package and cannot live cleanly in generic runtime;
- scripts must not replace shared `alloycat` orchestration;
- scripts must be tested before an agent can be promoted beyond `draft`;
- if no helper exists, the directory can either be absent or contain only a tracked placeholder.

Runtime use:

- scripts may be called by validation, fixture generation, or report assembly when generic runtime is insufficient.
- current Interaction Auditor MVP should not depend on agent-specific scripts.

Validation:

- if `scripts/` exists with executable files, each script must have a documented command and a test;
- scripts must be packaged only when referenced.

## Required Versus Optional Directories

For `draft` agents:

- required: `agent.md`, `workflow.yaml`, `prompts/`, `schemas/`, `templates/`, `adapters/`, `tests/`, `fixtures/`, `examples/`, `CHANGELOG.md`;
- optional: `scripts/`.

For `experimental` agents:

- required: all draft requirements;
- at least one schema for a machine-read artifact;
- at least one template used by a workflow output;
- at least one fixture-backed verification;
- at least one example or manual verification record;
- at least one adapter marked `experimental`.

For `stable` agents:

- required: all experimental requirements;
- schemas for every JSON output artifact;
- templates for user-facing Markdown report artifacts;
- fixture-backed validation for branch planning and report assembly;
- adapter verification notes;
- `CHANGELOG.md` entry for the promoted version.

## Workflow Metadata Additions

`workflow.yaml` output entries should be able to reference schemas and templates:

```yaml
outputs:
  - path: 05-branch-plan.json
    format: json
    schema: schemas/05-branch-plan.schema.json
    template: templates/branch-plan.json
    description: Branch execution plan with audit branch flags and rationale.
```

Runtime should use:

- `schema` to validate artifacts before phase advancement;
- `template` to guide artifact creation in rendered prompts.

## Packaging Rules

The npm package must include every file or starter asset required by the agent's current lifecycle status. For the Interaction Auditor draft package, include:

- `agent.md`;
- `workflow.yaml`;
- `prompts/`;
- `schemas/`;
- `templates/`;
- `adapters/`;
- `tests/`;
- `fixtures/`;
- `examples/`;
- `CHANGELOG.md`.

The package should exclude:

- generated run directories;
- local scratch files;
- unreferenced helper output.

## Migration Strategy

1. Document directory responsibilities.
2. Add starter files for schemas, templates, adapters, tests, fixtures, examples, and `CHANGELOG.md`.
3. Add schema and template references to `workflow.yaml` for assets that are workflow outputs.
4. Add validation that required draft starter assets exist and that workflow asset references resolve inside the agent package.
5. Add tests that prove package contents include required assets.
6. Update the roadmap to keep directory activation separate from later lifecycle status promotion rules.

## Acceptance Criteria

- Every directory inside `agents/interaction-auditor/` has a documented purpose.
- Empty future directories either contain a meaningful starter file or are explicitly optional.
- `workflow.yaml` references schema and template files for key outputs.
- `npm run validate` checks the required draft starter assets for the Interaction Auditor package.
- Package tests verify that required directory assets are included in the packed package.
- Package tests verify `CHANGELOG.md` is included with required directory assets.
- The roadmap lists directory activation as a near-term step and keeps full lifecycle status promotion rules in a separate milestone.
