import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRegistryEvent } from '../src/registry.js';

const pubkey = 'a'.repeat(64);
const bindingId = '22222222-2222-4222-8222-222222222222';
const event = () => ({
  id: 'b'.repeat(64), pubkey, kind: 30078, created_at: 1_800_000_000,
  tags: [['t', 'keystone-binding'], ['d', `keystone-binding:${bindingId}`]],
  content: JSON.stringify({ protocol: 'KEYSTONE-NOSTR-REGISTRY-v1', proofBundle: { bindingId, challenge: { nostrPubkey: pubkey } } }),
  sig: 'c'.repeat(128)
});
const opts = { nowSeconds: 1_800_000_000, signatureVerifier: () => true, proofVerifier: async () => ({ valid: true }) };

test('accepts a structurally sound signed registry event with a valid proof', async () => {
  const result = await validateRegistryEvent(event(), opts);
  assert.equal(result.valid, true);
});

test('rejects malformed event public keys before cryptographic verification', async () => {
  const input = event(); input.pubkey = 'not-a-pubkey';
  const result = await validateRegistryEvent(input, opts);
  assert.equal(result.valid, false); assert.match(result.error, /public key is malformed/);
});

test('rejects future-dated registry events', async () => {
  const input = event(); input.created_at = opts.nowSeconds + 61;
  const result = await validateRegistryEvent(input, opts);
  assert.equal(result.valid, false); assert.match(result.error, /timestamp/);
});

test('rejects duplicate binding d-tags', async () => {
  const input = event(); input.tags.push(['d', `keystone-binding:${bindingId}`]);
  const result = await validateRegistryEvent(input, opts);
  assert.equal(result.valid, false); assert.match(result.error, /ambiguous/);
});

test('rejects oversized registry payloads', async () => {
  const input = event(); input.content = 'x'.repeat(1_000_001);
  const result = await validateRegistryEvent(input, opts);
  assert.equal(result.valid, false); assert.match(result.error, /1 MB/);
});

test('rejects malformed tag structures', async () => {
  const input = event(); input.tags = [['t', 123]];
  const result = await validateRegistryEvent(input, opts);
  assert.equal(result.valid, false); assert.match(result.error, /tags are malformed/);
});


test('rejects duplicate KEYSTONE discovery topic tags', async () => {
  const input = event(); input.tags.push(['t', 'keystone-binding']);
  const result = await validateRegistryEvent(input, opts);
  assert.equal(result.valid, false); assert.match(result.error, /ambiguous keystone-binding/);
});


test('rejects KEYSTONE discovery topic tags with extra ambiguous fields', async () => {
  const input = event(); input.tags[0].push('unexpected-scope');
  const result = await validateRegistryEvent(input, opts);
  assert.equal(result.valid, false); assert.match(result.error, /discovery tag/);
});

test('rejects canonical binding d-tags with extra fields', async () => {
  const input = event(); input.tags[1].push('unexpected-scope');
  const result = await validateRegistryEvent(input, opts);
  assert.equal(result.valid, false); assert.match(result.error, /binding d-tag/);
});
