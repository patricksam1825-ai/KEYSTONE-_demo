import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createECDH, createHash, createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { buildUnsignedChipnetTransaction } from '../src/tx-builder.js';
import { calculateBchForkIdDigest } from '../src/tx-signing.js';

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

 test('HTTP smoke: starts, serves UI, reports readiness and rejects unsafe host', { timeout: 15_000 }, async (t) => {
  const port = await freePort();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'keystone-smoke-'));
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), // fileURLToPath works on Windows; URL.pathname does not
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, NOSTR_RELAYS: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk.toString(); });
  child.stderr.on('data', chunk => { logs += chunk.toString(); });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 1000))]);
    }
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port}`;
  let health;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(`KEYSTONE exited during startup: ${logs}`);
    try { health = await fetch(`${base}/api/health`); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.ok(health, `KEYSTONE did not become ready. Logs: ${logs}`);
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.name, 'KEYSTONE');
  assert.equal(healthBody.chain, 'chipnet');
  assert.equal(healthBody.bchVerifyMode, 'local');
  assert.equal(typeof healthBody.bchVerifierAvailable, 'boolean');
  assert.equal(typeof healthBody.nostrVerifierAvailable, 'boolean');
  assert.ok(['ready', 'degraded'].includes(healthBody.status));

  const page = await fetch(base);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /KEYSTONE/);
  assert.match(html, /id="signNostr"/);
  const app = await fetch(`${base}/app.js`);
  assert.equal(app.status, 200);
  const appSource = await app.text();
  assert.match(appSource, /identity\/verify/);
  assert.match(appSource, /identity-proof/);

  const challengeResponse = await fetch(`${base}/api/challenges`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      bchAddress: `bchtest:${'q'.repeat(30)}`,
      nostrPubkey: 'a'.repeat(64)
    })
  });
  assert.equal(challengeResponse.status, 201);
  const challenge = await challengeResponse.json();
  assert.ok(challenge.challengeId);
  assert.ok(challenge.challengeToken);
  assert.match(challenge.message, /KEYSTONE IDENTITY BINDING/);
  assert.match(challenge.message, /Chain: chipnet/);

  // Exercise the actual HTTP route with a genuine locally signed BCH FORKID transaction.
  const signer = createECDH('secp256k1'); signer.generateKeys();
  const publicKey = signer.getPublicKey(null, 'compressed');
  const publicKeyHash = createHash('ripemd160').update(createHash('sha256').update(publicKey).digest()).digest('hex');
  const sourceOutput = { txid: 'ab'.repeat(32), outputIndex: 1, valueSatoshis: 100_000, scriptPubKey: `76a914${publicKeyHash}88ac` };
  const unsigned = buildUnsignedChipnetTransaction({
    selectedUtxos: [sourceOutput], destinationScriptPubKey: `a914${'22'.repeat(20)}87`,
    changeScriptPubKey: `76a914${'33'.repeat(20)}88ac`, amountSatoshis: 40_000,
    changeSatoshis: 59_774, feeSatoshis: 226
  });
  const uncompressed = signer.getPublicKey(null, 'uncompressed');
  const signingKey = createPrivateKey({ key: {
    kty: 'EC', crv: 'secp256k1', d: signer.getPrivateKey().toString('base64url'),
    x: uncompressed.subarray(1, 33).toString('base64url'), y: uncompressed.subarray(33, 65).toString('base64url')
  }, format: 'jwk' });
  const digest = calculateBchForkIdDigest(unsigned.transactionHex, 0, sourceOutput, 0x41);
  const sigWithType = Buffer.concat([cryptoSign(null, digest, signingKey), Buffer.from([0x41])]);
  const script = Buffer.concat([Buffer.from([sigWithType.length]), sigWithType, Buffer.from([publicKey.length]), publicKey]);
  const signedTx = unsigned.transactionHex.slice(0, 82) + script.length.toString(16).padStart(2, '0') + script.toString('hex') + unsigned.transactionHex.slice(84);
  const verifyResponse = await fetch(`${base}/api/transactions/verify-signed`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ unsignedTransaction: unsigned.transactionHex, signedTransaction: signedTx, sourceOutputs: [sourceOutput] })
  });
  assert.equal(verifyResponse.status, 200);
  const verifyBody = await verifyResponse.json();
  assert.equal(verifyBody.integrity.cryptographicVerification, 'passed');
  assert.equal(verifyBody.integrity.cryptographicSignatureChecks[0].ecdsaSignatureValid, true);
  assert.equal(verifyBody.broadcast, false);

  const readiness = await fetch(`${base}/api/readiness`);
  assert.equal(readiness.status, 200);
  const report = await readiness.json();
  assert.equal(report.competitionReadiness, 'not-certified');
  assert.match(report.wallet.transactionBroadcast, /implemented|not-implemented|live-test/);
  assert.equal(report.deployment.productionDatabase, 'not-implemented');

  const unsafeOrigin = await fetch(`${base}/api/health`, { headers: { origin: 'https://example.com' } });
  assert.equal(unsafeOrigin.status, 403);
});
