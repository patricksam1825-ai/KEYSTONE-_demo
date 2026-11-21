// Independent, test-only secp256k1 + CashAddr + Base58 reference code (BigInt, no libauth).
// It exists so BCH signed-message tests run real elliptic-curve maths even when libauth is not
// installed. It is NOT used by the application.
import { createHash } from 'node:crypto';

export const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
export const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = { x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n, y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n };
const mod = (a, m = P) => ((a % m) + m) % m;
function pow(b, e, m) { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; }
const inv = (a, m = P) => pow(a, m - 2n, m);
function add(p, q) {
  if (!p) return q; if (!q) return p;
  if (p.x === q.x && mod(p.y + q.y) === 0n) return null;
  const l = p.x === q.x ? mod(3n * p.x * p.x * inv(2n * p.y)) : mod((q.y - p.y) * inv(q.x - p.x));
  const x = mod(l * l - p.x - q.x); return { x, y: mod(l * (p.x - x) - p.y) };
}
export function mul(k, p = G) { let r = null; let a = p; while (k > 0n) { if (k & 1n) r = add(r, a); a = add(a, a); k >>= 1n; } return r; }
export const toBig = buf => BigInt('0x' + Buffer.from(buf).toString('hex'));
export const to32 = n => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');

export function serializePub(pt, compressed) {
  return compressed ? Buffer.concat([Buffer.from([pt.y & 1n ? 3 : 2]), to32(pt.x)]) : Buffer.concat([Buffer.from([4]), to32(pt.x), to32(pt.y)]);
}
/** Standard ECDSA public-key recovery. Returns a point or null. */
export function recoverPoint(r, s, recId, hash32) {
  const x = r + (recId & 2 ? N : 0n); if (x >= P) return null;
  const y2 = mod(x ** 3n + 7n); let y = pow(y2, (P + 1n) / 4n, P); if (mod(y * y) !== y2) return null;
  if ((y & 1n) !== BigInt(recId & 1)) y = P - y;
  const R = { x, y }, e = toBig(hash32), rInv = inv(r, N);
  return add(mul(mod(s * rInv, N), R), mul(mod(-e * rInv, N), G));
}
export const sha256 = b => createHash('sha256').update(b).digest();
export const hash160 = b => createHash('ripemd160').update(sha256(b)).digest();

// ---- CashAddr encode (spec: github.com/bitcoincashorg/bitcoincash.org/blob/master/spec/cashaddr.md)
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function polymod(v) {
  let c = 1n; const g = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n];
  for (const d of v) { const c0 = c >> 35n; c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(d); for (let i = 0; i < 5; i++) if ((c0 >> BigInt(i)) & 1n) c ^= g[i]; }
  return c ^ 1n;
}
function to5(bytes) { const out = []; let acc = 0, bits = 0; for (const b of bytes) { acc = (acc << 8) | b; bits += 8; while (bits >= 5) { bits -= 5; out.push((acc >> bits) & 31); } acc &= (1 << bits) - 1; } if (bits) out.push((acc << (5 - bits)) & 31); return out; }
export function encodeCashAddrP2pkh(prefix, hash20, versionByte = 0x00) {
  const payload = to5([versionByte, ...hash20]); // version byte: type 0 = P2PKH, 8 = P2SH (160-bit hashes)
  const pre = [...prefix].map(ch => ch.charCodeAt(0) & 31);
  const sum = polymod([...pre, 0, ...payload, 0, 0, 0, 0, 0, 0, 0, 0]);
  const chk = []; for (let i = 7; i >= 0; i--) chk.push(Number((sum >> BigInt(5 * i)) & 31n));
  return `${prefix}:${[...payload, ...chk].map(i => CHARSET[i]).join('')}`;
}
// ---- Base58Check decode (legacy addresses), returns hash160 hex
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58CheckHash160(addr) {
  let n = 0n; for (const ch of addr) n = n * 58n + BigInt(B58.indexOf(ch));
  const raw = Buffer.from(n.toString(16).padStart(50, '0'), 'hex');
  if (!sha256(sha256(raw.subarray(0, 21))).subarray(0, 4).equals(raw.subarray(21))) throw new Error('bad base58 checksum');
  return raw.subarray(1, 21).toString('hex');
}

