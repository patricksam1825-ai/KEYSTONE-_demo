import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadinessReport } from '../src/readiness.js';

test('readiness manifest distinguishes implemented identity features from live verification', () => {
  const report = createReadinessReport({ chain: 'chipnet', rpcConfigured: true, bchVerifyMode: 'rpc' });
  assert.equal(report.identity.dualProofBinding, 'implemented');
  assert.equal(report.identity.bchOwnershipVerification, 'configured-not-live-verified');
  assert.equal(report.discovery.nostrRelayRegistry, 'implemented-not-live-verified');
  assert.equal(report.competition.decentralizedIdentity.status, 'incomplete');
  assert.ok(report.competition.decentralizedIdentity.blockers.length > 0);
});

test('readiness manifest never claims live-verified Mainnet or production readiness by default', () => {
  const report = createReadinessReport({ chain: 'mainnet', rpcConfigured: true });
  assert.equal(report.wallet.transactionSigning, 'network-aware-signing-request-implemented');
  assert.match(report.wallet.transactionBroadcast, /implemented|live-test-required/);
  assert.equal(report.deployment.publicDeployment, 'not-enabled');
  assert.equal(report.competition.mainnetTrack.status, 'incomplete');
  assert.equal(report.competitionReadiness, 'not-certified');
  assert.ok(report.competition.mainnetTrack.blockers.some(b => /public demo|WizardConnect|live/i.test(b)));
});

test('public hosting flag clears the public-demo blocker when set', () => {
  const report = createReadinessReport({
    chain: 'mainnet',
    publicHostingEnabled: true,
    wizardConnectLiveVerified: true,
    browserBuildVerified: true,
    mainnetBroadcastImplemented: true,
    confirmationTrackingImplemented: true,
    networkHandshakeImplemented: true,
    changeOutputSafetyImplemented: true
  });
  assert.equal(report.deployment.publicDeployment, 'enabled-not-live-verified');
  assert.ok(!report.competition.mainnetTrack.blockers.some(b => /public demo/i.test(b)));
});
