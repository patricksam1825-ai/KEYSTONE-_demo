import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('proof verifier prints usage and exits safely when no file is supplied', () => {
  const result = spawnSync(process.execPath, ['scripts/verify-proof.js'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: npm run verify:proof/);
});
