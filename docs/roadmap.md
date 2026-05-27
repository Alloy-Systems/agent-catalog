# Alloy Agent Catalog Roadmap

This roadmap tracks the path from the current MVP to a reusable catalog of installable workflow agents. It is based on the current repository state, the published `alloycat` package, and the original Interaction Audit workflow kit design.

## Current Baseline

- `alloycat` is published on npm, while the repository may contain unreleased changes for the next patch.
- `interaction-auditor` has a phase-gated workflow with durable run state.
- `install`, `init`, `remind`, `next`, `status`, and `uninstall` are implemented in the current repository.
- `init` can infer the installed agent when the project has one installed agent.
- `next` validates required output artifacts before advancing phases.
- JSON artifacts are checked for valid JSON syntax.
- The workflow stops explicitly at `user_gate: true` phases.
- Package publishing uses GitHub trusted publishing from release tags.

## Immediate Release

### 1. Release current local changes

Goal: publish the corrected project cleanup behavior and the current `interaction-auditor` package id.

Behavior:

- `alloycat uninstall <agent-id>` removes only `.alloycat/agents/<agent-id>/`.
- `alloycat uninstall` removes the full `.alloycat/` project state and cleans `.gitignore`.
- Running `alloycat uninstall` when no project state exists succeeds without changing files.

Acceptance checks:

- Runtime tests cover agent-only and full-project uninstall.
- CLI tests cover both command forms.
- Package smoke tests cover both command forms through `npx`.

Release checklist:

- Release patch is published and smoke-tested from npm.

## Near-Term Stabilization

### 2. Make `agent.md` the canonical agent manifest

Goal: replace split agent metadata and agent README files with one canonical Markdown manifest.

Why this matters:

- keeps agent metadata and human-readable documentation together;
- lets runtime derive workflow paths, run artifact roots, and host adapter references from the manifest;
- lets prompt rendering include explicitly selected agent-level rules.

Acceptance checks:

- `alloycat list` and `alloycat info` read display metadata from `agent.md`;
- `install`, `init`, `status`, `remind`, `next`, and agent-scoped `uninstall` use manifest-backed agent paths; full-project `uninstall` continues to remove the runtime project state root;
- skeleton adapter directories with README or host-specific entry files exist for hosts declared in `agent.md`; bare placeholders do not satisfy validation;
- validation rejects malformed frontmatter, missing prompt-context sections, unsafe artifact paths, and workflow id mismatches.

### 3. Add schemas for critical JSON artifacts

Goal: validate artifact shape, not just JSON syntax.

Initial schema files:

- `schemas/00-project-root.schema.json`
- `schemas/02-ui-inventory.schema.json`
- `schemas/05-branch-plan.schema.json`
- `schemas/finding.schema.json`; this is reusable for report templates and examples, not a required `workflow.yaml` output reference until findings become a structured workflow artifact

Why this matters:

- Prevents placeholder `{}` artifacts from advancing the workflow.
- Makes later phases safer after context compaction or a resumed run.
- Creates a stable contract for host adapters and examples.

Acceptance checks:

- Invalid required fields fail validation.
- Minimal valid examples pass validation.
- `workflow.yaml` declares `schema:` references for initial critical JSON workflow artifacts, excluding reusable/example-only schemas, and rendered prompts display those workflow-declared schema paths.
- `next` refuses to advance when a schema-backed output artifact fails its declared schema, with runtime and CLI coverage.

### 4. Activate agent package directories

Goal: turn schemas, templates, adapters, tests, fixtures, examples, and package changelog from placeholders into validated package assets.

Why this matters:

- makes each directory's role clear;
- gives runtime and validation real contracts to enforce;
- supports promotion from `draft` to `experimental` status.

Acceptance checks:

- starter directories and assets exist for schemas, templates, adapters, tests, fixtures, examples, and `CHANGELOG.md`;
- workflow outputs reference schemas for the critical JSON artifacts listed above and templates for outputs that define starter templates;
- package validation checks referenced files;
- package smoke tests prove required assets are shipped;
- agent-level test definitions are executed by source and packaged validation.

### 5. Enforce branch plans during phase advancement

Goal: make `05-branch-plan.json` control which audit tracks run.

Behavior:

- `branch_key` phases are skipped when the branch plan disables that track.
- Disabled tracks are recorded in run state.
- `report-assembly` receives only enabled or completed track artifacts.
- If the branch plan is missing or fails the branch-plan schema, `next` refuses to enter branch-controlled phases.

Why this matters:

- Avoids running visual audit when no authoritative visual source exists.
- Avoids asking agents to produce findings for tracks that were explicitly blocked.
- Makes branching deterministic instead of prompt-dependent.

Acceptance checks:

- Runtime tests cover enabled, disabled, and blocked branches.
- CLI tests show skipped phases clearly.
- Package smoke tests verify branch skipping through `npx`.

### 6. Improve prompt contract and artifact templates

Goal: make each phase prompt precise enough for real project audits.

Prompt contract:

