# KEYSTONE v2.3.4 — WizardConnect session and signing-response hardening

## Changes
- Tightened wallet readiness: KEYSTONE now requires the negotiated `hdwalletv1` protocol and a non-empty xpub for each uniquely named supported path (`receive`, `change`, or `defi`). Unknown, duplicate, malformed, or incomplete path entries do not enable signing.
- Added explicit handling for wallet signing errors and unexpected response actions before any signed transaction is passed to the server verifier.
- Preserved the explicit no-broadcast signing flow and transaction integrity verification.

## Verification performed
- `npm run check`: passed.
- `npm run build`: passed; 73 static DOM bindings validated.
- `npm test`: 76 passed, 0 failed, 0 skipped.
- Focused WizardConnect/transaction tests: 8 passed, 0 failed.

## Not verified
- A live compatible wallet has not yet paired with KEYSTONE in this environment.
- Live relay connection, encrypted key exchange, `wallet_ready`, real xpub delivery, and wallet signing still require a real wallet session.
- No BCH transaction was broadcast.
