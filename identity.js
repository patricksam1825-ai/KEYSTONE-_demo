import { randomUUID } from 'node:crypto';
import { sha256 } from './crypto.js';
import { canonicalMessage } from './challenges.js';
import { verifyNostrEvent } from './nostr.js';
import { verifyBchMessage } from './bch.js';

export async function verifyIdentityBinding({ store, challengeId, challengeToken, bchSignature, nostrEvent, bchVerifier = verifyBchMessage, nostrVerifier = verifyNostrEvent }) {
  const tokenHash = sha256(String(challengeToken || ''));
  // Check credentials first without consuming the challenge. Invalid signatures must
  // not let a third party burn a legitimate user's short-lived challenge. The final
  // consumeChallenge call below is atomic, so concurrent valid submissions still
  // produce at most one binding.
  const candidate = await store.getChallenge(challengeId);
  const now = Date.now();
  if (!candidate || candidate.consumedAt || candidate.expiresAt <= now || candidate.tokenHash !== tokenHash) {
    return { ok: false, error: 'Challenge is invalid, expired, already used, or token is incorrect.' };
  }
  const challenge = candidate;
  const message = canonicalMessage(challenge);
  const nostr = await nostrVerifier(nostrEvent, { ...challenge, message });
  if (!nostr.valid) return { ok: false, error: `Nostr proof rejected: ${nostr.reason}` };
  if (!bchSignature || typeof bchSignature !== 'string') return { ok: false, error: 'BCH message signature is required.' };
  let bchValid = false;
  try { bchValid = await bchVerifier({ address: challenge.bchAddress, signature: bchSignature, message, chain: challenge.chain }); }
  catch (e) { return { ok: false, error: `BCH verification unavailable: ${e.message}` }; }
  if (!bchValid) return { ok: false, error: 'BCH proof rejected: signature does not prove control of the challenged address.' };
  // Both proofs passed. Claim the challenge and save the binding in ONE atomic step
  // (store.completeBinding). If storage fails, the challenge is NOT consumed.
  const bindingId = randomUUID();
  const proofBundle = {
    protocol: 'KEYSTONE-IDENTITY-PROOF-BUNDLE-v1',
    bindingId,
    challenge: { id: challenge.id, nonce: challenge.nonce, bchAddress: challenge.bchAddress, nostrPubkey: challenge.nostrPubkey, chain: challenge.chain, verifier: challenge.verifier, createdAt: challenge.createdAt, expiresAt: challenge.expiresAt },
    bchSignature,
    nostrEvent
  };
  const binding = {
    id: bindingId, version: 1, chain: challenge.chain,
    bchAddress: challenge.bchAddress, nostrPubkey: challenge.nostrPubkey,
    createdAt: new Date().toISOString(), verification: { bch: true, nostr: true },
    proofMessageHash: sha256(message), protocol: 'KEYSTONE-IDENTITY-BINDING-v1',
    proofBundle
  };
  try {
    const saved = await store.completeBinding(challengeId, tokenHash, Date.now(), binding);
    if (!saved) return { ok: false, error: 'Challenge is invalid, expired, already used, or token is incorrect.' };
  } catch (e) {
    if (e?.code === 'DUPLICATE_BINDING') return { ok: false, code: 'DUPLICATE_BINDING', error: e.message };
    console.error('KEYSTONE storage failure while saving binding:', e?.message);
    return { ok: false, code: 'STORAGE_FAILURE', error: 'The database could not save this binding. Your challenge was not used up. Please try again.' };
  }
  return { ok: true, binding };
}


