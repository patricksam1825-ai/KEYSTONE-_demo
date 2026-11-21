import test from 'node:test';
import assert from 'node:assert/strict';
import { getChipnetTransactionStatus } from '../src/tx-status.js';
const txid = 'a'.repeat(64);

test('rejects malformed transaction IDs before RPC', async () => {
  let called = false;
  await assert.rejects(() => getChipnetTransactionStatus('bad', { rpc: async () => { called = true; } }), /64-character/);
  assert.equal(called, false);
});

test('supports Mainnet status lookups', async () => {
  const result = await getChipnetTransactionStatus(txid, { chain: 'mainnet', rpc: async () => ({ txid, confirmations: 2 }) });
  assert.equal(result.chain, 'mainnet');
  assert.equal(result.confirmed, true);
});

test('reports unknown transactions without claiming confirmation', async () => {
  const result = await getChipnetTransactionStatus(txid, { rpc: async () => { const e = new Error('RPC error -5: not found'); throw e; } });
  assert.equal(result.status, 'not-found');
  assert.equal(result.confirmed, false);
});

test('reports mempool/unconfirmed transaction', async () => {
  const result = await getChipnetTransactionStatus(txid, { rpc: async () => ({ txid, confirmations: 0 }) });
  assert.equal(result.status, 'in-mempool-or-unconfirmed');
  assert.equal(result.confirmations, 0);
});

test('reports confirmations and optional block metadata', async () => {
  const calls = [];
  const result = await getChipnetTransactionStatus(txid, { rpc: async (method, params) => {
    calls.push(method);
    if (method === 'getrawtransaction') return { txid, confirmations: 7, blockhash: 'b'.repeat(64), blocktime: 1700000000 };
    if (method === 'getblockheader') return { height: 12345 };
    throw new Error('unexpected method');
  }});
  assert.equal(result.status, 'confirmed');
  assert.equal(result.confirmations, 7);
  assert.equal(result.blockHeight, 12345);
  assert.deepEqual(calls, ['getrawtransaction', 'getblockheader']);
});

test('rejects mismatched node transaction response', async () => {
  await assert.rejects(() => getChipnetTransactionStatus(txid, { rpc: async () => ({ txid: 'c'.repeat(64), confirmations: 2 }) }), /does not match/);
});
