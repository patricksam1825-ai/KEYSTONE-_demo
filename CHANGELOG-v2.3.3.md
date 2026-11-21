# KEYSTONE v2.3.3 — WizardConnect live-handshake diagnostics

## Changes
- Added a safe connection-stage diagnostic tracker for relay connection, encrypted key exchange, protocol messages, and `wallet_ready`.
- The pairing screen now distinguishes a relay that has not connected from a relay-connected session waiting for wallet approval, a completed key exchange awaiting the BCH protocol handshake, and a completed wallet handshake.
- When pairing fails or a wallet offers an unsupported protocol or no usable public paths, the UI displays a sanitized diagnostic snapshot. No private keys, pairing secrets, or xpub values are included.
- Added two diagnostic tests; retained the two WizardConnect guard tests.

## Verification performed in this environment
- `npm run check`: passed.
- `npm run build`: passed; 73 static DOM bindings validated.
- Focused WizardConnect tests: 4 passed, 0 failed.
- Direct WebSocket probe to the default WizardConnect relay could not connect from this execution environment.

## Not verified
- A real compatible wallet has not scanned and approved a KEYSTONE pairing request.
- Live encrypted key exchange, `wallet_ready`, xpub delivery, and wallet signing remain unverified.
- A compatible wallet is required to complete that final end-to-end test.
