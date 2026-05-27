import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import {
  extractMarkdownSection,
  isAnyAbsolute,
  parseAgentMarkdown,
  resolveAgentProjectPath,
  resolveArtifactTemplate,
  resolvePackageRelativePath,
  resolveRunArtifactPath
} from './manifest.js';

const ALLOWED_AGENT_KEYS = new Set(['id', 'path']);
const ALLOWED_STATUSES = new Set(['draft', 'experimental', 'stable', 'deprecated']);
const ALLOWED_ADAPTER_STATUSES = new Set(['skeleton', 'experimental', 'stable', 'deprecated']);
const REQUIRED_QUALITY_GATES = [
  'requires_project_discovery',
  'requires_user_scope_confirmation',
  'requires_persistent_artifacts',
  'forbids_single_prompt_full_run',
  'requires_tests'
];
const REQUIRED_OUTPUT_METADATA_BY_AGENT = new Map([
  ['interaction-auditor', new Map([
    ['00-project-root.json', ['schema']],
    ['02-ui-inventory.json', ['schema']],
    ['04-confirmed-scope.md', ['template']],
    ['05-branch-plan.json', ['schema', 'template']],
    ['07-final-report.md', ['template']]
  ])]
]);

function cleanValue(value) {
  return value.trim().replace(/^["']|["']$/g, '');
}

function pushError(errors, message) {
  errors.push(message);
}

function isPlainStateFile(value) {
  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    value !== '.' &&
    value !== '..' &&
    !/[\\/]/.test(value) &&
    !/[{}]/.test(value) &&
    !isAnyAbsolute(value)
  );
}

function isInside(childPath, parentPath) {
  const relativePath = relative(parentPath, childPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAnyAbsolute(relativePath));
}

function parseCatalogEntries(catalogText, errors) {
  const entries = [];
  const blocks = catalogText.split(/\n\s*-\s+id:\s+/).slice(1);

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const id = cleanValue(lines[0] ?? '');
    const entry = { id, keys: new Set(['id']) };

    for (const line of lines.slice(1)) {
      const match = line.match(/^ {4}([^:\s][^:]*):\s*(.*)$/);
      if (!match) {
        continue;
      }
      const [, key, rawValue] = match;
      entry.keys.add(key);
      if (rawValue !== '') {
        entry[key] = cleanValue(rawValue);
      }
    }

    for (const key of entry.keys) {
      if (!ALLOWED_AGENT_KEYS.has(key)) {
        pushError(errors, `catalog.yaml entry for ${id} must contain only id and path, found: ${key}`);
      }
    }

    if (!id) {
      pushError(errors, 'catalog.yaml agent id must be a non-empty string.');
      continue;
    }
    if (!entry.path) {
      pushError(errors, `catalog.yaml path for ${id} must be a non-empty string.`);
      continue;
    }

    entries.push(entry);
  }

  return entries;
}

function requireFile(root, path, errors) {
  const fullPath = join(root, path);
  if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
    pushError(errors, `Missing required file: ${path}`);
    return false;
  }
  return true;
}

function requireDirectory(root, path, errors) {
  const fullPath = join(root, path);
  if (!existsSync(fullPath) || !statSync(fullPath).isDirectory()) {
    pushError(errors, `Missing required directory: ${path}`);
    return false;
  }
  return true;
}

function safePackagePath(basePath, candidatePath, label, errors) {
  if (typeof candidatePath !== 'string' || candidatePath.trim() === '') {
    pushError(errors, `${label} must be a non-empty string.`);
    return null;
  }

  try {
    return resolvePackageRelativePath(basePath, candidatePath, label);
  } catch (error) {
    pushError(errors, error.message);
    return null;
  }
}

function safeRunArtifactPath(basePath, candidatePath, label, errors) {
  try {
    resolveRunArtifactPath(basePath, candidatePath, label);
  } catch (error) {
    pushError(errors, error.message);
  }
}

function requireManifestField(manifest, documentPath, field, errors) {
  const value = field.split('.').reduce((current, key) => current?.[key], manifest);
  if (value === undefined || value === null || value === '') {
    pushError(errors, `${documentPath} is missing required manifest field: ${field}`);
  }
  return value;
}

function requireStringManifestField(manifest, documentPath, field, errors) {
  const value = requireManifestField(manifest, documentPath, field, errors);
  if (typeof value !== 'string' || value.trim() === '') {
    pushError(errors, `${documentPath} manifest field must be a non-empty string: ${field}`);
    return '';
  }
  return value;
}

