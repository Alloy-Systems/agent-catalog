import { readFileSync } from 'node:fs';
import { join, posix, relative, resolve, win32 } from 'node:path';

function cleanValue(value) {
  return value.trim().replace(/^["']|["']$/g, '');
}

function coerceValue(value) {
  const cleaned = cleanValue(value);
  if (cleaned === 'true') return true;
  if (cleaned === 'false') return false;
  if (/^-?\d+$/.test(cleaned)) return Number(cleaned);
  return cleaned;
}

function setNested(target, path, value) {
  let current = target;
  for (const key of path.slice(0, -1)) {
    current[key] ??= {};
    current = current[key];
  }
  current[path.at(-1)] = value;
}

function parseFrontmatterYaml(text) {
  const root = {};
  const stack = [{ indent: -1, path: [] }];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;

    const listItem = line.match(/^(\s*)-\s+(.+)$/);
    if (listItem) {
      const indent = listItem[1].length;
      while (stack.at(-1).indent >= indent) stack.pop();
      const parentPath = stack.at(-1).path;
      const parent = parentPath.reduce((value, key) => value[key], root);
      if (!Array.isArray(parent)) {
        throw new Error(`List item has no list parent: ${line}`);
      }
      parent.push(coerceValue(listItem[2]));
      continue;
    }

    const property = line.match(/^(\s*)([a-z0-9_-]+):\s*(.*)$/);
    if (!property) {
      throw new Error(`Unsupported frontmatter line: ${line}`);
    }

    const [, rawIndent, key, rawValue] = property;
    const indent = rawIndent.length;
    while (stack.at(-1).indent >= indent) stack.pop();
    const path = [...stack.at(-1).path, key];

    if (rawValue === '') {
      const nextLine = lines[index + 1] ?? '';
      const value = /^\s*-\s+/.test(nextLine) ? [] : {};
      setNested(root, path, value);
      stack.push({ indent, path });
    } else {
      setNested(root, path, coerceValue(rawValue));
    }
  }

  return root;
}

export function isAnyAbsolute(candidatePath) {
  return posix.isAbsolute(candidatePath) || win32.isAbsolute(candidatePath);
}

export function resolvePackageRelativePath(basePath, candidatePath, label) {
  if (candidatePath.includes('\\')) {
    throw new Error(`${label} must use POSIX separators: ${candidatePath}`);
  }
  if (isAnyAbsolute(candidatePath)) {
    throw new Error(`${label} must be relative: ${candidatePath}`);
  }
  if (candidatePath.split('/').includes('..')) {
    throw new Error(`${label} must not contain .. segments: ${candidatePath}`);
  }

  const normalizedPath = posix.normalize(candidatePath);
  const fullPath = resolve(basePath, normalizedPath);
  const relativePath = relative(basePath, fullPath);
  if (relativePath === '' || relativePath.startsWith('..') || isAnyAbsolute(relativePath)) {
    throw new Error(`${label} escapes the package root: ${candidatePath}`);
  }
  return normalizedPath;
}

export function resolveRunArtifactPath(runDir, candidatePath, label) {
  if (typeof candidatePath !== 'string' || candidatePath.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`);
  }
  if (candidatePath.includes('\\')) {
    throw new Error(`${label} must use POSIX separators: ${candidatePath}`);
  }
  if (isAnyAbsolute(candidatePath)) {
    throw new Error(`${label} must be relative: ${candidatePath}`);
  }
  if (candidatePath.split('/').includes('..')) {
    throw new Error(`${label} must not contain .. segments: ${candidatePath}`);
  }

  const normalizedPath = posix.normalize(candidatePath);
  if (normalizedPath === '.') {
    throw new Error(`${label} must not resolve to the run directory: ${candidatePath}`);
  }

  const basePath = resolve(runDir);
  const fullPath = resolve(basePath, normalizedPath);
  const relativePath = relative(basePath, fullPath);
  if (relativePath === '' || relativePath.startsWith('..') || isAnyAbsolute(relativePath)) {
    throw new Error(`${label} escapes the run directory: ${candidatePath}`);
  }

  return fullPath;
}

export function parseAgentMarkdown(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error('agent.md must start with YAML frontmatter.');
  }

  return {
    manifest: parseFrontmatterYaml(match[1]),
    body: match[2].trim()
  };
}

export function loadAgentDocument(repoRoot, relativePath) {
  const safePath = resolvePackageRelativePath(repoRoot, relativePath, 'agent document path');
  return parseAgentMarkdown(readFileSync(join(repoRoot, safePath), 'utf8'));
}

export function extractMarkdownSection(markdown, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lines = markdown.split(/\r?\n/);
  const headingPattern = new RegExp(`^## ${escaped}\\s*$`);
  const startIndex = lines.findIndex((line) => headingPattern.test(line));
  if (startIndex === -1) {
    return null;
  }

  const sectionLines = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (/^##\s+/.test(line)) {
      break;
    }
    sectionLines.push(line);
  }
  return sectionLines.join('\n').trim();
}

export function resolveArtifactTemplate(template, values) {
  if (template.includes('\\')) {
    throw new Error(`Agent artifact path template must use POSIX separators: ${template}`);
  }
  if (isAnyAbsolute(template)) {
    throw new Error(`Agent artifact path template must be relative: ${template}`);
  }

  const resolved = template.replace(/\{([^}]+)\}/g, (_, key) => {
    if (key === 'agent_id') return values.agentId;
    throw new Error(`Unknown artifact path placeholder: ${key}`);
  });
  if (/[{}]/.test(resolved)) {
    throw new Error(`Invalid artifact path template: ${template}`);
  }
  return resolved;
}

export function resolveAgentProjectPath(projectRoot, agent, template) {
  const fullPath = resolve(projectRoot, resolveArtifactTemplate(template, {
    agentId: agent.id,
    projectRoot
  }));
  const relativePath = relative(projectRoot, fullPath);
  if (relativePath === '') {
    throw new Error(`Agent artifact path must not resolve to the project root: ${template}`);
  }
  if (relativePath.startsWith('..') || isAnyAbsolute(relativePath)) {
    throw new Error(`Agent artifact path escapes the project root: ${template}`);
  }
  return fullPath;
}
