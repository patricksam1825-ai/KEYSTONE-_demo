import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { assertLoopbackListenHost, isLoopbackHost, isSafeLocalRequest, applySecurityHeaders } from '../src/security.js';

test('allows loopback hosts and blocks public listen addresses', () => {
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('localhost'), true);
  assert.equal(isLoopbackHost('::1'), true);
  assert.equal(isLoopbackHost('192.168.1.5'), false);
  assert.equal(isLoopbackHost('0.0.0.0'), false);
  assert.equal(assertLoopbackListenHost('127.0.0.1'), '127.0.0.1');
  assert.throws(() => assertLoopbackListenHost('0.0.0.0'), /loopback/);
});

test('accepts matching local Host and Origin and rejects DNS rebinding or cross-origin requests', () => {
  assert.equal(isSafeLocalRequest('127.0.0.1:4173', 'http://127.0.0.1:4173', 4173), true);
  assert.equal(isSafeLocalRequest('localhost:4173', undefined, 4173), true);
  assert.equal(isSafeLocalRequest('attacker.example:4173', undefined, 4173), false);
  assert.equal(isSafeLocalRequest('127.0.0.1:4173', 'http://evil.example:4173', 4173), false);
  assert.equal(isSafeLocalRequest('127.0.0.1:4173', 'null', 4173), false);
  assert.equal(isSafeLocalRequest('127.0.0.1:9999', undefined, 4173), false);
});

test('sets browser security headers', () => {
  const headers = new Map();
  const response = { setHeader: (key, value) => headers.set(key, value) };
  applySecurityHeaders(response);
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.match(headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(headers.get('referrer-policy'), 'no-referrer');
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
});
