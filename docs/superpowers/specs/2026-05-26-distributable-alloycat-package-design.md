# Distributable Alloycat Package Design

## Purpose

Make `alloycat` usable from any target project without absolute paths, shell-specific path syntax, or local link setup. The user-facing command should be:

```text
npx @alloy/alloycat install
```

The command runs from the target project directory, resolves that project as the install target, and uses the packaged catalog contents to install an agent.

## Problem

The current CLI works when launched from this repository because `packages/alloycat/src/index.js` can find the catalog root by walking relative to its own source file. That is acceptable for development, but it is not acceptable for users. A target project should not know where the catalog repository lives and should not pass a path to the CLI source file.

The package already declares a `bin` named `alloycat`, but the package is private and not yet shaped as a standalone package. It also imports runtime code through a monorepo source path, which only works inside this checkout.

## Goals

- Support `npx @alloy/alloycat install` from any target project.
- Support local package smoke testing before registry publishing.
- Keep the install command project-mutating and cwd-based.
- Keep the MVP self-contained: the package includes the runtime and bundled agents.
- Avoid a remote catalog service or dynamic package downloads.
- Preserve current CLI behavior for local repository development.
- Keep tests using real package output where practical.

## Non-Goals

- Do not build a hosted registry service.
- Do not implement automatic updates for installed agents.
- Do not add vendored agent install mode.
- Do not change the workflow runner semantics.
- Do not require users to configure PATH manually.
- Do not require target projects to add `@alloy/alloycat` as a dependency before trying it.

## User Experience

From a target project:

```text
npx @alloy/alloycat install
```

Expected behavior:

1. `npx` fetches or runs the package.
2. `alloycat` resolves the target project root from `process.cwd()`.
3. If no agent id is passed, it prints a numbered agent list and asks for a selection.
4. It writes `.alloycat/agents/<agent-id>.json`.
5. It creates `.agent-runs/<agent-id>/`.
6. It updates `.gitignore` with `.agent-runs/`.
7. It prints next commands.

Direct command form still works:

```text
npx @alloy/alloycat install interaction-auditor
```

Local smoke before publishing should use a package tarball:

```text
npm pack --workspace @alloy/alloycat
npx <path-to-created-tarball> install
```

## Package Shape

The package published as `@alloy/alloycat` contains:

```text
package/
  package.json
  src/
    index.js
  runtime/
    catalog.js
    workflow.js
    runs.js
    prompts.js
    install.js
    index.js
  catalog/
    catalog.yaml
    agents/
      interaction-auditor/
        agent.yaml
        workflow.yaml
        README.md
        prompts/
```

This keeps the MVP self-contained. The CLI can load bundled catalog data without knowing the source checkout path.

## Source Layout

Keep the monorepo source layout:

```text
packages/
  alloycat/
    src/
      index.js
    package.json
  agent-runtime/
    src/
      *.js
    package.json
agents/
  interaction-auditor/
catalog.yaml
```

Add a packaging script that stages package contents under a generated directory inside `packages/alloycat/dist-package/` or another ignored build directory. The staged package becomes the source for `npm pack`.

The staged package copies:

- `packages/alloycat/src/`;
- `packages/agent-runtime/src/` into `runtime/`;
- `catalog.yaml` into `catalog/catalog.yaml`;
- `agents/interaction-auditor/` into `catalog/agents/interaction-auditor/`;
- a package manifest with `bin.alloycat`.

The generated staging directory must be ignored by git.

## Runtime Root Resolution

The CLI needs two roots:

```text
catalogRoot
  Root containing catalog.yaml and agents/.

projectRoot
  Target project where install artifacts are written.
```

For source checkout execution:

- `catalogRoot` is the repository root.
- Current behavior can remain: resolve from the CLI source file location.

For packaged execution:

- `catalogRoot` is `<package-root>/catalog`.
- The CLI can detect packaged mode because `catalog/catalog.yaml` exists next to the packaged CLI/runtime layout.

The target `projectRoot` remains independent and is resolved from:

1. `--project`, when supplied;
2. otherwise `process.cwd()` upward to `.git`;
3. otherwise `process.cwd()` upward to `package.json`;
4. otherwise `process.cwd()`.

## Internal Imports

The current CLI imports runtime from:

```js
../../agent-runtime/src/index.js
```

That path does not exist in a standalone package.

The MVP should make the staged package rewrite or generate an entrypoint that imports:

```js
../runtime/index.js
```

Implementation can be simple for MVP:

- keep source entrypoint unchanged for repository tests;
- copy runtime into the staged package;
- create a staged `src/index.js` with adjusted runtime import and package-root catalog resolution.

This avoids publishing workspace internals accidentally.

## Package Manifest

The staged package manifest should be publishable:

```json
{
  "name": "@alloy/alloycat",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "alloycat": "./src/index.js"
  },
  "engines": {
    "node": ">=20"
  },
  "files": [
    "src/",
    "runtime/",
    "catalog/",
    "package.json",
    "README.md"
  ]
}
```

The root repository may remain private. The staged package manifest must not include `"private": true`.

## Commands

Add root scripts:

```json
{
  "scripts": {
    "pack:alloycat": "node scripts/pack-alloycat.mjs",
    "smoke:alloycat-pack": "node --test tests/alloycat-package.test.mjs"
  }
}
```

`pack:alloycat` stages the package and runs `npm pack` from the staging directory.

The script should print the created tarball path.

## Tests

Add package-level tests that verify the real packed artifact:

- `npm run pack:alloycat` creates a tarball.
- The tarball contains `package.json`, `src/index.js`, `runtime/index.js`, `catalog/catalog.yaml`, and the interaction-auditor prompts.
- `npx <tarball> list` prints `interaction-auditor`.
- `npx <tarball> install interaction-auditor` from a temporary target project writes `.alloycat/agents/interaction-auditor.json`, `.agent-runs/interaction-auditor/`, and `.gitignore`.
- The installed config records `catalog_root` inside the unpacked package runtime context, not the source checkout path.

The tests should avoid registry publishing.

## Error Handling

- If packaged catalog files are missing, fail with a clear message that the package is incomplete.
- If package staging cannot copy required files, fail the pack script.
- If an unsupported install mode is passed, preserve the existing runtime error.
- If `npx` cannot execute the tarball during tests, surface stdout and stderr in the assertion message.

## Success Criteria

- A target project can run the packed package without absolute source paths.
- Local smoke uses `npx <tarball> install` successfully.
- Existing CLI/runtime tests still pass.
- Package smoke tests pass.
- No target project setup is required before running the command.

## Deferred Work

- Publishing to npm or another registry.
- Signed releases.
- Single-file executable builds.
- Remote catalog update checks.
- Multiple catalog package versions installed side by side.
