import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractMarkdownSection } from './manifest.js';
import { loadInstalledWorkflow, loadWorkflow } from './workflow.js';
import { getCurrentPhase, loadRunState } from './runs.js';

function artifactPath(artifact) {
  return typeof artifact === 'string' ? artifact : artifact.path;
}

function artifactFormat(artifact) {
  if (typeof artifact === 'object' && artifact.format) {
    return artifact.format;
  }

  return artifactPath(artifact).endsWith('.json') ? 'json' : null;
}

function phaseTitle(phase) {
  return phase.title ? `${phase.title} (${phase.id})` : phase.id;
}

function listArtifacts(title, runDir, artifacts = []) {
  const lines = [`## ${title}`];
  if (artifacts.length === 0) {
    lines.push('- None');
  } else {
    for (const artifact of artifacts) {
      const path = artifactPath(artifact);
      lines.push(`- ${join(runDir, path)}`);
      if (typeof artifact === 'object') {
        if (artifactFormat(artifact)) {
          lines.push(`  - Format: ${artifactFormat(artifact)}`);
        }
        if (artifact.description) {
          lines.push(`  - Description: ${artifact.description}`);
        }
        if (artifact.template) {
          lines.push(`  - Template: ${artifact.template}`);
        }
        if (artifact.schema) {
          lines.push(`  - Schema: ${artifact.schema}`);
        }
      }
    }
  }
  return lines.join('\n');
}

function renderAgentContext(agent) {
  const sections = agent.prompt_context?.include_sections ?? [];
  const renderedSections = [];

  for (const sectionName of sections) {
    const section = extractMarkdownSection(agent.documentBody ?? '', sectionName);
    if (section) {
      renderedSections.push(`### ${sectionName}`, '', section);
    }
  }

  if (renderedSections.length === 0) {
    return null;
  }

  return ['## Agent Context', '', ...renderedSections].join('\n');
}

export function renderNextPrompt(repoRoot, runDir, options = {}) {
  const commandPrefix = options.commandPrefix ?? 'alloycat';
  const state = loadRunState(runDir);
  const workflow = loadWorkflow(repoRoot, state.agent_id);
  const phase = getCurrentPhase(repoRoot, state);
  return renderWorkflowPrompt(workflow, state, runDir, phase, { commandPrefix });
}

function getWorkflowPhase(workflow, state) {
  const phase = workflow.phases.find((candidate) => candidate.id === state.current_phase);
  if (!phase) {
    throw new Error(`Unknown phase for ${state.agent_id}: ${state.current_phase}`);
  }
  return phase;
}

function renderWorkflowPrompt(workflow, state, runDir, phase, options = {}) {
  const commandPrefix = options.commandPrefix ?? 'alloycat';
  const phasePrompt = readFileSync(join(workflow.packageRoot, phase.prompt), 'utf8').trim();
  const lines = [
    `# ${workflow.name}`,
    '',
    `You are executing ${workflow.name}.`,
    '',
    `Project root: ${state.project_root}`,
    `Run directory: ${runDir}`,
    `Phase: ${phaseTitle(phase)}`
  ];

  if (phase.description) {
    lines.push(`Goal: ${phase.description}`);
  }

  const agentContext = renderAgentContext(workflow.agent);

  lines.push(
    '',
    listArtifacts('Input artifacts', runDir, phase.inputs),
    '',
    listArtifacts('Output artifacts', runDir, phase.outputs)
  );

  if (agentContext) {
    lines.push('', agentContext);
  }

  lines.push(
    '',
    '## Phase Instructions',
    '',
    phasePrompt,
    '',
    '## Next',
    '',
    'Create the output artifacts above, then run:',
    `  ${commandPrefix} next`,
    ''
  );

  return lines.join('\n');
}

export function renderInstalledNextPrompt(installedAgent, runDir, options = {}) {
  const state = loadRunState(runDir, { stateFile: installedAgent.stateFile });
  const workflow = loadInstalledWorkflow(installedAgent);
  const phase = getWorkflowPhase(workflow, state);
  return renderWorkflowPrompt(workflow, state, runDir, phase, options);
}
