# KEYSTONE v2.3.2 — WizardConnect handshake hardening

## Fixed
- Prefer WizardConnect's documented QR-alphanumeric-safe `qrUri` when generating the pairing QR; retain the standard `uri` for copy/paste.
- Gate transaction-signing controls on a completed `hdwalletv1` handshake and a non-empty public derivation-path set.
- Keep the disconnect control available after a wallet handshake that lacks usable BCH paths.
- Validate every requested input derivation path against the paths actually shared by the connected wallet before sending a signing request.
- Refresh signing-control state after pairing, disconnect, relay failure, and signing completion.
- Add a 90-second waiting-state message so a stalled pairing is visible without falsely reporting success.
- Add dependency-free unit tests for protocol readiness and wallet path validation; add build checks for the protocol guard and QR-safe URI preference.

## Verification
- `node --check public/app.js` — passed.
- `node --check public/wizardconnect-guards.js` — passed.
- `node --test tests/wizardconnect-guards.test.js` — 2 passed, 0 failed.
- `npm run check` — passed.
- `npm run build` — passed; 73 static DOM bindings validated.

## Not verified by this patch
- A real compatible wallet pairing/approval session.
- A real wallet-produced BCH signature.
- Chipnet node acceptance or transaction confirmation.

No wallet secret, seed phrase, or private key is requested or handled by KEYSTONE.
