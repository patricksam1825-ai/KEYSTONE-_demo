import { randomUUID } from 'node:crypto';

const MAX_SATOSHIS = 2_100_000_000_000_000;

function formatBch(satoshis) {
  const whole = Math.floor(satoshis / 100_000_000);
  const fraction = String(satoshis % 100_000_000).padStart(8, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

const PREFIX = { chipnet: 'bchtest:', mainnet: 'bitcoincash:' };

export async function createPaymentRequest(store, input, now = Date.now(), { chain = 'chipnet', maxSatoshis = MAX_SATOSHIS } = {}) {
  if (!PREFIX[chain]) throw new Error('Unknown chain for payment request.');
  const bindingId = String(input?.bindingId || '');
  const amountSatoshis = input?.amountSatoshis;
  const memo = String(input?.memo || '').trim();
  const expiresInSeconds = input?.expiresInSeconds ?? 1800;

  if (!/^[0-9a-f-]{36}$/i.test(bindingId)) throw new Error('A valid verified KEYSTONE binding ID is required.');
  if (!Number.isSafeInteger(amountSatoshis) || amountSatoshis < 1 || amountSatoshis > MAX_SATOSHIS) throw new Error('Amount must be a whole number of satoshis between 1 and 2,100,000,000,000,000.');
  if (amountSatoshis > maxSatoshis) throw new Error(`Amount is above this server's safety limit of ${maxSatoshis} satoshis (${formatBch(maxSatoshis)} BCH) per request.`);
  if (memo.length > 120) throw new Error('Payment memo must be 120 characters or fewer.');
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 86400) throw new Error('Expiry must be between 60 seconds and 24 hours.');

  const binding = await store.getBinding(bindingId);
  if (!binding || binding.verification?.bch !== true || binding.verification?.nostr !== true) throw new Error('Payment requests require an existing binding with both proofs verified.');
  if (binding.chain !== chain || !String(binding.bchAddress).startsWith(PREFIX[chain])) throw new Error(`This server runs on ${chain}, but this binding is for ${binding.chain}. A payment request can only use a binding from the same network.`);

  const id = randomUUID();
  const expiresAt = now + expiresInSeconds * 1000;
  const params = new URLSearchParams();
  params.set('amount', formatBch(amountSatoshis));
  params.set('label', 'KEYSTONE verified recipient');
  if (memo) params.set('message', memo);
  // The CashAddr already contains its network prefix (bitcoincash: or bchtest:), so it is the URI scheme.
  const uri = `${binding.bchAddress}?${params.toString()}`;
  const request = {
    id, protocol: 'KEYSTONE-PAYMENT-REQUEST-v1', bindingId,
    chain, recipientAddress: binding.bchAddress,
    recipientNostrPubkey: binding.nostrPubkey,
    amountSatoshis, amountBch: formatBch(amountSatoshis), memo,
    createdAt: now, expiresAt, status: 'open', uri,
    warning: chain === 'mainnet'
      ? 'MAINNET: this is a payment request, not a payment. KEYSTONE does not sign, broadcast, or move funds; your wallet sends only if you approve. Mainnet payments are real money and cannot be reversed. Check the address and amount in your wallet.'
      : 'This is a Chipnet payment request, not a payment. It does not sign, broadcast, or move funds.'
  };
  await store.putPaymentRequest(request);
  return request;
}

export function isPaymentRequestActive(request, now = Date.now()) {
  return Boolean(request && request.status === 'open' && request.expiresAt > now);
}
