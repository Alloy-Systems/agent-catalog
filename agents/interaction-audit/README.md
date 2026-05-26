# Alloy Interaction Audit Agent

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

Run artifacts are durable and live under `.alloycat/agents/interaction-audit/runs/<run-id>/` unless the user chooses a different run root.
