// Test-only BCH signed-message signer: OpenSSL (node:crypto) ECDSA, independent of libauth/KEYSTONE.
import crypto from 'node:crypto';
import { bitcoinMessageHash } from '../../src/bch-local.js';
import * as r from './secp-ref.js';

function preimage(message) {
  const m = Buffer.from(message, 'utf8'), magic = Buffer.from('Bitcoin Signed Message:\n');
  const vi = n => n < 253 ? Buffer.from([n]) : Buffer.from([253, n & 255, n >> 8]);
  return Buffer.concat([vi(magic.length), magic, vi(m.length), m]);
}
export function bchKeypair(seed, compressed = true) {
  const priv = r.toBig(r.sha256(Buffer.from(seed))) % r.N;
  const pub = r.mul(priv);
  return { priv, pub, compressed, address: (prefix) => r.encodeCashAddrP2pkh(prefix, r.hash160(r.serializePub(pub, compressed))) };
}
export function signBchMessage(kp, message) {
  const { priv, pub, compressed } = kp;
  const key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'secp256k1', d: r.to32(priv).toString('base64url'), x: r.to32(pub.x).toString('base64url'), y: r.to32(pub.y).toString('base64url') }, format: 'jwk' });
  // OpenSSL hashes once; feeding sha256(preimage) yields Bitcoin's double SHA-256.
  const raw = crypto.sign('sha256', r.sha256(preimage(message)), { key, dsaEncoding: 'ieee-p1363' });
  const R = r.toBig(raw.subarray(0, 32)); let S = r.toBig(raw.subarray(32)); if (S > r.N / 2n) S = r.N - S;
  const hash = bitcoinMessageHash(message), want = r.serializePub(pub, true).toString('hex');
  for (let rec = 0; rec < 4; rec++) {
    const pt = r.recoverPoint(R, S, rec, hash);
    if (pt && r.serializePub(pt, true).toString('hex') === want) return Buffer.concat([Buffer.from([27 + rec + (compressed ? 4 : 0)]), r.to32(R), r.to32(S)]).toString('base64');
  }
  throw new Error('could not determine recovery id');
}
