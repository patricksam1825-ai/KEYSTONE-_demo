# KEYSTONE v2.3.9 — native BCH signature verification

## Changes
- Replaced the transaction ECDSA verification dependency on Libauth with Node.js `crypto` / OpenSSL secp256k1 verification. Libauth remains a runtime dependency for the separate local BCH message-ownership verifier.
- Added an exported BCH FORKID digest helper for deterministic fixtures and independent digest auditing.
- Added a real cryptographic test fixture generated at test time: valid signature accepted; modified signature rejected.
- Added an HTTP smoke test that submits a genuine locally signed BCH transaction to `/api/transactions/verify-signed` and confirms the production route reports cryptographic verification while keeping broadcast disabled.
- Updated release and readiness version to 2.3.9 and clarified the limits of signature verification.

## Verification performed
- `npm run check` — PASS
- `npm test` — PASS (88 tests, 0 failures)
- `npm run build` — PASS

## Not verified
- Real Paytaca/Cashonize WizardConnect pairing or wallet-generated signature.
- Live Chipnet node `testmempoolaccept`, UTXO status, or transaction broadcast.
- Mainnet transaction acceptance or broadcast.
- Full BCH Script interpreter / consensus validation.
- `npm run verify:live` still requires the pinned runtime dependencies and network-connected integration environment.

No Mainnet transaction was sent and no funds were used in these tests.
