import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnvFile } from '../src/env.js';

 test('loads .env values, quoted strings, comments and export prefixes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keystone-env-'));
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, '# comment\nPORT=4321 # local port\nBCH_RPC_USER="node user"\nBCH_RPC_PASSWORD=secret\nexport NOSTR_RELAYS=wss://relay.example\nEMPTY=\'\'\n');
  const target = { PORT: '9999' };
  try {
    const result = loadEnvFile(file, target);
    assert.deepEqual(result, { loaded: true, count: 4 });
    assert.equal(target.PORT, '9999');
    assert.equal(target.BCH_RPC_USER, 'node user');
    assert.equal(target.BCH_RPC_PASSWORD, 'secret');
    assert.equal(target.NOSTR_RELAYS, 'wss://relay.example');
    assert.equal(target.EMPTY, '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('missing .env is optional', () => {
  assert.deepEqual(loadEnvFile(path.join(os.tmpdir(), 'keystone-no-such-env-file')), { loaded: false, count: 0 });
});