function loadAgentDocument(root, documentPath, errors) {
  try {
    return parseAgentMarkdown(readFileSync(join(root, documentPath), 'utf8'));
  } catch (error) {
    pushError(errors, `${documentPath}: ${error.message}`);
    return { manifest: {}, body: '' };
  }
}

function extractWorkflowId(workflowText) {
  return cleanValue(workflowText.match(/\n\s+id:\s+(.+)/)?.[1] ?? '');
}

function extractWorkflowPaths(workflowText, key) {
  return [...workflowText.matchAll(new RegExp(`\\n\\s+${key}:\\s+(.+)`, 'g'))]
    .map((match) => cleanValue(match[1]));
}

function extractWorkflowList(workflowText, key) {
  const values = [];
  const lines = workflowText.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const section = lines[index].match(new RegExp(`^(\\s*)${key}:\\s*(.*)$`));
    if (!section) {
      continue;
    }

    const [, rawIndent, rawInlineValue] = section;
    const sectionIndent = rawIndent.length;
    const inlineValue = cleanValue(rawInlineValue);
    if (inlineValue && inlineValue !== '[]') {
      values.push(inlineValue);
    }

    for (let nestedIndex = index + 1; nestedIndex < lines.length; nestedIndex += 1) {
      const line = lines[nestedIndex];
      if (!line.trim()) {
        continue;
      }

      const lineIndent = line.match(/^(\s*)/)?.[1].length ?? 0;
      if (lineIndent <= sectionIndent) {
        break;
      }

      const item = line.match(/^(\s*)-\s+(.+)$/);
      if (!item || item[1].length <= sectionIndent) {
        continue;
      }

      const rawItem = cleanValue(item[2]);
      const objectStart = rawItem.match(/^([a-z_]+):\s*(.*)$/);
      if (!objectStart) {
        values.push(rawItem);
        continue;
      }

      const objectValue = {
        [objectStart[1]]: cleanValue(objectStart[2])
      };

      for (let propertyIndex = nestedIndex + 1; propertyIndex < lines.length; propertyIndex += 1) {
        const propertyLine = lines[propertyIndex];
        if (!propertyLine.trim()) {
          continue;
        }

        const nextItem = propertyLine.match(/^(\s*)-\s+(.+)$/);
        if (nextItem && nextItem[1].length === item[1].length) {
          break;
        }

        const property = propertyLine.match(/^(\s+)([a-z_]+):\s*(.*)$/);
        if (!property || property[1].length <= item[1].length) {
          break;
        }
        objectValue[property[2]] = cleanValue(property[3]);
      }

      values.push(objectValue);
    }
  }

  return values;
}

function extractWorkflowInputs(workflowText) {
  return extractWorkflowList(workflowText, 'inputs')
    .map((input) => (typeof input === 'string' ? input : input.path))
    .filter(Boolean);
}

function extractWorkflowOutputs(workflowText) {
  return extractWorkflowList(workflowText, 'outputs')
    .map((output) => (typeof output === 'string' ? { path: output } : output))
    .filter((output) => output.path);
}

function validateArtifactTemplates(root, agent, manifest, documentPath, errors) {
  const installRootTemplate = requireStringManifestField(manifest, documentPath, 'artifacts.install_root', errors);
  const runRootTemplate = requireStringManifestField(manifest, documentPath, 'artifacts.run_root', errors);
  const stateFile = requireStringManifestField(manifest, documentPath, 'artifacts.state_file', errors);
  let installRoot = null;
  let runRoot = null;

  if (installRootTemplate && installRootTemplate !== '.alloycat/agents/{agent_id}') {
    pushError(errors, `${documentPath} artifacts.install_root must be .alloycat/agents/{agent_id}.`);
  }

  for (const [label, template] of [
    ['artifacts.install_root', installRootTemplate],
    ['artifacts.run_root', runRootTemplate]
  ]) {
    if (!template) {
      continue;
    }
    try {
      resolveArtifactTemplate(template, { agentId: agent.id });
      const resolvedPath = resolveAgentProjectPath(root, agent, template);
      if (label === 'artifacts.install_root') {
        installRoot = resolvedPath;
      } else {
        runRoot = resolvedPath;
      }
    } catch (error) {
      pushError(errors, `${documentPath}: ${error.message}`);
    }
  }

  if (installRoot && runRoot && !isInside(runRoot, installRoot)) {
    pushError(errors, `${documentPath} artifacts.run_root must be inside artifacts.install_root.`);
  }
  if (!isPlainStateFile(stateFile)) {
    pushError(errors, `${documentPath} artifacts.state_file must be a plain file name.`);
  }
}

