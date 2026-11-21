# KEYSTONE v2.3.1 — Broadcast integrity hardening

## Changes
- Broadcast now verifies that the BCH node returns the exact transaction ID calculated from the signed raw transaction. A mismatch is surfaced instead of being reported as a successful submission.
- Preflight rejection messages now identify the selected network (Mainnet or Chipnet) accurately.
- Added focused regression tests for exact confirmation, network mismatch, unsigned transaction rejection, expected-txid mismatch, node preflight rejection, node-returned txid mismatch, and successful broadcast response.

## Verification in this environment
- `npm run check`: passed.
- `npm run build`: passed; 73 static DOM bindings validated and `dist/` regenerated.
- Focused tests: 17 assertions passed across broadcast, signing, change safety and network handshake tests.
- Full dependency-backed suite and live wallet/node tests were not run in this environment.

## Important boundary
This patch does not turn the transaction skeleton into a signed transaction. Live WizardConnect wallet signing, BCH consensus validation by a real node, Mainnet broadcast, and confirmation remain external verification requirements.
