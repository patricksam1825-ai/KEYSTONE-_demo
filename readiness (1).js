import { KEYSTONE_VERSION } from './version.js';
/**
 * Honest capability/readiness manifest for demos and judges.
 * Statuses describe implementation and configuration, not live external certification.
 */
export function createReadinessReport({
  chain = 'chipnet',
  rpcConfigured = false,
  bchLocalVerifierAvailable = false,
  bchWalletSignatureVerified = false,
  bchVerifyMode = 'local',
  storeDriver = 'sqlite',
  nip07BrowserVerified = false,
  browserE2eVerified = false,
  fullBindingFlowVerified = false,
  nostrDependencyAvailable = false,
  publicHostingEnabled = false,
  wizardConnectLiveVerified = false,
  nostrRelayLiveVerified = false,
  browserBuildVerified = false,
  mainnetBroadcastImplemented = true,
  confirmationTrackingImplemented = true,
  productionPersistenceImplemented = false,
  mediaAssetPrepared = false,
  changeOutputSafetyImplemented = true,
  networkHandshakeImplemented = true
} = {}) {
  const identityBlockers = [];
  const bchVerifierReady = bchVerifyMode === 'rpc' ? rpcConfigured : bchLocalVerifierAvailable || rpcConfigured;
  if (!bchVerifierReady) {
    identityBlockers.push(
      bchVerifyMode === 'rpc'
        ? 'Configure BCH Node RPC (BCH_RPC_URL/USER/PASSWORD).'
        : 'Install @bitauth/libauth so BCH signatures can be verified locally.'
    );
  }
  if (!bchWalletSignatureVerified) identityBlockers.push('Capture and verify a real wallet-produced BCH message signature fixture.');
  if (!nip07BrowserVerified) identityBlockers.push('Test NIP-07 signing in a real browser with a real signer extension.');
  if (!fullBindingFlowVerified) identityBlockers.push('Run the complete challenge → dual signatures → binding → relay publish → discovery → independent verify flow.');
  if (!nostrDependencyAvailable) identityBlockers.push('Install nostr-tools and run cryptographic Nostr verification tests.');
  if (!nostrRelayLiveVerified) identityBlockers.push('Run a live Nostr relay publish and discovery test.');
  if (!browserBuildVerified) identityBlockers.push('Build and smoke-test the browser entry points.');
  if (!browserE2eVerified) identityBlockers.push('Run browser end-to-end tests (Playwright).');

  const mainnetBlockers = [];
  if (!publicHostingEnabled) mainnetBlockers.push('Deploy an HTTPS public demo (set ALLOW_PUBLIC_HOST=true).');
  if (!wizardConnectLiveVerified) mainnetBlockers.push('Complete a live WizardConnect pairing and signing session with a real wallet.');
  if (!mainnetBroadcastImplemented) mainnetBlockers.push('Guarded Mainnet broadcast endpoint missing.');
  if (!confirmationTrackingImplemented) mainnetBlockers.push('Transaction status/confirmation tracking missing.');
  if (!networkHandshakeImplemented) mainnetBlockers.push('Node network handshake missing.');
  if (!changeOutputSafetyImplemented) mainnetBlockers.push('Explicit change-address safety missing.');
  if (!browserBuildVerified) mainnetBlockers.push('Build and smoke-test the browser entry points.');
  if (chain !== 'mainnet') mainnetBlockers.push('Server is not currently running with KEYSTONE_CHAIN=mainnet.');

  const mediaBlockers = [];
  if (!mediaAssetPrepared) mediaBlockers.push('Prepare an original media submission that meets the Media Track rules.');

  const identityReady = identityBlockers.length === 0;
  const mainnetReady = mainnetBlockers.length === 0;
  const mediaReady = mediaBlockers.length === 0;

  return {
    protocol: 'BCH + Nostr identity binding',
    version: KEYSTONE_VERSION,
    chain,
    identity: {
      challengeResponse: 'implemented',
      bchOwnershipVerification: bchWalletSignatureVerified
        ? 'verified-with-wallet-signature'
        : bchVerifyMode === 'local'
          ? (bchLocalVerifierAvailable ? 'local-verifier-available-wallet-signature-not-verified' : 'local-verifier-implemented-libauth-not-installed')
          : rpcConfigured ? 'configured-not-live-verified' : 'implemented-rpc-required',
      bchVerificationMode: bchVerifyMode,
      nostrEventVerification: nostrDependencyAvailable ? 'dependency-available-live-test-required' : 'implemented-dependency-required',
      dualProofBinding: 'implemented',
      portableProofBundle: 'implemented',
      independentProofVerification: 'implemented'
    },
    discovery: {
      nostrRelayRegistry: nostrRelayLiveVerified ? 'live-verified' : 'implemented-not-live-verified'
    },
    wallet: {
      wizardConnectPairing: wizardConnectLiveVerified ? 'live-verified' : 'implemented-not-live-verified',
      transactionSigning: 'network-aware-signing-request-implemented',
      transactionBroadcast: mainnetBroadcastImplemented ? 'guarded-broadcast-implemented-live-test-required' : 'not-implemented',
      confirmationTracking: confirmationTrackingImplemented ? 'implemented-live-test-required' : 'not-implemented',
      changeOutputSafety: changeOutputSafetyImplemented ? 'explicit-change-address-required' : 'not-implemented',
      networkHandshake: networkHandshakeImplemented ? 'node-chain-asserted-before-utxo-and-broadcast' : 'not-implemented'
    },
    deployment: {
      hostingMode: publicHostingEnabled ? 'public-hosting-enabled-not-live-verified' : 'local-only',
      persistentStore: storeDriver === 'sqlite' ? 'sqlite-implemented-single-instance' : 'json-file-single-process-evaluation-only',
      productionDatabase: productionPersistenceImplemented ? 'implemented-not-live-verified' : 'not-implemented',
      publicDeployment: publicHostingEnabled ? 'enabled-not-live-verified' : 'not-enabled',
      browserBuild: browserBuildVerified ? 'verified' : 'not-verified'
    },
    competition: {
      decentralizedIdentity: { status: identityReady ? 'requirements-evidence-ready' : 'incomplete', blockers: identityBlockers },
      mainnetTrack: { status: mainnetReady ? 'requirements-evidence-ready' : 'incomplete', blockers: mainnetBlockers },
      mediaTrack: { status: mediaReady ? 'submission-asset-ready' : 'incomplete', blockers: mediaBlockers }
    },
    competitionReadiness: 'not-certified',
    notes: [
      'This manifest reports implementation and evidence status, not a competition eligibility decision.',
      'A configured service is not considered live-verified until an end-to-end test with a real wallet/node has passed.',
      'Guarded Mainnet broadcast requires explicit confirmation text and a node on the matching network.',
      'Do not use this software to move large amounts of real funds without independent review.'
    ]
  };
}
