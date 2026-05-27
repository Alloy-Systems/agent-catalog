# Agent Markdown Manifest Design

## Purpose

Unify each agent's machine-readable manifest and human-readable description into one canonical `agent.md` file. The file should replace the split between `agent.yaml` and agent README files, while keeping workflow execution in `workflow.yaml` and phase instructions in `prompts/`.

The goal is to make the agent package easier to understand, validate, install, and render into prompts without duplicating metadata across files.

## Current Problem

The current `agents/interaction-auditor/agent.yaml` contains useful metadata, but the runtime only reads simple top-level fields. Nested sections such as `entrypoint`, `artifacts`, `supports`, and `quality_gates` are mostly declarative. The agent README duplicates agent purpose and runtime model details.

This creates drift:

- metadata can describe commands or orchestrators that no longer exist;
- README text can disagree with the manifest;
- runtime paths are hardcoded instead of derived from the manifest;
- host adapters have no single agent-level source of behavior rules.

## Decision

Use `agent.md` as the canonical agent file.

```text
agents/
  interaction-auditor/
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

`agent.md` contains YAML frontmatter followed by Markdown body content:

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

The agent is designed for desktop, web, and mobile UI products.

## Operating Rules

Agent-level rules that apply to every phase.

## Evidence Rules

Evidence standards that apply to findings and reports.

## Forbidden Actions

Actions this agent must not take during audit mode.
```

## Responsibilities

### `catalog.yaml`

`catalog.yaml` remains a repository-level index.

It should contain only enough information to find agent packages:

```yaml
catalog:
  name: Alloy Agent Catalog
  schema_version: 1

agents:
  - id: interaction-auditor
    path: agents/interaction-auditor
```

Catalog display commands can load `agent.md` to show status, version, and description.

### `agent.md`

`agent.md` is the source of truth for:

- agent id;
- display name;
- status;
- version;
- description;
- runtime model;
- workflow file path;
- project-local artifact paths;
- agent-level prompt context sections;
- supported host adapters and adapter status;
- quality gates.

### `workflow.yaml`

`workflow.yaml` remains the source of truth for phase execution:

- phase ids;
- phase titles and descriptions;
- prompt paths;
- input artifact paths;
- output artifact paths;
- user gates;
- branch keys.

It must not duplicate agent-level metadata beyond the workflow id required for validation.

Workflow input and output artifact paths must be relative POSIX-style run artifact paths. Validation must reject absolute paths, backslashes, `..` path segments, paths that resolve outside the run directory, and paths that resolve to the run directory itself.

### `prompts/`

Phase prompts remain separate files. They should receive agent-level prompt context from `agent.md` during prompt rendering, then add phase-specific instructions from the current phase prompt.

## Runtime Loading Flow

Runtime has two loading paths:

Source/catalog commands (`list`, `info`, and install source resolution) load agent packages in this order:

```text
catalog.yaml
  -> agent path
  -> agent.md frontmatter and body
  -> validate manifest
  -> load runtime.workflow from manifest
  -> validate workflow id, prompt paths, artifact paths, schema references, and template references
  -> return metadata for `list`/`info` or copy the source package for `install`
```

Installed-project commands (`init`, `status`, `remind`, `next`, and agent-scoped `uninstall`) must not require the source catalog after installation. They load installed project state in this order:

```text
.alloycat/agents/<agent-id>/index.json
  -> installed manifest/config snapshot
  -> run_root and state_file from installed config
  -> current run state
  -> workflow, prompt, schema, and template package paths from installed agent metadata
  -> resolve runtime package paths from installed_package_dir
  -> installed agent.md via agent_document_path
  -> selected Markdown sections from prompt_context.include_sections
```

Full-project `uninstall` without an agent id bypasses per-agent index loading and removes the runtime state root at `.alloycat`.

### Installed `index.json`

`install` writes `.alloycat/agents/<agent-id>/index.json` as the installed agent contract. Installed-project commands must read this file instead of re-reading source `catalog.yaml`.

The installed index contains at least:

- `agent_id`;
- `install_dir`;
- `run_root`;
- `state_file`;
- `manifest_snapshot` with the validated `agent.md` frontmatter fields needed by runtime commands;
- `installed_package_dir`, relative to `install_dir`, defaulting to `package`;
- `agent_document_path` relative to `installed_package_dir`;
- `workflow_path` and `prompt_root` relative to `installed_package_dir`.

`install` must copy `agent.md`, the workflow file, prompt files, and every workflow-referenced runtime asset needed by runtime commands under `installed_package_dir`. That includes schema and template files when workflow outputs declare them. Prompt rendering and phase advancement should resolve those paths from the installed package, never the source catalog checkout. Smoke tests must prove installed schema/template resolution still works after the source catalog is moved, changed, or unavailable. The snapshot is not a second source of truth for catalog authors. It is the installed runtime record that lets a target project keep working independently.

Installed-project commands must validate the installed index before using it. Validation fails closed when:

- any required installed index key is missing or has the wrong type;
- `agent_id` differs from the directory name or `manifest_snapshot.id`;
- `state_file` is empty, `.`, `..`, absolute, templated, or contains path separators;
- `install_dir`, `run_root`, `installed_package_dir`, `agent_document_path`, `workflow_path`, or `prompt_root` is absolute;
- `install_dir` does not resolve to `.alloycat/agents/<agent-id>`;
- `run_root` escapes `install_dir`;
- `installed_package_dir` escapes `install_dir`;
- `agent_document_path`, `workflow_path`, or `prompt_root` escapes `installed_package_dir`.
- `agent_document_path`, `workflow_path`, `prompt_root`, referenced prompt files, and copied schema/template assets are missing under `installed_package_dir`.

