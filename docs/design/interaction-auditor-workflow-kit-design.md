# Interaction Audit Workflow Kit Design

## Purpose

Build a portable, phase-gated workflow kit for auditing UI interaction quality across desktop, web, and mobile projects. The kit must work in multiple agent host environments without relying on one large prompt or transient chat memory.

The workflow turns an interaction audit into a sequence of narrow phases. Each phase receives concrete, previously confirmed artifacts as input and produces a bounded artifact as output. Branching decisions are recorded in files and validated before the next phase starts.

## Goals

- Resolve the target project root without requiring manual prompt edits.
- Discover the project type, UI surfaces, runtime commands, source-of-truth materials, and existing coverage before auditing.
- Stop for user confirmation after discovery and source-of-truth classification.
- Run interaction, visual, and e2e audit tracks only when their prerequisites are satisfied.
- Persist context in run artifacts so a later phase can resume after context compaction or a new host session.
- Keep host-specific instructions thin, with the shared workflow, prompts, schemas, and templates living in one portable kit.
- Produce evidence-backed findings and a final report that separates blockers, interaction defects, visual drift, and test gaps.

## Non-Goals

- The kit does not replace product-specific requirements, project instructions, or design specs.
- The kit does not fix code during audit mode.
- The kit does not treat static source assertions as a substitute for real runtime or e2e checks when project policy requires runtime coverage.
- The kit does not assume every project is a prototype.
- The kit does not require visual conformance checks when no authoritative visual source exists.

## Directory Layout

The portable kit is a standalone folder that can be copied into a project, installed as a shared local tool, or referenced from a central tools repository.

```text
interaction-auditor/
  README.md
  workflow.yaml

  prompts/
    00-resolve-project-root.md
    01-project-discovery.md
    02-source-of-truth.md
    03-scope-confirmation.md
    04-branch-planning.md
    05A-interaction-auditor.md
    05B-visual-conformance-audit.md
    05C-e2e-coverage-audit.md
    06-report-assembly.md
    07-fix-planning.md

  schemas/
    project-root.schema.json
    project-discovery.schema.json
    ui-inventory.schema.json
    source-of-truth-matrix.schema.json
    confirmed-scope.schema.json
    branch-plan.schema.json
    finding.schema.json
    e2e-coverage.schema.json

  templates/
    phase-prompt-header.md
    confirmation-report.md
    final-report.md

  scripts/
    auditctl.mjs

  adapters/
    primary-cli/
      SKILL.md
      agents/
        discovery.toml
        source-of-truth.toml
        interaction-auditor.toml
        visual-audit.toml
        e2e-coverage.toml
        report-assembly.toml

    secondary-cli/
      SKILL.md
      agents/
        discovery.md
        source-of-truth.md
        interaction-auditor.md
        visual-audit.md
        e2e-coverage.md
        report-assembly.md
```

Host adapters may rename files to match their host's expected skill and subagent format, but they must not duplicate the shared workflow logic.

## Run State

Each audit run writes all durable state into a run folder.

```text
.agent-runs/interaction-auditor/<run-id>/
  state.json
  00-project-root.json
  01-project-discovery.md
  02-ui-inventory.json
  03-source-of-truth-matrix.md
  04-confirmed-scope.md
  05-branch-plan.json
  06A-interaction-findings.md
  06B-visual-findings.md
  06C-e2e-coverage.md
  07-final-report.md
```

`state.json` records:

- run id;
- kit version;
- target project root;
- current phase;
- completed phases;
- blocked phase, if any;
- required user gate, if any;
- selected audit tracks;
- paths to all phase artifacts.

The run folder is the source of truth between phases. Agents should not rely on remembered chat context when a run artifact exists.

## Phase Model

### Phase 0. Resolve Project Root

Purpose: select the target project root before any audit work begins.

Inputs:

- current working directory;
- user message;
- host workspace metadata, if available.

Output:

- `00-project-root.json`.

Rules:

- Use an explicit user-provided path when present.
- Otherwise use the host workspace or current directory as a starting point.
- If the current directory is inside a repository, walk upward to find the likely root.
- Prefer ancestors with `.git`, project instructions, README, package manifests, lockfiles, or desktop/web framework config.
- If the root cannot be determined safely, ask one question: "Give the absolute path to the project folder."

### Phase 1. Project Discovery

Purpose: discover the project type, UI scope, runtime entrypoints, tests, and existing project rules.

Inputs:

