import { createHash } from 'node:crypto';

const MAX_MONEY_SAT = 2_100_000_000_000_000;
const DUST_SAT = 546;
const P2PKH = /^76a914[0-9a-f]{40}88ac$/i;
const P2SH = /^a914[0-9a-f]{40}87$/i;

function checkedScript(value, label) {
  if (typeof value !== 'string' || value.length % 2 || !/^[0-9a-f]+$/i.test(value)) throw new Error(`${label} locking script is missing or malformed.`);
  const script = value.toLowerCase();
  if (!P2PKH.test(script) && !P2SH.test(script)) throw new Error(`${label} must be a standard P2PKH or P2SH locking script in this release.`);
  return Buffer.from(script, 'hex');
}
function uint32LE(value) { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; }
function uint64LE(value) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; }
function varInt(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid transaction vector length.');
  if (value < 0xfd) return Buffer.from([value]);
  if (value <= 0xffff) { const b = Buffer.alloc(3); b[0] = 0xfd; b.writeUInt16LE(value, 1); return b; }
  const b = Buffer.alloc(5); b[0] = 0xfe; b.writeUInt32LE(value, 1); return b;
}
function varBytes(buffer) { return Buffer.concat([varInt(buffer.length), buffer]); }
function sha256d(buffer) { return createHash('sha256').update(createHash('sha256').update(buffer).digest()).digest('hex'); }

/** Builds an unsigned legacy BCH transaction skeleton. It never signs or broadcasts. */
export function buildUnsignedBchTransaction({ selectedUtxos, destinationScriptPubKey, changeScriptPubKey, amountSatoshis, changeSatoshis = 0, feeSatoshis, lockTime = 0 }) {
  if (!Array.isArray(selectedUtxos) || selectedUtxos.length < 1 || selectedUtxos.length > 100) throw new Error('Transaction requires between 1 and 100 selected inputs.');
  if (!Number.isSafeInteger(amountSatoshis) || amountSatoshis < DUST_SAT || amountSatoshis > MAX_MONEY_SAT) throw new Error('Destination amount must be an integer of at least 546 satoshis.');
  if (!Number.isSafeInteger(changeSatoshis) || changeSatoshis < 0 || (changeSatoshis > 0 && changeSatoshis < DUST_SAT)) throw new Error('Change must be zero or at least 546 satoshis.');
  if (!Number.isSafeInteger(feeSatoshis) || feeSatoshis < 1 || feeSatoshis > MAX_MONEY_SAT) throw new Error('Invalid transaction fee.');
  if (!Number.isInteger(lockTime) || lockTime < 0 || lockTime > 0xffffffff) throw new Error('Invalid transaction locktime.');
  const destinationScript = checkedScript(destinationScriptPubKey, 'Destination');
  const seen = new Set(); let inputTotal = 0;
  const inputs = selectedUtxos.map((utxo) => {
    if (!utxo || !/^[0-9a-f]{64}$/i.test(utxo.txid || '') || !Number.isInteger(utxo.outputIndex) || utxo.outputIndex < 0 || utxo.outputIndex > 0xffffffff || !Number.isSafeInteger(utxo.valueSatoshis) || utxo.valueSatoshis <= 0) throw new Error('Malformed selected UTXO.');
    const key = `${utxo.txid.toLowerCase()}:${utxo.outputIndex}`;
    if (seen.has(key)) throw new Error('Duplicate transaction input.');
    seen.add(key);
    const script = checkedScript(utxo.scriptPubKey, 'Source UTXO');
    inputTotal += utxo.valueSatoshis;
    if (!Number.isSafeInteger(inputTotal)) throw new Error('Input total exceeds safe integer precision.');
    return { txid: utxo.txid.toLowerCase(), vout: utxo.outputIndex, script };
  });
  const outputTotal = amountSatoshis + changeSatoshis;
  if (!Number.isSafeInteger(outputTotal) || inputTotal !== outputTotal + feeSatoshis) throw new Error('Input total must exactly equal destination amount, change and fee.');
  const outputs = [{ value: amountSatoshis, script: destinationScript }];
  if (changeSatoshis > 0) {
    if (!changeScriptPubKey) throw new Error('An explicit wallet-derived change script is required when the transaction has change. Source scripts must never be reused as an assumed change address.');
    const changeScript = checkedScript(changeScriptPubKey, 'Change');
    outputs.push({ value: changeSatoshis, script: changeScript });
  }
  const parts = [uint32LE(2), varInt(inputs.length)];
  for (const input of inputs) parts.push(Buffer.from(input.txid, 'hex').reverse(), uint32LE(input.vout), varInt(0), uint32LE(0xffffffff));
  parts.push(varInt(outputs.length));
  for (const output of outputs) parts.push(uint64LE(output.value), varBytes(output.script));
  parts.push(uint32LE(lockTime));
  const raw = Buffer.concat(parts);
  return {
    transactionHex: raw.toString('hex'), unsignedTransactionHash: sha256d(raw),
    inputCount: inputs.length, outputCount: outputs.length, inputTotalSatoshis: inputTotal,
    destinationSatoshis: amountSatoshis, changeSatoshis, feeSatoshis,
    signed: false, broadcast: false,
    warning: 'Unsigned BCH transaction skeleton only. Input scriptSigs are empty; the final txid and size will change after wallet signing. Recheck UTXOs, destination and fee in the wallet before signing. Nothing was broadcast.'
  };
}

export const buildUnsignedChipnetTransaction = buildUnsignedBchTransaction;
