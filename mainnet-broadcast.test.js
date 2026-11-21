import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUnsignedBchTransaction } from '../src/tx-builder.js';
import { inspectBchTransaction } from '../src/tx-inspector.js';
import { broadcastMainnetTransaction } from '../src/mainnet-broadcast.js';

const source = { txid: 'ab'.repeat(32), outputIndex: 0, valueSatoshis: 10_000, scriptPubKey: '76a914' + '11'.repeat(20) + '88ac' };
const unsigned = buildUnsignedBchTransaction({
  selectedUtxos: [source], destinationScriptPubKey: '76a914' + '22'.repeat(20) + '88ac',
  amountSatoshis: 9_000, feeSatoshis: 1_000
}).transactionHex;
// Minimal non-empty scriptSig for the broadcast guard tests; node preflight remains the
// authoritative script/consensus validator in production.
const signed = unsigned.slice(0, 82) + '020101' + unsigned.slice(84);
const txid = inspectBchTransaction(signed).txid;
const phrase = 'BROADCAST THIS BCH MAINNET TRANSACTION';

function mockRpc({ chain = 'main', allowed = true, sentTxid = txid } = {}) {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push(method);
    if (method === 'getblockchaininfo') return { chain };
    if (method === 'testmempoolaccept') return [{ allowed, ...(allowed ? {} : { 'reject-reason': 'test rejection' }) }];
    if (method === 'sendrawtransaction') return sentTxid;
    throw new Error(`Unexpected RPC method ${method}`);
  };
  return { rpc, calls };
}

test('broadcast requires explicit exact confirmation and matching network', async () => {
  const { rpc, calls } = mockRpc();
  await assert.rejects(() => broadcastMainnetTransaction(signed, { rpc, confirmation: 'yes', expectedTxid: txid }), /Explicit confirmation/);
  await assert.rejects(() => broadcastMainnetTransaction(signed, { rpc, confirmation: 'BROADCAST THIS BCH CHIPNET TRANSACTION', expectedTxid: txid, chain: 'chipnet' }), /not chipnet/);
  assert.deepEqual(calls, ['getblockchaininfo']);
});

test('broadcast refuses unsigned transactions and mismatched expected txids', async () => {
  const { rpc, calls } = mockRpc();
  await assert.rejects(() => broadcastMainnetTransaction(unsigned, { rpc, confirmation: phrase, expectedTxid: txid }), /unsigned/);
  await assert.rejects(() => broadcastMainnetTransaction(signed, { rpc, confirmation: phrase, expectedTxid: '00'.repeat(32) }), /does not match/);
  assert.deepEqual(calls, []);
});

test('broadcast stops when node preflight rejects the transaction', async () => {
  const { rpc, calls } = mockRpc({ allowed: false });
  await assert.rejects(() => broadcastMainnetTransaction(signed, { rpc, confirmation: phrase, expectedTxid: txid }), /Mainnet preflight rejected/);
  assert.deepEqual(calls, ['getblockchaininfo', 'testmempoolaccept']);
});

test('broadcast verifies the node-returned txid matches the submitted transaction', async () => {
  const { rpc, calls } = mockRpc({ sentTxid: 'ff'.repeat(32) });
  await assert.rejects(() => broadcastMainnetTransaction(signed, { rpc, confirmation: phrase, expectedTxid: txid }), /does not match the signed transaction/);
  assert.deepEqual(calls, ['getblockchaininfo', 'testmempoolaccept', 'sendrawtransaction']);
});

test('successful broadcast returns the exact submitted txid and selected network', async () => {
  const { rpc } = mockRpc();
  const result = await broadcastMainnetTransaction(signed, { rpc, confirmation: phrase, expectedTxid: txid });
  assert.equal(result.broadcast, true);
  assert.equal(result.chain, 'mainnet');
  assert.equal(result.txid, txid);
});
