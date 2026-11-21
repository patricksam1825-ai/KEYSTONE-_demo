import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createHash, createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { buildUnsignedChipnetTransaction } from '../src/tx-builder.js';
import { calculateBchForkIdDigest, createChipnetSignRequest, validateSignedTransactionResponse, verifySignedTransaction, verifySignedTransactionCryptographically } from '../src/tx-signing.js';
const ecdh = createECDH('secp256k1'); ecdh.generateKeys();
const publicKey = ecdh.getPublicKey(null, 'compressed');
const publicKeyHash = createHash('ripemd160').update(createHash('sha256').update(publicKey).digest()).digest('hex');
const source = { txid: 'ab'.repeat(32), outputIndex: 1, valueSatoshis: 100_000, scriptPubKey: '76a914' + publicKeyHash + '88ac' };
const built = buildUnsignedChipnetTransaction({ selectedUtxos: [source], destinationScriptPubKey: 'a914' + '22'.repeat(20) + '87', changeScriptPubKey: '76a914' + '33'.repeat(20) + '88ac', amountSatoshis: 40_000, changeSatoshis: 59_774, feeSatoshis: 226 });
const base = { transactionHex: built.transactionHex, sourceOutputs: [source], inputPaths: [[0, 'receive', 0]] };
// Test-only DER-shaped signature fixture (not a cryptographically valid signature).
const fakeDerSignatureWithForkId = '300602010102010141';
const unlockingScript = '09' + fakeDerSignatureWithForkId + '21' + publicKey.toString('hex');
const signedHex = built.transactionHex.slice(0, 82) + (unlockingScript.length / 2).toString(16).padStart(2, '0') + unlockingScript + built.transactionHex.slice(84);

test('creates selected-network request and binds every input to a source output', () => {
  const request = createChipnetSignRequest(base);
  assert.equal(request.transaction.broadcast, false);
  assert.equal(request.transaction.transaction, built.transactionHex);
  assert.equal(createChipnetSignRequest(base, 'mainnet').transaction.broadcast, false);
  assert.throws(() => createChipnetSignRequest({ ...base, sourceOutputs: [] }), /sourceOutputs/);
  assert.throws(() => createChipnetSignRequest({ ...base, sourceOutputs: [{ ...source, txid: 'cd'.repeat(32) }] }), /matching sourceOutput/);
});

test('requires exact input path coverage and rejects malformed mappings', () => {
  assert.throws(() => createChipnetSignRequest({ ...base, inputPaths: [] }), /exactly one inputPath/);
  assert.throws(() => createChipnetSignRequest({ ...base, inputPaths: [[0, 'unknown', 0]] }), /Invalid inputPath/);
  assert.throws(() => createChipnetSignRequest({ ...base, inputPaths: [[0, 'receive', 0], [0, 'change', 1]] }), /exactly one inputPath|Duplicate/);
});

test('validates signed response and confirms authorised transaction outputs are unchanged', () => {
  assert.equal(validateSignedTransactionResponse({ signedTransaction: signedHex }), signedHex);
  const result = verifySignedTransaction(built.transactionHex, signedHex, [source]);
  assert.equal(result.valid, true);
  assert.equal(result.feeSatoshis, 226);
  assert.equal(result.unlockingScriptChecks[0].publicKeyHashMatched, true);
  assert.throws(() => verifySignedTransaction(built.transactionHex, built.transactionHex, [source]), /no unlocking script/);
  assert.throws(() => validateSignedTransactionResponse({ signedTransaction: 'not-hex' }), /valid signed transaction/);
});

test('rejects signed transaction if destination or amount changes', () => {
  // Change first output amount byte without changing its script.
  const altered = Buffer.from(signedHex, 'hex');
  const outputValueOffset = 4 + 1 + 32 + 4 + 1 + (unlockingScript.length / 2) + 4 + 1;
  altered[outputValueOffset] ^= 1;
  assert.throws(() => verifySignedTransaction(built.transactionHex, altered.toString('hex'), [source]), /authorised output|negative fee/);
});


test('rejects a public key that does not control the supplied P2PKH prevout', () => {
  const wrong = createECDH('secp256k1'); wrong.generateKeys();
  const wrongScript = '09' + fakeDerSignatureWithForkId + '21' + wrong.getPublicKey(null, 'compressed').toString('hex');
  const altered = built.transactionHex.slice(0, 82) + (wrongScript.length / 2).toString(16).padStart(2, '0') + wrongScript + built.transactionHex.slice(84);
  assert.throws(() => verifySignedTransaction(built.transactionHex, altered, [source]), /does not match the trusted P2PKH prevout/);
});

test('rejects malformed DER signatures and non-push unlocking opcodes', () => {
  const malformedDer = '09' + '300602010102010101' + '21' + publicKey.toString('hex');
  const badDerTx = built.transactionHex.slice(0, 82) + (malformedDer.length / 2).toString(16).padStart(2, '0') + malformedDer + built.transactionHex.slice(84);
  assert.throws(() => verifySignedTransaction(built.transactionHex, badDerTx, [source]), /malformed DER signature/);
  const nonPush = '51';
  const badOpcodeTx = built.transactionHex.slice(0, 82) + '01' + nonPush + built.transactionHex.slice(84);
  assert.throws(() => verifySignedTransaction(built.transactionHex, badOpcodeTx, [source]), /no unlocking script|only direct data pushes/);
});


test('cryptographically verifies a genuine BCH FORKID ECDSA signature with Node crypto', async () => {
  const uncompressed = ecdh.getPublicKey(null, 'uncompressed');
  const privateKey = createPrivateKey({
    key: {
      kty: 'EC', crv: 'secp256k1',
      d: ecdh.getPrivateKey().toString('base64url'),
      x: uncompressed.subarray(1, 33).toString('base64url'),
      y: uncompressed.subarray(33, 65).toString('base64url')
    }, format: 'jwk'
  });
  const digest = calculateBchForkIdDigest(built.transactionHex, 0, source, 0x41);
  const derSignature = cryptoSign(null, digest, privateKey);
  const signatureWithType = Buffer.concat([derSignature, Buffer.from([0x41])]);
  const script = Buffer.concat([
    Buffer.from([signatureWithType.length]), signatureWithType,
    Buffer.from([publicKey.length]), publicKey
  ]);
  const signed = built.transactionHex.slice(0, 82) + script.length.toString(16).padStart(2, '0') + script.toString('hex') + built.transactionHex.slice(84);
  const verified = await verifySignedTransactionCryptographically(built.transactionHex, signed, [source]);
  assert.equal(verified.cryptographicVerification, 'passed');
  assert.equal(verified.cryptographicSignatureChecks[0].ecdsaSignatureValid, true);
  assert.equal(verified.verificationBackend, 'Node.js crypto/OpenSSL secp256k1');

  const tampered = Buffer.from(signed, 'hex');
  // Flip a byte inside r while retaining the transaction's unlocking-script shape.
  tampered[43] ^= 1;
  await assert.rejects(
    verifySignedTransactionCryptographically(built.transactionHex, tampered.toString('hex'), [source]),
    /ECDSA signature verification failed|malformed DER/
  );
});
