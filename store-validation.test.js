import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/store.js';

test('store initializes missing collections for backward compatibility', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'keystone-store-'));
  try {
    await fs.writeFile(path.join(dir, 'keystone-store.json'), JSON.stringify({ challenges: {} }));
    const store = new JsonStore(dir);
    await store.init();
    assert.deepEqual(Object.keys(store.state).sort(), ['bindings', 'challenges', 'paymentRequests', 'registry']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('store rejects array roots and malformed collection types', async () => {
  for (const invalid of [[], { registry: [] }, { bindings: null }]) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'keystone-store-'));
    try {
      await fs.writeFile(path.join(dir, 'keystone-store.json'), JSON.stringify(invalid));
      await assert.rejects(() => new JsonStore(dir).init(), /Store file is invalid/);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  }
});

test('store rejects files above the configured safety limit', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'keystone-store-'));
  try {
    const file = path.join(dir, 'keystone-store.json');
    await fs.writeFile(file, '{}');
    const store = new JsonStore(dir);
    // Exercise the same guard without creating a 50 MB fixture by mocking stat.
    const original = fs.stat;
    fs.stat = async (...args) => ({ ...(await original(...args)), size: 50 * 1024 * 1024 + 1 });
    try { await assert.rejects(() => store.init(), /50 MB safety limit/); }
    finally { fs.stat = original; }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});


test('store writes use private permissions and leave no temporary files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'keystone-store-durable-'));
  try {
    const store = new JsonStore(dir);
    await store.init();
    await store.putChallenge({ id: 'durable-test', value: 'ok' });
    const file = path.join(dir, 'keystone-store.json');
    const stat = await fs.stat(file);
    if (process.platform !== 'win32') assert.equal(stat.mode & 0o777, 0o600);
    const names = await fs.readdir(dir);
    assert.deepEqual(names.sort(), ['keystone-store.json']);
    const reopened = new JsonStore(dir);
    await reopened.init();
    assert.deepEqual(await reopened.getChallenge('durable-test'), { id: 'durable-test', value: 'ok' });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('concurrent store mutations are serialized and all survive reopening', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'keystone-store-concurrent-'));
  try {
    const store = new JsonStore(dir);
    await store.init();
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.putChallenge({ id: `parallel-${i}`, value: i })));
    const reopened = new JsonStore(dir);
    await reopened.init();
    assert.equal(Object.keys(reopened.state.challenges).length, 20);
    for (let i = 0; i < 20; i++) assert.equal((await reopened.getChallenge(`parallel-${i}`)).value, i);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
