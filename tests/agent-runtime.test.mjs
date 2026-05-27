import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import {
  createRun,
  createInstalledRun,
  extractMarkdownSection,
  isAnyAbsolute,
  loadAgent,
  loadAgentDocument,
  loadCatalog,
  loadRunState,
  loadInstalledAgent,
  loadWorkflow,
  completeRun,
  completeInstalledRun,
  parseAgentMarkdown,
  resolveProjectRoot,
  resolveAgentProjectPath,
  resolveArtifactTemplate,
  installAgent,
  uninstallProject,
  uninstallAgent,
  renderNextPrompt,
  renderInstalledNextPrompt,
  saveRunState
} from '../packages/agent-runtime/src/index.js';

const repoRoot = resolve(import.meta.dirname, '..');

function copyRepoFixture(sourceRoot, prefix) {
  const targetRoot = mkdtempSync(join(tmpdir(), prefix));
  cpSync(sourceRoot, targetRoot, {
    recursive: true,
    filter: (path) => {
      if (path.includes(`${sep}.git${sep}`) || path.includes(`${sep}node_modules${sep}`)) {
        return false;
      }
      if (path.includes(`${sep}packages${sep}alloycat${sep}dist-package`)) {
        return false;
      }
      return !path.endsWith('.tgz');
    }
  });
  return targetRoot;
}

test('parses agent.md frontmatter and selected Markdown sections', () => {
  const document = parseAgentMarkdown(`---
schema_version: 1
id: interaction-auditor
name: Alloy Interaction Auditor
runtime:
  model: workflow
  workflow: workflow.yaml
artifacts:
  run_root: .alloycat/agents/{agent_id}/runs
prompt_context:
  include_sections:
    - Operating Rules
---

# Alloy Interaction Auditor

## Operating Rules

Follow the phase-gated workflow.
`);

  assert.equal(document.manifest.id, 'interaction-auditor');
  assert.equal(document.manifest.schema_version, 1);
  assert.equal(document.manifest.name, 'Alloy Interaction Auditor');
  assert.equal(document.manifest.runtime.model, 'workflow');
  assert.equal(document.manifest.runtime.workflow, 'workflow.yaml');
  assert.equal(document.manifest.artifacts.run_root, '.alloycat/agents/{agent_id}/runs');
  assert.deepEqual(document.manifest.prompt_context.include_sections, ['Operating Rules']);
  assert.match(
    extractMarkdownSection(document.body, 'Operating Rules'),
    /Follow the phase-gated workflow/
  );
});

test('resolves manifest artifact templates with restricted placeholders', () => {
  assert.equal(
    resolveArtifactTemplate('.alloycat/agents/{agent_id}/runs', {
      agentId: 'interaction-auditor'
    }),
    '.alloycat/agents/interaction-auditor/runs'
  );

  assert.equal(isAnyAbsolute('C:/outside'), true);

  assert.throws(
    () => resolveArtifactTemplate('.alloycat/{unknown}', {
      agentId: 'interaction-auditor'
    }),
    /Unknown artifact path placeholder: unknown/
  );

  assert.throws(
    () => resolveArtifactTemplate('{project_root}/.alloycat/{agent_id}', {
      agentId: 'interaction-auditor'
    }),
    /Unknown artifact path placeholder: project_root/
  );

  assert.throws(
    () => resolveArtifactTemplate('.alloycat/{agent-id}', {
      agentId: 'interaction-auditor'
    }),
    /Unknown artifact path placeholder: agent-id/
  );

  assert.throws(
    () => resolveArtifactTemplate('.alloycat\\agents\\{agent_id}', {
      agentId: 'interaction-auditor'
    }),
    /must use POSIX separators/
  );

  assert.throws(
    () => resolveArtifactTemplate('C:/outside/{agent_id}', {
      agentId: 'interaction-auditor'
    }),
    /must be relative/
  );

  assert.throws(
    () => resolveAgentProjectPath('/tmp/project', { id: 'interaction-auditor' }, '.'),
    /must not resolve to the project root/
  );
});

