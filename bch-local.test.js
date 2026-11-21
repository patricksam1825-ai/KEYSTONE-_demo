import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { referencePrimitives, encodeCashAddrP2pkh, hash160 as refHash160, mul, serializePub } from './helpers/secp-ref.js';
import { bitcoinMessageHash, parseCompactSignature, verifyWithPrimitives, verifyBchMessageLocal, isLocalBchVerifierAvailable } from '../src/bch-local.js';

// NOTE: the first group below tests KEYSTONE's own parsing/format/network logic using injected
// primitives. It is NOT cryptographic evidence. The libauth group at the bottom is the real check
// and is SKIPPED (not passed) when libauth is not installed.

test('message hash is sha256d over magic-prefixed, varint-length message', () => {
  const m = 'hello';
  const payload = Buffer.concat([Buffer.from([24]), Buffer.from('Bitcoin Signed Message:\n'), Buffer.from([5]), Buffer.from(m)]);
  const expected = createHash('sha256').update(createHash('sha256').update(payload).digest()).digest('hex');
  assert.equal(Buffer.from(bitcoinMessageHash(m)).toString('hex'), expected);
});
test('long messages use the 0xfd varint form', () => {
  assert.equal(bitcoinMessageHash('x'.repeat(300)).length, 32);
});
const sigB64 = (header, fill = 7) => Buffer.concat([Buffer.from([header]), Buffer.alloc(64, fill)]).toString('base64');
test('signature parser accepts only 65-byte base64 with header 27..34', () => {
  assert.deepEqual({ ...parseCompactSignature(sigB64(31)), signature: undefined }, { signature: undefined, recoveryId: 0, compressed: true });
  assert.equal(parseCompactSignature(sigB64(27)).compressed, false);
  assert.equal(parseCompactSignature(sigB64(34)).recoveryId, 3);
  for (const bad of [sigB64(26), sigB64(35), '', 'abc', null, undefined, 123, Buffer.alloc(64).toString('base64'), sigB64(31) + 'A', sigB64(31).slice(0, -2) + 'B=']) assert.equal(parseCompactSignature(bad), null);
});
const payload = new Uint8Array(20).fill(9);
const prims = (over = {}) => ({
  decodeCashAddress: () => ({ prefix: 'bchtest', type: 0, payload }),
  recover: () => new Uint8Array([2, ...new Uint8Array(32)]),
  hash160: () => payload,
  ...over
});
const args = { address: 'bchtest:qqq', signature: sigB64(31), message: 'm' };
test('logic: accepts when recovered key hash equals address payload', () => assert.equal(verifyWithPrimitives(prims(), args), true));
test('logic: rejects different key hash', () => assert.equal(verifyWithPrimitives(prims({ hash160: () => new Uint8Array(20).fill(1) }), args), false));

test('logic: accepts P2PKH token-aware CashAddr types and rejects P2SH variants', () => {
  assert.equal(verifyWithPrimitives(prims({ decodeCashAddress: () => ({ prefix: 'bchtest', type: 'p2pkhWithTokens', payload }) }), args), true);
  assert.equal(verifyWithPrimitives(prims({ decodeCashAddress: () => ({ prefix: 'bchtest', type: 'p2shWithTokens', payload }) }), args), false);
});

test('logic: rejects failed recovery, bad address, wrong prefix, script-hash address, malformed signature', () => {
  assert.equal(verifyWithPrimitives(prims({ recover: () => null }), args), false);
  assert.equal(verifyWithPrimitives(prims({ decodeCashAddress: () => 'bad checksum' }), args), false);
  assert.equal(verifyWithPrimitives(prims({ decodeCashAddress: () => ({ prefix: 'evil', type: 0, payload }) }), args), false);
  assert.equal(verifyWithPrimitives(prims({ decodeCashAddress: () => ({ prefix: 'bchtest', type: 1, payload }) }), args), false);
  assert.equal(verifyWithPrimitives(prims(), { ...args, signature: 'nope' }), false);
});



test('logic: rejects mixed-case, whitespace, non-string messages and malformed recovered keys', () => {
  assert.equal(verifyWithPrimitives(prims(), { ...args, address: 'bchtest:Qqq' }), false);
  assert.equal(verifyWithPrimitives(prims(), { ...args, address: ' bchtest:qqq' }), false);
  assert.equal(verifyWithPrimitives(prims(), { ...args, message: 123 }), false);
  assert.equal(verifyWithPrimitives(prims({ recover: () => new Uint8Array([2, 1, 2]) }), args), false);
  assert.equal(verifyWithPrimitives(prims({ recover: () => new Uint8Array([4, ...new Uint8Array(32)]) }), args), false);
  assert.equal(verifyWithPrimitives(prims({ decodeCashAddress: () => { throw new Error('bad address'); } }), args), false);
});