// Re-verifies a portable proof bundle without trusting the local binding database.
export async function verifyProofBundle(bundle, { bchVerifier = verifyBchMessage, nostrVerifier = verifyNostrEvent } = {}) {
  try {
    if (!bundle || bundle.protocol !== 'KEYSTONE-IDENTITY-PROOF-BUNDLE-v1' || !bundle.challenge) return { valid: false, error: 'Unsupported or incomplete proof bundle.' };
    const c = bundle.challenge;
    if (!c.id || !c.nonce || !c.bchAddress || !c.nostrPubkey || !c.chain || !c.verifier || !c.createdAt || !c.expiresAt) return { valid: false, error: 'Proof bundle is missing required challenge fields.' };
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(String(bundle.bindingId || ''))) return { valid: false, error: 'Proof bundle binding ID is malformed.' };
    if (!uuidPattern.test(String(c.id))) return { valid: false, error: 'Proof bundle challenge ID is malformed.' };
    if (!bundle.nostrEvent || typeof bundle.nostrEvent !== 'object' || Array.isArray(bundle.nostrEvent)) return { valid: false, error: 'Nostr proof event is missing or malformed.' };
    if (bundle.nostrEvent.pubkey !== c.nostrPubkey) return { valid: false, error: 'Nostr event public key does not match the challenged identity.' };
    const challenge = { ...c, createdAt: Number(c.createdAt), expiresAt: Number(c.expiresAt) };
    if (!Number.isSafeInteger(challenge.createdAt) || !Number.isSafeInteger(challenge.expiresAt) || challenge.expiresAt <= challenge.createdAt) return { valid: false, error: 'Challenge timestamps are invalid.' };
    if (challenge.expiresAt - challenge.createdAt > 900_000) return { valid: false, error: 'Challenge lifetime exceeds the 15-minute protocol limit.' };
    if (challenge.createdAt > Date.now() + 60_000) return { valid: false, error: 'Challenge creation time is unreasonably far in the future.' };
    if (typeof challenge.nonce !== 'string' || challenge.nonce.length < 16 || challenge.nonce.length > 256) return { valid: false, error: 'Challenge nonce is malformed.' };
    if (typeof challenge.verifier !== 'string' || challenge.verifier.length < 1 || challenge.verifier.length > 128) return { valid: false, error: 'Challenge verifier identifier is malformed.' };
    if (typeof bundle.bchSignature !== 'string' || bundle.bchSignature.length < 1 || bundle.bchSignature.length > 2048) return { valid: false, error: 'BCH signature is missing or exceeds the supported size.' };
    let eventSize;
    try { eventSize = Buffer.byteLength(JSON.stringify(bundle.nostrEvent), 'utf8'); } catch { return { valid: false, error: 'Nostr event cannot be serialized.' }; }
    if (eventSize > 65_536) return { valid: false, error: 'Nostr event exceeds the 64 KiB proof limit.' };
    const expectedPrefix = challenge.chain === 'chipnet' ? 'bchtest:' : challenge.chain === 'mainnet' ? 'bitcoincash:' : null;
    if (!expectedPrefix || !String(challenge.bchAddress).toLowerCase().startsWith(expectedPrefix)) return { valid: false, error: 'Chain and BCH address prefix do not match.' };
    if (!/^[a-f0-9]{64}$/.test(challenge.nostrPubkey)) return { valid: false, error: 'Nostr public key is malformed.' };
    const message = canonicalMessage(challenge);
    const nostr = await nostrVerifier(bundle.nostrEvent, { ...challenge, message });
    if (!nostr.valid) return { valid: false, error: `Nostr proof rejected: ${nostr.reason}` };
    let bchValid = false;
    try { bchValid = await bchVerifier({ address: challenge.bchAddress, signature: bundle.bchSignature, message, chain: challenge.chain }); }
    catch (e) { return { valid: false, error: `BCH verification unavailable: ${e.message}` }; }
    if (!bchValid) return { valid: false, error: 'BCH proof rejected.' };
    return { valid: true, bindingId: bundle.bindingId, chain: challenge.chain, bchAddress: challenge.bchAddress, nostrPubkey: challenge.nostrPubkey, proofMessageHash: sha256(message), verifiedAt: new Date().toISOString() };
  } catch (e) { return { valid: false, error: e.message || 'Proof bundle verification failed.' }; }
}
