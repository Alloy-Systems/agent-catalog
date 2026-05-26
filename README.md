# Alloy Agent Catalog

Reusable, phase-gated agent packages for recurring engineering work.

This repository stores agent packages, not project-specific audit output. Each agent package owns its manifest, internal workflow, prompts, schemas, templates, host adapters, fixtures, tests, and examples.

## Initial Agent

- `agents/interaction-audit`: Alloy Interaction Audit Agent. It audits visible UI behavior, source-of-truth conformance, and e2e coverage through explicit phases and durable run artifacts.

## Repository Shape

```text
agents/
  interaction-audit/
    agent.yaml
    workflow.yaml
    prompts/
    schemas/
    templates/
    scripts/
    adapters/
    tests/
    fixtures/
    examples/

packages/
  alloycat/
  agent-runtime/

docs/
  design/
```

## Status

This repository is a seed scaffold. The design docs in `docs/design/` define the intended catalog and Interaction Audit architecture before implementation starts.