test('logic: explicit chain rejects a CashAddr from the other network', () => {
  const networkPrimitives = {
    decodeCashAddress: address => ({ prefix: String(address).split(':')[0], type: 0, payload }),
    recover: () => new Uint8Array([2, ...new Uint8Array(32)]),
    hash160: () => payload
  };
  const chipnet = { address: 'bchtest:qqq', signature: sigB64(31), message: 'm' };
  const mainnet = { ...chipnet, address: 'bitcoincash:qqq' };
  assert.equal(verifyWithPrimitives(networkPrimitives, { ...chipnet, chain: 'chipnet' }), true);
  assert.equal(verifyWithPrimitives(networkPrimitives, { ...chipnet, chain: 'mainnet' }), false);
  assert.equal(verifyWithPrimitives(networkPrimitives, { ...mainnet, chain: 'mainnet' }), true);
  assert.equal(verifyWithPrimitives(networkPrimitives, { ...mainnet, chain: 'chipnet' }), false);
  assert.equal(verifyWithPrimitives(networkPrimitives, { ...chipnet, chain: 'unknown' }), false);
});


const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/bch-signed-messages.json', import.meta.url), 'utf8'));
const flipChar = str => str.slice(0, 20) + (str[20] === 'A' ? 'B' : 'A') + str.slice(21);

// ---- REAL cryptography, always runs: KEYSTONE's verifier logic + independent BigInt secp256k1 recovery.
for (const f of fixtures) {
  test(`REAL crypto (reference maths): ${f.name} verifies`, () => assert.equal(verifyWithPrimitives(referencePrimitives, f), true));
  test(`REAL crypto (reference maths): ${f.name} rejects altered message, altered signature and another address`, () => {
    assert.equal(verifyWithPrimitives(referencePrimitives, { ...f, message: f.message + ' ' }), false);
    assert.equal(verifyWithPrimitives(referencePrimitives, { ...f, signature: flipChar(f.signature) }), false);
    const other = encodeCashAddrP2pkh(f.address.startsWith('bchtest') ? 'bchtest' : 'bitcoincash', refHash160(serializePub(mul(12345n), true)));
    assert.equal(verifyWithPrimitives(referencePrimitives, { ...f, address: other }), false);
  });
}
test('REAL crypto: wrong compression flag in header does not verify', () => {
  const f = fixtures[0]; const raw = Buffer.from(f.signature, 'base64'); raw[0] -= 4; // compressed -> uncompressed flag
  assert.equal(verifyWithPrimitives(referencePrimitives, { ...f, signature: raw.toString('base64') }), false);
});
test('REAL crypto: P2SH address (type 1), bad checksum and unknown prefix are rejected', () => {
  const f = fixtures[0]; const h = refHash160(serializePub(mul(7n), true));
  assert.equal(verifyWithPrimitives(referencePrimitives, { ...f, address: encodeCashAddrP2pkh('bchtest', h, 0x08) }), false);
  assert.equal(verifyWithPrimitives(referencePrimitives, { ...f, address: f.address.slice(0, -1) + (f.address.endsWith('q') ? 'p' : 'q') }), false);
  assert.equal(verifyWithPrimitives(referencePrimitives, { ...f, address: encodeCashAddrP2pkh('ectest', h) }), false);
});
test('REAL crypto: CashAddr encoder matches the published spec vector', () => {
  assert.equal(encodeCashAddrP2pkh('bitcoincash', Buffer.from('76a04053bda0a88bda5177b86a15c3b29f559873', 'hex')), 'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a');
});

// ---- libauth: the production verifier. SKIPPED (never "passed") when libauth is not installed.
const libauthPresent = await isLocalBchVerifierAvailable();
const skipMsg = libauthPresent ? false : 'libauth not installed: production verifier NOT run';
test('libauth: local verifier is installed and recognised', { skip: skipMsg }, () => assert.equal(libauthPresent, true));
for (const f of fixtures) {
  test(`libauth (production verifier): ${f.name} verifies; tampering fails`, { skip: skipMsg }, async () => {
    assert.equal(await verifyBchMessageLocal(f), true);
    assert.equal(await verifyBchMessageLocal({ ...f, message: f.message + ' ' }), false);
    assert.equal(await verifyBchMessageLocal({ ...f, signature: flipChar(f.signature) }), false);
  });
}
test('libauth: P2SH address, wrong prefix and bad checksum are rejected', { skip: skipMsg }, async () => {
  const f = fixtures[0]; const h = refHash160(serializePub(mul(7n), true));
  assert.equal(await verifyBchMessageLocal({ ...f, address: encodeCashAddrP2pkh('bchtest', h, 0x08) }), false);
  assert.equal(await verifyBchMessageLocal({ ...f, address: f.address.slice(0, -1) + (f.address.endsWith('q') ? 'p' : 'q') }), false);
  assert.equal(await verifyBchMessageLocal({ ...f, address: encodeCashAddrP2pkh('ectest', h) }), false);
});
