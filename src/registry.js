import { verifyProofBundle } from './identity.js';
import { plainNostrEvent } from './nostr-event.js';

const HEX_64 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CONTENT_BYTES = 1_000_000;
const MAX_TAGS = 128;

/** Validate a signed NIP-78 announcement and the cryptographic identity proof it carries. */
export async function validateRegistryEvent(event, { proofVerifier = verifyProofBundle, signatureVerifier, nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return { valid: false, error: 'Nostr registry event is required.' };
  try {
    if (event.kind !== 30078) return { valid: false, error: 'Registry announcement must be NIP-78 kind 30078.' };
    if (!HEX_64.test(String(event.pubkey || ''))) return { valid: false, error: 'Registry event public key is malformed.' };
    if (!HEX_64.test(String(event.id || '')) || !/^[a-f0-9]{128}$/.test(String(event.sig || ''))) return { valid: false, error: 'Registry event ID or signature is malformed.' };
    if (!Number.isSafeInteger(event.created_at) || event.created_at > nowSeconds + 60) return { valid: false, error: 'Registry event timestamp is invalid or too far in the future.' };
    if (!Array.isArray(event.tags) || event.tags.length > MAX_TAGS || event.tags.some(tag => !Array.isArray(tag) || tag.length < 2 || tag.length > 8 || tag.some(value => typeof value !== 'string' || value.length > 2_000))) return { valid: false, error: 'Registry event tags are malformed or exceed the size limit.' };
    if (typeof event.content !== 'string' || Buffer.byteLength(event.content, 'utf8') > MAX_CONTENT_BYTES) return { valid: false, error: 'Registry content is missing or exceeds the 1 MB limit.' };
    // Load the cryptographic verifier only when validating a real registry event.
    const verify = signatureVerifier || (await import('nostr-tools')).verifyEvent;
    if (!verify(plainNostrEvent(event))) return { valid: false, error: 'Registry event signature is invalid.' };
    const tags = event.tags;
    const bindingTags = tags.filter(t => t[0] === 't' && t[1] === 'keystone-binding');
    if (bindingTags.length !== 1 || bindingTags[0].length !== 2) return { valid: false, error: 'Missing, malformed or ambiguous keystone-binding discovery tag.' };
    const dTags = tags.filter(t => t[0] === 'd');
    if (dTags.length !== 1 || dTags[0].length !== 2 || !dTags[0][1].startsWith('keystone-binding:')) return { valid: false, error: 'Missing, malformed or ambiguous canonical binding d-tag.' };
    const payload = JSON.parse(event.content);
    if (!payload || payload.protocol !== 'KEYSTONE-NOSTR-REGISTRY-v1' || !payload.proofBundle) return { valid: false, error: 'Unsupported registry payload.' };
    const checked = await proofVerifier(payload.proofBundle);
    if (!checked.valid) return { valid: false, error: `Embedded identity proof is invalid: ${checked.error}` };
    const bundle = payload.proofBundle;
    if (bundle.challenge.nostrPubkey !== event.pubkey) return { valid: false, error: 'Registry signer does not match the bound Nostr identity.' };
    if (!UUID.test(String(bundle.bindingId || ''))) return { valid: false, error: 'Proof bundle binding ID is malformed.' };
    if (dTags[0][1] !== `keystone-binding:${bundle.bindingId}`) return { valid: false, error: 'Registry d-tag does not match the proof bundle binding ID.' };
    return { valid: true, payload, checked };
  } catch (error) {
    return { valid: false, error: error.message || 'Could not validate registry event.' };
  }
}
