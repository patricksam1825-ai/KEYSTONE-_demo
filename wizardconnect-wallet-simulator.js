import { EventEmitter } from 'node:events';

/**
 * Deterministic test double for KEYSTONE's WizardConnect-facing API.
 * This is a local protocol-envelope simulator, NOT the WizardConnect SDK,
 * encrypted relay, a real wallet, or a cryptographic signing implementation.
 */
export class SimulatedWizardRelay {
  constructor() {
    this.events = new EventEmitter();
    this.uri = 'wizardconnect-sim://local-test-session';
    this.closed = false;
    this.status = 'connecting';
  }
  setStatus(status) {
    if (this.closed) throw new Error('Relay is closed.');
    this.status = status;
  }
  completeKeyExchange() {
    if (this.closed) throw new Error('Relay is closed.');
    this.events.emit('keyexchangecomplete');
  }
  close() {
    this.closed = true;
    this.status = 'closed';
  }
}

export class SimulatedWizardWallet extends EventEmitter {
  constructor({ protocol = 'hdwalletv1', paths = [
    { name: 'receive', xpub: 'SIMULATED-PUBLIC-RECEIVE-XPUB' },
    { name: 'change', xpub: 'SIMULATED-PUBLIC-CHANGE-XPUB' }
  ], signingResponse, signingError } = {}) {
    super();
    this.protocol = protocol;
    this.walletName = 'KEYSTONE Test Wallet (SIMULATED)';
    this.paths = paths;
    this.signingResponse = signingResponse;
    this.signingError = signingError;
    this.connected = false;
    this.relay = null;
    this.sequence = 1;
  }
  attachRelay(relay) {
    if (!relay || relay.closed) throw new Error('A live simulated relay is required.');
    this.relay = relay;
  }
  updateConnection(client, status) {
    if (status?.status === 'connected') this.connected = true;
    if (status?.status === 'disconnected' || status?.status === 'error') this.connected = false;
  }
  getSessionPaths() {
    if (!this.connected) throw new Error('Simulated wallet is not connected.');
    return this.paths.map(path => ({ ...path }));
  }
  announceReady() {
    if (!this.connected) throw new Error('Connect the simulated wallet before announcing readiness.');
    const message = { action: 'wallet_ready', wallet_name: this.walletName };
    this.emit('messagereceived', message);
    this.emit('walletready', message);
    return message;
  }
  async signTransaction(request) {
    if (!this.connected || !this.relay || this.relay.closed) throw new Error('Simulated wallet session is not connected.');
    if (this.signingError) throw new Error(this.signingError);
    if (this.signingResponse !== undefined) return structuredClone(this.signingResponse);
    return {
      action: 'sign_transaction_response',
      sequence: this.sequence++,
      time: 1_800_000_000,
      signedTransaction: 'aabbccdd'
    };
  }
  disconnect(reason = 'simulated disconnect') {
    this.connected = false;
    this.emit('disconnect', reason);
  }
}

/** Connect relay and wallet through the same public method/event surface used by app.js. */
export function createWizardConnectSimulation(options = {}) {
  const relay = new SimulatedWizardRelay();
  const wallet = new SimulatedWizardWallet(options);
  wallet.attachRelay(relay);
  relay.setStatus('connected');
  wallet.updateConnection(null, { status: 'connected' });
  return {
    relay,
    wallet,
    completeKeyExchange: () => relay.completeKeyExchange(),
    announceWalletReady: () => wallet.announceReady(),
    disconnect: (reason) => {
      wallet.disconnect(reason);
      relay.close();
    }
  };
}
