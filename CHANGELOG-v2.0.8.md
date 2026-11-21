# KEYSTONE v2.0.8 — Portable Proof Validation Hardening

## Changes
- Portable proof bundles now reject challenge lifetimes above the protocol's 15-minute maximum.
- Rejects challenge creation timestamps more than 60 seconds in the future.
- Requires a bounded nonce (16–256 characters) and verifier identifier (1–128 characters).
- Rejects BCH message signatures over 2 KiB before calling external verifiers.
- Rejects Nostr event payloads over 64 KiB before cryptographic verification.
- Updated package and application version to 2.0.8.

## Verification performed
- `npm run check`: passed.
- `npm test`: 64 tests passed, 0 failed.

## Limitations
- Tests use injected BCH/Nostr verifiers for unit isolation; this does not establish live BCH Node or Nostr relay connectivity.
- Browser production build and live WizardConnect tests remain unverified.
- Mainnet transaction broadcast and public deployment remain unimplemented. Do not represent this release as Mainnet-ready.
