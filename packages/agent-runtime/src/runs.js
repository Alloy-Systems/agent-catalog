import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadWorkflow } from './workflow.js';

function defaultRunId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function createRun(repoRoot, options) {
  const agentId = options.agentId;
  const workflow = loadWorkflow(repoRoot, agentId);
  const runId = options.runId ?? defaultRunId();
  const projectRoot = resolve(options.project);
  const runRoot = resolve(options.runRoot ?? join(projectRoot, '.alloycat', 'agents', agentId, 'runs'));
  const runDir = join(runRoot, runId);
  const firstPhase = workflow.phases[0];

  mkdirSync(runDir, { recursive: true });

  const state = {
    schema_version: 1,
    run_id: runId,
    agent_id: agentId,
    project_root: projectRoot,
    repo_root: resolve(repoRoot),
    run_dir: runDir,
    status: 'running',
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

function findCurrentPhase(workflow, state) {
  if (state.status === 'completed') {
    throw new Error(`Run is already completed: ${state.run_id}`);
  }

  const phaseIndex = workflow.phases.findIndex((candidate) => candidate.id === state.current_phase);
  if (phaseIndex === -1) {
    throw new Error(`Unknown phase for ${state.agent_id}: ${state.current_phase}`);
  }

  return { phase: workflow.phases[phaseIndex], phaseIndex };
}

function artifactPath(artifact) {
  return typeof artifact === 'string' ? artifact : artifact.path;
}

function artifactFormat(artifact) {
  if (typeof artifact === 'object' && artifact.format) {
    return artifact.format;
  }

  return artifactPath(artifact).endsWith('.json') ? 'json' : null;
}

function missingOutputArtifacts(runDir, phase) {
  return phase.outputs
    .map(artifactPath)
    .filter((artifact) => !existsSync(join(runDir, artifact)));
}

function validateOutputArtifacts(runDir, phase) {
  for (const artifact of phase.outputs) {
    const path = artifactPath(artifact);
    if (artifactFormat(artifact) !== 'json') {
      continue;
    }

    try {
      JSON.parse(readFileSync(join(runDir, path), 'utf8'));
    } catch (error) {
      throw new Error(`Invalid JSON output artifact for phase ${phase.id}: ${path}`);
    }
  }
}

export function completeRun(repoRoot, runDir) {
  const state = loadRunState(runDir);
  const workflow = loadWorkflow(repoRoot, state.agent_id);
  const { phase, phaseIndex } = findCurrentPhase(workflow, state);
  const missingArtifacts = missingOutputArtifacts(runDir, phase);

  if (missingArtifacts.length > 0) {
    throw new Error(`Missing output artifacts for phase ${phase.id}: ${missingArtifacts.join(', ')}`);
  }
  validateOutputArtifacts(runDir, phase);

  const completedPhases = state.completed_phases.includes(phase.id)
    ? state.completed_phases
    : [...state.completed_phases, phase.id];
  const nextPhase = workflow.phases[phaseIndex + 1] ?? null;
  const nextState = {
    ...state,
    completed_phases: completedPhases,
    current_phase: nextPhase?.id ?? null,
    status: nextPhase ? 'running' : 'completed',
    updated_at: new Date().toISOString()
  };

  if (!nextPhase) {
    nextState.completed_at = nextState.updated_at;
  }

  saveRunState(runDir, nextState);

  return {
    state: nextState,
    completedPhase: phase,
    nextPhase,
    userGate: Boolean(nextPhase?.user_gate),
    workflowCompleted: nextPhase === null
  };
}
