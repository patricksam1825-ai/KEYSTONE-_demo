import test from 'node:test';
import assert from 'node:assert/strict';
import { getWizardConnectSessionState, validateWalletInputPaths, validateWalletSigningResponse } from '../public/wizardconnect-guards.js';

test('WizardConnect signing readiness requires the BCH protocol and public paths', () => {
  assert.equal(getWizardConnectSessionState(null, null).ready, false);
  assert.equal(getWizardConnectSessionState({ protocol: 'other', getSessionPaths: () => [{ name: 'receive' }] }, {}).reason, 'unsupported-protocol');
  assert.equal(getWizardConnectSessionState({ protocol: 'hdwalletv1', getSessionPaths: () => [] }, {}).reason, 'missing-public-paths');
  const state = getWizardConnectSessionState({ protocol: 'hdwalletv1', getSessionPaths: () => [{ name: 'receive', xpub: 'xpub-receive' }, { name: 'change', xpub: 'xpub-change' }] }, {});
  assert.equal(state.ready, true);
  assert.deepEqual([...state.pathNames].sort(), ['change', 'receive']);
  assert.equal(getWizardConnectSessionState({ protocol: 'hdwalletv1', getSessionPaths: () => [{ name: 'receive' }] }, {}).reason, 'invalid-public-paths');
  assert.equal(getWizardConnectSessionState({ protocol: 'hdwalletv1', getSessionPaths: () => [{ name: 'unknown', xpub: 'xpub' }] }, {}).reason, 'invalid-public-paths');
  assert.equal(getWizardConnectSessionState({ protocol: 'hdwalletv1', getSessionPaths: () => [{ name: 'receive', xpub: 'xpub' }, { name: 'receive', xpub: 'duplicate' }] }, {}).reason, 'invalid-public-paths');
});

test('signing path mappings must exist in the connected wallet session', () => {
  assert.equal(validateWalletInputPaths([[0, 'receive', 0], [1, 'change', 3]], new Set(['receive', 'change'])), true);
  assert.throws(() => validateWalletInputPaths([[0, 'defi', 0]], new Set(['receive', 'change'])), /did not share the required/);
  assert.throws(() => validateWalletInputPaths([], new Set(['receive'])), /Provide input paths/);
});


test('signing input paths reject unsafe indices and duplicate input mappings', () => {
  assert.throws(() => validateWalletInputPaths([[-1, 'receive', 0]], new Set(['receive'])), /required valid path/);
  assert.throws(() => validateWalletInputPaths([[0, 'receive', -1]], new Set(['receive'])), /required valid path/);
  assert.throws(() => validateWalletInputPaths([[0, 'receive', 0], [0, 'change', 1]], new Set(['receive', 'change'])), /Duplicate signing path/);
});

test('wallet signing response must match the hdwalletv1 response envelope', () => {
  const valid = { action: 'sign_transaction_response', sequence: 17, time: 1_800_000_000, signedTransaction: 'aabb' };
  assert.equal(validateWalletSigningResponse(valid), 'aabb');
  assert.throws(() => validateWalletSigningResponse({ ...valid, action: 'wallet_ready' }), /unexpected signing response/);
  assert.throws(() => validateWalletSigningResponse({ ...valid, sequence: -1 }), /sequence or timestamp/);
  assert.throws(() => validateWalletSigningResponse({ ...valid, signedTransaction: 'xyz' }), /valid signed transaction hex/);
  assert.throws(() => validateWalletSigningResponse({ ...valid, error: 'User rejected' }), /User rejected/);
});
