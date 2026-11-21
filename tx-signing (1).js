import { createHash, createECDH, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { inspectBchTransaction } from './tx-inspector.js';
const HEX = /^[0-9a-f]+$/i;
const PATHS = new Set(['receive', 'change', 'defi']);


function hash160(bytes) {
  return createHash('ripemd160').update(createHash('sha256').update(bytes).digest()).digest('hex');
}
function readPushes(scriptHex) {
  const script = Buffer.from(scriptHex, 'hex');
  const pushes = []; let i = 0;
  while (i < script.length) {
    const opcode = script[i++]; let length;
    if (opcode >= 1 && opcode <= 75) length = opcode;
    else if (opcode === 0x4c) { if (i >= script.length) throw new Error('Truncated PUSHDATA1 in unlocking script.'); length = script[i++]; }
    else if (opcode === 0x4d) { if (i + 2 > script.length) throw new Error('Truncated PUSHDATA2 in unlocking script.'); length = script.readUInt16LE(i); i += 2; }
    else throw new Error('Unlocking script must contain only direct data pushes (P2PKH).');
    if (length < 1 || i + length > script.length) throw new Error('Malformed data push in unlocking script.');
    pushes.push(script.subarray(i, i + length)); i += length;
    if (pushes.length > 2) throw new Error('P2PKH unlocking script must contain exactly two pushes.');
  }
  if (pushes.length !== 2) throw new Error('P2PKH unlocking script must contain a signature and public key.');
  return pushes;
}
function isStrictDerSignature(signatureWithType) {
  if (signatureWithType.length < 9 || signatureWithType.length > 73) return false;
  const hashType = signatureWithType.at(-1);
  if (![0x41,0x42,0x43,0xc1,0xc2,0xc3].includes(hashType)) return false; // BCH FORKID only.
  const der = signatureWithType.subarray(0, -1);
  if (der[0] !== 0x30 || der[1] !== der.length - 2 || der[2] !== 0x02) return false;
  const rLength = der[3];
  if (!rLength || 4 + rLength + 2 > der.length) return false;
  const r = der.subarray(4, 4 + rLength);
  const sTag = 4 + rLength;
  if (der[sTag] !== 0x02) return false;
  const sLength = der[sTag + 1];
  if (!sLength || sTag + 2 + sLength !== der.length) return false;
  const s = der.subarray(sTag + 2);
  const canonicalInteger = (v) => !(v[0] & 0x80) && !(v.length > 1 && v[0] === 0 && !(v[1] & 0x80));
  return canonicalInteger(r) && canonicalInteger(s);
}
/** Validate standard P2PKH unlocking-script shape and bind its public key to the trusted prevout. */
export function inspectP2pkhUnlockingScripts(transactionHex, sourceOutputs) {
  const parsed = inspectBchTransaction(transactionHex, sourceOutputs);
  const byOutpoint = new Map(sourceOutputs.map(o => [`${o.txid.toLowerCase()}:${o.outputIndex}`, o]));
  const checked = [];
  for (let inputPosition = 0; inputPosition < parsed.inputs.length; inputPosition++) {
    const input = parsed.inputs[inputPosition];
    const prevout = byOutpoint.get(`${input.txid}:${input.outputIndex}`);
    const locking = String(prevout?.lockingBytecode || prevout?.scriptPubKey || '').toLowerCase();
    if (!/^76a914[0-9a-f]{40}88ac$/.test(locking)) throw new Error('Cryptographic script inspection currently supports standard P2PKH prevouts only.');
    const inputScript = extractInputScript(transactionHex, inputPosition);
    const [signature, publicKey] = readPushes(inputScript);
    if (!isStrictDerSignature(signature)) throw new Error(`Input ${input.outputIndex} has a malformed DER signature or unsupported BCH FORKID hash type.`);
    if (!((publicKey.length === 33 && [2,3].includes(publicKey[0])) || (publicKey.length === 65 && publicKey[0] === 4))) throw new Error(`Input ${input.outputIndex} has an invalid SEC public-key encoding.`);
    if (hash160(publicKey).toLowerCase() !== locking.slice(6, 46)) throw new Error(`Input ${input.outputIndex} public key does not match the trusted P2PKH prevout.`);
    checked.push({ inputIndex: input.outputIndex, publicKeyHashMatched: true, derEncodingValid: true, forkIdHashType: signature.at(-1) });
  }
  return checked;
}
function extractInputScript(transactionHex, target) {
  const b = Buffer.from(transactionHex, 'hex'); let i = 4;
  const readVar = () => { const n = b[i++]; if (n < 0xfd) return n; const size = n === 0xfd ? 2 : n === 0xfe ? 4 : 8; let v; if (size===2) v=b.readUInt16LE(i); else if(size===4) v=b.readUInt32LE(i); else { const x=b.readBigUInt64LE(i); if(x>BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Input script length exceeds parser limits.'); v=Number(x); } i+=size; return v; };
  const count=readVar();
  for(let n=0;n<count;n++) { i+=36; const len=readVar(); if(n===target) return b.subarray(i,i+len).toString('hex'); i+=len+4; }
  throw new Error('Unable to locate transaction input script.');
}


function sha256d(bytes) {
  return createHash('sha256').update(createHash('sha256').update(bytes).digest()).digest();
}
function u32le(value) { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0); return b; }
function u64le(value) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; }
function compactSize(value) {
  if (value < 0xfd) return Buffer.from([value]);
  if (value <= 0xffff) { const b=Buffer.alloc(3); b[0]=0xfd; b.writeUInt16LE(value,1); return b; }
  if (value <= 0xffffffff) { const b=Buffer.alloc(5); b[0]=0xfe; b.writeUInt32LE(value,1); return b; }
  throw new Error('Script length exceeds supported CompactSize range.');
}
function parseRawInputsOutputs(transactionHex) {
  const b=Buffer.from(transactionHex,'hex'); let i=4;
  const readVar=()=>{ if(i>=b.length) throw new Error('Truncated transaction.'); const n=b[i++]; if(n<0xfd)return n; const size=n===0xfd?2:n===0xfe?4:8; if(i+size>b.length)throw new Error('Truncated CompactSize.'); let v; if(size===2)v=b.readUInt16LE(i); else if(size===4)v=b.readUInt32LE(i); else { const x=b.readBigUInt64LE(i); if(x>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('CompactSize exceeds parser limits.'); v=Number(x); } i+=size; return v; };
  const inputCount=readVar(), inputs=[];
  for(let n=0;n<inputCount;n++){ const start=i; const outpoint=b.subarray(i,i+36); i+=36; const sl=readVar(); i+=sl; const sequence=b.subarray(i,i+4); i+=4; inputs.push({outpoint,sequence}); }
  const outputCount=readVar(), outputs=[];
  for(let n=0;n<outputCount;n++){ const start=i; const value=b.subarray(i,i+8); i+=8; const sl=readVar(); const script=b.subarray(i,i+sl); i+=sl; outputs.push(Buffer.concat([value,compactSize(sl),script])); }
  return {version:b.subarray(0,4),inputs,outputs,locktime:b.subarray(i,i+4)};
}
function forkIdDigest(transactionHex, inputIndex, prevout, hashType) {
  const tx=parseRawInputsOutputs(transactionHex);
  const baseType=hashType & 0x1f, anyoneCanPay=(hashType & 0x80)!==0;
  if (![1,2,3].includes(baseType) || (hashType & 0x40)===0) throw new Error('Only BCH FORKID ALL/NONE/SINGLE sighash modes are supported.');
  const input=tx.inputs[inputIndex];
  if (!input) throw new Error('Signature input index is out of range.');
  const zero=Buffer.alloc(32);
  const hashPrevouts=anyoneCanPay?zero:sha256d(Buffer.concat(tx.inputs.map(x=>x.outpoint)));
  const hashSequence=(anyoneCanPay || baseType===2 || baseType===3)?zero:sha256d(Buffer.concat(tx.inputs.map(x=>x.sequence)));
  let hashOutputs=zero;
  if(baseType===1) hashOutputs=sha256d(Buffer.concat(tx.outputs));
  else if(baseType===3 && inputIndex<tx.outputs.length) hashOutputs=sha256d(tx.outputs[inputIndex]);
  const scriptCode=Buffer.from(prevout.lockingBytecode || prevout.scriptPubKey,'hex');
  const preimage=Buffer.concat([
    tx.version, hashPrevouts, hashSequence, input.outpoint,
    compactSize(scriptCode.length), scriptCode, u64le(prevout.valueSatoshis),
    input.sequence, hashOutputs, tx.locktime, u32le(hashType)
  ]);
  return sha256d(preimage);
}
/** Exposed for deterministic signing fixtures and independent digest auditing. */
export function calculateBchForkIdDigest(transactionHex, inputIndex, prevout, hashType) {
  return forkIdDigest(transactionHex, inputIndex, prevout, hashType);
}

function secp256k1PublicKeyObject(secPublicKey) {
  // Normalize compressed or uncompressed SEC1 points using OpenSSL's secp256k1 implementation.
  const ecdh = createECDH('secp256k1');
  ecdh.setPublicKey(Buffer.from(secPublicKey));
  const uncompressed = ecdh.getPublicKey(null, 'uncompressed');
  // SubjectPublicKeyInfo: id-ecPublicKey + secp256k1 OID + uncompressed SEC1 point.
  const prefix = Buffer.from('3056301006072a8648ce3d020106052b8104000a034200', 'hex');
  return createPublicKey({ key: Buffer.concat([prefix, uncompressed]), format: 'der', type: 'spki' });
}

/** Cryptographically verify each standard P2PKH BCH FORKID signature using trusted prevout data. */
export async function verifySignedTransactionCryptographically(unsignedHex, signedHex, sourceOutputs) {
  const structural=verifySignedTransaction(unsignedHex,signedHex,sourceOutputs);
  const parsed=inspectBchTransaction(signedHex);
  const byOutpoint=new Map(sourceOutputs.map(o=>[`${o.txid.toLowerCase()}:${o.outputIndex}`,o]));
  const scripts=extractAllInputScripts(signedHex);
  const checks=[];
  for(let i=0;i<parsed.inputs.length;i++){
    const input=parsed.inputs[i], prevout=byOutpoint.get(`${input.txid}:${input.outputIndex}`);
    const [signatureWithType,publicKey]=readPushes(scripts[i]);
    const hashType=signatureWithType.at(-1);
    const digest=forkIdDigest(signedHex,i,prevout,hashType);
    let valid = false;
    try { valid = cryptoVerify(null, digest, secp256k1PublicKeyObject(publicKey), signatureWithType.subarray(0, -1)); } catch { valid = false; }
    if(!valid) throw new Error(`Input ${i} ECDSA signature verification failed.`);
    checks.push({inputIndex:i,ecdsaSignatureValid:true,hashType,digestHex:digest.toString('hex')});
  }
  return {...structural,cryptographicSignatureChecks:checks,cryptographicVerification:'passed',verificationBackend:'Node.js crypto/OpenSSL secp256k1',warning:'ECDSA signatures were verified against BCH FORKID digests and supplied prevout data. This is not a complete BCH consensus/script interpreter and does not prove UTXO availability or mempool acceptance.'};
}
function extractAllInputScripts(transactionHex) {
  const b=Buffer.from(transactionHex,'hex'); let i=4;
  const readVar=()=>{const n=b[i++]; if(n<0xfd)return n; const size=n===0xfd?2:n===0xfe?4:8; let v; if(size===2)v=b.readUInt16LE(i); else if(size===4)v=b.readUInt32LE(i); else {const x=b.readBigUInt64LE(i); if(x>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Script length exceeds parser limits.');v=Number(x);} i+=size;return v;};
  const count=readVar(), scripts=[];
  for(let n=0;n<count;n++){i+=36;const len=readVar();scripts.push(b.subarray(i,i+len));i+=len+4;}
  return scripts;
}

/** Validate an unsigned BCH transaction for the explicitly selected network. */
export function createBchSignRequest(input, chain = 'chipnet') {
  if (!['chipnet', 'mainnet'].includes(chain)) throw new Error('Unsupported BCH network.');
  const transactionHex = String(input?.transactionHex || '').trim();
  if (!transactionHex || transactionHex.length % 2 !== 0 || !HEX.test(transactionHex) || transactionHex.length > 2_000_000) throw new Error('Unsigned transaction must be valid even-length hexadecimal (maximum 1 MB).');
  const sourceOutputs = input?.sourceOutputs;
  if (!Array.isArray(sourceOutputs) || sourceOutputs.length < 1 || sourceOutputs.length > 100) throw new Error('Provide 1–100 sourceOutputs from a trusted selected-network UTXO source.');
  const parsed = inspectBchTransaction(transactionHex);
  if (parsed.inputs.length !== sourceOutputs.length) throw new Error('Source output count must exactly match transaction input count.');
  const byOutpoint = new Map();
  for (const output of sourceOutputs) {
    if (!output || typeof output !== 'object' || Array.isArray(output) || !/^[0-9a-f]{64}$/i.test(String(output.txid || '')) || !Number.isInteger(output.outputIndex) || output.outputIndex < 0 || !Number.isSafeInteger(output.valueSatoshis) || output.valueSatoshis <= 0 || typeof (output.lockingBytecode || output.scriptPubKey) !== 'string' || (output.lockingBytecode || output.scriptPubKey).length % 2 || !HEX.test(output.lockingBytecode || output.scriptPubKey)) throw new Error('Each sourceOutput must include txid, outputIndex, valueSatoshis and lockingBytecode (or scriptPubKey) from the trusted selected-network UTXO source.');
    const key = `${output.txid.toLowerCase()}:${output.outputIndex}`;
    if (byOutpoint.has(key)) throw new Error('Duplicate source output supplied.');
    byOutpoint.set(key, output);
  }
  for (const txInput of parsed.inputs) if (!byOutpoint.has(`${txInput.txid}:${txInput.outputIndex}`)) throw new Error('Every transaction input must have a matching sourceOutput.');
  const inputPaths = input?.inputPaths;
  if (!Array.isArray(inputPaths) || inputPaths.length !== parsed.inputs.length || inputPaths.length > 100) throw new Error('Provide exactly one inputPath for every transaction input.');
  const seen = new Set();
  for (const tuple of inputPaths) {
    if (!Array.isArray(tuple) || tuple.length !== 3) throw new Error('Each inputPath must be [inputIndex, pathName, addressIndex].');
    const [inputIndex, pathName, addressIndex] = tuple;
    if (!Number.isSafeInteger(inputIndex) || inputIndex < 0 || inputIndex >= parsed.inputs.length || !PATHS.has(pathName) || !Number.isSafeInteger(addressIndex) || addressIndex < 0) throw new Error('Invalid inputPath. Supported paths are receive, change and defi.');
    if (seen.has(inputIndex)) throw new Error('Duplicate input index in inputPaths.');
    seen.add(inputIndex);
  }
  if (seen.size !== parsed.inputs.length) throw new Error('inputPaths must cover every transaction input exactly once.');
  const userPrompt = String(input?.userPrompt || `KEYSTONE ${chain} transaction`).trim();
  if (!userPrompt || userPrompt.length > 120) throw new Error('Wallet confirmation message must be 1–120 characters.');
  return { transaction: { transaction: transactionHex, sourceOutputs, userPrompt, broadcast: false }, inputPaths };
}

export function validateSignedTransactionResponse(response) {
  const signed = response?.signedTransaction;
  if (typeof signed !== 'string' || signed.length % 2 !== 0 || !HEX.test(signed) || signed.length > 2_000_000) throw new Error('Wallet did not return a valid signed transaction hex string.');
  return signed;
}

/** Ensure wallet signing changed only input unlocking scripts—not the transaction being authorised. */
export function verifySignedTransaction(unsignedHex, signedHex, sourceOutputs) {
  const before = inspectBchTransaction(unsignedHex, sourceOutputs);
  const after = inspectBchTransaction(signedHex, sourceOutputs);
  if (before.version !== after.version || before.locktime !== after.locktime) throw new Error('Signed transaction changed version or locktime.');
  if (before.inputs.length !== after.inputs.length || before.outputs.length !== after.outputs.length) throw new Error('Signed transaction changed input or output count.');
  for (let i = 0; i < before.inputs.length; i++) {
    const a = before.inputs[i], b = after.inputs[i];
    if (a.txid !== b.txid || a.outputIndex !== b.outputIndex || a.sequence !== b.sequence) throw new Error(`Signed transaction changed input ${i}.`);
    if (b.scriptSigBytes === 0) throw new Error(`Signed transaction input ${i} has no unlocking script.`);
  }
  for (let i = 0; i < before.outputs.length; i++) {
    const a = before.outputs[i], b = after.outputs[i];
    if (a.satoshis !== b.satoshis || a.lockingBytecode !== b.lockingBytecode) throw new Error(`Signed transaction changed authorised output ${i}.`);
  }
  if (after.feeSatoshis !== before.feeSatoshis) throw new Error('Signed transaction fee differs from the authorised transaction.');
  const unlockingScriptChecks = inspectP2pkhUnlockingScripts(signedHex, sourceOutputs);
  return { valid: true, txid: after.txid, byteLength: after.byteLength, feeSatoshis: after.feeSatoshis, inputCount: after.inputCount, outputCount: after.outputCount, unlockingScriptChecks, warning: 'Unlocking-script format and public-key-to-prevout binding checked. ECDSA signature validity, BCH consensus, UTXO status and network acceptance are NOT verified.' };
}

export const createChipnetSignRequest = createBchSignRequest;
