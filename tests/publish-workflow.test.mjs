import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const workflowPath = resolve(repoRoot, '.github', 'workflows', 'publish-alloycat.yml');

test('publish workflow uses npm trusted publishing without long-lived tokens', () => {
  const workflow = readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /actions\/setup-node@v6/);
  assert.match(workflow, /node-version:\s*['"]24['"]/);
  assert.match(workflow, /package-manager-cache:\s*false/);
  assert.match(workflow, /name:\s*Publish alloycat/);
  assert.match(workflow, /name:\s*Pack alloycat/);
  assert.doesNotMatch(workflow, /name:\s*Test/);
  assert.match(workflow, /ALLOYCAT_PACKAGE_REPOSITORY_URL:\s*git\+https:\/\/github\.com\/\$\{\{\s*github\.repository\s*\}\}\.git/);
  assert.match(workflow, /working-directory:\s*packages\/alloycat\/dist-package/);
  assert.match(workflow, /npm publish --access public/);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN/);
  assert.doesNotMatch(workflow, /NPM_TOKEN/);
});
