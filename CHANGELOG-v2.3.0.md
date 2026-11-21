# KEYSTONE v2.3.0 — Complete Multinetwork Release

## Implemented

### Networks
- Full Mainnet and Chipnet support via `KEYSTONE_CHAIN`
- Node network handshake before UTXO discovery and broadcast
- Network-specific CashAddr validation
- No accidental cross-network operations

### Transaction engine
- UTXO discovery (wallet-known outputs)
- Fee planning with dust protection
- Unsigned transaction construction
- Explicit change-address requirement (change-output safety)
- Signed transaction structural verification
- Mempool preflight (`testmempoolaccept`)
- Guarded broadcast with confirmation phrase
- Transaction status / confirmation tracking

### WizardConnect
- Encrypted pairing via relay
- Signing request construction (`broadcast: false`)
- Signed response validation
- Structural integrity check before any broadcast path

### Identity / Nostr
- Dual-proof BCH + Nostr binding
- Portable proof bundles + offline CLI verifier
- Registry publish / discovery
- Independent verification endpoint

### Security & deployment
- Controlled public hosting (`ALLOW_PUBLIC_HOST`)
- Local-only by default
- Rate limiting, CSP, host/origin checks
- Mainnet payment request safety cap (0.01 BCH default)

### Tests
- 67 automated tests passing (change safety, network handshake, signing integrity, store, readiness, smoke)

## Still requiring external verification
- Live WizardConnect session with a production wallet
- Real Mainnet broadcast of a user-signed transaction
- Live NIP-07 extension signing
- Production multi-user database
