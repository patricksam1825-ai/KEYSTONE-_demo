import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertBchNodeNetwork, validateBchAddressFormat } from '../src/utxos.js';

describe('network handshake and address validation', () => {
  it('accepts matching mainnet node chain', async () => {
    const rpc = async (method) => {
      if (method === 'getblockchaininfo') return { chain: 'main' };
      throw new Error('unexpected method');
    };
    const result = await assertBchNodeNetwork(rpc, 'mainnet');
    assert.equal(result.nodeChain, 'main');
  });

  it('rejects chipnet node when mainnet is selected', async () => {
    const rpc = async () => ({ chain: 'chipnet' });
    await assert.rejects(() => assertBchNodeNetwork(rpc, 'mainnet'), /not Mainnet/i);
  });

  it('rejects mainnet node when chipnet is selected', async () => {
    const rpc = async () => ({ chain: 'main' });
    await assert.rejects(() => assertBchNodeNetwork(rpc, 'chipnet'), /not Chipnet/i);
  });

  it('validates CashAddr prefixes by network', () => {
    assert.throws(() => validateBchAddressFormat('bchtest:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq', 'mainnet'), /mainnet CashAddr/i);
    assert.throws(() => validateBchAddressFormat('bitcoincash:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq', 'chipnet'), /chipnet CashAddr/i);
  });
});
