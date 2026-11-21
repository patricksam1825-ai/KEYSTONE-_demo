import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// URL.pathname returns "/C:/Users/..." on Windows, which is not a valid folder. Use fileURLToPath instead.
test('no file-system code builds paths from new URL(..., import.meta.url).pathname', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const bad = [];
  const walk = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'data', '.git'].includes(e.name)) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.(m?js)$/.test(e.name) && e.name !== 'windows-paths.test.js' && /new URL\([^)]*import\.meta\.url\)\.pathname/.test(fs.readFileSync(f, 'utf8'))) bad.push(path.relative(root, f));
  } };
  walk(root);
  assert.deepEqual(bad, []);
});
