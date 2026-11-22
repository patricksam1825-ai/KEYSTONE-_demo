const TXID = /^[0-9a-f]{64}$/i;

/** Read-only transaction status lookup. Never broadcasts or modifies a transaction. */
export async function getBchTransactionStatus(txid, { rpc, chain = 'chipnet' } = {}) {
  if (!['chipnet', 'mainnet'].includes(chain)) throw new Error('Unsupported BCH network.');
  if (typeof rpc !== 'function') throw new Error('A configured BCH Node RPC client is required.');
  const id = String(txid || '').trim().toLowerCase();
  if (!TXID.test(id)) throw new Error('A 64-character hexadecimal transaction ID is required.');

  let transaction;
  try {
    transaction = await rpc('getrawtransaction', [id, true]);
  } catch (error) {
    // Bitcoin-derived nodes commonly use -5 for an unknown transaction.
    if (error?.code === -5 || /-5.*(not|found)|not found/i.test(error?.message || '')) {
      return { txid: id, chain, status: 'not-found', confirmations: 0, confirmed: false };
    }
    throw error;
  }
  if (!transaction || transaction.txid?.toLowerCase() !== id) {
    throw new Error('BCH Node returned transaction data that does not match the requested transaction ID.');
  }
  const confirmations = Number(transaction.confirmations ?? 0);
  if (!Number.isSafeInteger(confirmations) || confirmations < 0) {
    throw new Error('BCH Node returned an invalid confirmation count.');
  }
  const result = {
    txid: id,
    chain,
    status: confirmations > 0 ? 'confirmed' : 'in-mempool-or-unconfirmed',
    confirmations,
    confirmed: confirmations > 0,
    blockHash: typeof transaction.blockhash === 'string' ? transaction.blockhash : null,
    blockTime: Number.isSafeInteger(transaction.blocktime) ? transaction.blocktime : null,
    firstSeenTime: Number.isSafeInteger(transaction.time) ? transaction.time : null
  };
  if (result.blockHash) {
    try {
      const header = await rpc('getblockheader', [result.blockHash, true]);
      if (Number.isSafeInteger(header?.height) && header.height >= 0) result.blockHeight = header.height;
    } catch {
      // Status remains useful if optional block metadata is unavailable.
    }
  }
  return result;
}

export const getChipnetTransactionStatus = getBchTransactionStatus;
