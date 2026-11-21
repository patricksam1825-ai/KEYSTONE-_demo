# KEYSTONE v2.3.11 — Submission status (single source of truth)

This file replaces the older, version-stamped status notes. Older CHANGELOG/RELEASE files are history only.

## What the owner has run on a real PC
- `npm test` on v2.3.9 with dependencies installed: 88 passed, 0 failed, 0 skipped (owner report).
- Earlier builds (v2.1.9): `npm test` 142/142 and `npm run verify:live` 11 passed / 0 failed; with `LIVE_RELAYS=wss://relay.damus.io` 12 passed / 0 failed / 1 skipped (publish, discovery and independent verification of the full proof event on a real public relay).

## v2.3.11 changes
- Restored 14 core test files that v2.3.9 did not contain: identity binding, challenges, atomic SQLite save and rollback, SQLite store, BCH message verifier (incl. real-libauth tests), Nostr cached-verification hardening, real-crypto pipeline, registry store, proof verification, environment and version checks. Source code for these was unchanged; only the tests were missing.
- Updated three older transaction tests to the current, safer behavior (explicit change script is required; the node network is checked before UTXOs are requested).
- `readiness.js` now reads the version from `version.js` instead of a hard-coded string.
- Tests in the build environment (no dependencies installed): 170 passed, 0 failed, 6 skipped. The 6 skipped tests need libauth, nostr-tools or ws and run on a machine where `npm install` succeeded. Skipped tests are NOT passes.

## NOT verified (do not claim)
- Real wallet pairing and signing (Paytaca or another WizardConnect wallet).
- A real BCH mainnet transaction, node preflight, or broadcast.
- NIP-07 signing with a real browser extension.
- A BCH message signature produced by a real wallet (fixture slot: `tests/fixtures/wallet-bch-signature.json`).
- Public hosting and a live demo link.
- Browser end-to-end tests (`npm run test:e2e`).

## Safe wording
"KEYSTONE is a BCH + Nostr identity-binding system. Both signatures are verified with libauth and nostr-tools, bindings are stored in SQLite and published to Nostr relays, and anyone can verify a proof bundle without our database. Wallet-signed transactions and mainnet sending are implemented with safeguards but not yet tested with a real wallet."
