import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from './env.js';
import { assertListenHost } from './security.js';
import { validatePort, validateChallengeTtlSeconds } from './http-hardening.js';
import { parseRelayUrls } from './relays.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnvFile(path.join(projectRoot, '.env'));

const truthy = (v) => ['1', 'true', 'yes', 'on'].includes(String(v || '').toLowerCase());

const allowPublicHost = truthy(process.env.ALLOW_PUBLIC_HOST);
const demoMode = truthy(process.env.DEMO_MODE) || allowPublicHost;
const chain = (process.env.KEYSTONE_CHAIN || 'chipnet').toLowerCase();

// Mainnet safety: default max payment is 0.01 BCH (1_000_000 sats).
const defaultMaxPayment = chain === 'mainnet' ? 1_000_000 : 2_100_000_000_000_000;

export const config = {
  host: assertListenHost(process.env.HOST || (allowPublicHost ? '0.0.0.0' : '127.0.0.1'), { allowPublic: allowPublicHost }),
  port: validatePort(process.env.PORT || 4173),
  chain,
  allowPublicHost,
  demoMode,
  storeDriver: (process.env.STORE_DRIVER || 'sqlite').toLowerCase(),
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  challengeTtlSeconds: validateChallengeTtlSeconds(process.env.CHALLENGE_TTL_SECONDS || 300),
  bchVerifyMode: (process.env.BCH_VERIFY_MODE || 'local').toLowerCase(),
  bchRpcUrl: process.env.BCH_RPC_URL || '',
  bchRpcUser: process.env.BCH_RPC_USER || '',
  bchRpcPassword: process.env.BCH_RPC_PASSWORD || '',
  maxPaymentSatoshis: Number(process.env.MAX_PAYMENT_SATOSHIS || defaultMaxPayment),
  nostrRelays: parseRelayUrls(process.env.NOSTR_RELAYS || '')
};

if (!['sqlite', 'json'].includes(config.storeDriver)) throw new Error('STORE_DRIVER must be sqlite or json');
if (!['local', 'rpc'].includes(config.bchVerifyMode)) throw new Error('BCH_VERIFY_MODE must be local or rpc');
if (!['chipnet', 'mainnet'].includes(config.chain)) throw new Error('KEYSTONE_CHAIN must be chipnet or mainnet');
if (!Number.isSafeInteger(config.maxPaymentSatoshis) || config.maxPaymentSatoshis < 1) {
  throw new Error('MAX_PAYMENT_SATOSHIS must be a positive whole number of satoshis.');
}

if (config.allowPublicHost) {
  console.warn('[KEYSTONE] ALLOW_PUBLIC_HOST=true — public binding enabled. Use only for demos / competition.');
}
if (config.chain === 'mainnet') {
  console.warn(`[KEYSTONE] Running in MAINNET mode. Max payment request capped at ${config.maxPaymentSatoshis} sats.`);
}
