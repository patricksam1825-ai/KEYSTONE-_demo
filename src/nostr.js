import { plainNostrEvent } from './nostr-event.js';

export async function verifyNostrEvent(event, challenge, { verifyEventFn } = {}) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return { valid: false, reason: 'Nostr event is missing.' };
  try {
    if (event.pubkey !== challenge.nostrPubkey) return { valid: false, reason: 'Nostr public key does not match the challenge.' };
    if (event.kind !== 30078) return { valid: false, reason: 'Expected NIP-78 kind 30078 event.' };
    if (event.content !== challenge.message) return { valid: false, reason: 'Nostr event content does not exactly match the challenge message.' };
    const tags = Array.isArray(event.tags) ? event.tags : [];
    if (!tags.some(t => Array.isArray(t) && t[0] === 'd' && t[1] === challenge.id)) return { valid: false, reason: 'Missing matching challenge d-tag.' };
    if (!tags.some(t => Array.isArray(t) && t[0] === 'keystone' && t[1] === 'identity-proof' && t[2] === 'v1')) return { valid: false, reason: 'Missing KEYSTONE identity-proof tag.' };
    const created = Number(event.created_at) * 1000;
    if (!Number.isFinite(created) || created < challenge.createdAt - 60_000 || created > challenge.expiresAt + 60_000) return { valid: false, reason: 'Nostr event timestamp is outside the challenge window.' };
    // Injected verifier supports deterministic protocol tests; production defaults
    // to nostr-tools' actual Schnorr/event-ID verification.
    const verifier = verifyEventFn || (await import('nostr-tools')).verifyEvent;
    if (!verifier(plainNostrEvent(event))) return { valid: false, reason: 'Nostr event signature is invalid.' };
    return { valid: true };
  } catch { return { valid: false, reason: 'Nostr event could not be cryptographically verified.' }; }
}
