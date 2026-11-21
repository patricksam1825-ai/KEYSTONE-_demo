# KEYSTONE v2.3.11 — BCH + Nostr Identity-Binding Demo

BCH + Nostr identity binding with portable proofs, registry discovery, and an experimental network-aware transaction workflow.

Built for **BCH BLAZE 2026** (Mainnet Track + Decentralized Identity bounty).

## What it does

1. **Identity** — Cryptographically bind a BCH address and a Nostr pubkey via dual proofs (signed challenge message + signed Nostr event). Portable proof bundles can be verified offline by third parties.
2. **Discovery** — Publish and discover bindings through Nostr relays (NIP-78 style registry).
3. **Payments to identity** — Create payment requests against verified bindings.
4. **Experimental transaction workflow** — network-aware UTXO discovery, fee planning, unsigned transaction construction, change-address safety, signing-request validation, structural signed-transaction checks, guarded broadcast with exact txid reconciliation and status lookup.
5. **Wallet signing interface** — prepares a WizardConnect-compatible signing request without handling private keys; production wallet pairing/signing remains unverified.

## Requirements

- Node.js **≥ 22.13**
- npm
- Internet for `npm install` (`@bitauth/libauth`, `nostr-tools`, `ws`)
- Optional: BCH Node RPC (for UTXO tools, status, broadcast)
- Optional: WizardConnect-compatible BCH wallet for live signing tests

## Quick start (local)

```bash
cp .env.example .env
npm install
npm test
npm start
# open http://127.0.0.1:4173
```

## Mainnet / public demo

```bash
# .env
KEYSTONE_CHAIN=mainnet
ALLOW_PUBLIC_HOST=true
DEMO_MODE=true
HOST=0.0.0.0
PORT=4173
# optional RPC for UTXO/broadcast:
# BCH_RPC_URL=...
# BCH_RPC_USER=...
# BCH_RPC_PASSWORD=...

npm start
```

Deploy to Railway / Render / Fly.io (set the same env vars) or use a tunnel for a temporary HTTPS URL.

**Safety:** Mainnet payment requests default to a **0.01 BCH** cap. Broadcast requires an explicit confirmation string and a node that reports the matching network.

## Core flows for judges

### Identity binding
1. Create challenge (BCH address + Nostr pubkey)
2. Sign the challenge message with a BCH wallet
3. Sign the matching Nostr event (NIP-07 or paste)
4. Verify → binding created + portable proof bundle
5. Optional: publish registry event to relays
6. Independent verification: `npm run verify:proof -- ./proof.json`

### Transaction (with RPC node)
1. List UTXOs for a watched address (network handshake enforced)
2. Plan payment (fee + change estimate)
3. Build unsigned tx (**explicit changeAddress required** when change > 0)
4. Create WizardConnect signing request (`broadcast: false`)
5. Wallet signs → structural integrity check
6. Optional mempool preflight
7. Guarded broadcast with confirmation phrase
8. Status poll by txid

## Commands

| Command | Purpose |
|---------|---------|
| `npm start` | Run server |
| `npm test` | Unit/integration tests |
| `npm run check` | Syntax check all core modules |
| `npm run build` | Validate browser/server entry points |
| `npm run verify:proof -- <file>` | Offline proof verification |
| `npm run verify:live` | Live dependency / relay preflight (skips when unavailable) |

## Architecture notes

- **No private keys** are ever handled by KEYSTONE. Signing is wallet-side (message paste or WizardConnect).
- **Change output safety:** the server refuses to build a transaction with change unless the client supplies a wallet-derived `changeAddress` that the node validates on the selected network.
- **Network safety:** UTXO discovery and broadcast call `getblockchaininfo` and refuse to proceed if the node chain does not match `KEYSTONE_CHAIN`.
- **Public hosting** is off by default. Enable only with `ALLOW_PUBLIC_HOST=true`.

## Important limitations before submission

The transaction builder creates an unsigned transaction skeleton. The signing module now verifies standard P2PKH BCH FORKID ECDSA signatures locally with Node.js crypto/OpenSSL, checks that the signed transaction preserves the authorised inputs and outputs, and exposes that verification through `/api/transactions/verify-signed`. This is not a full BCH Script/consensus interpreter and does not prove UTXO availability, node mempool acceptance, or a completed live Mainnet payment. The following still require external verification:

- Live WizardConnect pairing + signing with a production wallet
- Real Mainnet broadcast of a signed transaction
- Live NIP-07 browser extension signing
- Live Nostr relay publish/discovery under production load
- Multi-user production database (current store is single-process SQLite/JSON)

## License / competition

Reference implementation for BCH BLAZE 2026. Treat as experimental software. Do not move large amounts of real funds without independent review.
