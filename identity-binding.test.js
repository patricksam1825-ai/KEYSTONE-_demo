import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs/promises';
import { JsonStore } from '../src/store.js';
import { createChallenge } from '../src/challenges.js';
import { verifyIdentityBinding } from '../src/identity.js';

const config = { chain: 'chipnet', challengeTtlSeconds: 300 };
const address = 'bchtest:qz0testaddressplaceholder000000000000000000000000000';
const pubkey = 'a'.repeat(64);
async function setup() {
  const dir = await fs.mkdtemp(`${os.tmpdir()}/keystone-identity-`);
  const store = new JsonStore(dir);
  await store.init();
  return { dir, store };
}

async function makeChallenge(store) {
  return createChallenge(store, { bchAddress: address, nostrPubkey: pubkey }, config);
}

const validNostr = { pubkey, kind: 30078, content: 'signed challenge', tags: [], created_at: Math.floor(Date.now() / 1000), id: 'x', sig: 'y' };

test('invalid Nostr proof does not consume a valid challenge', async () => {
  const { dir, store } = await setup();
  try {
    const c = await makeChallenge(store);
    const result = await verifyIdentityBinding({
      store, challengeId: c.challengeId, challengeToken: c.challengeToken,
      bchSignature: 'signature', nostrEvent: validNostr,
      nostrVerifier: async () => ({ valid: false, reason: 'bad signature' }),
      bchVerifier: async () => true
    });
    assert.equal(result.ok, false);
    const saved = await store.getChallenge(c.challengeId);
    assert.equal(saved.consumedAt, null);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('invalid BCH proof does not consume a valid challenge', async () => {
  const { dir, store } = await setup();
  try {
    const c = await makeChallenge(store);
    const result = await verifyIdentityBinding({
      store, challengeId: c.challengeId, challengeToken: c.challengeToken,
      bchSignature: 'bad-signature', nostrEvent: validNostr,
      nostrVerifier: async () => ({ valid: true }),
      bchVerifier: async () => false
    });
    assert.equal(result.ok, false);
    const saved = await store.getChallenge(c.challengeId);
    assert.equal(saved.consumedAt, null);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('two concurrent valid identity submissions can create only one binding', async () => {
  const { dir, store } = await setup();
  try {
    const c = await makeChallenge(store);
    const args = {
      store, challengeId: c.challengeId, challengeToken: c.challengeToken,
      bchSignature: 'valid-signature', nostrEvent: validNostr,
      nostrVerifier: async () => ({ valid: true }),
      bchVerifier: async () => true
    };
    const results = await Promise.all([verifyIdentityBinding(args), verifyIdentityBinding(args)]);
    assert.equal(results.filter(result => result.ok).length, 1);
    assert.equal(results.filter(result => !result.ok).length, 1);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
