import { config } from './config.js';
import { verifyBchMessageLocal } from './bch-local.js';

// Default: verify locally with libauth (no trusted node). BCH_VERIFY_MODE=rpc keeps the old node-based check.
export async function verifyBchMessage(args) {
  return config.bchVerifyMode === 'rpc' ? verifyBchMessageViaRpc(args) : verifyBchMessageLocal(args);
}

export async function verifyBchMessageViaRpc({ address, signature, message }) {
  if (!config.bchRpcUrl || !config.bchRpcUser || !config.bchRpcPassword) throw new Error('BCH Node RPC is not configured. Set BCH_RPC_URL, BCH_RPC_USER and BCH_RPC_PASSWORD.');
  const url = new URL(config.bchRpcUrl);
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new Error('BCH RPC must use HTTPS except for localhost.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${config.bchRpcUser}:${config.bchRpcPassword}`).toString('base64')}` },
      body: JSON.stringify({ jsonrpc: '1.0', id: 'keystone-verify', method: 'verifymessage', params: [address, signature, message] })
    });
    if (!response.ok) throw new Error(`BCH Node RPC returned HTTP ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(`BCH Node RPC error: ${data.error.message || 'verification failed'}`);
    return data.result === true;
  } finally { clearTimeout(timer); }
}
