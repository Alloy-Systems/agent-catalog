import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadAgent } from './catalog.js';

function cleanValue(value) {
  return value.trim().replace(/^["']|["']$/g, '');
}

function parseList(lines, startIndex) {
  const values = [];
  let index = startIndex + 1;

  while (index < lines.length) {
    const item = lines[index].match(/^(\s*)-\s+(.+)$/);
    if (!item) {
      break;
    }

    const [, itemIndent, rawItem] = item;
    const objectStart = rawItem.match(/^([a-z_]+):\s*(.*)$/);
    if (!objectStart) {
      values.push(cleanValue(rawItem));
      index += 1;
      continue;
    }

    const objectValue = {
      [objectStart[1]]: cleanValue(objectStart[2])
    };
    index += 1;

    while (index < lines.length) {
      const nextItem = lines[index].match(/^(\s*)-\s+(.+)$/);
      if (nextItem && nextItem[1].length === itemIndent.length) {
        break;
      }

      const property = lines[index].match(/^(\s+)([a-z_]+):\s*(.*)$/);
      if (!property) {
        break;
      }

      const [, propertyIndent, key, rawValue] = property;
      if (propertyIndent.length <= itemIndent.length) {
        break;
      }

      objectValue[key] = rawValue === 'true' ? true : cleanValue(rawValue);
      index += 1;
    }

    values.push(objectValue);
  }

  return { values, nextIndex: index - 1 };
}

export function loadWorkflow(repoRoot, agentId) {
  const agent = loadAgent(repoRoot, agentId);
  const text = readFileSync(join(repoRoot, agent.path, 'workflow.yaml'), 'utf8');
  const lines = text.split(/\r?\n/);
  const phases = [];

  for (let index = 0; index < lines.length; index += 1) {
    const phaseStart = lines[index].match(/^\s+-\s+id:\s+(.+)$/);
    if (!phaseStart) {
      continue;
    }

    const phase = { id: cleanValue(phaseStart[1]), inputs: [], outputs: [] };
    index += 1;

    while (index < lines.length && !/^\s+-\s+id:\s+/.test(lines[index])) {
      const scalar = lines[index].match(/^\s+([a-z_]+):\s*(.*)$/);
      if (scalar) {
        const [, key, rawValue] = scalar;
        if (key === 'inputs' || key === 'outputs') {
          const parsed = parseList(lines, index);
          phase[key] = parsed.values;
          index = parsed.nextIndex;
        } else if (rawValue !== '') {
          phase[key] = rawValue === 'true' ? true : cleanValue(rawValue);
        }
      }
      index += 1;
    }

    phases.push(phase);
    index -= 1;
  }

  return {
    id: agentId,
    name: agent.name,
    agent,
    phases
  };
}
