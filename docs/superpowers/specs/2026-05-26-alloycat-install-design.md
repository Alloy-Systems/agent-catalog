# Alloycat Install MVP Design

## Purpose

Add a project-local installer for catalog agents. The installer should let a user run `alloycat install`, choose an agent interactively, and have the target project prepared for workflow runs without manually passing catalog paths or editing ignore files.

This MVP installs agents in linked mode. Linked installs keep the reusable agent package in the central catalog checkout and write only small project-local configuration into the target project.

## Goals

- Make `alloycat install` the default happy path.
- Let users install without passing `--project` when running from inside a target project.
- Always show an interactive agent choice when no agent id is provided, even when the catalog has one agent.
- Support direct non-interactive installs with `alloycat install <agent-id>`.
- Automatically update the target project's `.gitignore` for run artifacts.
- Keep install output deterministic enough for tests and copyable enough for manual use.
- Make repeated installs safe and non-duplicating.

## Non-Goals

- Do not implement vendored agent copies in this MVP.
- Do not generate host-specific adapter files yet.
- Do not publish packages or require global installation.
- Do not start a workflow run automatically after installation.
- Do not ignore `.alloycat/`; the install configuration is intended to be committed with the target project.

## CLI Contract

Supported command forms:

```text
alloycat install
alloycat install <agent-id>
alloycat install --project <path>
alloycat install <agent-id> --project <path>
```

Options:

```text
--project <path>
  Optional target project path. When omitted, the CLI resolves the project root from the current working directory.

--mode linked
  Optional install mode. The only supported MVP mode is linked. If omitted, linked is used.
```

When no `<agent-id>` is provided:

- if stdin is interactive, the CLI prints a numbered catalog list and asks the user to enter a number;
- if stdin is not interactive but contains piped input, the CLI reads the first line as the selection;
- empty input is an error;
- invalid numbers are errors;
- if stdin is not interactive and contains no selection, the CLI exits nonzero with `Agent id is required when running non-interactively. Run: alloycat install <agent-id>`.

When `<agent-id>` is provided, the CLI installs that agent without prompting.

## Project Root Resolution

The installer resolves the target project root in this order:

1. If `--project <path>` is provided, resolve and use that path.
2. Otherwise start from `process.cwd()` and walk upward to the nearest directory containing `.git`.
3. If no `.git` directory is found, walk upward to the nearest directory containing `package.json`.
4. If neither marker is found, use `process.cwd()`.

The resolved path must exist and be a directory.

## Installed Files

For `interaction-auditor`, a linked install writes:

```text
<project-root>/
  .alloycat/
    README.md
    agents/
      interaction-auditor.json
  .agent-runs/
    interaction-auditor/
```

The agent config JSON contains:

```json
{
  "schema_version": 1,
  "agent_id": "interaction-auditor",
  "mode": "linked",
  "catalog_root": "<absolute catalog checkout path>",
  "agent_path": "<absolute path to agents/interaction-auditor>",
  "run_root": "<absolute project path>/.agent-runs/interaction-auditor",
  "installed_at": "<ISO timestamp>"
}
```

On repeated install, the same config file is rewritten with the current catalog path and timestamp. The run root directory is ensured to exist.

## Gitignore Behavior

The installer updates `<project-root>/.gitignore` automatically.

- If `.gitignore` does not exist, create it.
- If it does not contain `.agent-runs/` as a standalone entry, append it.
- If the entry already exists, leave the file unchanged.
- Do not add `.alloycat/` to `.gitignore`.

The install result records whether the `.agent-runs/` entry was `added` or `already-present` so the CLI can report it clearly.

## CLI Output

After a successful install, the CLI prints:

```text
Installed agent: <agent-id>
Project root: <project-root>
Config: <project-root>/.alloycat/agents/<agent-id>.json
Gitignore: <added|already-present> .agent-runs/

Next:
  alloycat init <agent-id> --project <project-root> --run-root <project-root>/.agent-runs/<agent-id>
  alloycat next --run <run-dir>
```

The exact path separators may follow the host platform.

## Runtime API

Add focused runtime functions rather than embedding installer behavior in the CLI:

```js
resolveProjectRoot(startPath)
installAgent(repoRoot, options)
```

`installAgent(repoRoot, options)` accepts:

```js
{
  agentId,
  project,
  mode
}
```

`agentId` may be omitted only by CLI code before selection. The runtime install function requires a resolved agent id.

The function returns:

```js
{
  agent,
  projectRoot,
  configPath,
  runRoot,
  gitignoreStatus,
  mode
}
```

## Testing

Runtime tests should cover:

- project root resolution from a nested directory with `.git`;
- project root resolution from a nested directory with `package.json`;
- linked install writes config, README, run root, and `.gitignore`;
- repeated linked install does not duplicate `.agent-runs/`.

CLI tests should cover:

- `install interaction-auditor --project <temp>` installs without prompting;
- selection-driven `install --project <temp>` accepts stdin input `1` and installs the listed agent;
- non-interactive `install --project <temp>` without an agent id exits nonzero with the required-agent message.

## Success Criteria

- A user can run `alloycat install` from inside a target project and choose an agent interactively.
- A script can run `alloycat install interaction-auditor --project <path>` without interaction.
- The target project receives durable install config and ignored run artifact storage.
- Re-running the installer is safe.
- Existing tests plus the new install tests pass.
