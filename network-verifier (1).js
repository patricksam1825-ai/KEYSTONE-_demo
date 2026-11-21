import { inspectBchTransaction } from './tx-inspector.js';

const HEX = /^[0-9a-f]+$/i;
const NODE_CHAIN = { chipnet: 'chipnet', mainnet: 'main' };

/** Read-only BCHN mempool preflight for the explicitly selected BCH network. Never broadcasts. */
export async function testBchMempoolAcceptance(transactionHex, { rpc, chain = 'chipnet' } = {}) {
  if (!Object.hasOwn(NODE_CHAIN, chain)) throw new Error('Unsupported BCH network.');
  if (typeof rpc !== 'function') throw new Error('A configured BCH Node RPC client is required.');
  const hex = String(transactionHex || '').trim();
  if (!hex || hex.length % 2 !== 0 || !HEX.test(hex) || hex.length > 2_000_000) throw new Error('Provide a valid raw transaction hex string (maximum 1 MB).');
  const parsed = inspectBchTransaction(hex);
  if (!parsed.inputs.length || parsed.inputs.some(input => input.scriptSigBytes === 0)) throw new Error('Transaction is unsigned: every input must contain an unlocking script.');
  const chainInfo = await rpc('getblockchaininfo', []);
  const expected = NODE_CHAIN[chain];
  if (chainInfo?.chain !== expected) throw new Error(`Configured BCH Node reports chain "${chainInfo?.chain || 'unknown'}", not ${chain === 'mainnet' ? 'Mainnet' : 'Chipnet'}. No transaction was submitted.`);
  const results = await rpc('testmempoolaccept', [[hex], false]);
  if (!Array.isArray(results) || results.length !== 1 || typeof results[0]?.allowed !== 'boolean') throw new Error('BCH Node returned an unexpected testmempoolaccept response.');
  const result = results[0];
  return {
    chain, txid: result.txid || parsed.txid, allowed: result.allowed,
    size: Number.isFinite(result.size) ? result.size : parsed.byteLength,
    virtualSize: Number.isFinite(result.vsize) ? result.vsize : null,
    feeBch: Number.isFinite(result.fees?.base) ? result.fees.base : null,
    rejectReason: result.allowed ? null : String(result['reject-reason'] || 'Node rejected transaction without a reason.'),
    rejectDetails: result.allowed ? null : (result['reject-details'] ? String(result['reject-details']) : null),
    submitted: false, broadcast: false,
    verification: 'BCH Node testmempoolaccept result; this checks current node consensus/policy and mempool conditions, not future confirmation.',
    warning: 'Read-only preflight. No transaction was broadcast or submitted to the network.'
  };
}

/** Backwards-compatible Chipnet entry point. */
export async function testChipnetMempoolAcceptance(transactionHex, options = {}) {
  return testBchMempoolAcceptance(transactionHex, { ...options, chain: 'chipnet' });
}
