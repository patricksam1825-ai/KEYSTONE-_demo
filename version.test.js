import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { KEYSTONE_VERSION } from '../src/version.js';

test('application version matches package metadata', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(KEYSTONE_VERSION, pkg.version);
});

test('web page has no hard-coded version number (footer is filled from /api/health)', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.equal(/KEYSTONE v\d+\.\d+\.\d+/.test(html), false);
  assert.ok(html.includes('id="footerVersion"'));
});
