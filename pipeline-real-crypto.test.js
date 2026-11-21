import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { SqliteStore } from '../src/store-sqlite.js';
import { createChallenge } from '../src/challenges.js';
import { verifyIdentityBinding, verifyProofBundle } from '../src/identity.js';
import { verifyNostrEvent } from '../src/nostr.js';
import { validateRegistryEvent } from '../src/registry.js';
import { publishToRelays, discoverFromRelays } from '../src/relays.js';
import { verifyWithPrimitives } from '../src/bch-local.js';
import { referencePrimitives, schnorrPubkey, schnorrSign, schnorrVerify, signNostrEvent, verifyEventRef } from './helpers/secp-ref.js';
import { bchKeypair, signBchMessage } from './helpers/bch-sign.js';

// WHAT IS REAL HERE: every BCH ECDSA signature (OpenSSL), every Nostr BIP340 Schnorr signature and
// event ID, the SQLite database, and all KEYSTONE verification logic.
// WHAT IS NOT: the crypto *libraries* used for checking are independent test references, not
// libauth / nostr-tools (not installable offline), and the "relay" is an in-memory stub.
// This is therefore NOT a live integration test.
const bchVerifier = a => verifyWithPrimitives(referencePrimitives, a);
const nostrVerifier = (ev, ch) => verifyNostrEvent(ev, ch, { verifyEventFn: verifyEventRef });
const cfg = { chain: 'chipnet', challengeTtlSeconds: 300 };
const nowS = () => Math.floor(Date.now() / 1000);

async function setup() {
  const store = new SqliteStore(':memory:'); await store.init();
  const kp = bchKeypair(`wallet-${randomBytes(4).toString('hex')}`);
  const nsec = randomBytes(32).toString('hex'), npub = schnorrPubkey(nsec);
  const challenge = await createChallenge(store, { bchAddress: kp.address('bchtest'), nostrPubkey: npub }, cfg);
  const nostrTemplate = { kind: 30078, created_at: nowS(), tags: [['d', challenge.challengeId], ['keystone', 'identity-proof', 'v1'], ['alt', 'KEYSTONE proof']], content: challenge.message };
  return { store, kp, nsec, npub, challenge, nostrEvent: signNostrEvent(nostrTemplate, nsec), bchSignature: signBchMessage(kp, challenge.message) };
}
const submit = (s, over = {}) => verifyIdentityBinding({ store: s.store, challengeId: s.challenge.challengeId, challengeToken: s.challenge.challengeToken, bchSignature: s.bchSignature, nostrEvent: s.nostrEvent, bchVerifier, nostrVerifier, ...over });

test('Schnorr reference reproduces BIP340 test vector 0', () => {
  const sk = '0'.repeat(63) + '3';
  assert.equal(schnorrPubkey(sk), 'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9');
  const sig = 'e907831f80848d1069a5371b402410364bdf1c5f8307b0084c55f1ce2dca821525f66a4a85ea8b71e482a74f382d2ce5ebeee8fdb2172f477df4900d310536c0';
  assert.equal(schnorrSign(Buffer.alloc(32), sk), sig);
  assert.equal(schnorrVerify(sig, Buffer.alloc(32), schnorrPubkey(sk)), true);
});

test('full pipeline with real signatures: challenge → BCH+Nostr proofs → SQLite → registry event → relay stub → discovery → independent verification', async () => {
  const s = await setup();
  // binding
  const r = await submit(s); assert.equal(r.ok, true, r.error);
  assert.equal((await submit(s)).ok, false, 'replay of the same challenge is rejected');
  const saved = await s.store.getBinding(r.binding.id); assert.equal(saved.nostrPubkey, s.npub);
  // registry announcement, signed by the Nostr identity
  const bundle = saved.proofBundle;
  const regTemplate = { kind: 30078, created_at: nowS(), tags: [['d', `keystone-binding:${bundle.bindingId}`], ['t', 'keystone-binding'], ['alt', 'KEYSTONE binding']], content: JSON.stringify({ protocol: 'KEYSTONE-NOSTR-REGISTRY-v1', proofBundle: bundle }) };
  const regEvent = signNostrEvent(regTemplate, s.nsec);
  const proofVerifier = b => verifyProofBundle(b, { bchVerifier, nostrVerifier });
  const checked = await validateRegistryEvent(regEvent, { proofVerifier, signatureVerifier: verifyEventRef });
  assert.equal(checked.valid, true, checked.error);
  assert.equal((await s.store.putRegistryEvent(regEvent, checked.payload)).inserted, true);
  assert.equal((await s.store.listRegistryByPubkey(s.npub)).length, 1);
  // relay publish + discovery (STUB relay: protocol shape only)
  const relayStore = [];
  const pool = { publish: (urls, ev) => urls.map(() => { relayStore.push(ev); return Promise.resolve('ok'); }), querySync: async (_u, f) => relayStore.filter(e => f.authors.includes(e.pubkey)), close() {} };
  const pub = await publishToRelays(regEvent, ['wss://relay.test.invalid'], { poolFactory: () => pool });
  assert.equal(pub.ok, true);
  const forged = { ...regEvent, content: regEvent.content.replace('chipnet', 'mainnet') }; relayStore.push(forged); // hostile relay returns a tampered copy
  const found = await discoverFromRelays(s.npub, ['wss://relay.test.invalid'], { poolFactory: () => pool });
  const verdicts = []; for (const e of found.events) verdicts.push((await validateRegistryEvent(e, { proofVerifier, signatureVerifier: verifyEventRef })).valid);
  assert.deepEqual(verdicts, [true, false], 'good event accepted, tampered event rejected');
  // independent verification from the bundle alone — fresh data, no database
  const fresh = JSON.parse(JSON.stringify(checked.payload.proofBundle));
  assert.equal((await verifyProofBundle(fresh, { bchVerifier, nostrVerifier })).valid, true);
  const swapped = JSON.parse(JSON.stringify(fresh)); swapped.challenge.bchAddress = bchKeypair('someone-else').address('bchtest');
  assert.equal((await verifyProofBundle(swapped, { bchVerifier, nostrVerifier })).valid, false, 'bundle with a swapped BCH address fails');
});

test('invalid Nostr signature or someone else\'s BCH signature is rejected WITHOUT burning the challenge', async () => {
  const s = await setup();
  const badEvent = { ...s.nostrEvent, sig: (s.nostrEvent.sig[0] === 'a' ? 'b' : 'a') + s.nostrEvent.sig.slice(1) };
  assert.match((await submit(s, { nostrEvent: badEvent })).error, /Nostr/);
  const otherSig = signBchMessage(bchKeypair('attacker'), s.challenge.message);
  assert.match((await submit(s, { bchSignature: otherSig })).error, /BCH proof rejected/);
  assert.equal((await submit(s)).ok, true, 'legitimate submission still succeeds afterwards');
});
test('a Nostr event signed for a different challenge is rejected (cross-challenge replay)', async () => {
  const a = await setup(), b = await setup();
  const r = await submit(a, { nostrEvent: b.nostrEvent });
  assert.equal(r.ok, false);
});
test('BCH signature over a different challenge message is rejected', async () => {
  const a = await setup(); const b = await setup();
  assert.equal((await submit(a, { bchSignature: signBchMessage(a.kp, b.challenge.message) })).ok, false);
});
