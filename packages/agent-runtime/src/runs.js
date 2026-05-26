import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadWorkflow } from './workflow.js';

function defaultRunId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function createRun(repoRoot, options) {
  const agentId = options.agentId;
  const workflow = loadWorkflow(repoRoot, agentId);
  const runId = options.runId ?? defaultRunId();
  const runRoot = resolve(options.runRoot ?? join(repoRoot, '.agent-runs', agentId));
  const runDir = join(runRoot, runId);
  const firstPhase = workflow.phases[0];

  mkdirSync(runDir, { recursive: true });

  const state = {
    schema_version: 1,
    run_id: runId,
    agent_id: agentId,
    project_root: resolve(options.project),
    repo_root: resolve(repoRoot),
    run_dir: runDir,
    current_phase: firstPhase.id,
    completed_phases: [],
    created_at: new Date().toISOString(),
    artifacts: {}
  };

  saveRunState(runDir, state);
  return { runDir, state };
}

export function loadRunState(runDir) {
  return JSON.parse(readFileSync(join(runDir, 'state.json'), 'utf8'));
}

export function saveRunState(runDir, state) {
  writeFileSync(join(runDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
}

export function getCurrentPhase(repoRoot, state) {
  const workflow = loadWorkflow(repoRoot, state.agent_id);
  const phase = workflow.phases.find((candidate) => candidate.id === state.current_phase);
  if (!phase) {
    throw new Error(`Unknown phase for ${state.agent_id}: ${state.current_phase}`);
  }
  return phase;
}
