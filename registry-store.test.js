import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs/promises';
import { JsonStore } from '../src/store.js';

test('registry records persist and can be listed by Nostr author', async () => {
  const dir = await fs.mkdtemp(`${os.tmpdir()}/keystone-registry-`);
  try {
    const store = new JsonStore(dir);
    await store.init();
    const pubkey = 'a'.repeat(64);
    const event = { id: 'event-id', pubkey, kind: 30078, created_at: 1, tags: [], content: '{}', sig: 'sig' };
    const payload = { protocol: 'KEYSTONE-NOSTR-REGISTRY-v1', proofBundle: { bindingId: 'binding-id', challenge: { bchAddress: 'bchtest:example', chain: 'chipnet' } } };
    await store.putRegistryEvent(event, payload);
    const records = await store.listRegistryByPubkey(pubkey);
    assert.equal(records.length, 1);
    assert.equal(records[0].eventId, 'event-id');
    assert.equal(records[0].bindingId, 'binding-id');
    const reopened = new JsonStore(dir);
    await reopened.init();
    assert.equal((await reopened.listRegistryByPubkey(pubkey)).length, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('registry listing is deterministic and paginated with a continuation cursor', async () => {
  const dir = await fs.mkdtemp(`${os.tmpdir()}/keystone-registry-page-`);
  try {
    const store = new JsonStore(dir); await store.init();
    const pubkey = 'd'.repeat(64);
    for (let i = 1; i <= 3; i++) {
      const id = String(i).repeat(64);
      const event = { id, pubkey, kind: 30078, created_at: 100 + i, tags: [], content: '{}', sig: 'sig' };
      const payload = { proofBundle: { bindingId: `binding-${i}`, challenge: { bchAddress: 'bchtest:example', chain: 'chipnet' } } };
      await store.putRegistryEvent(event, payload);
    }
    const first = await store.listRegistryPageByPubkey(pubkey, { limit: 2 });
    assert.equal(first.records.length, 2);
    assert.equal(first.hasMore, true);
    assert.equal(first.records[0].createdAt, 103);
    const second = await store.listRegistryPageByPubkey(pubkey, { limit: 2, cursor: first.nextCursor });
    assert.equal(second.records.length, 1);
    assert.equal(second.hasMore, false);
    assert.equal(second.records[0].createdAt, 101);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('registry pagination rejects an unknown cursor instead of silently restarting', async () => {
  const dir = await fs.mkdtemp(`${os.tmpdir()}/keystone-registry-cursor-`);
  try {
    const store = new JsonStore(dir); await store.init();
    const result = await store.listRegistryPageByPubkey('a'.repeat(64), { limit: 10, cursor: 'f'.repeat(64) });
    assert.match(result.cursorError, /not found/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('registry event insertion is idempotent for exact retries', async () => {
  const dir = await fs.mkdtemp(`${os.tmpdir()}/keystone-registry-idempotent-`);
  try {
    const store = new JsonStore(dir); await store.init();
    const event = { id: 'immutable-event', pubkey: 'b'.repeat(64), kind: 30078, created_at: 10, tags: [], content: '{}', sig: 'sig' };
    const payload = { proofBundle: { bindingId: 'binding-1', challenge: { bchAddress: 'bchtest:example', chain: 'chipnet' } } };
    assert.deepEqual(await store.putRegistryEvent(event, payload), { inserted: true, duplicate: false });
    assert.deepEqual(await store.putRegistryEvent(event, payload), { inserted: false, duplicate: true });
    assert.equal((await store.listRegistryPageByPubkey(event.pubkey)).records.length, 1);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('registry event ID cannot overwrite a previously stored event or payload', async () => {
  const dir = await fs.mkdtemp(`${os.tmpdir()}/keystone-registry-conflict-`);
  try {
    const store = new JsonStore(dir); await store.init();
    const event = { id: 'immutable-event', pubkey: 'c'.repeat(64), kind: 30078, created_at: 10, tags: [], content: '{}', sig: 'sig' };
    const payload = { proofBundle: { bindingId: 'binding-1', challenge: { bchAddress: 'bchtest:example', chain: 'chipnet' } } };
    await store.putRegistryEvent(event, payload);
    const altered = { ...event, content: '{"replacement":true}' };
    assert.deepEqual(await store.putRegistryEvent(altered, payload), { inserted: false, conflict: true });
    assert.equal((await store.listRegistryPageByPubkey(event.pubkey)).records[0].bindingId, 'binding-1');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
