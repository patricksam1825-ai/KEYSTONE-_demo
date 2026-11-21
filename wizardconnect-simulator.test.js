import test from 'node:test';
import assert from 'node:assert/strict';
import { getWizardConnectSessionState, validateWalletInputPaths, validateWalletSigningResponse } from '../public/wizardconnect-guards.js';
import { createWizardConnectSimulation } from './helpers/wizardconnect-wallet-simulator.js';

test('simulated wallet completes relay, key-exchange and hdwalletv1 readiness stages', () => {
  const sim = createWizardConnectSimulation();
  let keyExchange = false;
  let walletReady = false;
  sim.relay.events.on('keyexchangecomplete', () => { keyExchange = true; });
  sim.wallet.on('walletready', () => { walletReady = true; });

  assert.equal(sim.relay.status, 'connected');
  sim.completeKeyExchange();
  assert.equal(keyExchange, true);
  sim.announceWalletReady();
  assert.equal(walletReady, true);

  const state = getWizardConnectSessionState(sim.wallet, sim.relay);
  assert.equal(state.ready, true);
  assert.deepEqual([...state.pathNames].sort(), ['change', 'receive']);
});

test('simulated wallet signing approval returns a response accepted by KEYSTONE guards', async () => {
  const sim = createWizardConnectSimulation();
  sim.completeKeyExchange();
  sim.announceWalletReady();
  const state = getWizardConnectSessionState(sim.wallet, sim.relay);
  const request = { inputPaths: [[0, 'receive', 0]] };
  validateWalletInputPaths(request.inputPaths, state.pathNames);
  const response = await sim.wallet.signTransaction(request);
  assert.equal(validateWalletSigningResponse(response), 'aabbccdd');
});

test('simulated wallet rejection is surfaced and never treated as a signature', async () => {
  const sim = createWizardConnectSimulation({ signingError: 'User rejected the request' });
  sim.announceWalletReady();
  await assert.rejects(() => sim.wallet.signTransaction({}), /User rejected/);
});

test('simulated malformed wallet response is rejected by the production response guard', async () => {
  const sim = createWizardConnectSimulation({ signingResponse: {
    action: 'wallet_ready', sequence: 1, time: 1_800_000_000, signedTransaction: 'aabb'
  }});
  sim.announceWalletReady();
  const response = await sim.wallet.signTransaction({});
  assert.throws(() => validateWalletSigningResponse(response), /unexpected signing response/);
});

test('simulated incompatible protocol cannot become signing-ready', () => {
  const sim = createWizardConnectSimulation({ protocol: 'unsupported-protocol' });
  sim.announceWalletReady();
  const state = getWizardConnectSessionState(sim.wallet, sim.relay);
  assert.equal(state.ready, false);
  assert.equal(state.reason, 'unsupported-protocol');
});

test('simulated disconnect invalidates the session and prevents further signing', async () => {
  const sim = createWizardConnectSimulation();
  sim.announceWalletReady();
  assert.equal(getWizardConnectSessionState(sim.wallet, sim.relay).ready, true);
  sim.disconnect();
  assert.equal(getWizardConnectSessionState(sim.wallet, sim.relay).ready, false);
  await assert.rejects(() => sim.wallet.signTransaction({}), /not connected/);
});

test('simulated reconnect creates a fresh relay and fresh wallet session', () => {
  const first = createWizardConnectSimulation();
  first.disconnect();
  const second = createWizardConnectSimulation();
  second.announceWalletReady();
  assert.notEqual(first.relay, second.relay);
  assert.equal(getWizardConnectSessionState(second.wallet, second.relay).ready, true);
});
