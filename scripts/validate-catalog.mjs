import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatValidationErrors,
  validateCatalogRoot
} from '../packages/agent-runtime/src/index.js';

const defaultRepoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repoRoot = process.env.ALLOYCAT_VALIDATE_ROOT
  ? resolve(process.env.ALLOYCAT_VALIDATE_ROOT)
  : defaultRepoRoot;
const result = validateCatalogRoot(repoRoot, {
  requireRepositoryFiles: true
});

if (!result.valid) {
  console.error(formatValidationErrors(result));
  process.exit(1);
}

console.log(`Validated ${result.agentCount} agent.`);
