import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadWorkflow } from './workflow.js';
import { getCurrentPhase, loadRunState } from './runs.js';

function listArtifacts(title, runDir, artifacts = []) {
  const lines = [`## ${title}`];
  if (artifacts.length === 0) {
    lines.push('- None');
  } else {
    for (const artifact of artifacts) {
      lines.push(`- ${join(runDir, artifact)}`);
    }
  }
  return lines.join('\n');
}

export function renderNextPrompt(repoRoot, runDir) {
  const state = loadRunState(runDir);
  const workflow = loadWorkflow(repoRoot, state.agent_id);
  const phase = getCurrentPhase(repoRoot, state);
  const phasePrompt = readFileSync(join(repoRoot, workflow.agent.path, phase.prompt), 'utf8').trim();

  return [
    `# ${workflow.name}`,
    '',
    `You are executing ${workflow.name}.`,
    '',
    `Project root: ${state.project_root}`,
    `Run directory: ${runDir}`,
    `Phase: ${phase.id}`,
    '',
    listArtifacts('Input artifacts', runDir, phase.inputs),
    '',
    listArtifacts('Output artifacts', runDir, phase.outputs),
    '',
    '## Phase Instructions',
    '',
    phasePrompt,
    ''
  ].join('\n');
}
