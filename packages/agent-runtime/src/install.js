import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function findUp(startPath, marker) {
  let current = resolve(startPath);

  while (true) {
    if (existsSync(resolve(current, marker))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function resolveProjectRoot(startPath = process.cwd()) {
  const resolvedStart = resolve(startPath);
  const start = statSync(resolvedStart).isDirectory() ? resolvedStart : dirname(resolvedStart);

  return findUp(start, '.git') ?? findUp(start, 'package.json') ?? start;
}

export function installAgent() {
  throw new Error('installAgent is not implemented');
}
