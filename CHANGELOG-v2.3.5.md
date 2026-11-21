# KEYSTONE v2.3.5 — WizardConnect response-envelope validation

## Changes
- Validate every signing input-path tuple's index types/ranges and reject duplicate transaction-input mappings before asking a wallet to sign.
- Validate the documented `sign_transaction_response` envelope (action, sequence, timestamp, error state, and bounded even-length hexadecimal transaction) before sending signed bytes to the server-side integrity verifier.
- Keep transaction broadcast separate and explicitly user-controlled.

## Verification
- Focused WizardConnect guard tests are included for malformed indices, duplicate input mappings, malformed response envelopes, and valid response handling.
- Syntax and production-build checks are run for this release.

## Not verified
- A live wallet pairing and signing session remains unverified. Unit tests cannot establish relay reachability, real wallet compatibility, cryptographic signature validity, or BCH node acceptance.
