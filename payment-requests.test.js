import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs/promises';
import { JsonStore } from '../src/store.js';
import { createPaymentRequest, isPaymentRequestActive } from '../src/payments.js';

const address = 'bchtest:qz0testaddressplaceholder000000000000000000000000000';
const pubkey = 'b'.repeat(64);
async function setup() {
  const dir = await fs.mkdtemp(`${os.tmpdir()}/keystone-pay-`);
  const store = new JsonStore(dir); await store.init();
  await store.putBinding({ id: '11111111-1111-4111-8111-111111111111', chain: 'chipnet', bchAddress: address, nostrPubkey: pubkey, verification: { bch: true, nostr: true } });
  return { dir, store };
}

test('creates and persists a Chipnet request for a verified recipient', async () => {
  const { dir, store } = await setup();
  try {
    const request = await createPaymentRequest(store, { bindingId: '11111111-1111-4111-8111-111111111111', amountSatoshis: 25000, memo: 'Test invoice', expiresInSeconds: 900 }, 1000);
    assert.equal(request.amountBch, '0.00025');
    assert.match(request.uri, /^bchtest:q/); assert.equal(request.uri.includes('bitcoincash:'), false, 'no doubled scheme');
    assert.equal(request.chain, 'chipnet');
    assert.equal(request.status, 'open');
    assert.equal((await store.getPaymentRequest(request.id)).id, request.id);
    assert.equal(isPaymentRequestActive(request, 1001), true);
    assert.equal(isPaymentRequestActive(request, request.expiresAt), false);
    assert.match(request.warning, /does not sign, broadcast, or move funds/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('rejects payment requests for unverified or missing bindings', async () => {
  const { dir, store } = await setup();
  try {
    await assert.rejects(() => createPaymentRequest(store, { bindingId: '22222222-2222-4222-8222-222222222222', amountSatoshis: 10 }), /existing binding/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('rejects invalid amounts and excessive memo or expiry', async () => {
  const { dir, store } = await setup();
  const base = { bindingId: '11111111-1111-4111-8111-111111111111' };
  try {
    await assert.rejects(() => createPaymentRequest(store, { ...base, amountSatoshis: 1.5 }), /whole number/);
    await assert.rejects(() => createPaymentRequest(store, { ...base, amountSatoshis: 1, memo: 'x'.repeat(121) }), /120 characters/);
    await assert.rejects(() => createPaymentRequest(store, { ...base, amountSatoshis: 1, expiresInSeconds: 5 }), /between 60 seconds/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('rejects a Mainnet binding when the server runs on Chipnet', async () => {
  const { dir, store } = await setup();
  try {
    await store.putBinding({ id: '33333333-3333-4333-8333-333333333333', chain: 'mainnet', bchAddress: 'bitcoincash:qz0test', nostrPubkey: pubkey, verification: { bch: true, nostr: true } });
    await assert.rejects(() => createPaymentRequest(store, { bindingId: '33333333-3333-4333-8333-333333333333', amountSatoshis: 1 }), /runs on chipnet/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('mainnet server: request URI uses the bitcoincash: address scheme once, mainnet warning shown', async () => {
  const { dir, store } = await setup();
  try {
    await store.putBinding({ id: '44444444-4444-4444-8444-444444444444', chain: 'mainnet', bchAddress: 'bitcoincash:qz0test', nostrPubkey: pubkey, verification: { bch: true, nostr: true } });
    const r = await createPaymentRequest(store, { bindingId: '44444444-4444-4444-8444-444444444444', amountSatoshis: 10000 }, 1000, { chain: 'mainnet', maxSatoshis: 1_000_000 });
    assert.match(r.uri, /^bitcoincash:qz0test\?amount=0\.0001/); assert.equal(r.uri.startsWith('bitcoincash:bitcoincash:'), false);
    assert.equal(r.chain, 'mainnet'); assert.match(r.warning, /MAINNET.*real money/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('mainnet server rejects a Chipnet binding and enforces the per-request safety cap', async () => {
  const { dir, store } = await setup();
  try {
    await assert.rejects(() => createPaymentRequest(store, { bindingId: '11111111-1111-4111-8111-111111111111', amountSatoshis: 1 }, 1000, { chain: 'mainnet' }), /runs on mainnet/);
    await store.putBinding({ id: '55555555-5555-4555-8555-555555555555', chain: 'mainnet', bchAddress: 'bitcoincash:qz0test', nostrPubkey: pubkey, verification: { bch: true, nostr: true } });
    await assert.rejects(() => createPaymentRequest(store, { bindingId: '55555555-5555-4555-8555-555555555555', amountSatoshis: 1_000_001 }, 1000, { chain: 'mainnet', maxSatoshis: 1_000_000 }), /safety limit/);
    assert.ok(await createPaymentRequest(store, { bindingId: '55555555-5555-4555-8555-555555555555', amountSatoshis: 1_000_000 }, 1000, { chain: 'mainnet', maxSatoshis: 1_000_000 }));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
