import { config } from './config.js';

const SATOSHIS_PER_BCH = 100_000_000;
const MAX_MONEY_SAT = 2_100_000_000_000_000;
const CASHADDR_BY_CHAIN = { chipnet: /^bchtest:[qp][a-z0-9]{20,100}$/i, mainnet: /^bitcoincash:[qp][a-z0-9]{20,100}$/i };
const NODE_CHAIN_BY_KEYSTONE_CHAIN = { chipnet: new Set(['chipnet']), mainnet: new Set(['main']) };

/** Refuse UTXO discovery unless the connected node identifies the requested network. */
export async function assertBchNodeNetwork(rpc, chain) {
  if (typeof rpc !== 'function') throw new Error('A BCH Node RPC client is required.');
  const accepted = NODE_CHAIN_BY_KEYSTONE_CHAIN[chain];
  if (!accepted) throw new Error('Unsupported BCH network.');
  const info = await rpc('getblockchaininfo', []);
  if (!accepted.has(info?.chain)) {
    const expected = chain === 'mainnet' ? 'Mainnet (main)' : 'Chipnet (chipnet)';
    throw new Error(`Configured BCH node reports chain "${info?.chain || 'unknown'}", not ${expected}. No UTXOs were requested.`);
  }
  return { chain, nodeChain: info.chain };
}

export function validateBchAddressFormat(address, chain = config.chain) {
  const value = String(address || '').trim();
  const pattern = CASHADDR_BY_CHAIN[chain];
  if (!pattern || !pattern.test(value) || value !== value.toLowerCase()) throw new Error(`A lowercase ${chain} CashAddr is required.`);
  return value;
}

export function validateChipnetAddressFormat(address) {
  return validateBchAddressFormat(address, 'chipnet');
}

function amountToSatoshis(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0 || value > 21_000_000) throw new Error('Node returned an invalid BCH amount.');
  const satoshis = Math.round(value * SATOSHIS_PER_BCH);
  if (!Number.isSafeInteger(satoshis)) throw new Error('Node amount exceeds safe integer precision.');
  return satoshis;
}

export function createBchRpcClient({ url = config.bchRpcUrl, user = config.bchRpcUser, password = config.bchRpcPassword, fetchImpl = fetch } = {}) {
  if (!url || !user || !password) throw new Error('BCH Node RPC is not configured. Set BCH_RPC_URL, BCH_RPC_USER and BCH_RPC_PASSWORD.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new Error('BCH RPC must use HTTPS except for localhost.');
  }
  let sequence = 0;
  return async function rpc(method, params = []) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetchImpl(parsed, {
        method: 'POST', signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
        },
        body: JSON.stringify({ jsonrpc: '1.0', id: `keystone-${++sequence}`, method, params })
      });
      if (!response.ok) throw new Error(`BCH Node RPC returned HTTP ${response.status}.`);
      const data = await response.json();
      if (data.error) throw new Error(`BCH Node RPC error: ${data.error.message || 'request failed'}`);
      return data.result;
    } finally { clearTimeout(timer); }
  };
}

/** Lists wallet-known spendable outputs on the explicitly selected BCH network. */
export async function listBchUtxos(address, { rpc = createBchRpcClient(), chain = config.chain, minConfirmations = 1 } = {}) {
  const target = validateBchAddressFormat(address, chain);
  await assertBchNodeNetwork(rpc, chain);
  if (!Number.isInteger(minConfirmations) || minConfirmations < 0 || minConfirmations > 100_000) throw new Error('Invalid minimum confirmation count.');
  const validation = await rpc('validateaddress', [target]);
  if (!validation?.isvalid) throw new Error('The configured BCH node does not recognise this address on its network. Check that the node is connected to the selected BCH network.');
  const rows = await rpc('listunspent', [minConfirmations, 9_999_999, [target], true]);
  if (!Array.isArray(rows)) throw new Error('BCH Node returned an unexpected listunspent response.');
  return rows
    .filter(row => row && row.spendable === true && /^[0-9a-f]{64}$/i.test(row.txid || '') && Number.isInteger(row.vout) && row.vout >= 0)
    .map(row => ({
      txid: row.txid.toLowerCase(), outputIndex: row.vout,
      valueSatoshis: amountToSatoshis(row.amount),
      confirmations: Number.isInteger(row.confirmations) ? row.confirmations : 0,
      scriptPubKey: typeof row.scriptPubKey === 'string' ? row.scriptPubKey : '',
      address: target, safe: row.safe === true
    }))
    .filter(row => row.valueSatoshis > 0)
    .sort((a, b) => b.valueSatoshis - a.valueSatoshis)
    .slice(0, 500);
}

