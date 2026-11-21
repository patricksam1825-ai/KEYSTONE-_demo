import test from 'node:test';
import assert from 'node:assert/strict';
import { createWizardConnectDiagnostics } from '../public/wizardconnect-diagnostics.js';

test('WizardConnect diagnostics distinguish relay, key exchange and wallet handshake stages', () => {
  const d = createWizardConnectDiagnostics();
  assert.match(d.waitingMessage(), /not reached the relay-connected stage/);
  d.setRelayStatus({ status: 'connected' });
  assert.match(d.waitingMessage(), /Waiting for a compatible wallet/);
  d.markKeyExchangeComplete();
  assert.match(d.waitingMessage(), /Encrypted key exchange completed/);
  d.recordProtocolMessage({ action: 'wallet_ready' });
  d.markWalletReady({ protocol: 'hdwalletv1', paths: ['receive', 'change'] });
  assert.deepEqual(d.snapshot(), { relayStatus: 'connected', keyExchangeComplete: true, walletReadyReceived: true, protocol: 'hdwalletv1', pathNames: ['receive', 'change'], lastProtocolAction: 'wallet_ready', error: null });
});

test('WizardConnect diagnostics expose errors without any key or URI material', () => {
  const d = createWizardConnectDiagnostics();
  d.setError('relay refused connection');
  assert.match(d.waitingMessage(), /relay refused connection/);
  assert.equal(JSON.stringify(d.snapshot()).includes('privateKey'), false);
  assert.equal(JSON.stringify(d.snapshot()).includes('secret'), false);
});
