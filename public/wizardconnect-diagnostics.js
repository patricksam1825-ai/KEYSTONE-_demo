/** Safe, non-secret WizardConnect diagnostics for the connection UI. */
export function createWizardConnectDiagnostics() {
  const state = {
    relayStatus: 'not-started',
    keyExchangeComplete: false,
    walletReadyReceived: false,
    protocol: null,
    pathNames: [],
    lastProtocolAction: null,
    error: null
  };

  return {
    setRelayStatus(status) {
      state.relayStatus = typeof status === 'string' ? status : status?.status || 'unknown';
      if (state.relayStatus === 'error') state.error = 'Relay reported an error.';
    },
    markKeyExchangeComplete() { state.keyExchangeComplete = true; },
    recordProtocolMessage(message) {
      if (message && typeof message.action === 'string') state.lastProtocolAction = message.action;
    },
    markWalletReady({ protocol, paths } = {}) {
      state.walletReadyReceived = true;
      state.protocol = typeof protocol === 'string' ? protocol : null;
      state.pathNames = Array.isArray(paths) ? paths.filter(x => typeof x === 'string') : [];
    },
    setError(error) { state.error = String(error || 'Unknown connection error').slice(0, 240); },
    waitingMessage() {
      if (state.error) return `WizardConnect error: ${state.error}`;
      if (state.walletReadyReceived) return 'Wallet handshake received, but KEYSTONE is still validating the BCH session.';
      if (state.keyExchangeComplete) return 'Encrypted key exchange completed. Waiting for the wallet BCH hdwalletv1 handshake.';
      if (state.relayStatus === 'connected') return 'Relay connected. Waiting for a compatible wallet to scan and approve the request.';
      if (state.relayStatus === 'connecting' || state.relayStatus === 'reconnecting') return 'Connecting to the WizardConnect relay. No wallet handshake has happened yet.';
      if (state.relayStatus === 'error') return 'WizardConnect relay connection failed.';
      return 'WizardConnect has not reached the relay-connected stage yet.';
    },
    snapshot() { return JSON.parse(JSON.stringify(state)); }
  };
}
