import test from 'node:test';
import assert from 'node:assert/strict';
import { testChipnetMempoolAcceptance } from '../src/network-verifier.js';
import { buildUnsignedChipnetTransaction } from '../src/tx-builder.js';

const source = { txid: 'ab'.repeat(32), outputIndex: 1, valueSatoshis: 100_000, scriptPubKey: '76a914' + '11'.repeat(20) + '88ac' };
const unsigned = buildUnsignedChipnetTransaction({
  selectedUtxos: [source], destinationScriptPubKey: 'a914' + '22'.repeat(20) + '87', changeScriptPubKey: '76a914' + '33'.repeat(20) + '88ac',
  amountSatoshis: 40_000, changeSatoshis: 59_774, feeSatoshis: 226
}).transactionHex;
// Test fixture adds a minimal non-empty unlocking script; this is not a valid cryptographic signature.
const signedShape = unsigned.slice(0, 82) + '020101' + unsigned.slice(84);

test('rejects unsigned transactions before contacting node', async () => {
  let called = false;
  await assert.rejects(() => testChipnetMempoolAcceptance(unsigned, { rpc: async () => { called = true; } }), /unsigned/);
  assert.equal(called, false);
});

test('requires Chipnet chain and BCH node RPC', async () => {
  await assert.rejects(() => testChipnetMempoolAcceptance(signedShape, { rpc: async () => ({}), chain: 'mainnet' }), /not Chipnet/);
  await assert.rejects(() => testChipnetMempoolAcceptance(signedShape, { chain: 'chipnet' }), /RPC client/);
});

test('checks chain then invokes read-only testmempoolaccept and never broadcasts', async () => {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (method === 'getblockchaininfo') return { chain: 'chipnet' };
    if (method === 'testmempoolaccept') return [{ txid: 'cd'.repeat(32), allowed: true, size: 190, vsize: 190, fees: { base: 0.00000226 } }];
    throw new Error(`Unexpected RPC ${method}`);
  };
  const result = await testChipnetMempoolAcceptance(signedShape, { rpc });
  assert.deepEqual(calls.map(x => x.method), ['getblockchaininfo', 'testmempoolaccept']);
  assert.deepEqual(calls[1].params, [[signedShape], false]);
  assert.equal(result.allowed, true);
  assert.equal(result.broadcast, false);
  assert.equal(result.submitted, false);
  assert.equal(result.size, 190);
});

test('stops if the configured node is not on Chipnet', async () => {
  const calls = [];
  const rpc = async method => { calls.push(method); return { chain: 'main' }; };
  await assert.rejects(() => testChipnetMempoolAcceptance(signedShape, { rpc }), /not Chipnet/);
  assert.deepEqual(calls, ['getblockchaininfo']);
});

test('returns node rejection reason without treating it as success', async () => {
  const rpc = async method => method === 'getblockchaininfo'
    ? { chain: 'chipnet' }
    : [{ txid: 'ef'.repeat(32), allowed: false, 'reject-reason': 'missing-inputs' }];
  const result = await testChipnetMempoolAcceptance(signedShape, { rpc });
  assert.equal(result.allowed, false);
  assert.equal(result.rejectReason, 'missing-inputs');
  assert.equal(result.broadcast, false);
});

test('supports Mainnet read-only mempool preflight only against a Mainnet node', async () => {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (method === 'getblockchaininfo') return { chain: 'main' };
    if (method === 'testmempoolaccept') return [{ txid: 'cd'.repeat(32), allowed: true, size: 190, vsize: 190, fees: { base: 0.00000226 } }];
    throw new Error(`Unexpected RPC ${method}`);
  };
  const { testBchMempoolAcceptance } = await import('../src/network-verifier.js');
  const result = await testBchMempoolAcceptance(signedShape, { rpc, chain: 'mainnet' });
  assert.equal(result.chain, 'mainnet');
  assert.equal(result.allowed, true);
  assert.equal(result.broadcast, false);
  assert.deepEqual(calls.map(call => call.method), ['getblockchaininfo', 'testmempoolaccept']);
});

test('Mainnet preflight refuses a Chipnet node', async () => {
  const { testBchMempoolAcceptance } = await import('../src/network-verifier.js');
  await assert.rejects(() => testBchMempoolAcceptance(signedShape, { rpc: async () => ({ chain: 'chipnet' }), chain: 'mainnet' }), /not Mainnet/);
});
