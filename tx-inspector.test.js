import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectBchTransaction } from '../src/tx-inspector.js';

// Minimal valid legacy transaction: 1 input, 1 P2PKH output, locktime 0.
const tx = '01000000' + '01' + '11'.repeat(32) + '00000000' + '00' + 'ffffffff' + '01' + '1027000000000000' + '19' + '76a914' + '22'.repeat(20) + '88ac' + '00000000';
const prev = [{ txid: '11'.repeat(32), outputIndex: 0, valueSatoshis: 12000 }];

test('parses BCH transaction and computes txid/output details', () => {
  const r = inspectBchTransaction(tx);
  assert.equal(r.inputCount, 1);
  assert.equal(r.outputCount, 1);
  assert.equal(r.outputs[0].satoshis, 10000);
  assert.equal(r.outputs[0].scriptType, 'P2PKH');
  assert.match(r.txid, /^[0-9a-f]{64}$/);
  assert.equal(r.feeSatoshis, null);
});

test('calculates fee only when matching source outpoint amounts are supplied', () => {
  const r = inspectBchTransaction(tx, prev, 1);
  assert.equal(r.feeSatoshis, 2000);
  assert.equal(r.estimatedFeeSatoshis, tx.length / 2);
});

test('rejects malformed, truncated, trailing and invalid fee inputs', () => {
  assert.throws(() => inspectBchTransaction('xyz'), /hexadecimal/);
  assert.throws(() => inspectBchTransaction(tx.slice(0, -8)), /Truncated/);
  assert.throws(() => inspectBchTransaction(tx + '00'), /Trailing bytes/);
  assert.throws(() => inspectBchTransaction(tx, [], 0), /Fee rate/);
});

test('rejects output total greater than supplied inputs', () => {
  assert.throws(() => inspectBchTransaction(tx, [{ ...prev[0], valueSatoshis: 9000 }]), /exceed supplied input value/);
});