function validatePromptContext(document, documentPath, errors) {
  const sections = document.manifest.prompt_context?.include_sections;
  if (!Array.isArray(sections) || sections.length === 0) {
    pushError(errors, `${documentPath} prompt_context.include_sections must be a non-empty list.`);
    return;
  }

  for (const section of sections) {
    if (typeof section !== 'string' || section.trim() === '') {
      pushError(errors, `${documentPath} prompt_context.include_sections values must be non-empty strings.`);
      continue;
    }
    if (!extractMarkdownSection(document.body, section)) {
      pushError(errors, `${documentPath} is missing Markdown section: ${section}`);
    }
  }
}

function validateSupports(root, agentPath, agentRoot, manifest, documentPath, errors) {
  const hosts = manifest.supports?.hosts;
  if (!hosts || Array.isArray(hosts) || typeof hosts !== 'object' || Object.keys(hosts).length === 0) {
    pushError(errors, `${documentPath} supports.hosts must be a non-empty object.`);
    return;
  }

  for (const [hostId, host] of Object.entries(hosts)) {
    if (!host || typeof host !== 'object' || Array.isArray(host)) {
      pushError(errors, `${documentPath} supports.hosts.${hostId} must be an object.`);
      continue;
    }
    if (typeof host.adapter_path !== 'string' || host.adapter_path.trim() === '') {
      pushError(errors, `${documentPath} supports.hosts.${hostId}.adapter_path must be a non-empty string.`);
      continue;
    }
    if (!ALLOWED_ADAPTER_STATUSES.has(host.status)) {
      pushError(errors, `${documentPath} has unsupported adapter status for ${hostId}: ${host.status}`);
    }

    const adapterPath = safePackagePath(agentRoot, host.adapter_path, `${documentPath} supports.hosts.${hostId}.adapter_path`, errors);
    if (adapterPath === null) {
      continue;
    }

    requireDirectory(root, `${agentPath}/${adapterPath}`, errors);
    const adapterReadme = join(root, agentPath, adapterPath, 'README.md');
    const adapterEntry = join(root, agentPath, adapterPath, `${hostId}.md`);
    if (!existsSync(adapterReadme) && !existsSync(adapterEntry)) {
      pushError(errors, `Missing adapter README or host entry for ${hostId}: ${agentPath}/${adapterPath}`);
    }
  }
}

function validateQualityGates(manifest, documentPath, errors) {
  const gates = manifest.quality_gates;
  if (!gates || Array.isArray(gates) || typeof gates !== 'object') {
    pushError(errors, `${documentPath} quality_gates must be an object.`);
    return;
  }

  for (const key of REQUIRED_QUALITY_GATES) {
    if (!(key in gates)) {
      pushError(errors, `${documentPath} is missing required quality gate: ${key}`);
    }
  }

  for (const [key, value] of Object.entries(gates)) {
    if (typeof value !== 'boolean') {
      pushError(errors, `${documentPath} quality gate must be boolean: ${key}`);
    }
  }
}

function validateWorkflow(root, agentPath, agentRoot, agentId, workflowPath, errors) {
  if (workflowPath === null || !requireFile(root, `${agentPath}/${workflowPath}`, errors)) {
    return;
  }

  const workflowText = readFileSync(join(agentRoot, workflowPath), 'utf8');
  const workflowId = extractWorkflowId(workflowText);
  if (workflowId !== agentId) {
    pushError(errors, `Workflow id differs from agent id for ${agentId}: ${workflowId}`);
  }

  for (const key of ['prompt', 'schema', 'template']) {
    for (const candidatePath of extractWorkflowPaths(workflowText, key)) {
      const safePath = safePackagePath(agentRoot, candidatePath, `${agentId} workflow ${key}`, errors);
      if (safePath !== null) {
        requireFile(root, `${agentPath}/${safePath}`, errors);
      }
    }
  }

  const outputs = extractWorkflowOutputs(workflowText);
  const outputByPath = new Map();
  for (const inputPath of extractWorkflowInputs(workflowText)) {
    safeRunArtifactPath(agentRoot, inputPath, `${agentId} workflow input`, errors);
  }
  for (const output of outputs) {
    safeRunArtifactPath(agentRoot, output.path, `${agentId} workflow output`, errors);
    outputByPath.set(output.path, output);
  }

  const requiredMetadata = REQUIRED_OUTPUT_METADATA_BY_AGENT.get(agentId) ?? new Map();
  for (const [requiredPath, requiredKeys] of requiredMetadata) {
    const output = outputByPath.get(requiredPath);
    if (!output) {
      pushError(errors, `${agentId} workflow missing required workflow output: ${requiredPath}`);
      continue;
    }
    for (const key of requiredKeys) {
      if (!output[key]) {
        pushError(errors, `${agentId} workflow output ${output.path} must declare ${key}.`);
      }
    }
  }
}

