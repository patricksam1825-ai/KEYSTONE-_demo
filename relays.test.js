import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRelayUrls, publishToRelays, discoverFromRelays } from '../src/relays.js';

test('relay URL parser requires secure websocket endpoints and deduplicates', () => {
  assert.deepEqual(parseRelayUrls('wss://relay.example,wss://relay.example/'), ['wss://relay.example']);
  assert.throws(() => parseRelayUrls('ws://relay.example'), /wss/);
  assert.throws(() => parseRelayUrls('wss://user:pass@relay.example'), /credential-free/);
  assert.throws(() => parseRelayUrls(Array.from({ length: 9 }, (_, i) => `wss://r${i}.example`)), /At most 8/);
});

test('publish reports per-relay success and failure', async () => {
  const poolFactory = () => ({
    publish: () => [Promise.resolve('OK'), Promise.reject(new Error('offline'))],
    close: () => {}
  });
  const result = await publishToRelays({ id: 'event' }, ['wss://a.example', 'wss://b.example'], { poolFactory, timeoutMs: 100 });
  assert.equal(result.ok, true);
  assert.equal(result.published.length, 1);
  assert.equal(result.failed.length, 1);
});

test('discovery requests only KEYSTONE registry events for the requested author', async () => {
  let captured;
  const poolFactory = () => ({
    querySync: async (_relays, filter) => { captured = filter; return [{ id: 'a'.repeat(64) }]; },
    close: () => {}
  });
  const result = await discoverFromRelays('b'.repeat(64), ['wss://relay.example'], { poolFactory, timeoutMs: 100 });
  assert.equal(result.events.length, 1);
  assert.deepEqual(captured.kinds, [30078]);
  assert.deepEqual(captured.authors, ['b'.repeat(64)]);
  assert.deepEqual(captured['#t'], ['keystone-binding']);
});

test('discovery rejects malformed public keys and returns empty when no relays configured', async () => {
  await assert.rejects(() => discoverFromRelays('not-a-key', []), /64 hexadecimal/);
  assert.deepEqual(await discoverFromRelays('c'.repeat(64), []), { configured: false, events: [], message: 'No Nostr relays configured.' });
});


test('publish times out and closes the relay pool', async () => {
  let closed = false;
  const poolFactory = () => ({
    publish: () => [new Promise(() => {})],
    close: () => { closed = true; }
  });
  await assert.rejects(
    () => publishToRelays({ id: 'event' }, ['wss://slow.example'], { poolFactory, timeoutMs: 10 }),
    /publish timed out/
  );
  assert.equal(closed, true);
});

test('discovery times out and closes the relay pool', async () => {
  let closed = false;
  const poolFactory = () => ({
    querySync: () => new Promise(() => {}),
    close: () => { closed = true; }
  });
  await assert.rejects(
    () => discoverFromRelays('d'.repeat(64), ['wss://slow.example'], { poolFactory, timeoutMs: 10 }),
    /discovery timed out/
  );
  assert.equal(closed, true);
});

test('publish failures keep the relay reason, whether string, Error or empty', async () => {
  const { describeRelayError } = await import('../src/relays.js');
  assert.equal(describeRelayError('blocked: kind not allowed'), 'blocked: kind not allowed');
  assert.equal(describeRelayError(new Error('connection failure: ECONNRESET')), 'connection failure: ECONNRESET');
  assert.match(describeRelayError(undefined), /no reason/);
  assert.equal(describeRelayError('x'.repeat(500)).length, 200);
  assert.equal(describeRelayError('bad\nreason\u0000'), 'bad reason');
  const poolFactory = () => ({ publish: () => [Promise.reject('rate-limited: slow down'), Promise.resolve('ok')], close() {} });
  const result = await publishToRelays({ id: 'e' }, ['wss://a.example', 'wss://b.example'], { poolFactory, timeoutMs: 100 });
  assert.equal(result.failed[0].error, 'rate-limited: slow down');
  assert.equal(result.published.length, 1);
});
