import { createHash, timingSafeEqual } from 'node:crypto';

// Local (in-process) verification of Bitcoin-Cash "Signed Message" signatures.
// This is the format produced by Electron Cash / bitcoin-cli signmessage:
//   hash = SHA256d( varint(len(magic)) + magic + varint(len(message)) + message )
//   signature = base64( header(27..34) + r(32) + s(32) )  -> recover public key -> hash160 -> compare with address.
// The secp256k1 recovery, hash160 and CashAddr decoding come from libauth. This file never
// returns true unless a recovered public key hashes to the address payload.

const MAGIC = Buffer.from('Bitcoin Signed Message:\n', 'utf8');
const sha256 = data => createHash('sha256').update(data).digest();

function varint(n) {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) { const b = Buffer.alloc(3); b[0] = 0xfd; b.writeUInt16LE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = 0xfe; b.writeUInt32LE(n, 1); return b;
}

export function bitcoinMessageHash(message) {
  const m = Buffer.from(String(message), 'utf8');
  return new Uint8Array(sha256(sha256(Buffer.concat([varint(MAGIC.length), MAGIC, varint(m.length), m]))));
}

/** Strictly parse a 65-byte base64 compact signature. Returns null when malformed. */
export function parseCompactSignature(base64) {
  if (typeof base64 !== 'string' || base64.length !== 88 || !/^[A-Za-z0-9+/]{87}=$/.test(base64)) return null;
  const raw = Buffer.from(base64, 'base64');
  // Buffer's Base64 decoder is permissive; round-tripping rejects non-canonical
  // encodings with altered unused padding bits.
  if (raw.length !== 65 || raw.toString('base64') !== base64) return null;
  const header = raw[0];
  if (header < 27 || header > 34) return null;
  const flag = header - 27;
  return { signature: new Uint8Array(raw.subarray(1, 65)), recoveryId: flag & 3, compressed: flag >= 4 };
}

const isP2pkh = type => type === 'p2pkh' || type === 'p2pkhWithTokens' || type === 0 || type === 2;

/** Core logic with injected primitives (libauth in production).
 * Invalid user-controlled inputs always return false; they never escape as exceptions.
 */
export function verifyWithPrimitives({ decodeCashAddress, recover, hash160 }, { address, signature, message, chain }) {
  try {
    const parsed = parseCompactSignature(signature);
    if (!parsed || typeof address !== 'string' || typeof message !== 'string') return false;
    if (address.length === 0 || address.trim() !== address) return false;
    // CashAddr permits all-lowercase or all-uppercase, but never mixed case.
    if (address !== address.toLowerCase() && address !== address.toUpperCase()) return false;
    const decoded = decodeCashAddress(address.toLowerCase());
    if (!decoded || typeof decoded === 'string' || !(decoded.payload instanceof Uint8Array)) return false;
    if (!['bitcoincash', 'bchtest'].includes(decoded.prefix)) return false;
    // When the caller knows the selected chain, bind verification to that network.
    const expectedPrefix = chain === 'chipnet' ? 'bchtest' : chain === 'mainnet' ? 'bitcoincash' : null;
    if (chain !== undefined && chain !== null && !expectedPrefix) return false;
    if (expectedPrefix && decoded.prefix !== expectedPrefix) return false;
    if (!isP2pkh(decoded.type)) return false;

    const publicKey = recover(parsed.signature, parsed.recoveryId, bitcoinMessageHash(message), parsed.compressed);
    const expectedPublicKeyLength = parsed.compressed ? 33 : 65;
    if (!(publicKey instanceof Uint8Array) || publicKey.length !== expectedPublicKeyLength) return false;
    if (parsed.compressed ? ![2, 3].includes(publicKey[0]) : publicKey[0] !== 4) return false;

    const keyHashResult = hash160(publicKey);
    if (!(keyHashResult instanceof Uint8Array)) return false;
    const keyHash = Buffer.from(keyHashResult);
    const expected = Buffer.from(decoded.payload);
    return keyHash.length === 20 && expected.length === 20 && timingSafeEqual(keyHash, expected);
  } catch {
    return false;
  }
}

let libauthPromise;
async function loadLibauth() {
  libauthPromise ??= (async () => {
    try { return await import('@bitauth/libauth'); }
    catch (e) {
      if (['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(e?.code)) return null;
      throw e;
    }
  })();
  return libauthPromise;
}

async function primitivesFromLibauth() {
  const lib = await loadLibauth();
  if (!lib) throw new Error('Local BCH verification needs @bitauth/libauth@2.0.0 (run npm install).');

  // Libauth exposes a ready-to-use secp256k1 instance. The instantiate fallback is
  // retained for builds that expose the WASM factory rather than the singleton.
  const secp = lib.secp256k1 ?? (typeof lib.instantiateSecp256k1 === 'function'
    ? await lib.instantiateSecp256k1()
    : null);
  const requiredSecpMethods = ['recoverPublicKeyCompressed', 'recoverPublicKeyUncompressed'];
  const missing = requiredSecpMethods.filter(name => typeof secp?.[name] !== 'function');
  if (typeof lib.decodeCashAddress !== 'function') missing.push('decodeCashAddress');
  if (missing.length) {
    throw new Error(`Installed @bitauth/libauth does not expose required APIs: ${missing.join(', ')}.`);
  }

  // hash160 is a top-level function in Libauth. Keep the composition fallback for
  // compatible builds, but validate every primitive before advertising readiness.
  const hash160 = typeof lib.hash160 === 'function'
    ? bin => lib.hash160(bin)
    : (typeof lib.sha256?.hash === 'function' && typeof lib.ripemd160?.hash === 'function'
      ? bin => lib.ripemd160.hash(lib.sha256.hash(bin))
      : null);
  if (!hash160) throw new Error('Installed @bitauth/libauth is missing hash160/sha256/ripemd160 APIs.');

  return {
    decodeCashAddress: address => lib.decodeCashAddress(address),
    hash160,
    recover: (sig, recoveryId, hash, compressed) => {
      try {
        const recovered = compressed
          ? secp.recoverPublicKeyCompressed(sig, recoveryId, hash)
          : secp.recoverPublicKeyUncompressed(sig, recoveryId, hash);
        // Libauth reports failures as strings in some releases and throws in others.
        return recovered instanceof Uint8Array ? recovered : null;
      } catch {
        return null;
      }
    }
  };
}

export async function isLocalBchVerifierAvailable() {
  try { await primitivesFromLibauth(); return true; } catch { return false; }
}

export async function verifyBchMessageLocal({ address, signature, message, chain }) {
  return verifyWithPrimitives(await primitivesFromLibauth(), { address, signature, message, chain });
}
