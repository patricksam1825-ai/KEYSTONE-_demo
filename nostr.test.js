import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyNostrEvent } from '../src/nostr.js';

const now = Date.now();
const challenge = {
  id: 'challenge-123',
  nostrPubkey: 'a'.repeat(64),
  message: 'KEYSTONE IDENTITY BINDING\nNonce: example',
  createdAt: now - 10_000,
  expiresAt: now + 290_000
};
function event(overrides = {}) {
  return {
    id: 'b'.repeat(64),
    pubkey: challenge.nostrPubkey,
    kind: 30078,
    created_at: Math.floor(now / 1000),
    tags: [
      ['d', challenge.id],
      ['keystone', 'identity-proof', 'v1'],
      ['alt', 'KEYSTONE ownership proof']
    ],
    content: challenge.message,
    sig: 'c'.repeat(128),
    ...overrides
  };
}

test('accepts a correctly structured KEYSTONE kind-30078 proof when signature verifier accepts it', async () => {
  const result = await verifyNostrEvent(event(), challenge, { verifyEventFn: () => true });
  assert.deepEqual(result, { valid: true });
});

test('rejects an event with a different public key', async () => {
  const result = await verifyNostrEvent(event({ pubkey: 'd'.repeat(64) }), challenge, { verifyEventFn: () => true });
  assert.match(result.reason, /public key/);
});

test('rejects missing challenge d-tag', async () => {
  const result = await verifyNostrEvent(event({ tags: [['keystone', 'identity-proof', 'v1']] }), challenge, { verifyEventFn: () => true });
  assert.match(result.reason, /d-tag/);
});

test('rejects missing KEYSTONE identity-proof tag', async () => {
  const result = await verifyNostrEvent(event({ tags: [['d', challenge.id]] }), challenge, { verifyEventFn: () => true });
  assert.match(result.reason, /identity-proof tag/);
});

test('rejects content, kind and timestamp mismatches', async () => {
  assert.match((await verifyNostrEvent(event({ content: 'different' }), challenge, { verifyEventFn: () => true })).reason, /content/);
  assert.match((await verifyNostrEvent(event({ kind: 1 }), challenge, { verifyEventFn: () => true })).reason, /kind 30078/);
  assert.match((await verifyNostrEvent(event({ created_at: 1 }), challenge, { verifyEventFn: () => true })).reason, /timestamp/);
});

test('rejects event when cryptographic signature verifier fails', async () => {
  const result = await verifyNostrEvent(event(), challenge, { verifyEventFn: () => false });
  assert.match(result.reason, /signature is invalid/);
});
