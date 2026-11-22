const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RELAYS = 8;

export function parseRelayUrls(value = '') {
  const raw = Array.isArray(value) ? value : String(value).split(',').map(x => x.trim()).filter(Boolean);
  if (raw.length > MAX_RELAYS) throw new Error(`At most ${MAX_RELAYS} Nostr relays may be configured.`);
  const urls = raw.map(item => {
    let url;
    try { url = new URL(item); } catch { throw new Error(`Invalid Nostr relay URL: ${item}`); }
    if (url.protocol !== 'wss:' || url.username || url.password || url.hash) throw new Error('Nostr relays must use credential-free wss:// URLs without fragments.');
    return url.toString().replace(/\/$/, '');
  });
  return [...new Set(urls)];
}

async function makePool(poolFactory) {
  if (poolFactory) return poolFactory();
  // nostr-tools 2.x expects a WebSocket implementation in Node.js.
  const [{ SimplePool, useWebSocketImplementation }, wsModule] = await Promise.all([
    import('nostr-tools/pool'),
    import('ws')
  ]);
  useWebSocketImplementation(wsModule.default);
  return new SimplePool();
}

// nostr-tools rejects a refused publish with a plain STRING (the relay's own reason, e.g. "blocked: ..." or
// "connection failure: ..."), not an Error. Keep that reason so failures can be diagnosed.
export function describeRelayError(reason) {
  const text = typeof reason === 'string' ? reason : reason instanceof Error ? reason.message : reason?.message ?? (reason == null ? '' : String(reason));
  const clean = String(text).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
  return clean || 'Publish failed (relay gave no reason).';
}

async function withTimeout(operation, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Publish a signed, already-validated Nostr event to configured relays. */
export async function publishToRelays(event, relayUrls, { poolFactory, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const relays = parseRelayUrls(relayUrls);
  if (!relays.length) return { configured: false, published: [], failed: [], message: 'No Nostr relays configured.' };
  const pool = await makePool(poolFactory);
  try {
    const results = await withTimeout(
      () => Promise.allSettled(pool.publish(relays, event)),
      timeoutMs,
      'Nostr relay publish timed out.'
    );
    const published = [], failed = [];
    results.forEach((result, index) => (result.status === 'fulfilled' ? published : failed).push({ relay: relays[index], ...(result.status === 'fulfilled' ? { result: result.value } : { error: describeRelayError(result.reason) }) }));
    return { configured: true, published, failed, ok: published.length > 0 };
  } finally { pool.close?.(relays); }
}

/** Query public relays for KEYSTONE kind-30078 announcements and return raw events for verification. */
export async function discoverFromRelays(pubkey, relayUrls, { poolFactory, timeoutMs = DEFAULT_TIMEOUT_MS, limit = 100 } = {}) {
  if (!/^[a-f0-9]{64}$/i.test(String(pubkey))) throw new Error('Nostr public key must be 64 hexadecimal characters.');
  const relays = parseRelayUrls(relayUrls);
  if (!relays.length) return { configured: false, events: [], message: 'No Nostr relays configured.' };
  const pool = await makePool(poolFactory);
  try {
    const events = await withTimeout(
      () => pool.querySync(relays, { kinds: [30078], authors: [pubkey.toLowerCase()], '#t': ['keystone-binding'], limit: Math.min(200, Math.max(1, Number(limit) || 100)) }, { maxWait: timeoutMs }),
      timeoutMs,
      'Nostr relay discovery timed out.'
    );
    return { configured: true, events: Array.isArray(events) ? events : [] };
  } finally { pool.close?.(relays); }
}
