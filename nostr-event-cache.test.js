import test from 'node:test';
import assert from 'node:assert/strict';
import { plainNostrEvent } from '../src/nostr-event.js';
import { verifyNostrEvent } from '../src/nostr.js';
import { validateRegistryEvent } from '../src/registry.js';

const HIDDEN = Symbol('verified');
const base = () => ({ id: 'a'.repeat(64), pubkey: 'b'.repeat(64), created_at: 1, kind: 30078, tags: [['d', 'x']], content: 'c', sig: 'f'.repeat(128), extra: 'drop me', [HIDDEN]: true });

test('plainNostrEvent keeps only the seven Nostr fields and drops hidden symbol flags', () => {
  const p = plainNostrEvent(base());
  assert.deepEqual(Object.keys(p).sort(), ['content', 'created_at', 'id', 'kind', 'pubkey', 'sig', 'tags']);
  assert.equal(Object.getOwnPropertySymbols(p).length, 0);
  const e = base(); const q = plainNostrEvent(e); q.tags[0][1] = 'changed'; assert.equal(e.tags[0][1], 'x', 'tags are copied, not shared');
});
test('verifyNostrEvent hands the signature verifier a plain object (no cached flags)', async () => {
  const now = Date.now(); let seen;
  const ch = { id: 'cid', nostrPubkey: 'b'.repeat(64), message: 'm', createdAt: now - 1000, expiresAt: now + 60_000 };
  const ev = { ...base(), content: 'm', created_at: Math.floor(now / 1000), tags: [['d', 'cid'], ['keystone', 'identity-proof', 'v1']] };
  const r = await verifyNostrEvent(ev, ch, { verifyEventFn: e => { seen = e; return true; } });
  assert.equal(r.valid, true);
  assert.equal(Object.getOwnPropertySymbols(seen).length, 0); assert.equal('extra' in seen, false);
});
test('validateRegistryEvent hands the signature verifier a plain object', async () => {
  let seen;
  await validateRegistryEvent({ ...base(), tags: [['t', 'keystone-binding'], ['d', 'keystone-binding:x']], content: '{}' }, { signatureVerifier: e => { seen = e; return true; }, nowSeconds: 10 });
  assert.ok(seen); assert.equal(Object.getOwnPropertySymbols(seen).length, 0);
});

// Real-library regression test: skipped (not passed) when nostr-tools is not installed.
let nt = null; try { nt = await import('nostr-tools'); } catch { /* not installed */ }
test('REAL nostr-tools: an edited spread copy of a verified event is rejected by KEYSTONE', { skip: nt ? false : 'nostr-tools not installed: real-library check NOT run' }, async () => {
  const sk = nt.generateSecretKey(); const now = Date.now();
  const ch = { id: 'cid', nostrPubkey: nt.getPublicKey(sk), message: 'KEYSTONE test', createdAt: now - 1000, expiresAt: now + 60_000 };
  const ev = nt.finalizeEvent({ kind: 30078, created_at: Math.floor(now / 1000), tags: [['d', 'cid'], ['keystone', 'identity-proof', 'v1']], content: ch.message }, sk);
  assert.equal((await verifyNostrEvent(ev, ch)).valid, true);
  assert.equal((await verifyNostrEvent({ ...ev, tags: [...ev.tags, ['x', 'y']] }, ch)).valid, false, 'cached-verification bypass');
  assert.equal((await verifyNostrEvent({ ...ev, created_at: ev.created_at + 1 }, ch)).valid, false);
});
