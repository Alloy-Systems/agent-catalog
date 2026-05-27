import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { loadAgent } from './catalog.js';
import { isAnyAbsolute, resolveAgentProjectPath, resolveRunArtifactPath } from './manifest.js';
import { loadInstalledWorkflow, loadWorkflow } from './workflow.js';

function defaultRunId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function validateRunId(runId) {
  if (
    typeof runId !== 'string' ||
    runId.trim() === '' ||
    runId !== runId.trim() ||
    runId === '.' ||
    runId === '..' ||
    /[\\/]/.test(runId) ||
    isAnyAbsolute(runId)
  ) {
    throw new Error(`run_id must be a plain directory name: ${runId}`);
  }
  return runId;
}

export function createRun(repoRoot, options) {
  const agentId = options.agentId;
  const agent = loadAgent(repoRoot, agentId);
  const workflow = loadWorkflow(repoRoot, agentId);
  const runId = validateRunId(options.runId ?? defaultRunId());
  const projectRoot = resolve(options.project);
  const runRoot = options.runRoot
    ? resolve(options.runRoot)
    : resolveAgentProjectPath(projectRoot, agent, agent.artifacts.run_root);
  const runDir = join(runRoot, runId);
  const stateFile = agent.artifacts.state_file;
  const statePath = join(runDir, stateFile);
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

  saveRunState(runDir, state, { stateFile });
  return { runDir, state, stateFile, statePath };
}

export function createInstalledRun(installedAgent, options) {
  const workflow = loadInstalledWorkflow(installedAgent);
  const runId = validateRunId(options.runId ?? defaultRunId());
  const projectRoot = resolve(options.project);
  const runRoot = resolveInstalledRunRoot(installedAgent, options.runRoot);
  const runDir = join(runRoot, runId);
  const stateFile = installedAgent.stateFile;
  const statePath = join(runDir, stateFile);
  const firstPhase = workflow.phases[0];

  mkdirSync(runDir, { recursive: true });

  const state = {
    schema_version: 1,
    run_id: runId,
    agent_id: installedAgent.id,
    project_root: projectRoot,
    repo_root: installedAgent.packageRoot,
    install_dir: installedAgent.installDir,
    run_dir: runDir,
    status: 'running',
    current_phase: firstPhase.id,
    completed_phases: [],
    created_at: new Date().toISOString(),
    artifacts: {}
  };

  saveRunState(runDir, state, { stateFile });
  return { runDir, state, stateFile, statePath };
}

function isInside(childPath, parentPath) {
  const relativePath = relative(parentPath, childPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAnyAbsolute(relativePath));
}

function resolveInstalledRunRoot(installedAgent, runRootOverride) {
  const installDir = resolve(installedAgent.installDir);
  const runRoot = runRootOverride ? resolve(runRootOverride) : resolve(installedAgent.runRoot);
  if (runRoot === installDir || !isInside(runRoot, installDir)) {
    throw new Error('Installed run root must be inside install_dir.');
  }
  return runRoot;
}

export function loadRunState(runDir, options = {}) {
  return JSON.parse(readFileSync(join(runDir, options.stateFile ?? 'state.json'), 'utf8'));
}

export function saveRunState(runDir, state, options = {}) {
  writeFileSync(join(runDir, options.stateFile ?? 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
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
    .filter((artifact) => !existsSync(resolveRunArtifactPath(runDir, artifact, `phase ${phase.id} output artifact`)));
}

function validateOutputArtifacts(runDir, phase) {
  for (const artifact of phase.outputs) {
    const path = artifactPath(artifact);
    const artifactFile = resolveRunArtifactPath(runDir, path, `phase ${phase.id} output artifact`);
    if (artifactFormat(artifact) !== 'json') {
      continue;
    }

    try {
      JSON.parse(readFileSync(artifactFile, 'utf8'));
    } catch (error) {
      throw new Error(`Invalid JSON output artifact for phase ${phase.id}: ${path}`);
    }
  }
}

export function completeRun(repoRoot, runDir) {
  const state = loadRunState(runDir);
  const workflow = loadWorkflow(repoRoot, state.agent_id);
  return completeWorkflowRun(workflow, runDir, { state });
}

export function completeInstalledRun(installedAgent, runDir) {
  const state = loadRunState(runDir, { stateFile: installedAgent.stateFile });
  const workflow = loadInstalledWorkflow(installedAgent);
  return completeWorkflowRun(workflow, runDir, {
    state,
    stateFile: installedAgent.stateFile
  });
}

function completeWorkflowRun(workflow, runDir, options = {}) {
  const state = options.state ?? loadRunState(runDir, { stateFile: options.stateFile });
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

  saveRunState(runDir, nextState, { stateFile: options.stateFile });

  return {
    state: nextState,
    completedPhase: phase,
    nextPhase,
    userGate: Boolean(nextPhase?.user_gate),
    workflowCompleted: nextPhase === null
  };
}