/** Estimates a BCH P2PKH payment plan. It selects inputs only; it does not build, sign or broadcast a transaction. */
export function planBchPayment(utxos, amountSatoshis, feeRateSatPerByte = 1) {
  if (!Array.isArray(utxos) || utxos.length === 0) throw new Error('No spendable UTXOs were supplied.');
  if (!Number.isSafeInteger(amountSatoshis) || amountSatoshis <= 0 || amountSatoshis > MAX_MONEY_SAT) throw new Error('Payment amount must be a positive integer number of satoshis.');
  if (!Number.isFinite(feeRateSatPerByte) || feeRateSatPerByte < 1 || feeRateSatPerByte > 100) throw new Error('Fee rate must be between 1 and 100 sat/byte.');
  const seen = new Set();
  const coins = utxos.map(item => {
    if (!item || !/^[0-9a-f]{64}$/i.test(String(item.txid || '')) || !Number.isInteger(item.outputIndex) || item.outputIndex < 0 || !Number.isSafeInteger(item.valueSatoshis) || item.valueSatoshis <= 0) throw new Error('Invalid UTXO supplied to payment planner.');
    const key = `${item.txid.toLowerCase()}:${item.outputIndex}`;
    if (seen.has(key)) throw new Error('Duplicate UTXO supplied to payment planner.');
    seen.add(key);
    return { txid: item.txid.toLowerCase(), outputIndex: item.outputIndex, valueSatoshis: item.valueSatoshis };
  }).sort((a, b) => b.valueSatoshis - a.valueSatoshis).slice(0, 100);

  const selected = []; let total = 0;
  for (const coin of coins) {
    selected.push(coin); total += coin.valueSatoshis;
    if (!Number.isSafeInteger(total)) throw new Error('Selected input total exceeds safe integer precision.');
    const oneOutputBytes = 10 + selected.length * 148 + 34;
    const oneOutputFee = Math.ceil(oneOutputBytes * feeRateSatPerByte);
    if (total < amountSatoshis + oneOutputFee) continue;
    const changeWithTwoOutputs = total - amountSatoshis - Math.ceil((oneOutputBytes + 34) * feeRateSatPerByte);
    if (changeWithTwoOutputs >= 546) {
      const estimatedBytes = oneOutputBytes + 34;
      const estimatedFeeSatoshis = Math.ceil(estimatedBytes * feeRateSatPerByte);
      return { selectedUtxos: selected, inputTotalSatoshis: total, amountSatoshis, changeSatoshis: total - amountSatoshis - estimatedFeeSatoshis, estimatedFeeSatoshis, estimatedBytes, feeRateSatPerByte, changeIncluded: true, broadcast: false, warning: 'Planning estimate only. UTXOs may change before signing; fee size assumes legacy P2PKH inputs/outputs. No transaction was built, signed or broadcast.' };
    }
    const actualFee = total - amountSatoshis;
    if (actualFee >= oneOutputFee && actualFee - oneOutputFee < 546) {
      return { selectedUtxos: selected, inputTotalSatoshis: total, amountSatoshis, changeSatoshis: 0, estimatedFeeSatoshis: actualFee, estimatedBytes: oneOutputBytes, feeRateSatPerByte, changeIncluded: false, broadcast: false, warning: 'The remainder is below the 546-satoshi change threshold and is included in the fee. Review this before signing.' };
    }
  }
  throw new Error('Insufficient funds for this amount plus the estimated network fee.');
}

// Backwards-compatible aliases for existing integrations.
export const planChipnetPayment = planBchPayment;
export const listChipnetUtxos = listBchUtxos;