- `00-project-root.json`.

Outputs:

- `01-project-discovery.md`;
- `02-ui-inventory.json`.

Required discovery:

- project instructions and documentation;
- package/build/e2e scripts;
- UI entrypoints;
- routing, window, and screen definitions;
- shell integration for desktop apps;
- test and e2e structure;
- design handoff folders, specs, screenshots, Storybook, HTML wireframes, or equivalent materials;
- runtime data sources;
- fixtures and mocks that may leak into visible UI.

### Phase 2. Source Of Truth Discovery

Purpose: classify source materials before deciding whether visual conformance can be audited.

Inputs:

- `01-project-discovery.md`;
- `02-ui-inventory.json`.

Output:

- `03-source-of-truth-matrix.md`.

Each source is classified as:

- authoritative;
- reference-only;
- stale;
- unclear.

If no authoritative visual source is found, visual conformance is disabled until the user confirms otherwise.

### Phase 3. Scope Confirmation

Purpose: stop and ask the user to confirm the discovered project understanding, UI scope, and source-of-truth classification.

Inputs:

- `01-project-discovery.md`;
- `02-ui-inventory.json`;
- `03-source-of-truth-matrix.md`.

Output:

- `04-confirmed-scope.md`.

The confirmation report must include:

- chosen project root;
- project type and platforms;
- discovered screens, windows, menus, popovers, modals, tray or system surfaces, and core flows;
- authoritative and reference-only sources;
- planned audit tracks;
- only the questions required to avoid auditing the wrong scope.

The workflow cannot continue past this phase until the user confirms or corrects the scope.

### Phase 4. Branch Planning

Purpose: convert confirmed scope into deterministic audit tracks.

Inputs:

- `04-confirmed-scope.md`;
- `03-source-of-truth-matrix.md`;
- `02-ui-inventory.json`.

Output:

- `05-branch-plan.json`.

The branch plan decides:

- whether interaction/runtime audit runs;
- whether visual conformance audit runs;
- whether e2e coverage audit runs;
- whether runtime launch is required;
- which screens and surfaces belong to each track;
- which commands, scripts, or manual setup steps are required;
- whether any track is blocked.

Branching must happen here, not inside later phase prompts.

### Phase 5A. Interaction Audit

Purpose: verify runtime interaction behavior for confirmed surfaces.

Inputs:

- `04-confirmed-scope.md`;
- `05-branch-plan.json`;
- `02-ui-inventory.json`.

Output:

- `06A-interaction-findings.md`.

Audit checks:

- clicks;
- keyboard access;
- hover, focus, active, disabled, loading, and error states;
- outside click and Escape dismissal for popovers, dropdowns, and modals;
- focus management;
- bulk action label and state transitions;
- navigation and auth environment correctness;
- runtime user data versus fixture or design data;
- empty, error, loading, and disconnected states;
- controls that look interactive but are dead.

### Phase 5B. Visual Conformance Audit

Purpose: compare confirmed screens against authoritative visual sources.

Inputs:

- `04-confirmed-scope.md`;
- `05-branch-plan.json`;
- `03-source-of-truth-matrix.md`;
- screenshots or captures created during the run.

Output:

- `06B-visual-findings.md`.

This phase runs only when the branch plan enables it. Reference-only sources may produce recommendations or consistency risks, not visual bug claims.

### Phase 5C. E2E Coverage Audit

Purpose: verify that user-visible surfaces and important behaviors have real e2e coverage when the project has runnable UI or shell surfaces.

Inputs:

- `04-confirmed-scope.md`;
- `05-branch-plan.json`;
- test and e2e discovery from Phase 1.

Output:

- `06C-e2e-coverage.md`.

The phase must distinguish:

- real runtime/e2e coverage;
- component-only tests;
- static assertions;
- missing coverage;
- blocked coverage.

### Phase 6. Report Assembly

Purpose: combine findings into one audit report without changing severity or inventing missing evidence.

Inputs:

- `06A-interaction-findings.md`;
- `06B-visual-findings.md`, if present;
- `06C-e2e-coverage.md`;
- `04-confirmed-scope.md`;
- `05-branch-plan.json`.

Output:

- `07-final-report.md`.

The report must include:

- executive summary;
- confirmed scope;
- source-of-truth matrix;
- findings by severity;
- dead UI or fake UI inventory;
- e2e coverage matrix;
- recommended fix order;
- final gate for whether the build is ready for user testing.