## Prompt Context Rules

Only selected Markdown sections from `agent.md` may be injected into rendered prompts.

`prompt_context.include_sections` is an allowlist. This prevents general README prose, installation notes, or changelog text from accidentally becoming behavior instructions.

Rendered phase prompts should include:

- agent name and description;
- selected agent-level sections;
- current phase metadata;
- exact input artifacts;
- exact output artifacts;
- phase prompt content;
- next command.

## Artifact Path Rules

The manifest may use a limited template set for project-local artifact paths:

- `{agent_id}`

Runtime must reject unknown placeholders. This keeps project writes predictable and prevents agent packages from writing outside the intended project-local state directory.

Resolution rules:

- `install_root` is reserved for the project-local agent installation directory and must be exactly `.alloycat/agents/{agent_id}` for the MVP.
- `run_root` resolves relative to the target project root and must remain inside `install_root`.
- `state_file` is a plain file name, not a path template, and is resolved inside each run directory.

Initial artifact defaults:

```yaml
artifacts:
  install_root: .alloycat/agents/{agent_id}
  run_root: .alloycat/agents/{agent_id}/runs
  state_file: state.json
```

## Validation Rules

Validation must fail when:

- `catalog.yaml` references an agent path without `agent.md`;
- `catalog.yaml` id differs from `agent.md` id;
- `catalog.yaml` path is absolute or escapes the catalog root;
- required frontmatter fields are missing;
- `schema_version` is not `1`;
- `type` is not a supported agent type;
- `version` is not valid semver;
- `status` is not a supported lifecycle status;
- `runtime.model` is not `workflow`;
- `runtime.workflow` is not a relative POSIX-style package path, contains backslashes, or escapes the agent package;
- `runtime.workflow` does not exist;
- workflow id differs from agent id;
- workflow prompt paths are not relative POSIX-style paths under `prompts/`, contain backslashes, or escape the agent package;
- prompt files referenced by `workflow.yaml` do not exist;
- `prompt_context.include_sections` is missing, empty, or not a list of strings;
- `prompt_context.include_sections` references a missing Markdown heading;
- artifact paths use unknown placeholders;
- `install_root` differs from `.alloycat/agents/{agent_id}`;
- `run_root` is absolute or escapes `install_root`;
- `state_file` is empty, `.`, `..`, absolute, or contains path separators or placeholders;
- `supports.hosts` is missing, empty, or malformed;
- supported hosts omit `adapter_path` or `status`;
- supported host adapter paths are not relative POSIX-style paths under `adapters/`, contain backslashes, or escape the agent package;
- supported hosts reference missing adapter directories or unsupported adapter statuses;
- quality gate fields are missing or not boolean.

Required frontmatter fields:

- `schema_version`;
- `id`;
- `name`;
- `type`;
- `version`;
- `status`;
- `description`;
- `runtime.model`;
- `runtime.workflow`;
- `artifacts.install_root`;
- `artifacts.run_root`;
- `artifacts.state_file`;
- `prompt_context.include_sections`;
- `supports.hosts`;
- `quality_gates`.

Required quality gate keys:

- `requires_project_discovery`;
- `requires_user_scope_confirmation`;
- `requires_persistent_artifacts`;
- `forbids_single_prompt_full_run`;
- `requires_tests`.

## Migration Strategy

1. Add manifest parsing support while keeping the current package behavior intact.
2. Add `agent.md` for `interaction-auditor`.
3. Move `agent.yaml` metadata into frontmatter.
4. Move agent README body into Markdown body.
5. Update runtime and validators to prefer `agent.md`.
6. Update package assembly and packaged validation so they no longer require `agent.yaml` or agent README files.
7. Update `install` so `.alloycat/agents/<agent-id>/index.json` persists the installed manifest/config snapshot and runtime package paths.
8. Remove `agent.yaml` and agent README after tests prove runtime, validation, and packaging use `agent.md`.

## Non-Goals

- Do not merge `workflow.yaml` into `agent.md`.
- Do not merge phase prompts into `agent.md`.
- Do not inject the full Markdown body into every prompt.
- Do not add a general-purpose YAML dependency unless the local parser becomes a blocker.
- Do not implement functional host adapters in this migration. Creating skeleton adapter directories with README or host-specific entry files for hosts declared in `agent.md` is allowed so validation can prove manifest references are real paths; bare placeholders do not satisfy adapter validation.

## Acceptance Criteria

- `alloycat list` reads agent status and description through `agent.md`.
- `alloycat info interaction-auditor` prints manifest metadata and useful Markdown body fields.
- `install` writes `.alloycat/agents/<agent-id>/index.json` with installed path settings, manifest snapshot, and workflow/prompt package references.
- Installed-project commands read `.alloycat/agents/<agent-id>/index.json` and keep working without source `catalog.yaml`.
- Installed-project commands reject malformed installed `index.json` files before proceeding, including missing keys, wrong types, invalid `state_file`, mismatched ids, absolute or escaping installed paths, and missing installed runtime assets.
- Installed-project commands keep working when the source catalog is unavailable, using copied installed assets for agent.md, workflow, prompts, schemas, and templates.
- `install`, `init`, `status`, `remind`, `next`, and agent-scoped `uninstall` use manifest-backed agent project paths. Full-project `uninstall` removes the runtime project state root.
- `renderNextPrompt()` includes selected agent-level sections and excludes unrelated Markdown sections.
- `npm run validate` rejects malformed `agent.md` files.
- `npm test` passes.
- `npm run pack:alloycat` packages `agent.md` and no longer requires agent-level `agent.yaml` or README files.
