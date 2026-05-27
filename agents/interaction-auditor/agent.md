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
