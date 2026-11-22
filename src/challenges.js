import { randomUUID } from 'node:crypto';
import { randomToken, sha256 } from './crypto.js';

export function canonicalMessage({ id, nonce, bchAddress, nostrPubkey, chain, verifier, expiresAt }) {
  return [
    'KEYSTONE IDENTITY BINDING', 'Version: 1', `Challenge: ${id}`,
    `Chain: ${chain}`, `BCH Address: ${bchAddress}`, `Nostr Pubkey: ${nostrPubkey}`,
    `Nonce: ${nonce}`, `Verifier: ${verifier}`, `Expires: ${new Date(expiresAt).toISOString()}`,
    'Purpose: Prove control of the BCH address and Nostr public key.'
  ].join('\n');
}

export async function createChallenge(store, input, config) {
  const bchAddress = String(input.bchAddress || '').trim();
  const nostrPubkey = String(input.nostrPubkey || '').trim().toLowerCase();
  if (!/^(bchtest|bitcoincash):[a-z0-9]{20,}$/i.test(bchAddress)) throw new Error('Enter a valid CashAddr with bchtest: or bitcoincash: prefix.');
  const expectedPrefix = config.chain === 'chipnet' ? 'bchtest:' : 'bitcoincash:';
  if (!bchAddress.toLowerCase().startsWith(expectedPrefix)) throw new Error(`This server is configured for ${config.chain}; address must start with ${expectedPrefix}`);
  if (!/^[a-f0-9]{64}$/.test(nostrPubkey)) throw new Error('Nostr public key must be a 64-character hexadecimal public key (not npub).');
  const id = randomUUID(), token = randomToken(), nonce = randomToken(24);
  const now = Date.now(), expiresAt = now + config.challengeTtlSeconds * 1000;
  const verifier = 'KEYSTONE Local Verifier';
  const fields = { id, nonce, bchAddress, nostrPubkey, chain: config.chain, verifier, expiresAt };
  const message = canonicalMessage(fields);
  await store.putChallenge({ ...fields, tokenHash: sha256(token), createdAt: now, consumedAt: null });
  return { challengeId: id, challengeToken: token, message, expiresAt: new Date(expiresAt).toISOString(), chain: config.chain };
}
