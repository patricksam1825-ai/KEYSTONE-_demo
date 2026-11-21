import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { SqliteStore } from '../src/store-sqlite.js';
import { JsonStore } from '../src/store.js';
import { createChallenge, canonicalMessage } from '../src/challenges.js';
import { verifyIdentityBinding } from '../src/identity.js';

// Verifiers are injected here because this test is about STORAGE behaviour, not cryptography.
const cfg = { chain: 'chipnet', challengeTtlSeconds: 300 };
const addr = 'bchtest:qpm2qsznhks23z7629mms6s4cwef74vcwvhanqgjxu';
const pub = 'a'.repeat(64);
const yes = async () => true; const okNostr = async () => ({ valid: true });
const run = (store, c, bchVerifier = yes) => verifyIdentityBinding({ store, challengeId: c.challengeId, challengeToken: c.challengeToken, bchSignature: 'sig', nostrEvent: { pubkey: pub }, bchVerifier, nostrVerifier: okNostr });

async function sqlite() { const s = new SqliteStore(':memory:'); await s.init(); return s; }

test('sqlite: successful binding saves and uses the challenge together', async () => {
  const s = await sqlite(); const c = await createChallenge(s, { bchAddress: addr, nostrPubkey: pub }, cfg);
  const r = await run(s, c); assert.equal(r.ok, true);
  assert.equal((await s.getBinding(r.binding.id)).id, r.binding.id);
  assert.equal((await run(s, c)).ok, false, 'replay rejected');
});
test('sqlite: invalid BCH signature does not use up the challenge', async () => {
  const s = await sqlite(); const c = await createChallenge(s, { bchAddress: addr, nostrPubkey: pub }, cfg);
  assert.equal((await run(s, c, async () => false)).ok, false);
  assert.equal((await run(s, c)).ok, true);
});
test('sqlite: storage failure after both proofs pass does NOT consume the challenge', async () => {
  const s = await sqlite(); const c = await createChallenge(s, { bchAddress: addr, nostrPubkey: pub }, cfg);
  const realPrepare = s.db.prepare.bind(s.db);
  s.db.prepare = sql => { if (/INSERT INTO bindings/.test(sql)) throw new Error('disk I/O error'); return realPrepare(sql); };
  const r = await run(s, c);
  assert.equal(r.ok, false); assert.equal(r.code, 'STORAGE_FAILURE');
  assert.ok(!/disk/.test(r.error), 'internal error text is not leaked');
  assert.equal((await s.getChallenge(c.challengeId)).consumedAt, null, 'challenge still unused');
  s.db.prepare = realPrepare;
  assert.equal((await run(s, c)).ok, true, 'retry succeeds after the fault clears');
});
test('sqlite: duplicate identity returns a conflict code and a clear message', async () => {
  const s = await sqlite();
  const c1 = await createChallenge(s, { bchAddress: addr, nostrPubkey: pub }, cfg); assert.equal((await run(s, c1)).ok, true);
  const c2 = await createChallenge(s, { bchAddress: addr, nostrPubkey: pub }, cfg);
  const r = await run(s, c2); assert.equal(r.ok, false); assert.equal(r.code, 'DUPLICATE_BINDING');
  assert.equal((await s.getChallenge(c2.challengeId)).consumedAt, null);
});
test('sqlite: concurrent valid submissions create exactly one binding', async () => {
  const s = await sqlite(); const c = await createChallenge(s, { bchAddress: addr, nostrPubkey: pub }, cfg);
  const results = await Promise.all(Array.from({ length: 10 }, () => run(s, c)));
  assert.equal(results.filter(r => r.ok).length, 1);
});
test('json store: failed disk write rolls the challenge and binding back', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ksj-')); const s = new JsonStore(dir); await s.init();
  const c = await createChallenge(s, { bchAddress: addr, nostrPubkey: pub }, cfg);
  const realPersist = s.persist.bind(s); let fail = true;
  s.persist = async () => { if (fail) throw new Error('ENOSPC'); return realPersist(); };
  const r = await run(s, c); assert.equal(r.code, 'STORAGE_FAILURE');
  assert.equal(s.state.challenges[c.challengeId].consumedAt, null);
  fail = false; assert.equal((await run(s, c)).ok, true);
});
