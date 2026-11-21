import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { SqliteStore, DuplicateBindingError } from '../src/store-sqlite.js';

const ch = (o = {}) => ({ id: 'c1', tokenHash: 'h1', nonce: 'n'.repeat(20), bchAddress: 'bchtest:qq', nostrPubkey: 'a'.repeat(64), chain: 'chipnet', verifier: 'v', createdAt: 1000, expiresAt: 10_000, consumedAt: null, ...o });
const mk = async () => { const s = new SqliteStore(':memory:'); await s.init(); return s; };

test('challenge can be consumed exactly once', async () => {
  const s = await mk(); await s.putChallenge(ch());
  assert.ok(await s.consumeChallenge('c1', 'h1', 2000));
  assert.equal(await s.consumeChallenge('c1', 'h1', 2001), null);
});
test('wrong token or expired challenge is not consumed', async () => {
  const s = await mk(); await s.putChallenge(ch());
  assert.equal(await s.consumeChallenge('c1', 'bad', 2000), null);
  assert.equal(await s.consumeChallenge('c1', 'h1', 10_000), null);
  assert.ok(await s.consumeChallenge('c1', 'h1', 2000), 'still usable after failed attempts');
});
test('parallel consume gives one winner', async () => {
  const s = await mk(); await s.putChallenge(ch());
  const r = await Promise.all(Array.from({ length: 20 }, () => s.consumeChallenge('c1', 'h1', 2000)));
  assert.equal(r.filter(Boolean).length, 1);
});
test('duplicate binding is rejected by a database constraint', async () => {
  const s = await mk();
  const b = id => ({ id, chain: 'chipnet', bchAddress: 'bchtest:qq', nostrPubkey: 'a'.repeat(64), createdAt: 'x' });
  await s.putBinding(b('b1'));
  await assert.rejects(() => s.putBinding(b('b2')), DuplicateBindingError);
  assert.equal((await s.getBinding('b1')).id, 'b1');
});
test('data survives reopening the file and migrations run once', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ks-')), 'k.db');
  const a = new SqliteStore(f); await a.init(); await a.putChallenge(ch()); a.close();
  const b = new SqliteStore(f); await b.init();
  assert.equal((await b.getChallenge('c1')).id, 'c1');
  assert.equal(b.db.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n, 1);
  b.close();
});
test('registry events: insert, duplicate, conflict, paging', async () => {
  const s = await mk(); const pk = 'b'.repeat(64);
  const mkp = id => ({ proofBundle: { bindingId: 'bid' + id, challenge: { bchAddress: 'bchtest:qq', chain: 'chipnet' } } });
  const ev = (id, t) => ({ id, pubkey: pk, created_at: t });
  assert.deepEqual(await s.putRegistryEvent(ev('e1', 1), mkp(1)), { inserted: true, duplicate: false });
  assert.equal((await s.putRegistryEvent(ev('e1', 1), mkp(1))).duplicate, true);
  assert.equal((await s.putRegistryEvent(ev('e1', 1), mkp(2))).conflict, true);
  await s.putRegistryEvent(ev('e2', 2), mkp(2));
  const p = await s.listRegistryPageByPubkey(pk, { limit: 1 });
  assert.equal(p.records[0].eventId, 'e2'); assert.equal(p.hasMore, true);
  assert.equal((await s.listRegistryPageByPubkey(pk, { limit: 1, cursor: p.nextCursor })).records[0].eventId, 'e1');
});
