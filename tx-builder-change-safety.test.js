import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildUnsignedBchTransaction } from '../src/tx-builder.js';

const P2PKH = '76a914' + '11'.repeat(20) + '88ac';
const P2PKH2 = '76a914' + '22'.repeat(20) + '88ac';

describe('tx-builder change-output safety', () => {
  it('rejects change without an explicit change script', () => {
    assert.throws(() => buildUnsignedBchTransaction({
      selectedUtxos: [{ txid: 'aa'.repeat(32), outputIndex: 0, valueSatoshis: 10_000, scriptPubKey: P2PKH }],
      destinationScriptPubKey: P2PKH2,
      amountSatoshis: 5_000,
      changeSatoshis: 4_000,
      feeSatoshis: 1_000
    }), /change script/i);
  });

  it('accepts explicit change script and balances correctly', () => {
    const result = buildUnsignedBchTransaction({
      selectedUtxos: [{ txid: 'aa'.repeat(32), outputIndex: 0, valueSatoshis: 10_000, scriptPubKey: P2PKH }],
      destinationScriptPubKey: P2PKH2,
      changeScriptPubKey: P2PKH,
      amountSatoshis: 5_000,
      changeSatoshis: 4_000,
      feeSatoshis: 1_000
    });
    assert.equal(result.signed, false);
    assert.equal(result.broadcast, false);
    assert.equal(result.changeSatoshis, 4_000);
    assert.equal(result.inputTotalSatoshis, 10_000);
    assert.ok(result.transactionHex.length > 0);
  });

  it('rejects dust destination amounts', () => {
    assert.throws(() => buildUnsignedBchTransaction({
      selectedUtxos: [{ txid: 'aa'.repeat(32), outputIndex: 0, valueSatoshis: 10_000, scriptPubKey: P2PKH }],
      destinationScriptPubKey: P2PKH2,
      amountSatoshis: 100,
      changeSatoshis: 0,
      feeSatoshis: 9_900
    }), /546/);
  });

  it('rejects unbalanced inputs/outputs/fees', () => {
    assert.throws(() => buildUnsignedBchTransaction({
      selectedUtxos: [{ txid: 'aa'.repeat(32), outputIndex: 0, valueSatoshis: 10_000, scriptPubKey: P2PKH }],
      destinationScriptPubKey: P2PKH2,
      amountSatoshis: 5_000,
      changeSatoshis: 0,
      feeSatoshis: 1_000
    }), /exactly equal/i);
  });
});