/** CashAddr decode with full checksum verification. Returns { prefix, type, payload } or an error string (libauth-style). */
export function decodeCashAddrRef(address) {
  const [prefix, body] = String(address).toLowerCase().split(':'); if (!body) return 'missing prefix';
  const vals = [...body].map(ch => CHARSET.indexOf(ch)); if (vals.some(v => v < 0)) return 'bad character';
  const pre = [...prefix].map(ch => ch.charCodeAt(0) & 31);
  if (polymod([...pre, 0, ...vals]) !== 0n) return 'bad checksum';
  const data = vals.slice(0, -8); let acc = 0, bits = 0; const bytes = [];
  for (const v of data) { acc = (acc << 5) | v; bits += 5; if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); acc &= (1 << bits) - 1; } }
  return { prefix, type: bytes[0] >> 3, payload: new Uint8Array(bytes.slice(1)) };
}
/** Primitives with the same shape verifyWithPrimitives expects, built from the reference maths. */
export const referencePrimitives = {
  decodeCashAddress: decodeCashAddrRef,
  hash160: b => new Uint8Array(hash160(Buffer.from(b))),
  recover: (sig, recId, hash, compressed) => {
    const pt = recoverPoint(toBig(sig.subarray(0, 32)), toBig(sig.subarray(32, 64)), recId, hash);
    return pt ? new Uint8Array(serializePub(pt, compressed)) : null;
  }
};

// ---- BIP340 Schnorr (test-only reference; used to check Nostr signatures with real maths)
const tagged = (tag, ...parts) => { const t = sha256(Buffer.from(tag)); return sha256(Buffer.concat([t, t, ...parts])); };
const liftX = x => { const y2 = mod(x ** 3n + 7n); let y = pow(y2, (P + 1n) / 4n, P); if (mod(y * y) !== y2) return null; return { x, y: y & 1n ? P - y : y }; };
export function schnorrPubkey(secretHex) { return to32(mul(toBig(Buffer.from(secretHex, 'hex'))).x).toString('hex'); }
export function schnorrSign(msg32, secretHex, aux32 = Buffer.alloc(32)) {
  const d0 = toBig(Buffer.from(secretHex, 'hex')); const Pt = mul(d0); const d = Pt.y & 1n ? N - d0 : d0;
  const t = Buffer.from(to32(d).map((b, i) => b ^ tagged('BIP0340/aux', aux32)[i]));
  let k0 = toBig(tagged('BIP0340/nonce', t, to32(Pt.x), msg32)) % N; if (k0 === 0n) throw new Error('bad nonce');
  const Rp = mul(k0); const k = Rp.y & 1n ? N - k0 : k0;
  const e = toBig(tagged('BIP0340/challenge', to32(Rp.x), to32(Pt.x), msg32)) % N;
  return Buffer.concat([to32(Rp.x), to32((k + e * d) % N)]).toString('hex');
}
export function schnorrVerify(sigHex, msg32, pubHex) {
  try {
    const sig = Buffer.from(sigHex, 'hex'); if (sig.length !== 64) return false;
    const Pt = liftX(toBig(Buffer.from(pubHex, 'hex'))); const r = toBig(sig.subarray(0, 32)), s = toBig(sig.subarray(32));
    if (!Pt || r >= P || s >= N) return false;
    const e = toBig(tagged('BIP0340/challenge', to32(r), to32(Pt.x), msg32)) % N;
    const R = add(mul(s), mul(N - e, Pt));
    return !!R && !(R.y & 1n) && R.x === r;
  } catch { return false; }
}
export const nostrEventId = e => sha256(Buffer.from(JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]), 'utf8')).toString('hex');
export function signNostrEvent(template, secretHex) {
  const event = { ...template, pubkey: schnorrPubkey(secretHex) };
  event.id = nostrEventId(event);
  event.sig = schnorrSign(Buffer.from(event.id, 'hex'), secretHex);
  return event;
}
/** Same contract as nostr-tools verifyEvent: id must match content AND signature must be valid. */
export const verifyEventRef = e => e && nostrEventId(e) === e.id && schnorrVerify(e.sig, Buffer.from(e.id, 'hex'), e.pubkey);
