import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { applySecurityHeaders, isSafeRequest } from './security.js';
import { readJsonBody } from './http-hardening.js';
import { KEYSTONE_VERSION } from './version.js';
import { createReadinessReport } from './readiness.js';
import { JsonStore } from './store.js';
import { SqliteStore } from './store-sqlite.js';
import { isLocalBchVerifierAvailable } from './bch-local.js';
import { createChallenge } from './challenges.js';
import { verifyIdentityBinding, verifyProofBundle } from './identity.js';
import { validateRegistryEvent } from './registry.js';
import { createPaymentRequest, isPaymentRequestActive } from './payments.js';
import { inspectBchTransaction } from './tx-inspector.js';
import { createBchRpcClient, listBchUtxos, planBchPayment, validateBchAddressFormat } from './utxos.js';
import { buildUnsignedBchTransaction } from './tx-builder.js';
import { testBchMempoolAcceptance } from './network-verifier.js';
import { createBchSignRequest, validateSignedTransactionResponse, verifySignedTransactionCryptographically } from './tx-signing.js';
import { getBchTransactionStatus } from './tx-status.js';
import { broadcastMainnetTransaction } from './mainnet-broadcast.js';
import { publishToRelays, discoverFromRelays } from './relays.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Keep startup dependency-tolerant for local UI review, but report the actual
// availability of the cryptographic Nostr verifier in the readiness endpoint.
let nostrDependencyAvailable = false;
try { await import('nostr-tools'); nostrDependencyAvailable = true; } catch { /* dependency is installed by npm install */ }
const bchLocalVerifierAvailable = await isLocalBchVerifierAvailable();
const publicDir = path.join(root, 'public');
const store = config.storeDriver === 'json' ? new JsonStore(config.dataDir) : new SqliteStore(path.join(config.dataDir, 'keystone.db'));
await store.init();
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const hits = new Map();
function rateLimit(req) {
  const ip = req.socket.remoteAddress || 'local'; const now = Date.now();
  if (hits.size > 1000) {
    for (const [key, timestamps] of hits) {
      if (!timestamps.some(t => now - t < 60_000)) hits.delete(key);
    }
  }
  const old = (hits.get(ip) || []).filter(t => now - t < 60_000);
  if (old.length >= 60) return false;
  old.push(now); hits.set(ip, old); return true;
}
function send(res, status, data) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); }
async function body(req) { return readJsonBody(req); }
const server = http.createServer({ maxHeaderSize: 16 * 1024 }, async (req, res) => {
  try {
    applySecurityHeaders(res, { allowPublic: config.allowPublicHost });
    if (!isSafeRequest(req.headers.host, req.headers.origin, config.port, { allowPublic: config.allowPublicHost })) {
      return send(res, 403, { error: config.allowPublicHost
        ? 'Request rejected by KEYSTONE safety checks.'
        : 'KEYSTONE local-only request rejected. Use localhost or 127.0.0.1, or set ALLOW_PUBLIC_HOST=true for a public demo.' });
    }
    if (!rateLimit(req)) return send(res, 429, { error: 'Too many requests. Try again shortly.' });
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/health') {
      const rpcConfigured = Boolean(config.bchRpcUrl && config.bchRpcUser && config.bchRpcPassword);
      const bchVerifierAvailable = config.bchVerifyMode === 'rpc' ? rpcConfigured : bchLocalVerifierAvailable;
      const ready = bchVerifierAvailable && nostrDependencyAvailable;
      return send(res, 200, {
        ok: true, // process is alive; readiness is reported separately
        ready,
        name: 'KEYSTONE',
        version: KEYSTONE_VERSION,
        chain: config.chain,
        bchVerifyMode: config.bchVerifyMode,
        bchVerifierAvailable,
        nostrVerifierAvailable: nostrDependencyAvailable,
        status: ready ? 'ready' : 'degraded'
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/readiness') return send(res, 200, createReadinessReport({
      chain: config.chain,
      rpcConfigured: Boolean(config.bchRpcUrl && config.bchRpcUser && config.bchRpcPassword),
      nostrDependencyAvailable,
      bchLocalVerifierAvailable,
      bchVerifyMode: config.bchVerifyMode,
      storeDriver: config.storeDriver,
      publicHostingEnabled: config.allowPublicHost,
      mainnetBroadcastImplemented: true,
      confirmationTrackingImplemented: true
    }));
    if (req.method === 'POST' && url.pathname === '/api/challenges') {
      const input = await body(req); const result = await createChallenge(store, input, config); return send(res, 201, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/identity/verify') {
      const input = await body(req);
      const result = await verifyIdentityBinding({ store, challengeId: input.challengeId, challengeToken: input.challengeToken, bchSignature: input.bchSignature, nostrEvent: input.nostrEvent });
      return send(res, result.ok ? 201 : result.code === 'STORAGE_FAILURE' ? 503 : result.code === 'DUPLICATE_BINDING' ? 409 : 400, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/utxos/list') {
      const input = await body(req);
      const utxos = await listBchUtxos(input.address, { rpc: createBchRpcClient(), chain: config.chain, minConfirmations: input.minConfirmations ?? 1 });
      return send(res, 200, { chain: config.chain, address: input.address, count: utxos.length, utxos, note: 'These are wallet-known outputs returned by your configured BCH node. They are not reserved and may be spent elsewhere.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/transactions/plan') {
      const input = await body(req);
      const rpc = createBchRpcClient();
      const destination = validateBchAddressFormat(input.destinationAddress);
      const destinationCheck = await rpc('validateaddress', [destination]);
      if (!destinationCheck?.isvalid) throw new Error('The configured BCH node does not recognise the destination on its network. Check that the node is connected to the selected BCH network.');
      const utxos = await listBchUtxos(input.address, { rpc, chain: config.chain, minConfirmations: input.minConfirmations ?? 1 });
      const plan = planBchPayment(utxos, input.amountSatoshis, input.feeRateSatPerByte ?? 1);
      return send(res, 200, { chain: config.chain, sourceAddress: input.address, destinationAddress: destination, ...plan });
    }
    if (req.method === 'POST' && url.pathname === '/api/transactions/build-unsigned') {
      const input = await body(req);
      const rpc = createBchRpcClient();
      const destination = validateBchAddressFormat(input.destinationAddress);
      const destinationCheck = await rpc('validateaddress', [destination]);
      if (!destinationCheck?.isvalid || typeof destinationCheck.scriptPubKey !== 'string') throw new Error('BCH Node did not return a verified destination locking script.');
      const utxos = await listBchUtxos(input.address, { rpc, chain: config.chain, minConfirmations: input.minConfirmations ?? 1 });
      const plan = planBchPayment(utxos, input.amountSatoshis, input.feeRateSatPerByte ?? 1);
      const selected = plan.selectedUtxos.map(item => {
        const found = utxos.find(row => row.txid === item.txid && row.outputIndex === item.outputIndex);
        if (!found?.scriptPubKey) throw new Error('A selected source output has no node-provided locking script.');
        return found;
      });
      let changeScriptPubKey;
      if (plan.changeSatoshis > 0) {
        if (typeof input.changeAddress !== 'string' || !input.changeAddress.trim()) throw new Error('A wallet-derived changeAddress is required when change is returned. KEYSTONE will not guess a change address.');
        const changeAddress = validateBchAddressFormat(input.changeAddress);
        const changeCheck = await rpc('validateaddress', [changeAddress]);
        if (!changeCheck?.isvalid || typeof changeCheck.scriptPubKey !== 'string') throw new Error('BCH node did not validate the wallet-derived change address on the selected network.');
        changeScriptPubKey = changeCheck.scriptPubKey;
      }
      const built = buildUnsignedBchTransaction({
        selectedUtxos: selected, destinationScriptPubKey: destinationCheck.scriptPubKey, changeScriptPubKey,
        amountSatoshis: plan.amountSatoshis, changeSatoshis: plan.changeSatoshis,
        feeSatoshis: plan.estimatedFeeSatoshis
      });
      return send(res, 200, { chain: config.chain, sourceAddress: input.address, destinationAddress: destination, ...built });
    }
    if (req.method === 'POST' && url.pathname === '/api/transactions/signing-request') {
      const input = await body(req);
      const request = createBchSignRequest(input, config.chain);
      const rpc = createBchRpcClient();
      const info = await rpc('getblockchaininfo', []);
      const expectedNodeChain = config.chain === 'mainnet' ? 'main' : 'chipnet';
      if (info?.chain !== expectedNodeChain) throw new Error(`Configured BCH node reports ${info?.chain || 'unknown'}; ${config.chain} signing is blocked.`);
      for (const output of request.transaction.sourceOutputs) {
        const live = await rpc('gettxout', [output.txid, output.outputIndex, true]);
        if (!live) throw new Error(`Source output ${output.txid}:${output.outputIndex} is spent or unavailable on ${config.chain}.`);
        const liveValue = Math.round(Number(live.value) * 100_000_000);
        const liveScript = live.scriptPubKey?.hex?.toLowerCase();
        const suppliedScript = (output.lockingBytecode || output.scriptPubKey).toLowerCase();
        if (!Number.isSafeInteger(liveValue) || liveValue !== output.valueSatoshis || liveScript !== suppliedScript) throw new Error(`Source output ${output.txid}:${output.outputIndex} does not match the selected-network node data.`);
      }
      return send(res, 200, { request, broadcast: false, chain: config.chain, sourceOutputsVerified: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/transactions/verify-signed') {
      const input = await body(req);
      const signedTransaction = validateSignedTransactionResponse({ signedTransaction: input.signedTransaction });
      const integrity = await verifySignedTransactionCryptographically(input.unsignedTransaction, signedTransaction, input.sourceOutputs);
      return send(res, 200, { signedTransaction, integrity, chain: config.chain, broadcast: false });
    }
    if (req.method === 'POST' && url.pathname === '/api/transactions/test-acceptance') {
      const input = await body(req);
      const result = await testBchMempoolAcceptance(input.transactionHex, { rpc: createBchRpcClient(), chain: config.chain });
      return send(res, 200, result);
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/transactions/status/')) {
      const txid = url.pathname.slice('/api/transactions/status/'.length);
      const result = await getBchTransactionStatus(txid, { rpc: createBchRpcClient(), chain: config.chain });
      return send(res, 200, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/transactions/inspect') {
      const input = await body(req);
      const result = inspectBchTransaction(input.transactionHex, input.sourceOutputs || [], input.feeRateSatPerByte ?? null);
      return send(res, 200, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/transactions/broadcast') {
      const input = await body(req);
      const result = await broadcastMainnetTransaction(input.transactionHex, {
        rpc: createBchRpcClient(), chain: config.chain,
        confirmation: input.confirmation, expectedTxid: input.expectedTxid
      });
      return send(res, 200, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/payment-requests') {
      const input = await body(req);
      const request = await createPaymentRequest(store, input, Date.now(), { chain: config.chain, maxSatoshis: config.maxPaymentSatoshis });
      return send(res, 201, request);
    }
    const paymentMatch = url.pathname.match(/^\/api\/payment-requests\/([0-9a-f-]{36})$/i);
    if (req.method === 'GET' && paymentMatch) {
      const request = await store.getPaymentRequest(paymentMatch[1]);
      if (!request) return send(res, 404, { error: 'Payment request not found.' });
      return send(res, 200, { ...request, active: isPaymentRequestActive(request) });
    }
    if (req.method === 'POST' && url.pathname === '/api/registry/validate') {
      const input = await body(req);
      const checked = await validateRegistryEvent(input.event);
      if (!checked.valid) return send(res, 400, { valid: false, error: checked.error });
      return send(res, 200, { valid: true, eventId: input.event.id, pubkey: input.event.pubkey, bindingId: checked.payload.proofBundle.bindingId, chain: checked.payload.proofBundle.chain });
    }
    if (req.method === 'POST' && url.pathname === '/api/registry/publish') {
      const input = await body(req);
      const checked = await validateRegistryEvent(input.event);
      if (!checked.valid) return send(res, 400, { error: checked.error });
      const stored = await store.putRegistryEvent(input.event, checked.payload);
      if (stored.conflict) return send(res, 409, { error: 'A different registry record already exists for this event ID.' });
      const relayResult = config.nostrRelays.length ? await publishToRelays(input.event, config.nostrRelays) : { configured: false, published: [], failed: [], message: 'No Nostr relays configured; event stored locally only.' };
      return send(res, stored.duplicate ? 200 : 201, { ok: true, duplicate: Boolean(stored.duplicate), eventId: input.event.id, bindingId: checked.payload.proofBundle.bindingId, relayPublication: relayResult });
    }
    if (req.method === 'GET' && url.pathname === '/api/registry/discover') {
      const pubkey = url.searchParams.get('pubkey') || '';
      const relayResult = await discoverFromRelays(pubkey, config.nostrRelays);
      const verified = [];
      const rejected = [];
      for (const event of relayResult.events) {
        const checked = await validateRegistryEvent(event);
        if (checked.valid) verified.push({ event, bindingId: checked.payload.proofBundle.bindingId, chain: checked.payload.proofBundle.chain });
        else rejected.push({ eventId: event?.id || null, reason: checked.error });
      }
      return send(res, 200, { configured: relayResult.configured, queriedPubkey: pubkey, received: relayResult.events.length, verified, rejected });
    }
    const registryMatch = url.pathname.match(/^\/api\/registry\/([0-9a-f]{64})$/i);
    if (req.method === 'GET' && registryMatch) {
      const rawLimit = url.searchParams.get('limit');
      const limit = rawLimit === null ? 50 : Number(rawLimit);
      const cursor = url.searchParams.get('cursor');
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) return send(res, 400, { error: 'Registry page limit must be an integer from 1 to 100.' });
      if (cursor !== null && (!/^[0-9a-f]{64}$/i.test(cursor))) return send(res, 400, { error: 'Registry cursor must be a 64-character hexadecimal event ID.' });
      const page = await store.listRegistryPageByPubkey(registryMatch[1].toLowerCase(), { limit, cursor });
      if (page.cursorError) return send(res, 400, { error: page.cursorError });
      return send(res, 200, page);
    }
    if (req.method === 'POST' && url.pathname === '/api/verify-bundle') {
      const input = await body(req);
      const result = await verifyProofBundle(input.bundle);
      return send(res, result.valid ? 200 : 400, result);
    }
    const proofMatch = url.pathname.match(/^\/api\/proof-bundles\/([0-9a-f-]{36})$/i);
    if (req.method === 'GET' && proofMatch) {
      const binding = await store.getBinding(proofMatch[1]);
      if (!binding?.proofBundle) return send(res, 404, { error: 'Portable proof bundle not found.' });
      return send(res, 200, binding.proofBundle);
    }
    const match = url.pathname.match(/^\/api\/bindings\/([0-9a-f-]{36})$/i);
    if (req.method === 'GET' && match) {
      const binding = await store.getBinding(match[1]);
      if (!binding) return send(res, 404, { error: 'Binding not found.' });
      const { proofBundle, ...publicBinding } = binding;
      return send(res, 200, { binding: publicBinding, proofBundleUrl: `/api/proof-bundles/${binding.id}`, independentlyVerifiable: true });
    }
    if (req.method === 'GET') {
      const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
      const resolved = path.resolve(publicDir, `.${pathname}`);
      if (!resolved.startsWith(publicDir + path.sep)) return send(res, 403, { error: 'Forbidden' });
      try { const data = await fs.readFile(resolved); res.writeHead(200, { 'content-type': mime[path.extname(resolved)] || 'application/octet-stream', 'cache-control': 'no-store' }); return res.end(data); }
      catch { return send(res, 404, { error: 'Not found' }); }
    }
    return send(res, 404, { error: 'Route not found.' });
  } catch (e) { return send(res, 400, { error: e.message || 'Request failed.' }); }
});
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.listen(config.port, config.host, () => {
  const mode = config.allowPublicHost ? 'PUBLIC DEMO' : 'LOCAL';
  console.log(`KEYSTONE ${config.chain.toUpperCase()} [${mode}] listening at http://${config.host}:${config.port}`);
  if (config.allowPublicHost) console.log('  → Public hosting enabled via ALLOW_PUBLIC_HOST=true');
  if (config.chain === 'mainnet') console.log('  → MAINNET mode active — keep payment amounts small');
});
