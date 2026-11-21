// nostr-tools remembers "already verified" in a hidden Symbol property on the event object, and JavaScript's
// spread ({ ...event }) copies that hidden flag. An edited copy of a verified event could then pass verifyEvent
// WITHOUT a real signature check. We therefore always verify a fresh plain object that has only the seven
// standard Nostr fields, so the signature is genuinely recomputed every time.
export function plainNostrEvent(event) {
  return {
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: Array.isArray(event.tags) ? event.tags.map(tag => (Array.isArray(tag) ? [...tag] : tag)) : event.tags,
    content: event.content,
    sig: event.sig
  };
}
