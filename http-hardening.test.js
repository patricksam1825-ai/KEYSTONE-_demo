import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readJsonBody, validatePort, validateChallengeTtlSeconds } from '../src/http-hardening.js';

function request(chunks, headers = { 'content-type': 'application/json' }) {
  const stream = Readable.from(chunks);
  stream.headers = headers;
  return stream;
}

test('validates configured HTTP ports', () => {
  assert.equal(validatePort('4173'), 4173);
  for (const value of ['0', '-1', '65536', '1.5', 'abc', '']) {
    assert.throws(() => validatePort(value), /PORT must be/);
  }
});

test('parses JSON objects and safely handles UTF-8 split across chunks', async () => {
  const bytes = Buffer.from('{"memo":"café"}', 'utf8');
  const split = bytes.indexOf(Buffer.from('é')) + 1;
  const parsed = await readJsonBody(request([bytes.subarray(0, split), bytes.subarray(split)]));
  assert.deepEqual(parsed, { memo: 'café' });
});

test('rejects wrong content type, malformed JSON and non-object JSON', async () => {
  await assert.rejects(readJsonBody(request(['{}'], { 'content-type': 'text/plain' })), /Content-Type/);
  await assert.rejects(readJsonBody(request(['{bad}'])), /invalid JSON/);
  await assert.rejects(readJsonBody(request(['[]'])), /must be an object/);
});

test('rejects oversized declared and streamed request bodies', async () => {
  await assert.rejects(readJsonBody(request(['{}'], { 'content-type': 'application/json', 'content-length': '99' }), 10), /too large/);
  await assert.rejects(readJsonBody(request(['12345678901']), 10), /too large/);
});

test('rejects malformed Content-Length', async () => {
  await assert.rejects(readJsonBody(request(['{}'], { 'content-type': 'application/json', 'content-length': '2x' })), /Invalid Content-Length/);
});


test('validates and bounds the challenge lifetime', () => {
  assert.equal(validateChallengeTtlSeconds('300'), 300);
  assert.equal(validateChallengeTtlSeconds('10'), 60);
  assert.equal(validateChallengeTtlSeconds('1200'), 900);
  for (const value of ['abc', 'NaN', 'Infinity', '1.5', '0', '-2']) {
    assert.throws(() => validateChallengeTtlSeconds(value), /CHALLENGE_TTL_SECONDS/);
  }
});
