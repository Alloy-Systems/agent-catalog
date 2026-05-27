# Alloy Agent Catalog Design

## Purpose

Create a separate repository for reusable agents. The repository is a governed catalog, not a loose prompt collection. Each agent package must define its purpose, internal workflow, artifacts, prompts, schemas, host adapters, tests, fixtures, and release status.

The initial agent in the catalog is the Interaction Auditor. Future agents may cover release readiness, architecture review, migration planning, design conformance, e2e coverage review, and other recurring engineering tasks.

In this design, "agent" is the user-facing unit. "Workflow" is the internal implementation model for agents that need phase gates, durable artifacts, and deterministic branching.

## Naming

Recommended repository name:

```text
alloy-agent-catalog
```

Recommended product name:

```text
Alloy Agent Catalog
```

Recommended CLI name:

```text
alloycat
```

Recommended package names:

```text
@alloy/agent-catalog
@alloy/agent-runtime
```

`Alloy` is the shared brand prefix for user-facing naming. Individual agents use descriptive names under that brand, such as `alloy-interaction-auditor` or `alloy-release-readiness`.

## Goals

- Keep reusable agents outside product repositories.
- Make each agent installable into multiple host environments through thin adapters.
- Store shared workflow logic in one place and prevent adapter drift.
- Make phase outputs durable through run artifacts.
- Enforce quality gates for new agents before they become stable.
- Support gradual growth from one agent to a catalog of reusable agents.
- Allow agents to be vendored into a project when a fully local, pinned copy is required.

## Non-Goals

- The catalog does not replace project-specific instructions.
- The catalog does not own product requirements for consuming repositories.
- The catalog does not require every agent to modify code.
- The catalog does not require every agent to use subagents.
- The catalog does not store project audit run artifacts by default.

## Repository Layout

```text
alloy-agent-catalog/
  README.md
  CONTRIBUTING.md
  LICENSE
  catalog.yaml
  package.json

  docs/
    concepts.md
    authoring-workflows.md
    installing-workflows.md
    adapter-contract.md
    release-process.md

  packages/
    agent-runtime/
      package.json
      src/
      tests/

    alloycat/
      package.json
      src/
      tests/

  agents/
    interaction-auditor/
      agent.yaml
      README.md
      workflow.yaml
      CHANGELOG.md
      prompts/
      schemas/
      templates/
      scripts/
      adapters/
        primary-cli/
        secondary-cli/
      tests/
      fixtures/
      examples/

    release-readiness/
      agent.yaml
      README.md
      workflow.yaml
      CHANGELOG.md
      prompts/
      schemas/
      templates/
      scripts/
      adapters/
      tests/
      fixtures/
      examples/

  examples/
    minimal-web-app/
    desktop-shell-app/
    no-design-source-app/

  scripts/
    validate-catalog.mjs
    new-agent.mjs
```

## Catalog Manifest

`catalog.yaml` is the repository-level index.

Example:

```yaml
catalog:
  name: Alloy Agent Catalog
  schema_version: 1

workflows:
  - id: interaction-auditor
    path: agents/interaction-auditor
    status: experimental
    version: 0.1.0
    description: Agent that audits visible UI behavior, source-of-truth conformance, and e2e coverage.
    hosts:
      - primary-cli
      - secondary-cli

  - id: release-readiness
    path: agents/release-readiness
    status: draft
    version: 0.0.1
    description: Agent that checks release blockers, test evidence, docs, and handoff readiness.
    hosts: []
```

The catalog validator checks that every listed agent has a valid `agent.yaml`, README, workflow definition, and required folders for its status level.

## Workflow Manifest

Every agent package has `agent.yaml`.

Example:

```yaml
id: interaction-auditor
name: Alloy Interaction Auditor
type: phase-gated-agent
runtime_model: workflow
status: experimental
version: 0.1.0
description: Agent that audits visible UI behavior, source-of-truth conformance, and e2e coverage.

entrypoint:
  command: alloycat run interaction-auditor
  orchestrator: scripts/auditctl.mjs

artifacts:
  run_root: .agent-runs/interaction-auditor
  state_file: state.json

supports:
  hosts:
    primary-cli:
      adapter_path: adapters/primary-cli
      status: experimental
    secondary-cli:
      adapter_path: adapters/secondary-cli
      status: skeleton

quality_gates:
  requires_project_discovery: true
  requires_user_scope_confirmation: true
  requires_persistent_artifacts: true
  forbids_single_prompt_full_run: true
  requires_tests: true
```

## Agent Status

Agent status controls quality expectations.

```text
draft
  Idea is captured, but prompts, artifacts, and adapters may change freely.

experimental
  Agent runs end to end on at least one fixture or real project.
  Artifact names and schemas may still change.

stable
  Agent has schema validation, tests, examples, changelog, and at least one complete host adapter.
  Breaking changes require a major version bump.

deprecated
  Agent is kept for compatibility and points to a replacement.
```

Promotion requirements:

- `draft` to `experimental`: manifest, README, workflow phases, at least one prompt, and one example.
- `experimental` to `stable`: tests, fixtures, validation, changelog, install instructions, and documented limitations.
- `stable` to `deprecated`: migration note and replacement workflow, if one exists.

## Agent Package Contract

Each agent package must include:

