import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUnsignedChipnetTransaction } from '../src/tx-builder.js';

const txid = 'ab'.repeat(32);
const sourceScript = '76a914' + '11'.repeat(20) + '88ac';
const destScript = 'a914' + '22'.repeat(20) + '87';
const changeScript = '76a914' + '33'.repeat(20) + '88ac';
const input = { txid, outputIndex: 1, valueSatoshis: 100_000, scriptPubKey: sourceScript };

 test('serializes unsigned legacy transaction with destination and change outputs', () => {
  const result = buildUnsignedChipnetTransaction({ selectedUtxos: [input], destinationScriptPubKey: destScript, amountSatoshis: 40_000, changeSatoshis: 59_774, feeSatoshis: 226, changeScriptPubKey: changeScript });
  assert.equal(result.signed, false); assert.equal(result.broadcast, false);
  assert.equal(result.inputCount, 1); assert.equal(result.outputCount, 2);
  assert.equal(result.transactionHex.slice(0, 8), '02000000');
  assert.equal(result.transactionHex.includes('' + '00'.repeat(1)), true);
  assert.equal(result.transactionHex.length % 2, 0);
  assert.match(result.unsignedTransactionHash, /^[0-9a-f]{64}$/);
});

test('change without an explicit wallet-derived change script is refused (never reuse the source script)', () => {
  assert.throws(() => buildUnsignedChipnetTransaction({ selectedUtxos: [input], destinationScriptPubKey: destScript, amountSatoshis: 40_000, changeSatoshis: 59_774, feeSatoshis: 226 }), /explicit wallet-derived change script/);
});

test('rejects malformed scripts, duplicate inputs and invalid amounts', () => {
  assert.throws(() => buildUnsignedChipnetTransaction({ selectedUtxos: [input], destinationScriptPubKey: '76a914', amountSatoshis: 40_000, changeSatoshis: 59_774, feeSatoshis: 226 }), /locking script/);
  assert.throws(() => buildUnsignedChipnetTransaction({ selectedUtxos: [input, input], destinationScriptPubKey: destScript, amountSatoshis: 40_000, changeSatoshis: 159_774, feeSatoshis: 226 }), /Duplicate/);
  assert.throws(() => buildUnsignedChipnetTransaction({ selectedUtxos: [input], destinationScriptPubKey: destScript, amountSatoshis: 1, changeSatoshis: 99_773, feeSatoshis: 226 }), /at least 546/);
  assert.throws(() => buildUnsignedChipnetTransaction({ selectedUtxos: [input], destinationScriptPubKey: destScript, amountSatoshis: 40_000, changeSatoshis: 59_773, feeSatoshis: 226 }), /exactly equal/);
});

test('accepts P2SH and validates locktime bounds', () => {
  const result = buildUnsignedChipnetTransaction({ selectedUtxos: [input], destinationScriptPubKey: destScript, amountSatoshis: 99_000, feeSatoshis: 1_000, lockTime: 500 });
  assert.equal(result.outputCount, 1);
  assert.throws(() => buildUnsignedChipnetTransaction({ selectedUtxos: [input], destinationScriptPubKey: destScript, amountSatoshis: 99_000, feeSatoshis: 1_000, lockTime: -1 }), /locktime/);
});
