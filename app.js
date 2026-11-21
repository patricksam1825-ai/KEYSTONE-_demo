// Optional browser libraries load only when needed. If the CDN is unreachable, the core identity-binding
// flow (challenge, NIP-07, signature paste, verification, discovery) still works and only
// WizardConnect pairing / QR codes show a clear error.
const CDN = {
  core: 'https://esm.sh/@wizardconnect/core@0.2.0',
  dapp: 'https://esm.sh/@wizardconnect/dapp@0.2.0',
  qr: 'https://esm.sh/qrcode@1.5.4'
};
const cdnCache = {};
function cdn(name) {
  cdnCache[name] ??= import(CDN[name]).catch(() => {
    delete cdnCache[name]; // allow a retry
    throw new Error(`Could not load the ${name} browser library from esm.sh. Check your internet connection and try again.`);
  });
  return cdnCache[name];
}
async function loadQrCode() {
  if (!cdnCache.qr) {
    cdnCache.qr = (async () => {
      const sources = [CDN.qr, 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm'];
      let lastError;
      for (const source of sources) {
        try { return await import(source); }
        catch (error) { lastError = error; }
      }
      throw new Error(`QR generator unavailable. Check your connection and retry. You can still copy the URI below. (${lastError?.message || 'library load failed'})`);
    })().catch(error => { delete cdnCache.qr; throw error; });
  }
  return cdnCache.qr;
}
function showQrFailure(statusId, message) {
  status(statusId, `${message} The URI is available to copy manually.`, true);
}

import { getWizardConnectSessionState, validateWalletInputPaths, validateWalletSigningResponse } from './wizardconnect-guards.js';
import { createWizardConnectDiagnostics } from './wizardconnect-diagnostics.js';

const $ = id => document.getElementById(id);
let activeChallenge = null;
let lastBindingId = null;
let wizardRelay = null;
let wizardManager = null;
let wizardUri = '';
let latestPaymentUri = '';
let activeChain = 'chipnet';
let wizardConnectTimer = null;
let wizardConnectDiagnostics = null;

async function api(path, options={}) {
  const r = await fetch(path, { ...options, headers: { 'content-type':'application/json', ...(options.headers||{}) } });
  const data = await r.json(); if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`); return data;
}
function status(id, text, error=false) { $(id).textContent=text; $(id).classList.toggle('error',error); }
try { const h=await api('/api/health'); $('chain').textContent=`${h.chain.toUpperCase()} · ONLINE`; $('footerVersion').textContent=`v${h.version}`; applyNetwork(h.chain); }
catch { $('chain').textContent='OFFLINE'; }

// WizardConnect pairing. No wallet secret material is requested or handled here.
$('connectWallet').addEventListener('click', async () => {
  $('connectWallet').disabled = true;
  status('walletStatus', 'Starting encrypted WizardConnect relay…');
  try {
    if (wizardRelay) throw new Error('A WizardConnect session is already active.');
    const [{ initiateDappRelay }, { DappConnectionManager }] = await Promise.all([cdn('core'), cdn('dapp')]);
    wizardConnectDiagnostics = createWizardConnectDiagnostics();
    wizardManager = new DappConnectionManager('KEYSTONE', undefined, { session: false });
    wizardManager.on('messagereceived', (msg) => wizardConnectDiagnostics?.recordProtocolMessage(msg));
    wizardManager.on('walletready', async (msg) => {
      clearTimeout(wizardConnectTimer);
      $('disconnectWallet').disabled = false;
      const sessionState = getWizardConnectSessionState(wizardManager, wizardRelay);
      wizardConnectDiagnostics?.markWalletReady({ protocol: wizardManager.protocol, paths: sessionState.paths.map(p => p?.name) });
      if (!sessionState.ready) {
        $('walletDetails').textContent = JSON.stringify({
          diagnostics: wizardConnectDiagnostics?.snapshot(),
          walletName: msg.wallet_name || wizardManager.walletName || 'Connected wallet',
          protocol: wizardManager.protocol,
          readinessReason: sessionState.reason,
          note: 'No private keys, shared secret, or extended public-key values are recorded in diagnostics.'
        }, null, 2);
        $('walletDetails').classList.remove('hidden');
        status('walletStatus', sessionState.reason === 'unsupported-protocol'
          ? 'Wallet connected, but it did not negotiate the BCH hdwalletv1 protocol required by KEYSTONE.'
          : 'Wallet handshake completed without usable public derivation paths. Disconnect and try a compatible BCH wallet.', true);
        refreshSignButton();
        return;
      }
      const paths = sessionState.paths.map(p => p.name);
      $('walletDetails').textContent = JSON.stringify({
        diagnostics: wizardConnectDiagnostics?.snapshot(),
        walletName: msg.wallet_name || wizardManager.walletName || 'Connected BCH wallet',
        protocol: wizardManager.protocol,
        availablePublicKeyPaths: paths,
        note: 'Extended public keys remain in this browser session and are not sent to the KEYSTONE server.'
      }, null, 2);
      $('walletDetails').classList.remove('hidden');
      $('walletQrWrap').classList.add('hidden');
      $('disconnectWallet').disabled = false;
      status('walletStatus', 'Wallet paired. BCH hdwalletv1 session and public derivation paths received. BCH message-signature proof is still required separately.');
      refreshSignButton();
    });
    wizardManager.on('disconnect', (reason, message) => {
      wizardConnectDiagnostics?.setError(`Wallet disconnected: ${reason || 'remote disconnect'}${message ? ` — ${message}` : ''}`);
      $('walletDetails').textContent = JSON.stringify(wizardConnectDiagnostics?.snapshot(), null, 2);
      $('walletDetails').classList.remove('hidden');
      status('walletStatus', `Wallet disconnected: ${reason || 'remote disconnect'}${message ? ` — ${message}` : ''}`, true);
      cleanupWizard(false);
    });
    wizardRelay = initiateDappRelay((payload) => {
      wizardManager.updateConnection(payload.client, payload.status);
      const state = payload.status?.status || 'connecting';
      wizardConnectDiagnostics?.setRelayStatus(payload.status);
      if (state === 'connected') status('walletStatus', wizardConnectDiagnostics.waitingMessage());
      if (state === 'error') {
        wizardConnectDiagnostics?.setError('Relay connection failed. Check the network and retry.');
        $('walletDetails').textContent = JSON.stringify(wizardConnectDiagnostics?.snapshot(), null, 2);
        $('walletDetails').classList.remove('hidden');
        status('walletStatus', 'WizardConnect relay error. Check your connection and try again.', true);
        cleanupWizard(false);
      }
    });
    wizardManager.attachRelay(wizardRelay);
    wizardRelay.events?.on?.('keyexchangecomplete', () => {
      wizardConnectDiagnostics?.markKeyExchangeComplete();
      status('walletStatus', wizardConnectDiagnostics.waitingMessage());
    });
    wizardUri = wizardRelay.uri;
    $('walletUri').textContent = wizardUri;
    wizardConnectTimer = setTimeout(() => {
      if (wizardRelay && !getWizardConnectSessionState(wizardManager, wizardRelay).ready) {
        $('walletDetails').textContent = JSON.stringify(wizardConnectDiagnostics?.snapshot(), null, 2);
        $('walletDetails').classList.remove('hidden');
        status('walletStatus', wizardConnectDiagnostics?.waitingMessage() || 'Still waiting for wallet approval.');
      }
    }, 90000);
    $('walletQrWrap').classList.remove('hidden');
    try {
      const { default: QRCode } = await loadQrCode();
      // WizardConnect specifies qrUri (alphanumeric-safe) for QR encoding; uri remains the copy/paste form.
      $('walletQr').src = await QRCode.toDataURL(wizardRelay.qrUri || wizardUri, { width: 260, margin: 2, errorCorrectionLevel: 'M' });
      status('walletStatus', 'Pairing request ready. Open a compatible BCH wallet and scan the QR code.');
    } catch (qrError) {
      $('walletQr').removeAttribute('src');
      showQrFailure('walletStatus', qrError.message);
    }
  } catch (e) {
    wizardConnectDiagnostics?.setError(e.message || 'Could not start WizardConnect.');
    if (wizardConnectDiagnostics) { $('walletDetails').textContent = JSON.stringify(wizardConnectDiagnostics.snapshot(), null, 2); $('walletDetails').classList.remove('hidden'); }
    status('walletStatus', e.message || 'Could not start WizardConnect.', true);
    cleanupWizard(false);
  } finally {
    $('connectWallet').disabled = Boolean(wizardRelay);
  }
});

function cleanupWizard(clearStatus = true) {
  clearTimeout(wizardConnectTimer);
  wizardConnectTimer = null;
  try { wizardRelay?.cleanup?.(); } catch {}
  try { wizardManager?.clearStoredSession?.(); } catch {}
  wizardRelay = null; wizardManager = null; wizardUri = '';
  wizardConnectDiagnostics = null;
  $('walletQrWrap').classList.add('hidden');
  $('walletDetails').classList.add('hidden');
  $('connectWallet').disabled = false;
  $('disconnectWallet').disabled = true;
  refreshSignButton();
  if (clearStatus) status('walletStatus', 'Wallet disconnected.');
}
$('disconnectWallet').addEventListener('click', async () => {
  try { await wizardManager?.sendDisconnect?.('User disconnected from KEYSTONE'); } catch {}
  cleanupWizard(true);
});
$('copyWalletUri').addEventListener('click', async () => {
  if (!wizardUri) return;
  try { await navigator.clipboard.writeText(wizardUri); status('walletStatus', 'Pairing URI copied. Treat it as temporary session data and do not post it publicly.'); }
  catch { status('walletStatus', 'Could not copy URI. Scan the QR code instead.', true); }
});

$('create').addEventListener('click', async () => {
  $('create').disabled=true; status('createStatus','Creating challenge…');
  try { activeChallenge=await api('/api/challenges',{method:'POST',body:JSON.stringify({bchAddress:$('bch').value,nostrPubkey:$('pubkey').value})}); $('message').value=activeChallenge.message; $('proofPanel').classList.remove('hidden'); status('createStatus',`Challenge created. Expires ${new Date(activeChallenge.expiresAt).toLocaleTimeString()}. Keep the challenge token private.`); $('proofPanel').scrollIntoView({behavior:'smooth'}); }
  catch(e){status('createStatus',e.message,true);} finally{$('create').disabled=false;}
});
$('copy').addEventListener('click',async()=>{await navigator.clipboard.writeText($('message').value);$('copy').textContent='Copied';setTimeout(()=>$('copy').textContent='Copy challenge message',1500);});
$('signNostr').addEventListener('click', async () => {
  const button = $('signNostr');
  button.disabled = true;
  status('verifyStatus', 'Requesting Nostr signature from your browser extension…');
  try {
    if (!activeChallenge) throw new Error('Create an identity challenge first.');
    if (!window.nostr?.signEvent || !window.nostr?.getPublicKey) throw new Error('No compatible NIP-07 Nostr browser extension was found. You can still paste a signed event JSON manually.');
    const extensionPubkey = String(await window.nostr.getPublicKey()).toLowerCase();
    if (extensionPubkey !== $('pubkey').value.trim().toLowerCase()) throw new Error('Your Nostr extension is logged into a different public key than the challenged identity.');
    const template = {
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', activeChallenge.challengeId],
        ['keystone', 'identity-proof', 'v1'],
        ['alt', 'KEYSTONE BCH and Nostr identity ownership proof']
      ],
      content: activeChallenge.message
    };
    const signed = await window.nostr.signEvent(template);
    $('event').value = JSON.stringify(signed, null, 2);
    status('verifyStatus', 'Nostr proof signed and filled in. Now paste the BCH compact message signature and verify both proofs.');
  } catch (error) {
    status('verifyStatus', error.message || 'Nostr signing failed.', true);
  } finally { button.disabled = false; }
});

// All transaction tools support the explicitly configured server network.
function applyNetwork(chain) {
  activeChain = chain === 'mainnet' ? 'mainnet' : 'chipnet';
  const main = activeChain === 'mainnet';
  const network = main ? 'Mainnet' : 'Chipnet';
  $('bchLabel').textContent = `BCH ${network} CashAddr`;
  $('bch').placeholder = main ? 'bitcoincash:...' : 'bchtest:...';
  $('footerNetwork').textContent = activeChain.toUpperCase();
  for (const id of ['signPanel', 'utxoPanel', 'inspectPanel']) $(id)?.classList.remove('hidden');
  const notice = document.querySelector('.hero .notice span');
  if (notice) notice.textContent = main
    ? 'This server is configured for BCH Mainnet. Transactions can spend real BCH. Never approve a transaction unless you have checked every input, output, amount and fee in your wallet.'
    : 'This server is configured for BCH Chipnet test transactions. KEYSTONE never asks for wallet seed phrases or private keys.';
  const payTitle = $('paymentQr')?.alt; if (payTitle !== undefined) $('paymentQr').alt = `${network} payment request QR code`;
}

// Format check only (the server does the real cryptographic verification).
function checkSignatureFormat(raw) {
  const sig = String(raw).replace(/\s+/g, '');
  if (!sig) return { sig, text: '', error: false };
  if (!/^[A-Za-z0-9+/]{87}=$/.test(sig)) return { sig, error: true, text: 'This does not look like a BCH message signature. It should be 88 characters of base64 ending with "=". Copy it again from your wallet.' };
  const header = atob(sig).charCodeAt(0);
  if (header < 27 || header > 34) return { sig, error: true, text: 'Unsupported signature type. KEYSTONE needs a standard BCH message signature (not a transaction or Nostr signature).' };
  return { sig, error: false, text: `Format looks right (${header >= 31 ? 'compressed' : 'uncompressed'} key). The server will verify it cryptographically.` };
}
$('signature').addEventListener('input', () => {
  const r = checkSignatureFormat($('signature').value);
  if ($('signature').value !== r.sig) $('signature').value = r.sig; // remove spaces and line breaks from pasted text
  status('sigHint', r.text, r.error);
});
$('verify').addEventListener('click',async()=>{
  if(!activeChallenge)return; $('verify').disabled=true; status('verifyStatus','Verifying both cryptographic proofs…');
  try { const sigCheck=checkSignatureFormat($('signature').value); if(sigCheck.error||!sigCheck.sig) throw new Error(sigCheck.text||'Paste your BCH wallet signature first.'); let event; try{event=JSON.parse($('event').value);}catch{throw new Error('Nostr event must be valid JSON.');}
    const result=await api('/api/identity/verify',{method:'POST',body:JSON.stringify({challengeId:activeChallenge.challengeId,challengeToken:activeChallenge.challengeToken,bchSignature:sigCheck.sig,nostrEvent:event})});
    lastBindingId=result.binding.id; $('publishRegistry').disabled=false; $('createPayment').disabled=false; const {proofBundle,...publicBinding}=result.binding; $('result').textContent=JSON.stringify(publicBinding,null,2);$('resultPanel').classList.remove('hidden');status('verifyStatus','Both proofs verified. Binding record created.');$('resultPanel').scrollIntoView({behavior:'smooth'});activeChallenge=null;
  }catch(e){status('verifyStatus',e.message,true);}finally{$('verify').disabled=false;}
});

$('downloadProof').addEventListener('click',async()=>{if(!lastBindingId)return;try{const bundle=await api(`/api/proof-bundles/${lastBindingId}`);const blob=new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`keystone-proof-${lastBindingId}.json`;a.click();URL.revokeObjectURL(a.href);}catch(e){alert(e.message);}});

$('verifyBundle').addEventListener('click',async()=>{const file=$('bundleFile').files?.[0];if(!file){status('bundleStatus','Choose a proof bundle JSON file first.',true);return;}try{const bundle=JSON.parse(await file.text());const result=await api('/api/verify-bundle',{method:'POST',body:JSON.stringify({bundle})});$('bundleResult').textContent=JSON.stringify(result,null,2);status('bundleStatus','Both proofs independently verified by this verifier.');}catch(e){$('bundleResult').textContent='';status('bundleStatus',e.message,true);}});

window.addEventListener('beforeunload', () => { try { wizardRelay?.cleanup?.(); } catch {} });

// Nostr relay registry: the browser signer signs the public announcement; private keys never leave the extension.
function relayUrls() {
  const values = $('relays').value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (!values.length) throw new Error('Enter at least one Nostr relay URL.');
  for (const value of values) { const u = new URL(value); if (u.protocol !== 'wss:') throw new Error('Only secure wss:// Nostr relays are allowed.'); }
  return [...new Set(values)];
}
async function publishEventToRelay(url, event) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url); let settled=false;
    const timer=setTimeout(()=>finish(new Error('Relay timeout')),9000);
    function finish(err, value){if(settled)return;settled=true;clearTimeout(timer);try{ws.close();}catch{}err?reject(err):resolve(value);}
    ws.addEventListener('open',()=>ws.send(JSON.stringify(['EVENT',event])),{once:true});
    ws.addEventListener('message',ev=>{let m;try{m=JSON.parse(ev.data)}catch{return;}if(m[0]==='OK'&&m[1]===event.id)finish(m[2]?null:new Error(m[3]||'Relay rejected event'),{accepted:m[2],message:m[3]});});
    ws.addEventListener('error',()=>finish(new Error('Relay connection failed')),{once:true});
  });
}
async function discoverRelay(url, pubkey) {
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket(url), sub='ks'+Math.random().toString(36).slice(2); const events=[]; let done=false;
    const timer=setTimeout(()=>finish(null),10000);
    function finish(err){if(done)return;done=true;clearTimeout(timer);try{ws.send(JSON.stringify(['CLOSE',sub]));ws.close();}catch{}err?reject(err):resolve(events);}
    ws.addEventListener('open',()=>ws.send(JSON.stringify(['REQ',sub,{kinds:[30078],authors:[pubkey],'#t':['keystone-binding'],limit:50}])),{once:true});
    ws.addEventListener('message',ev=>{let m;try{m=JSON.parse(ev.data)}catch{return;}if(m[0]==='EVENT'&&m[1]===sub&&m[2])events.push(m[2]);if(m[0]==='EOSE'&&m[1]===sub)finish(null);});
    ws.addEventListener('error',()=>finish(new Error('Relay connection failed')),{once:true});
  });
}
$('publishRegistry').addEventListener('click', async()=>{
  $('publishRegistry').disabled=true; status('publishStatus','Preparing signed public registry announcement…');
  try {
    if(!lastBindingId) throw new Error('Create and verify an identity binding first.');
    if(!window.nostr?.signEvent) throw new Error('A Nostr browser signer extension with window.nostr.signEvent is required.');
    const proofBundle=await api(`/api/proof-bundles/${lastBindingId}`);
    const pubkey=proofBundle.challenge.nostrPubkey;
    if(window.nostr.getPublicKey){const signerPubkey=await window.nostr.getPublicKey();if(signerPubkey!==pubkey)throw new Error('Your Nostr extension is logged into a different public key than this binding.');}
    const template={kind:30078,created_at:Math.floor(Date.now()/1000),tags:[['d',`keystone-binding:${lastBindingId}`],['t','keystone-binding'],['alt','KEYSTONE verifiable BCH and Nostr identity binding']],content:JSON.stringify({protocol:'KEYSTONE-NOSTR-REGISTRY-v1',proofBundle})};
    const signed=await window.nostr.signEvent(template);
    const accepted=await api('/api/registry/publish',{method:'POST',body:JSON.stringify({event:signed})});
    const relays=relayUrls(); const results=await Promise.allSettled(relays.map(r=>publishEventToRelay(r,signed)));
    const summary=results.map((r,i)=>`${relays[i]}: ${r.status==='fulfilled'?'accepted':r.reason.message}`).join('\n');
    status('publishStatus',`Registry event validated locally (${accepted.eventId}). Relay results:\n${summary}`,results.every(r=>r.status==='rejected'));
    $('registryPubkey').value=pubkey;
  } catch(e){status('publishStatus',e.message,true);} finally{$('publishRegistry').disabled=!lastBindingId;}
});
$('discoverRegistry').addEventListener('click',async()=>{
  $('discoverRegistry').disabled=true; $('registryResults').textContent=''; status('discoverStatus','Querying Nostr relays…');
  try {
    const pubkey=$('registryPubkey').value.trim().toLowerCase(); if(!/^[a-f0-9]{64}$/.test(pubkey))throw new Error('Enter a valid 64-character hexadecimal Nostr public key.');
    const relays=relayUrls(); const all=await Promise.allSettled(relays.map(r=>discoverRelay(r,pubkey)));
    const events=new Map(); for(const r of all)if(r.status==='fulfilled')for(const ev of r.value)events.set(ev.id,ev);
    const verified=[]; const rejected=[];
    for(const event of events.values()){
      try{
        if(event.pubkey!==pubkey) throw new Error('Relay returned an event from a different Nostr public key.');
        const result=await api('/api/registry/validate',{method:'POST',body:JSON.stringify({event})});
        verified.push({eventId:result.eventId,bindingId:result.bindingId,chain:result.chain,nostrPubkey:result.pubkey,verified:true,verification:'event-signature-and-embedded-BCH/Nostr-proof'});
      } catch(e){rejected.push({eventId:typeof event.id==='string'?event.id:'unknown',error:e.message});}
    }
    $('registryResults').textContent=JSON.stringify({verified,rejected,relayErrors:all.filter(x=>x.status==='rejected').length},null,2);
    status('discoverStatus',`Found ${events.size} announcement(s); ${verified.length} independently verified, ${rejected.length} rejected. Relay errors: ${all.filter(x=>x.status==='rejected').length}.`);
  }catch(e){status('discoverStatus',e.message,true);}finally{$('discoverRegistry').disabled=false;}
});
const publishButton=$('publishRegistry');
if(publishButton) publishButton.disabled=!lastBindingId;


// Verified-recipient payment requests (Chipnet or Mainnet, as the server is configured). This creates a URI only; no transaction is signed or broadcast.
$('createPayment').addEventListener('click', async () => {
  $('createPayment').disabled = true;
  status('payStatus', 'Creating payment request…');
  try {
    if (!lastBindingId) throw new Error('Verify a BCH + Nostr identity binding first.');
    const amountSatoshis = Number($('payAmount').value);
    if (!Number.isSafeInteger(amountSatoshis)) throw new Error('Enter a whole-number satoshi amount.');
    const request = await api('/api/payment-requests', { method: 'POST', body: JSON.stringify({ bindingId: lastBindingId, amountSatoshis, memo: $('payMemo').value, expiresInSeconds: Number($('payExpiry').value) }) });
    latestPaymentUri = request.uri;
    $('paymentQr').removeAttribute('src');
    try {
      const { default: QRCode } = await loadQrCode();
      $('paymentQr').src = await QRCode.toDataURL(request.uri, { width: 240, margin: 2, errorCorrectionLevel: 'M' });
    } catch (qrError) {
      showQrFailure('payStatus', qrError.message);
    }
    $('paymentUri').textContent = request.uri;
    $('paymentTitle').textContent = `${request.amountBch} BCH · ${request.chain === 'mainnet' ? 'MAINNET (real money)' : 'Chipnet'}`;
    $('paymentDetails').textContent = JSON.stringify({ requestId: request.id, bindingId: request.bindingId, recipientAddress: request.recipientAddress, recipientNostrPubkey: request.recipientNostrPubkey, amountSatoshis: request.amountSatoshis, expiresAt: new Date(request.expiresAt).toISOString(), status: request.status, note: request.warning }, null, 2);
    $('paymentResult').classList.remove('hidden');
    status('payStatus', request.chain === 'mainnet' ? 'Payment request created. No funds have been sent. Approve it in your wallet only if the address and amount are right.' : 'Payment request created. No funds have been sent.');
  } catch (e) { status('payStatus', e.message, true); }
  finally { $('createPayment').disabled = !lastBindingId; }
});
$('copyPaymentUri').addEventListener('click', async () => {
  if (!latestPaymentUri) return;
  try { await navigator.clipboard.writeText(latestPaymentUri); status('payStatus', 'Payment URI copied. Nothing is sent until you approve it in your wallet.'); }
  catch { status('payStatus', 'Could not copy the URI.'); }
});

// Guarded WizardConnect signing request for the server's explicitly selected BCH network.
let signingController = null;
let signedTransactionForDownload = null;
let signedTransactionTxid = null;
function refreshSignButton() {
  const button = $('requestSign');
  if (!button) return;
  button.disabled = !getWizardConnectSessionState(wizardManager, wizardRelay).ready || Boolean(signingController);
}
$('requestSign').addEventListener('click', async () => {
  $('requestSign').disabled = true;
  $('cancelSign').disabled = false;
  signedTransactionForDownload = null;
  signedTransactionTxid = null;
  $('mainnetBroadcastControls')?.classList.add('hidden');
  $('downloadSignedTx').classList.add('hidden');
  $('signedTxResult').classList.add('hidden');
  $('testNodeAcceptance').classList.add('hidden');
  $('nodeAcceptanceResult').classList.add('hidden');
  try {
    if (!wizardManager || !wizardRelay) throw new Error('Connect a WizardConnect-compatible BCH wallet first.');
    const prepared = await api('/api/transactions/signing-request', { method: 'POST', body: JSON.stringify({
      transactionHex: $('unsignedTx').value,
      sourceOutputs: JSON.parse($('sourceOutputs').value),
      inputPaths: JSON.parse($('inputPaths').value),
      userPrompt: $('signPrompt').value
    }) });
    const request = prepared.request;
    const sessionState = getWizardConnectSessionState(wizardManager, wizardRelay);
    if (!sessionState.ready) throw new Error('The wallet session is not ready for BCH transaction signing. Reconnect the wallet first.');
    validateWalletInputPaths(request.inputPaths, sessionState.pathNames);
    signingController = new AbortController();
    status('signStatus', `Sending ${activeChain} signing request. Review the transaction carefully in your wallet…`);
    const response = await wizardManager.signTransaction(request, { signal: signingController.signal });
    const signedTransaction = validateWalletSigningResponse(response);
    const verified = await api('/api/transactions/verify-signed', { method: 'POST', body: JSON.stringify({
      unsignedTransaction: request.transaction.transaction,
      signedTransaction,
      sourceOutputs: request.transaction.sourceOutputs
    }) });
    signedTransactionForDownload = verified.signedTransaction;
    const integrity = verified.integrity;
    signedTransactionTxid = integrity.txid;
    $('expectedTxid').value = integrity.txid; $('broadcastConfirmationLabel').textContent = `Type BROADCAST THIS BCH ${activeChain.toUpperCase()} TRANSACTION to confirm`; $('broadcastConfirmation').value = ''; $('broadcastMainnet').textContent = `Broadcast this ${activeChain} transaction`; $('mainnetBroadcastControls').classList.remove('hidden');
    $('signedTxResult').textContent = JSON.stringify({
      integrityCheck: integrity,
      result: 'Wallet returned a signed transaction; authorised outputs and inputs structurally match.',
      chain: activeChain,
      broadcastRequested: false,
      signedTransactionHexLength: signedTransactionForDownload.length,
      note: 'Not broadcast. A wallet signature is not a broadcast; use the explicit network preflight and broadcast controls only after reviewing the transaction.'
    }, null, 2);
    $('signedTxResult').classList.remove('hidden');
    $('downloadSignedTx').classList.remove('hidden');
    $('testNodeAcceptance').classList.remove('hidden');
    status('signStatus', 'Signature received. The transaction has NOT been broadcast.');
  } catch (e) {
    status('signStatus', e.name === 'AbortError' ? 'Signing request cancelled.' : (e.message || 'Wallet signing failed.'), true);
  } finally {
    signingController = null;
    $('cancelSign').disabled = true;
    refreshSignButton();
  }
});
$('cancelSign').addEventListener('click', () => signingController?.abort('Cancelled by user'));
$('testNodeAcceptance').addEventListener('click', async () => {
  const button = $('testNodeAcceptance');
  button.disabled = true;
  $('nodeAcceptanceResult').classList.add('hidden');
  status('nodeAcceptanceStatus', `Asking your configured BCH ${activeChain} node to run a read-only mempool preflight…`);
  try {
    if (!signedTransactionForDownload) throw new Error('Sign and pass the local integrity check first.');
    const result = await api('/api/transactions/test-acceptance', {
      method: 'POST', body: JSON.stringify({ transactionHex: signedTransactionForDownload })
    });
    $('nodeAcceptanceResult').textContent = JSON.stringify(result, null, 2);
    $('nodeAcceptanceResult').classList.remove('hidden');
    status('nodeAcceptanceStatus', result.allowed ? `${activeChain} node says this transaction is currently acceptable. It has NOT been broadcast.` : `Node rejected it: ${result.rejectReason}` , !result.allowed);
  } catch (e) {
    status('nodeAcceptanceStatus', e.message || 'Node preflight failed.', true);
  } finally { button.disabled = false; }
});

$('broadcastMainnet')?.addEventListener('click', async () => {
  const button = $('broadcastMainnet'); button.disabled = true;
  $('broadcastResult').classList.add('hidden');
  try {
    if (!signedTransactionForDownload || !signedTransactionTxid) throw new Error('Sign and verify a transaction first.');
    const result = await api('/api/transactions/broadcast', { method: 'POST', body: JSON.stringify({
      transactionHex: signedTransactionForDownload,
      expectedTxid: signedTransactionTxid,
      confirmation: $('broadcastConfirmation').value
    }) });
    $('broadcastResult').textContent = JSON.stringify(result, null, 2);
    $('broadcastResult').classList.remove('hidden');
    status('broadcastStatus', `${activeChain.toUpperCase()} broadcast submitted. Transaction ID: ${result.txid}`);
  } catch (error) { status('broadcastStatus', error.message || 'Mainnet broadcast failed.', true); }
  finally { button.disabled = false; }
});

$('downloadSignedTx').addEventListener('click', () => {
  if (!signedTransactionForDownload) return;
  const file = { protocol: `KEYSTONE-${activeChain.toUpperCase()}-SIGNED-TX-v1`, chain: activeChain, broadcast: false, signedTransaction: signedTransactionForDownload, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `keystone-${activeChain}-signed-transaction.json`; a.click(); URL.revokeObjectURL(a.href);
});
const connectButton = $('connectWallet');
connectButton.addEventListener('click', () => setTimeout(refreshSignButton, 0));
const walletPanel = $('walletPanel');
if (walletPanel) {
  const observer = new MutationObserver(refreshSignButton);
  observer.observe($('walletDetails'), { attributes: true, attributeFilter: ['class'] });
}


// Local Chipnet transaction parser/fee inspector. Inspection only; never broadcasts.
const inspectButton = $('inspectTx');
if (inspectButton) inspectButton.addEventListener('click', async () => {
  inspectButton.disabled = true; status('inspectStatus', 'Parsing transaction…'); $('inspectResult').classList.add('hidden');
  try {
    let sourceOutputs = [];
    const rawSources = $('inspectSourceOutputs').value.trim();
    if (rawSources) { try { sourceOutputs = JSON.parse(rawSources); } catch { throw new Error('Source outputs must be valid JSON.'); } }
    const result = await api('/api/transactions/inspect', { method: 'POST', body: JSON.stringify({ transactionHex: $('inspectTxHex').value.trim(), sourceOutputs, feeRateSatPerByte: $('inspectFeeRate').value || null }) });
    $('inspectResult').textContent = JSON.stringify(result, null, 2); $('inspectResult').classList.remove('hidden');
    status('inspectStatus', 'Inspection complete. This is structural analysis, not consensus or UTXO validation.');
  } catch (e) { status('inspectStatus', e.message, true); } finally { inspectButton.disabled = false; }
});


// Chipnet node-backed UTXO discovery and non-signing payment planner.
let discoveredUtxos = [];
const loadUtxosButton = $('loadUtxos');
if (loadUtxosButton) loadUtxosButton.addEventListener('click', async () => {
  loadUtxosButton.disabled = true; status('utxoStatus', 'Querying configured BCH Node wallet…'); $('utxoResults').classList.add('hidden'); discoveredUtxos = [];
  try {
    const result = await api('/api/utxos/list', { method: 'POST', body: JSON.stringify({ address: $('utxoAddress').value.trim(), minConfirmations: Number($('utxoMinConf').value || 1) }) });
    discoveredUtxos = result.utxos; $('utxoResults').textContent = JSON.stringify(result, null, 2); $('utxoResults').classList.remove('hidden');
    status('utxoStatus', `Found ${result.count} spendable wallet-known output(s).`);
  } catch (e) { status('utxoStatus', e.message, true); } finally { loadUtxosButton.disabled = false; }
});
const planPaymentButton = $('planPayment');
if (planPaymentButton) planPaymentButton.addEventListener('click', async () => {
  planPaymentButton.disabled = true; status('planStatus', 'Calculating input selection and estimated fee…'); $('planResult').classList.add('hidden');
  try {
    if (!discoveredUtxos.length) throw new Error('Discover UTXOs first.');
    const result = await api('/api/transactions/plan', { method: 'POST', body: JSON.stringify({ address: $('utxoAddress').value.trim(), destinationAddress: $('planDestination').value.trim(), amountSatoshis: Number($('planAmount').value), feeRateSatPerByte: Number($('planFeeRate').value || 1), minConfirmations: Number($('utxoMinConf').value || 1) }) });
    $('planResult').textContent = JSON.stringify(result, null, 2); $('planResult').classList.remove('hidden');
    status('planStatus', 'Plan calculated. No transaction has been constructed, signed or broadcast.');
  } catch (e) { status('planStatus', e.message, true); } finally { planPaymentButton.disabled = false; }
});
