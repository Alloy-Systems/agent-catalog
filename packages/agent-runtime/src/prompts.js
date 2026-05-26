import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadWorkflow } from './workflow.js';
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
      }
    }
  }
  return lines.join('\n');
}

export function renderNextPrompt(repoRoot, runDir, options = {}) {
  const commandPrefix = options.commandPrefix ?? 'alloycat';
  const state = loadRunState(runDir);
  const workflow = loadWorkflow(repoRoot, state.agent_id);
  const phase = getCurrentPhase(repoRoot, state);
  const phasePrompt = readFileSync(join(repoRoot, workflow.agent.path, phase.prompt), 'utf8').trim();
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

  lines.push(
    '',
    listArtifacts('Input artifacts', runDir, phase.inputs),
    '',
    listArtifacts('Output artifacts', runDir, phase.outputs),
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