### Phase 7. Optional Fix Planning

Purpose: create a fix plan only after the user asks to fix findings.

Inputs:

- `07-final-report.md`;
- user-selected fix scope.

Output:

- `08-fix-plan.md`.

The plan must require focused tests before behavior changes and real e2e coverage for UI or shell changes.

## Orchestrator

`scripts/auditctl.mjs` is the deterministic coordinator. It owns phase transitions, artifact paths, validation, and prompt rendering.

Commands:

```text
auditctl init [--project <path>]
auditctl status [--run <run-id>]
auditctl next [--run <run-id>]
auditctl validate <phase> [--run <run-id>]
auditctl confirm-scope [--run <run-id>]
auditctl branch [--run <run-id>]
auditctl assemble-report [--run <run-id>]
```

`auditctl next` renders the next phase prompt by combining:

- shared phase prompt header;
- phase-specific prompt;
- validated input artifact paths;
- exact output artifact path;
- allowed actions for the phase;
- current branch decisions.

If a previous artifact is missing or invalid, `auditctl next` refuses to advance and reports the missing requirement.

## Prompt Contract

Every phase prompt must include:

- role;
- phase goal;
- exact input files;
- exact output file;
- allowed commands and actions;
- forbidden actions;
- evidence requirements;
- stop conditions;
- validation command to run after writing the artifact.

Every phase prompt must exclude:

- unrelated project history;
- speculative branches not selected by the branch plan;
- instructions for future phases;
- broad "audit everything" language once scope is confirmed.

## Finding Format

Each finding must include:

- id;
- severity;
- audit track;
- surface or screen;
- issue;
- expected behavior;
- actual behavior;
- evidence;
- reproduction steps for runtime findings;
- source reference for visual findings;
- recommended fix;
- required test or coverage.

Severity levels:

- Critical: user cannot complete a core flow, wrong environment, data/auth/runtime risk.
- High: visible UI promises functionality that is broken or misleading.
- Medium: behavior works but violates common interaction conventions.
- Low: polish, consistency, missing state, or visual drift.
- Test Gap: behavior may work but lacks required real coverage.

## Host Adapters

Host adapters are thin wrappers. They should only teach a host how to start the workflow and how to call phase-specific subagents if supported.

Adapter responsibilities:

- locate the shared kit folder;
- initialize or resume a run;
- call `auditctl next`;
- execute only the rendered phase prompt;
- stop at user confirmation gates;
- avoid duplicating shared prompts inside host-specific files.

One adapter may use TOML agent definitions. Another may use Markdown subagent definitions. Both must consume the same workflow, schemas, templates, and run artifacts.

## User Gates

The workflow has two required user gates:

1. Scope confirmation after Project Discovery and Source Of Truth Discovery.
2. Fix scope confirmation before Optional Fix Planning.

The workflow may also stop when:

- project root cannot be determined;
- runtime cannot be launched;
- required credentials or local services are missing;
- source-of-truth status is ambiguous and affects audit track selection.

## MVP

The first implementation should include:

- `workflow.yaml`;
- prompt files for phases 0 through 6;
- JSON schemas for project root, UI inventory, branch plan, and finding records;
- `auditctl init`, `status`, `next`, `validate`, and `branch`;
- one host skill adapter;
- one second-host adapter skeleton;
- generated run folder state;
- final report template.

The MVP can defer:

- automatic screenshot diffing;
- automatic browser or desktop runtime orchestration;
- rich schema validation for every Markdown artifact;
- multi-run dashboarding.

## Verification

The kit itself needs tests for:

- project root resolution;
- run folder creation;
- phase ordering;
- validation failure on missing artifacts;
- branch plan selection when visual sources are authoritative, reference-only, or missing;
- prompt rendering with exact input and output paths;
- report assembly from multiple finding files.

Manual verification for the MVP:

- run the workflow against a small web app;
- run it against a desktop app;
- run it against a project with no visual source;
- verify that the workflow stops at scope confirmation;
- verify that a later phase can resume using only run artifacts.

## Risks

- If adapters duplicate prompt content, the shared workflow will drift. Keep adapters thin.
- If artifacts are free-form only, validation will be weak. Use JSON for branch and inventory data.
- If branch decisions remain inside phase prompts, later agents will receive too much conditional context.
- If the confirmation gate is skipped, the audit may test the wrong screens or apply the wrong design source.
- If run artifacts are stored inside product source without ignore rules, audit output may pollute normal project diffs.