test('loads agent.md frontmatter and selected Markdown sections from disk', () => {
  const document = loadAgentDocument(repoRoot, 'agents/interaction-auditor/agent.md');

  assert.equal(document.manifest.id, 'interaction-auditor');
  assert.equal(document.manifest.name, 'Alloy Interaction Auditor');
  assert.equal(document.manifest.runtime.model, 'workflow');
  assert.equal(document.manifest.runtime.workflow, 'workflow.yaml');
  assert.equal(document.manifest.artifacts.run_root, '.alloycat/agents/{agent_id}/runs');
  assert.deepEqual(document.manifest.prompt_context.include_sections, [
    'Operating Rules',
    'Evidence Rules',
    'Forbidden Actions'
  ]);
  assert.match(
    extractMarkdownSection(document.body, 'Operating Rules'),
    /Follow the phase-gated workflow/
  );
});

test('loads catalog index and Interaction Auditor markdown manifest metadata', () => {
  const catalog = loadCatalog(repoRoot);
  assert.equal(catalog.agents.length, 1);
  assert.deepEqual(catalog.agents[0], {
    id: 'interaction-auditor',
    path: 'agents/interaction-auditor'
  });

  const agent = loadAgent(repoRoot, 'interaction-auditor');
  assert.equal(agent.name, 'Alloy Interaction Auditor');
  assert.equal(agent.runtime.model, 'workflow');
  assert.equal(agent.runtime.workflow, 'workflow.yaml');
  assert.equal(agent.artifacts.install_root, '.alloycat/agents/{agent_id}');
  assert.equal(agent.artifacts.run_root, '.alloycat/agents/{agent_id}/runs');
  assert.equal(agent.artifacts.state_file, 'state.json');
  assert.match(agent.documentBody, /## Operating Rules/);
});

test('loads ordered workflow phases', () => {
  const workflow = loadWorkflow(repoRoot, 'interaction-auditor');
  assert.equal(workflow.phases[0].id, 'resolve-project-root');
  assert.equal(workflow.phases.at(-1).id, 'report-assembly');
});

test('loads workflow from agent.md runtime workflow path', () => {
  const tempRepo = copyRepoFixture(repoRoot, 'alloycat-workflow-path-');
  try {
    const agentPath = join(tempRepo, 'agents', 'interaction-auditor', 'agent.md');
    const originalWorkflowPath = join(tempRepo, 'agents', 'interaction-auditor', 'workflow.yaml');
    const workflowPath = join(tempRepo, 'agents', 'interaction-auditor', 'custom-workflow.yaml');
    writeFileSync(workflowPath, readFileSync(originalWorkflowPath, 'utf8'));
    rmSync(originalWorkflowPath);
    writeFileSync(
      agentPath,
      readFileSync(agentPath, 'utf8').replace('workflow: workflow.yaml', 'workflow: custom-workflow.yaml')
    );

    const workflow = loadWorkflow(tempRepo, 'interaction-auditor');

    assert.equal(workflow.id, 'interaction-auditor');
    assert.equal(workflow.phases[0].id, 'resolve-project-root');
  } finally {
    rmSync(tempRepo, { recursive: true, force: true });
  }
});

test('loads human-readable phase metadata and output artifact contracts', () => {
  const workflow = loadWorkflow(repoRoot, 'interaction-auditor');
  const phase = workflow.phases.find((candidate) => candidate.id === 'project-discovery');

  assert.equal(phase.title, 'Project Discovery');
  assert.match(phase.description, /Discover the target project type/);
  assert.deepEqual(phase.outputs.map((artifact) => artifact.path), [
    '01-project-discovery.md',
    '02-ui-inventory.json'
  ]);
  assert.equal(phase.outputs[0].format, 'markdown');
  assert.match(phase.outputs[0].description, /Discovery notes/);
  assert.equal(phase.outputs[1].format, 'json');
  assert.match(phase.outputs[1].description, /UI inventory/);
});

test('resolves project root by walking up to the nearest git directory', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-root-git-'));
  try {
    mkdirSync(join(tempRoot, '.git'));
    const nested = join(tempRoot, 'src', 'features', 'audit');
    mkdirSync(nested, { recursive: true });

    assert.equal(resolveProjectRoot(nested), tempRoot);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolves project root by walking up to package.json when no git directory exists', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-root-package-'));
  try {
    writeFileSync(join(tempRoot, 'package.json'), '{"name":"target"}\n');
    const nested = join(tempRoot, 'app', 'components');
    mkdirSync(nested, { recursive: true });

    assert.equal(resolveProjectRoot(nested), tempRoot);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('linked install writes project config, run root, readme, and gitignore entry', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-install-runtime-'));
  try {
    const result = installAgent(repoRoot, {
      agentId: 'interaction-auditor',
      project: tempRoot
    });

    const configPath = join(tempRoot, '.alloycat', 'agents', 'interaction-auditor', 'index.json');
    const readmePath = join(tempRoot, '.alloycat', 'README.md');
    const runRoot = join(tempRoot, '.alloycat', 'agents', 'interaction-auditor', 'runs');
    const gitignorePath = join(tempRoot, '.gitignore');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const packageRoot = join(tempRoot, '.alloycat', 'agents', 'interaction-auditor', 'package');

    assert.equal(result.agent.id, 'interaction-auditor');
    assert.equal(result.projectRoot, tempRoot);
    assert.equal(result.configPath, configPath);
    assert.equal(result.runRoot, runRoot);
    assert.equal(result.gitignoreStatus, 'added');
    assert.equal(result.mode, 'linked');
    assert.equal(config.schema_version, 1);
    assert.equal(config.agent_id, 'interaction-auditor');
    assert.equal(config.mode, 'linked');
    assert.equal(config.catalog_root, repoRoot);
    assert.equal(config.agent_path, join(repoRoot, 'agents', 'interaction-auditor'));
    assert.equal(config.run_root, runRoot);
    assert.equal(config.installed_package_dir, 'package');
    assert.equal(config.agent_document_path, 'agent.md');
    assert.equal(config.workflow_path, 'workflow.yaml');
    assert.equal(config.prompt_root, 'prompts');
    assert.match(config.installed_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(existsSync(readmePath), false);
    assert.equal(existsSync(runRoot), true);
    assert.equal(existsSync(join(packageRoot, 'agent.md')), true);
    assert.equal(existsSync(join(packageRoot, 'workflow.yaml')), true);
    assert.equal(existsSync(join(packageRoot, 'prompts', '00-resolve-project-root.md')), true);
    assert.equal(existsSync(join(packageRoot, 'prompts', '06-report-assembly.md')), true);
    assert.equal(existsSync(join(packageRoot, 'schemas', '00-project-root.schema.json')), true);
    assert.equal(existsSync(join(packageRoot, 'schemas', '05-branch-plan.schema.json')), true);
    assert.equal(existsSync(join(packageRoot, 'templates', 'branch-plan.json')), true);
    assert.equal(existsSync(join(packageRoot, 'templates', 'final-report.md')), true);
    assert.equal(existsSync(join(tempRoot, '.agent-runs')), false);
    assert.match(readFileSync(gitignorePath, 'utf8'), /^\.alloycat\/$/m);
    assert.doesNotMatch(readFileSync(gitignorePath, 'utf8'), /^\.agent-runs\/$/m);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('linked install does not duplicate an existing alloycat gitignore entry', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-install-idempotent-'));
  try {
    writeFileSync(join(tempRoot, '.gitignore'), 'node_modules/\n/.alloycat/\ndist/\n');

    const first = installAgent(repoRoot, {
      agentId: 'interaction-auditor',
      project: tempRoot
    });
    const second = installAgent(repoRoot, {
      agentId: 'interaction-auditor',
      project: tempRoot
    });
    const gitignore = readFileSync(join(tempRoot, '.gitignore'), 'utf8');

    assert.equal(first.gitignoreStatus, 'already-present');
    assert.equal(second.gitignoreStatus, 'already-present');
    assert.equal(gitignore.match(/^\/?\.alloycat\/?$/gm).length, 1);
    assert.equal(gitignore.includes('.agent-runs'), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('linked install does not write an alloycat readme', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-install-readme-'));
  try {
    const readmePath = join(tempRoot, '.alloycat', 'README.md');

    installAgent(repoRoot, {
      agentId: 'interaction-auditor',
      project: tempRoot
    });

    assert.equal(existsSync(readmePath), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('linked install repeated from an empty project keeps one alloycat gitignore entry', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-install-repeat-'));
  try {
    installAgent(repoRoot, {
      agentId: 'interaction-auditor',
      project: tempRoot
    });
    const second = installAgent(repoRoot, {
      agentId: 'interaction-auditor',
      project: tempRoot
    });
    const gitignore = readFileSync(join(tempRoot, '.gitignore'), 'utf8');

    assert.equal(second.gitignoreStatus, 'already-present');
    assert.equal(gitignore.match(/^\.alloycat\/$/gm).length, 1);
    assert.equal(gitignore.includes('.agent-runs'), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('install and run paths are derived from agent.md artifacts', () => {
  const tempRepo = copyRepoFixture(repoRoot, 'alloycat-manifest-paths-');
  const tempProject = mkdtempSync(join(tmpdir(), 'alloycat-manifest-project-'));
  try {
    const agentPath = join(tempRepo, 'agents', 'interaction-auditor', 'agent.md');
    writeFileSync(
      agentPath,
      readFileSync(agentPath, 'utf8')
        .replace(
          'run_root: .alloycat/agents/{agent_id}/runs',
          'run_root: .alloycat/agents/{agent_id}/custom-runs'
        )
        .replace('state_file: state.json', 'state_file: run-state.json')
    );

    const install = installAgent(tempRepo, {
      agentId: 'interaction-auditor',
      project: tempProject
    });
    const run = createRun(tempRepo, {
      agentId: 'interaction-auditor',
      project: tempProject,
      runId: 'manifest-run'
    });

    assert.equal(install.runRoot, join(tempProject, '.alloycat', 'agents', 'interaction-auditor', 'custom-runs'));
    assert.equal(run.runDir, join(tempProject, '.alloycat', 'agents', 'interaction-auditor', 'custom-runs', 'manifest-run'));
    assert.equal(run.stateFile, 'run-state.json');
    assert.equal(run.statePath, join(run.runDir, 'run-state.json'));
    assert.equal(loadRunState(run.runDir, { stateFile: 'run-state.json' }).run_id, 'manifest-run');
  } finally {
    rmSync(tempRepo, { recursive: true, force: true });
    rmSync(tempProject, { recursive: true, force: true });
  }
});

test('installed runs render prompts from the copied package without source catalog access', () => {
  const tempRepo = copyRepoFixture(repoRoot, 'alloycat-installed-source-');
  const tempProject = mkdtempSync(join(tmpdir(), 'alloycat-installed-project-'));
  try {
    installAgent(tempRepo, {
      agentId: 'interaction-auditor',
      project: tempProject
    });

    const installedPromptPath = join(
      tempProject,
      '.alloycat',
      'agents',
      'interaction-auditor',
      'package',
      'prompts',
      '00-resolve-project-root.md'
    );
    writeFileSync(
      installedPromptPath,
      `${readFileSync(installedPromptPath, 'utf8')}\n\nInstalled package prompt marker.\n`
    );
    rmSync(join(tempRepo, 'catalog.yaml'));

    const installedAgent = loadInstalledAgent(tempProject, 'interaction-auditor');
    const run = createInstalledRun(installedAgent, {
      project: tempProject,
      runId: 'installed-run'
    });
    const prompt = renderInstalledNextPrompt(installedAgent, run.runDir);

    assert.match(prompt, /Installed package prompt marker/);

    writeFileSync(join(run.runDir, '00-project-root.json'), '{}\n');
    const result = completeInstalledRun(installedAgent, run.runDir);

    assert.equal(result.completedPhase.id, 'resolve-project-root');
    assert.equal(result.nextPhase.id, 'project-discovery');
  } finally {
    rmSync(tempRepo, { recursive: true, force: true });
    rmSync(tempProject, { recursive: true, force: true });
  }
});

test('installed agent index rejects run roots outside the project install directory', () => {
  const tempProject = mkdtempSync(join(tmpdir(), 'alloycat-installed-index-project-'));
  const outsideRoot = mkdtempSync(join(tmpdir(), 'alloycat-installed-index-outside-'));
  try {
    installAgent(repoRoot, {
      agentId: 'interaction-auditor',
      project: tempProject
    });

    const configPath = join(tempProject, '.alloycat', 'agents', 'interaction-auditor', 'index.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.run_root = outsideRoot;
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

    assert.throws(
      () => loadInstalledAgent(tempProject, 'interaction-auditor'),
      /run_root.*inside.*install_dir/
    );
    assert.equal(existsSync(join(outsideRoot, 'blocked-run', 'state.json')), false);
  } finally {
    rmSync(tempProject, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('uninstall with an agent id removes only that agent state', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-uninstall-runtime-'));
  try {
    installAgent(repoRoot, {
      agentId: 'interaction-auditor',
      project: tempRoot
    });
    const runRoot = join(tempRoot, '.alloycat', 'agents', 'interaction-auditor', 'runs');
    writeFileSync(join(runRoot, 'old-run.txt'), 'run artifact\n');

    const result = uninstallAgent(repoRoot, {
      agentId: 'interaction-auditor',
      project: tempRoot
    });

    assert.equal(result.agentId, 'interaction-auditor');
    assert.equal(result.projectRoot, tempRoot);
    assert.equal(result.gitignoreStatus, 'kept');
    assert.equal(result.installRootStatus, 'kept');
    assert.equal(existsSync(join(tempRoot, '.alloycat')), true);
    assert.equal(existsSync(join(tempRoot, '.alloycat', 'agents', 'interaction-auditor')), false);
    assert.match(readFileSync(join(tempRoot, '.gitignore'), 'utf8'), /^\.alloycat\/$/m);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('project uninstall removes all alloycat state and cleans project ignore state', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-uninstall-project-runtime-'));
  try {
    installAgent(repoRoot, {
      agentId: 'interaction-auditor',
      project: tempRoot
    });
    const runRoot = join(tempRoot, '.alloycat', 'agents', 'interaction-auditor', 'runs');
    writeFileSync(join(runRoot, 'old-run.txt'), 'run artifact\n');

    const result = uninstallProject({
      project: tempRoot
    });

    assert.equal(result.projectRoot, tempRoot);
    assert.equal(result.gitignoreStatus, 'removed');
    assert.equal(result.installRootStatus, 'removed');
    assert.equal(existsSync(join(tempRoot, '.alloycat')), false);
    assert.doesNotMatch(readFileSync(join(tempRoot, '.gitignore'), 'utf8'), /^\.alloycat\/$/m);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('uninstall rejects agents that are not installed', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-uninstall-missing-runtime-'));
  try {
    assert.throws(
      () => uninstallAgent(repoRoot, {
        agentId: 'interaction-auditor',
        project: tempRoot
      }),
      /Agent is not installed: interaction-auditor/
    );
    assert.equal(existsSync(join(tempRoot, '.alloycat')), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('create run defaults run root to the target project agent runs folder', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-run-default-root-'));
  try {
    const run = createRun(repoRoot, {
      agentId: 'interaction-auditor',
      project: tempRoot,
      runId: 'default-root-run'
    });

    assert.equal(run.runDir, join(tempRoot, '.alloycat', 'agents', 'interaction-auditor', 'runs', 'default-root-run'));
    assert.equal(loadRunState(run.runDir).project_root, tempRoot);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('creates run state for the first phase', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-run-'));
  try {
    const run = createRun(repoRoot, {
      agentId: 'interaction-auditor',
      project: repoRoot,
      runRoot: tempRoot,
      runId: 'test-run'
    });

    assert.equal(run.state.agent_id, 'interaction-auditor');
    assert.equal(run.state.current_phase, 'resolve-project-root');
    assert.equal(loadRunState(run.runDir).current_phase, 'resolve-project-root');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('renders current phase prompt with phase metadata and artifact contracts', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-prompt-'));
  try {
    const run = createRun(repoRoot, {
      agentId: 'interaction-auditor',
      project: repoRoot,
      runRoot: tempRoot,
      runId: 'prompt-run'
    });

    const prompt = renderNextPrompt(repoRoot, run.runDir);
    assert.match(prompt, /You are executing Alloy Interaction Auditor/);
    assert.match(prompt, /Phase: Resolve Project Root \(resolve-project-root\)/);
    assert.match(prompt, /Goal: Identify the target project root/);
    assert.match(prompt, /Output artifacts/);
    assert.match(prompt, /00-project-root\.json/);
    assert.match(prompt, /Format: json/);
    assert.match(prompt, /## Agent Context/);
    assert.match(prompt, /### Operating Rules/);
    assert.match(prompt, /Follow the phase-gated workflow/);
    assert.match(prompt, /### Evidence Rules/);
    assert.match(prompt, /Findings must cite concrete evidence/);
    assert.match(prompt, /### Forbidden Actions/);
    assert.match(prompt, /Do not fix product code during audit mode/);
    assert.match(prompt, /then run:/);
    assert.match(prompt, /alloycat next/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('complete requires current phase output artifacts before advancing', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-complete-missing-'));
  try {
    const run = createRun(repoRoot, {
      agentId: 'interaction-auditor',
      project: repoRoot,
      runRoot: tempRoot,
      runId: 'missing-output-run'
    });

    assert.throws(
      () => completeRun(repoRoot, run.runDir),
      /Missing output artifacts for phase resolve-project-root: .*00-project-root\.json/
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('complete validates json output artifacts before advancing', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-complete-invalid-json-'));
  try {
    const run = createRun(repoRoot, {
      agentId: 'interaction-auditor',
      project: repoRoot,
      runRoot: tempRoot,
      runId: 'invalid-json-run'
    });
    writeFileSync(join(run.runDir, '00-project-root.json'), '{not json}\n');

    assert.throws(
      () => completeRun(repoRoot, run.runDir),
      /Invalid JSON output artifact for phase resolve-project-root: .*00-project-root\.json/
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('complete advances to the next workflow phase after outputs exist', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-complete-next-'));
  try {
    const run = createRun(repoRoot, {
      agentId: 'interaction-auditor',
      project: repoRoot,
      runRoot: tempRoot,
      runId: 'next-phase-run'
    });
    writeFileSync(join(run.runDir, '00-project-root.json'), '{}\n');

    const result = completeRun(repoRoot, run.runDir);
    const state = loadRunState(run.runDir);

    assert.equal(result.completedPhase.id, 'resolve-project-root');
    assert.equal(result.nextPhase.id, 'project-discovery');
    assert.equal(result.workflowCompleted, false);
    assert.equal(state.current_phase, 'project-discovery');
    assert.deepEqual(state.completed_phases, ['resolve-project-root']);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('complete reports when the next phase is a user gate', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-complete-gate-'));
  try {
    const run = createRun(repoRoot, {
      agentId: 'interaction-auditor',
      project: repoRoot,
      runRoot: tempRoot,
      runId: 'gate-run'
    });
    const state = loadRunState(run.runDir);
    state.current_phase = 'source-of-truth';
    state.completed_phases = ['resolve-project-root', 'project-discovery'];
    saveRunState(run.runDir, state);
    writeFileSync(join(run.runDir, '03-source-of-truth-matrix.md'), '# Matrix\n');

    const result = completeRun(repoRoot, run.runDir);

    assert.equal(result.nextPhase.id, 'scope-confirmation');
    assert.equal(result.userGate, true);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('complete marks the run completed after the final phase', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'alloycat-complete-final-'));
  try {
    const run = createRun(repoRoot, {
      agentId: 'interaction-auditor',
      project: repoRoot,
      runRoot: tempRoot,
      runId: 'final-run'
    });
    const state = loadRunState(run.runDir);
    state.current_phase = 'report-assembly';
    state.completed_phases = [
      'resolve-project-root',
      'project-discovery',
      'source-of-truth',
      'scope-confirmation',
      'branch-planning',
      'interaction-auditor',
      'visual-conformance-audit',
      'e2e-coverage-audit'
    ];
    saveRunState(run.runDir, state);
    writeFileSync(join(run.runDir, '07-final-report.md'), '# Report\n');

    const result = completeRun(repoRoot, run.runDir);
    const completedState = loadRunState(run.runDir);

    assert.equal(result.workflowCompleted, true);
    assert.equal(result.nextPhase, null);
    assert.equal(completedState.status, 'completed');
    assert.equal(completedState.current_phase, null);
    assert.deepEqual(completedState.completed_phases, [
      'resolve-project-root',
      'project-discovery',
      'source-of-truth',
      'scope-confirmation',
      'branch-planning',
      'interaction-auditor',
      'visual-conformance-audit',
      'e2e-coverage-audit',
      'report-assembly'
    ]);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