- agent name and description
- phase goal
- exact input files
- exact output files
- allowed actions
- forbidden actions
- evidence requirements
- stop conditions
- validation command

Templates:

- scope confirmation report
- branch plan JSON
- final report
- finding format

Why this matters:

- Reduces vague phase output.
- Makes artifacts more consistent between runs.
- Improves handoff between hosts and between sessions.

Acceptance checks:

- Prompt rendering includes validation guidance.
- Tests assert prompt contract sections are present.
- Templates are packaged with `alloycat`.

## Host Integration

### 7. Reconcile adapter command model before host adapters

Goal: make host adapter expectations match real CLI behavior.

Why this matters:

- prevents adapter documentation from advertising commands that do not exist;
- clarifies whether adapters should drive `init`/`next`/`remind` or a higher-level `run`/`start` command;
- keeps published agent metadata honest for host integrations.

Acceptance checks:

- adapter docs use the same command model as the CLI;
- command-reference validation is deferred until adapter command references have a machine-readable shape.

### 8. Build thin host adapters

Goal: make the catalog usable from host environments without copying workflow logic into each host.

Adapter responsibilities:

- locate installed agent state;
- initialize or resume a run;
- call `alloycat remind` or `alloycat next`;
- execute only the rendered current phase;
- stop at user gates;
- avoid duplicating shared phase prompts.

Initial adapter targets:

- one primary host adapter;
- one secondary host adapter skeleton.

Why this matters:

- Moves usage closer to a native agent install experience.
- Keeps the shared workflow as the single source of truth.
- Prevents adapter drift.

Acceptance checks:

- Adapter files are generated or packaged from shared templates.
- Adapter documentation explains how a host should call the workflow.
- Manual verification covers install, init, remind, next, user gate stop, and uninstall.

### 9. Reduce manual run commands

Goal: make normal usage feel like one guided workflow, not a sequence of memorized commands.

Possible direction:

- make `alloycat i` / `alloycat install` the normal first-run command: after the user selects and confirms an agent, install it, create the first run, and render the first phase task immediately;
- keep `init`, `next`, and `remind` for debugging and explicit run recovery;
- add a higher-level `run` or `start` command later;
- use installed project state to infer agent and active run where unambiguous;
- show clear errors when multiple agents or active runs exist.

Why this matters:

- Keeps current debug controls available.
- Makes first-time usage simpler.
- Preserves correctness when more agents are added.

Acceptance checks:

- Installing one selected agent creates the initial run and prints the first phase without requiring a separate `init`.
- If the selected agent is already installed, the CLI does not silently create duplicate ambiguous runs; it resumes, asks, or errors with a clear next action.
- Multiple installed agents never select silently.
- Multiple active runs never select silently.
- UX tests cover the single-agent and multi-agent cases.

## Catalog Growth

### 10. Add examples and fixtures

Goal: make the agent verifiable against known projects and artifact sets.

Initial examples:

- small web app;
- desktop shell app;
- project with no authoritative visual source.

Why this matters:

- Gives repeatable manual verification.
- Supports promotion from `draft` to `experimental`.
- Makes design assumptions visible.

Acceptance checks:

- Example artifact sets can be validated.
- Manual verification steps are documented.
- At least one complete Interaction Audit run is captured as an example.

### 11. Strengthen catalog validation

Goal: make agent status meaningful.

Validation rules:

- `draft` requires `agent.md`, workflow, prompts, required directories, and `CHANGELOG.md`.
- `experimental` requires all draft requirements, at least one schema for a machine-read artifact, at least one template used by a workflow output, fixture-backed verification, one example or manual verification record, and at least one adapter marked `experimental`.
- `stable` requires all experimental requirements, schemas for every JSON output artifact, templates for user-facing Markdown report artifacts, fixture-backed validation for branch planning and report assembly, adapter verification notes, and a `CHANGELOG.md` entry for the promoted version.

Why this matters:

- Prevents the catalog from becoming a loose prompt collection.
- Gives clear promotion criteria for new agents.
- Makes breaking changes easier to reason about.

Acceptance checks:

- Validation rejects status claims without required assets.
- Tests cover draft, experimental, stable, and invalid fixtures.

### 12. Add new-agent scaffolding

Goal: create future agents consistently.

Generated structure:

- `agent.md`;
- workflow;
- prompts;
- schemas;
- templates;
- adapters;
- tests;
- fixtures;
- examples;
- `CHANGELOG.md`.

Why this matters:

- Reduces copy-paste drift.
- Keeps new agents aligned with catalog rules.
- Speeds up adding future workflow packages.

Acceptance checks:

- `alloycat new-agent <id>` creates a valid draft agent.
- Generated agent passes catalog validation.
- Generated tests pass without manual edits.

## Deferred

- automatic screenshot comparison;
- automatic app launch orchestration;
- hosted registry service;
- multi-run dashboard;
- vendored install mode.

These are useful later, but they should wait until branch enforcement, schemas, prompt contracts, and host adapters are working.