- `agent.yaml`: agent metadata, runtime model, and quality gates.
- `README.md`: purpose, scope, install, run, outputs, limitations.
- `workflow.yaml`: phase graph and artifact map for agents that use a workflow runtime model.
- `prompts/`: phase prompts only, not one large all-purpose prompt.
- `schemas/`: JSON schemas for durable artifacts.
- `templates/`: reusable output templates.
- `scripts/`: optional agent-specific orchestration helpers.
- `adapters/`: host-specific thin wrappers.
- `tests/`: unit tests for workflow scripts, schema validation, and prompt rendering.
- `fixtures/`: small sample projects or artifact sets used by tests.
- `examples/`: human-readable example runs and reports.
- `CHANGELOG.md`: agent-level changes.

Each agent must keep project-specific facts out of shared prompts. Project facts belong in run artifacts produced during a specific audit or review.

## Adapter Contract

Adapters are host-specific shims. They are not the source of truth.

Adapter responsibilities:

- expose the workflow to the host;
- locate the shared agent package;
- initialize or resume a run;
- call the workflow orchestrator;
- execute only the currently rendered phase prompt;
- stop at user gates;
- document any host-specific capability gaps.

Adapter restrictions:

- do not duplicate shared phase prompts;
- do not fork artifact schemas;
- do not own branch decisions;
- do not bypass validation;
- do not continue past required user gates.

Adapter status levels:

```text
skeleton
  File structure exists, but it is not verified.

experimental
  Adapter can start and complete a sample run with manual supervision.

stable
  Adapter is covered by tests or documented manual verification and matches the shared workflow contract.
```

## Runtime And CLI

The `alloycat` CLI is the common entrypoint.

Commands:

```text
alloycat list
alloycat info <agent-id>
alloycat install <agent-id> --host <host> --project <path>
alloycat init <agent-id> --project <path>
alloycat status --run <run-id>
alloycat next --run <run-id>
alloycat validate <agent-id>
alloycat validate-run --run <run-id>
```

Install modes:

```text
linked
  Project adapter points to the central catalog checkout.

vendored
  A pinned agent package copy is copied into the target project.

prompt-only
  The agent package produces a standalone bootstrap prompt and no host adapter files.
```

The default local development mode is `linked`. The safer project archival mode is `vendored`.

## Run Artifacts

Workflow run artifacts are stored outside source directories unless the user explicitly chooses a project-local run root.

Default:

```text
.agent-runs/<agent-id>/<run-id>/
```

The catalog should ship a recommended ignore snippet:

```text
.agent-runs/
```

Run artifacts are durable operational output, not catalog source files.

## First Agent: Alloy Interaction Auditor

The first catalog agent is `interaction-auditor`.

It includes:

- phase-gated project discovery;
- source-of-truth classification;
- user scope confirmation;
- branch planning;
- interaction/runtime audit;
- optional visual conformance audit;
- e2e coverage audit;
- final report assembly;
- optional fix planning.

The Interaction Auditor is the reference implementation for catalog rules. New agents should copy its structure before simplifying it.

## Adding A New Agent

New agent creation uses:

```text
alloycat new-agent <id>
```

The scaffold creates:

- manifest;
- README;
- workflow graph;
- prompt folder;
- schema folder;
- template folder;
- adapter folders;
- test folder;
- fixture folder;
- changelog.

New agent review checklist:

- clear purpose and non-goals;
- bounded phases;
- durable artifacts;
- deterministic branch points;
- user gates where wrong assumptions are costly;
- evidence rules;
- validation rules;
- examples;
- tests;
- adapter status clearly marked.

## Quality Gates

Repository-level validation must check:

- every agent listed in `catalog.yaml` exists;
- every agent has valid `agent.yaml`;
- status rules are satisfied;
- adapter paths referenced by manifests exist;
- prompt files referenced by `workflow.yaml` exist;
- schema files referenced by `workflow.yaml` exist;
- no agent declares stable status without tests and examples;
- generated run artifact folders are not committed.

Agent-level tests should cover:

- phase graph validity;
- required artifact names;
- schema validation;
- prompt rendering;
- branch selection;
- install adapter file generation;
- example run validation.

## Governance

The catalog should use pull requests for agent additions and promotions.

Reviewers check:

- agent scope is reusable and not project-specific;
- host adapters are thin;
- prompts are phase-specific;
- branch logic is represented in artifacts;
- user gates are explicit;
- tests match status level;
- examples are understandable;
- changelog is updated.

Breaking changes:

- require version bump;
- require migration notes;
- should keep old workflow versions available when practical.

## MVP

The first repository milestone should include:

- repository scaffold;
- `catalog.yaml`;
- `packages/alloycat`;
- `packages/agent-runtime`;
- `agents/interaction-auditor`;
- manifest validation;
- run folder creation;
- phase prompt rendering;
- branch plan validation;
- one complete host adapter;
- one adapter skeleton for a second host;
- fixtures for a small web app and a project without visual source;
- tests for catalog validation and Interaction Audit phase flow.

Deferred:

- remote package publishing;
- rich interactive dashboard;
- automatic screenshot comparison;
- automatic host process launching;
- hosted registry service.

## Open Policy Decisions

Before implementation, decide:

- whether the first repo is private or public;
- whether agent versions are published as packages or consumed from git tags;
- whether generated run artifacts should ever be project-local by default;
- whether `alloycat install` should modify project ignore files automatically or only print instructions;
- whether agent adapters should be generated from templates or committed as static files.

## Risks

- A catalog can become a prompt dump unless manifests, tests, and status rules are enforced.
- Adapters can drift if they duplicate shared prompts.
- Agents can become too generic if they avoid concrete artifacts.
- Project-local install can pollute product diffs if ignore rules are not clear.
- Stable status loses meaning if promotion rules are not enforced.
