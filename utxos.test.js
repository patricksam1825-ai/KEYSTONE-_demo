import test from 'node:test';
import assert from 'node:assert/strict';
import { createBchRpcClient, listChipnetUtxos, planChipnetPayment } from '../src/utxos.js';

const address = 'bchtest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
const txid = 'ab'.repeat(32);

test('RPC client rejects non-HTTPS remote endpoints', () => {
  assert.throws(() => createBchRpcClient({ url: 'http://example.com', user: 'u', password: 'p' }), /HTTPS/);
});

test('UTXO discovery validates Chipnet address and maps node amounts', async () => {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (method === 'getblockchaininfo') return { chain: 'chipnet' };
    if (method === 'validateaddress') return { isvalid: true };
    if (method === 'listunspent') return [
      { txid, vout: 1, amount: 0.0002, confirmations: 4, spendable: true, safe: true, scriptPubKey: '76a914' },
      { txid, vout: 2, amount: 0.0001, confirmations: 0, spendable: false }
    ];
    throw new Error('unexpected method');
  };
  const rows = await listChipnetUtxos(address, { rpc, chain: 'chipnet', minConfirmations: 1 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].valueSatoshis, 20_000);
  assert.deepEqual(calls.map(c => c.method), ['getblockchaininfo', 'validateaddress', 'listunspent']);
});

test('UTXO discovery rejects non-Chipnet address or wrong configured chain', async () => {
  await assert.rejects(() => listChipnetUtxos('bitcoincash:qqqq', { rpc: async () => ({}), chain: 'chipnet' }), /lowercase chipnet CashAddr/);
  await assert.rejects(() => listChipnetUtxos(address, { rpc: async () => ({}), chain: 'mainnet' }), /lowercase mainnet CashAddr/);
  // A node on the wrong network is refused before any UTXO is requested.
  await assert.rejects(() => listChipnetUtxos(address, { rpc: async method => (method === 'getblockchaininfo' ? { chain: 'main' } : { isvalid: true }), chain: 'chipnet' }), /not Chipnet/);
  await assert.rejects(() => listChipnetUtxos(address, { rpc: async method => (method === 'getblockchaininfo' ? { chain: 'chipnet' } : { isvalid: false }), chain: 'chipnet' }), /does not recognise/);
});

test('payment planner selects sufficient UTXOs and estimates P2PKH fee/change', () => {
  const plan = planChipnetPayment([
    { txid, outputIndex: 0, valueSatoshis: 100_000 },
    { txid: 'cd'.repeat(32), outputIndex: 1, valueSatoshis: 50_000 }
  ], 40_000, 1);
  assert.equal(plan.inputTotalSatoshis, 100_000);
  assert.equal(plan.selectedUtxos.length, 1);
  assert.equal(plan.estimatedFeeSatoshis, 226);
  assert.equal(plan.changeSatoshis, 59_774);
  assert.equal(plan.broadcast, false);
});

test('payment planner rejects duplicate, malformed and insufficient UTXOs', () => {
  assert.throws(() => planChipnetPayment([{ txid, outputIndex: 0, valueSatoshis: 1000 }, { txid, outputIndex: 0, valueSatoshis: 1000 }], 100, 1), /Duplicate/);
  assert.throws(() => planChipnetPayment([{ txid, outputIndex: 0, valueSatoshis: 1000 }], 1000, 1), /Insufficient/);
  assert.throws(() => planChipnetPayment([], 100, 1), /No spendable/);
  assert.throws(() => planChipnetPayment([{ txid, outputIndex: 0, valueSatoshis: 1000 }], 100, 0), /Fee rate/);
});