function validateManifestBasics(manifest, agent, documentPath, errors) {
  for (const field of [
    'schema_version',
    'id',
    'name',
    'type',
    'version',
    'status',
    'description',
    'runtime.model',
    'runtime.workflow',
    'artifacts.install_root',
    'artifacts.run_root',
    'artifacts.state_file',
    'prompt_context.include_sections',
    'supports.hosts',
    'quality_gates'
  ]) {
    requireManifestField(manifest, documentPath, field, errors);
  }

  const manifestId = requireStringManifestField(manifest, documentPath, 'id', errors);
  requireStringManifestField(manifest, documentPath, 'name', errors);
  const type = requireStringManifestField(manifest, documentPath, 'type', errors);
  const version = requireStringManifestField(manifest, documentPath, 'version', errors);
  const status = requireStringManifestField(manifest, documentPath, 'status', errors);
  requireStringManifestField(manifest, documentPath, 'description', errors);

  if (manifestId !== agent.id) {
    pushError(errors, `${documentPath} id differs from catalog id: ${manifestId} !== ${agent.id}`);
  }
  if (manifest.schema_version !== 1) {
    pushError(errors, `${documentPath} schema_version must be 1.`);
  }
  if (type !== 'phase-gated-agent') {
    pushError(errors, `${documentPath} type must be phase-gated-agent.`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    pushError(errors, `${documentPath} version must be semver.`);
  }
  if (!ALLOWED_STATUSES.has(status)) {
    pushError(errors, `${documentPath} has unsupported status: ${status}`);
  }
  if (manifest.runtime?.model !== 'workflow') {
    pushError(errors, `${documentPath} runtime.model must be workflow.`);
  }
}

export function validateCatalogRoot(rootPath, options = {}) {
  const root = resolve(rootPath);
  const errors = [];

  requireFile(root, 'catalog.yaml', errors);
  if (options.requireRepositoryFiles) {
    requireFile(root, 'README.md', errors);
    requireFile(root, 'package.json', errors);
  }
  if (errors.length > 0) {
    return { valid: false, errors, agentCount: 0 };
  }

  const agents = parseCatalogEntries(readFileSync(join(root, 'catalog.yaml'), 'utf8'), errors);
  if (agents.length === 0) {
    pushError(errors, 'catalog.yaml must list at least one agent.');
  }

  for (const agent of agents) {
    const agentPath = safePackagePath(root, agent.path, `catalog.yaml path for ${agent.id}`, errors);
    if (agentPath === null) {
      continue;
    }

    const agentRoot = join(root, agentPath);
    requireDirectory(root, agentPath, errors);
    if (!requireFile(root, `${agentPath}/agent.md`, errors)) {
      continue;
    }
    for (const directory of ['prompts', 'schemas', 'templates', 'adapters', 'tests', 'fixtures', 'examples']) {
      requireDirectory(root, `${agentPath}/${directory}`, errors);
    }

    const documentPath = `${agentPath}/agent.md`;
    const document = loadAgentDocument(root, documentPath, errors);
    const manifest = document.manifest;

    validateManifestBasics(manifest, agent, documentPath, errors);
    validateArtifactTemplates(root, agent, manifest, documentPath, errors);
    validatePromptContext(document, documentPath, errors);
    validateSupports(root, agentPath, agentRoot, manifest, documentPath, errors);
    validateQualityGates(manifest, documentPath, errors);

    const workflowPath = safePackagePath(
      agentRoot,
      manifest.runtime?.workflow,
      `${agent.id} runtime.workflow`,
      errors
    );
    validateWorkflow(root, agentPath, agentRoot, agent.id, workflowPath, errors);
  }

  return {
    valid: errors.length === 0,
    errors,
    agentCount: agents.length
  };
}

export function formatValidationErrors(result) {
  return result.errors.join('\n');
}
