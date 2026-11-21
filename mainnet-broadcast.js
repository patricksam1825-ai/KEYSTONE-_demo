import { inspectBchTransaction } from './tx-inspector.js';

const HEX = /^[0-9a-f]+$/i;
const CONFIRMATIONS = { mainnet: 'BROADCAST THIS BCH MAINNET TRANSACTION', chipnet: 'BROADCAST THIS BCH CHIPNET TRANSACTION' };
const NODE_CHAINS = { mainnet: 'main', chipnet: 'chipnet' };

/** Guarded network-specific BCH broadcast. Requires exact confirmation and a node on the selected network. */
export async function broadcastMainnetTransaction(transactionHex, {
  rpc,
  chain = 'mainnet',
  confirmation,
  expectedTxid
} = {}) {
  if (!Object.hasOwn(NODE_CHAINS, chain)) throw new Error('Unsupported BCH network.');
  if (typeof rpc !== 'function') throw new Error('A configured BCH Node RPC client is required.');
  if (confirmation !== CONFIRMATIONS[chain]) throw new Error(`Explicit confirmation required: ${CONFIRMATIONS[chain]}`);
  const hex = String(transactionHex || '').trim();
  if (!hex || hex.length % 2 || !HEX.test(hex) || hex.length > 2_000_000) throw new Error('Provide valid signed raw transaction hex (maximum 1 MB).');
  const inspected = inspectBchTransaction(hex);
  if (!inspected.inputs.length || inspected.inputs.some(input => input.scriptSigBytes === 0)) throw new Error('Transaction is unsigned. No transaction was broadcast.');
  if (expectedTxid !== inspected.txid) throw new Error('Transaction ID confirmation does not match this exact transaction.');
  const info = await rpc('getblockchaininfo', []);
  if (info?.chain !== NODE_CHAINS[chain]) throw new Error(`Configured BCH node reports chain "${info?.chain || 'unknown'}", not ${chain}. Nothing was broadcast.`);
  const preflight = await rpc('testmempoolaccept', [[hex]]);
  if (!Array.isArray(preflight) || !preflight[0]?.allowed) {
    const reason = preflight?.[0]?.['reject-reason'] || 'Node did not accept transaction in preflight.';
    throw new Error(`${chain === 'mainnet' ? 'Mainnet' : 'Chipnet'} preflight rejected transaction: ${reason}. Nothing was broadcast.`);
  }
  const txid = await rpc('sendrawtransaction', [hex]);
  if (typeof txid !== 'string' || !/^[0-9a-f]{64}$/i.test(txid)) throw new Error('BCH node returned an invalid transaction ID after broadcast.');
  if (txid.toLowerCase() !== inspected.txid.toLowerCase()) throw new Error('BCH node returned a transaction ID that does not match the signed transaction submitted. Check node logs before retrying.');
  return { chain, broadcast: true, txid, preflight: 'accepted', warning: chain === 'mainnet' ? 'A real BCH Mainnet transaction was submitted. Funds may be spent and the transaction cannot normally be reversed.' : 'A BCH Chipnet transaction was submitted; Chipnet coins have no Mainnet value.' };
}
