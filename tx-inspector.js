import { createHash } from 'node:crypto';

const HEX = /^[0-9a-f]+$/i;
const MAX_TX_BYTES = 1_000_000;

function readVarInt(buf, state) {
  if (state.i >= buf.length) throw new Error('Unexpected end of transaction while reading CompactSize.');
  const first = buf[state.i++];
  if (first < 0xfd) return first;
  const size = first === 0xfd ? 2 : first === 0xfe ? 4 : 8;
  if (state.i + size > buf.length) throw new Error('Truncated CompactSize value.');
  let value;
  if (size === 2) value = buf.readUInt16LE(state.i);
  else if (size === 4) value = buf.readUInt32LE(state.i);
  else {
    const n = buf.readBigUInt64LE(state.i);
    if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Transaction count exceeds safe parser limits.');
    value = Number(n);
  }
  state.i += size;
  if ((size === 2 && value < 0xfd) || (size === 4 && value <= 0xffff) || (size === 8 && value <= 0xffffffff)) throw new Error('Non-canonical CompactSize encoding.');
  return value;
}
function take(buf, state, length, label) {
  if (!Number.isSafeInteger(length) || length < 0 || state.i + length > buf.length) throw new Error(`Truncated transaction ${label}.`);
  const out = buf.subarray(state.i, state.i + length); state.i += length; return out;
}
function scriptType(script) {
  const h = script.toString('hex');
  if (/^76a914[0-9a-f]{40}88ac$/.test(h)) return 'P2PKH';
  if (/^a914[0-9a-f]{40}87$/.test(h)) return 'P2SH';
  if (h.startsWith('6a')) return 'OP_RETURN';
  if (/^0014[0-9a-f]{40}$/.test(h) || /^0020[0-9a-f]{64}$/.test(h)) return 'Witness-like (not standard BCH)';
  return 'Unknown';
}

/** Parse and inspect a serialized legacy BCH transaction. Does not sign or broadcast. */
export function inspectBchTransaction(transactionHex, sourceOutputs = [], feeRateSatPerByte = null) {
  const hex = String(transactionHex || '').trim();
  if (!hex || hex.length % 2 || !HEX.test(hex)) throw new Error('Transaction must be even-length hexadecimal.');
  if (hex.length / 2 > MAX_TX_BYTES) throw new Error('Transaction exceeds the 1 MB inspection limit.');
  const buf = Buffer.from(hex, 'hex');
  const state = { i: 0 };
  if (buf.length < 10) throw new Error('Transaction is too short.');
  const version = buf.readInt32LE(state.i); state.i += 4;
  const inputCount = readVarInt(buf, state);
  if (inputCount < 1 || inputCount > 1000) throw new Error('Transaction must contain 1–1000 inputs.');
  const inputs = [];
  const seenOutpoints = new Set();
  for (let n = 0; n < inputCount; n++) {
    const txidLE = take(buf, state, 32, 'input outpoint');
    const outputIndex = take(buf, state, 4, 'input output index').readUInt32LE(0);
    const outpointKey = `${Buffer.from(txidLE).reverse().toString('hex')}:${outputIndex}`;
    if (seenOutpoints.has(outpointKey)) throw new Error('Duplicate transaction input outpoint detected.');
    seenOutpoints.add(outpointKey);
    const scriptLength = readVarInt(buf, state);
    const scriptSig = take(buf, state, scriptLength, 'input script');
    const sequence = take(buf, state, 4, 'input sequence').readUInt32LE(0);
    inputs.push({ txid: Buffer.from(txidLE).reverse().toString('hex'), outputIndex, scriptSigBytes: scriptSig.length, sequence });
  }
  const outputCount = readVarInt(buf, state);
  if (outputCount < 1 || outputCount > 1000) throw new Error('Transaction must contain 1–1000 outputs.');
  const outputs = []; let outputTotal = 0;
  for (let n = 0; n < outputCount; n++) {
    const value = take(buf, state, 8, 'output amount').readBigUInt64LE(0);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Output amount exceeds safe integer range.');
    const satoshis = Number(value);
    const scriptLength = readVarInt(buf, state);
    const script = take(buf, state, scriptLength, 'output locking script');
    outputTotal += satoshis;
    if (!Number.isSafeInteger(outputTotal)) throw new Error('Output total exceeds safe integer range.');
    outputs.push({ index: n, satoshis, bch: (satoshis / 100_000_000).toFixed(8), scriptType: scriptType(script), lockingBytecode: script.toString('hex') });
  }
  const locktime = take(buf, state, 4, 'locktime').readUInt32LE(0);
  if (state.i !== buf.length) throw new Error('Trailing bytes detected after transaction locktime.');
  const txid = createHash('sha256').update(createHash('sha256').update(buf).digest()).digest().reverse().toString('hex');
  const byteLength = buf.length;
  let inputTotal = null, feeSatoshis = null, feeRate = null, feeError = null;
  if (Array.isArray(sourceOutputs) && sourceOutputs.length) {
    const byOutpoint = new Map();
    for (const item of sourceOutputs) {
      if (!item || !/^[0-9a-f]{64}$/i.test(String(item.txid || '')) || !Number.isSafeInteger(item.outputIndex) || !Number.isSafeInteger(item.valueSatoshis) || item.valueSatoshis < 0) throw new Error('Each source output needs txid, outputIndex and non-negative integer valueSatoshis.');
      const key = `${item.txid.toLowerCase()}:${item.outputIndex}`;
      if (byOutpoint.has(key)) throw new Error('Duplicate source output supplied.');
      byOutpoint.set(key, item.valueSatoshis);
    }
    inputTotal = 0;
    for (const input of inputs) {
      const key = `${input.txid}:${input.outputIndex}`;
      if (!byOutpoint.has(key)) { feeError = `Missing trusted source amount for ${key}.`; inputTotal = null; break; }
      inputTotal += byOutpoint.get(key);
    }
    if (inputTotal !== null) {
      if (outputTotal > inputTotal) throw new Error('Transaction outputs exceed supplied input value (negative fee).');
      feeSatoshis = inputTotal - outputTotal;
      feeRate = feeSatoshis / byteLength;
    }
  }
  let estimatedFee = null;
  if (feeRateSatPerByte !== null && feeRateSatPerByte !== '') {
    const rate = Number(feeRateSatPerByte);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 1000) throw new Error('Fee rate must be greater than 0 and no more than 1000 sat/byte.');
    estimatedFee = Math.ceil(byteLength * rate);
  }
  return {
    network: 'network-neutral transaction inspection', txid, version, locktime, byteLength,
    inputCount, outputCount, inputs, outputs, outputTotalSatoshis: outputTotal,
    outputTotalBch: (outputTotal / 100_000_000).toFixed(8),
    feeSatoshis, actualFeeRateSatPerByte: feeRate === null ? null : Number(feeRate.toFixed(4)),
    sourceOutputError: feeError, estimatedFeeSatoshis: estimatedFee,
    warning: 'Inspection only. This parser does not validate BCH consensus rules, script execution, UTXO existence, mempool acceptance or transaction confirmation. Do not rely on user-supplied source amounts as proof of funds.'
  };
}
