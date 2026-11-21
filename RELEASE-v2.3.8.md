# KEYSTONE v2.3.8 — BCH FORKID signature verification integration

## Changes
- Added BCH FORKID signature-hash preimage construction for legacy P2PKH inputs.
- Added asynchronous ECDSA verification through the pinned `@bitauth/libauth` secp256k1 API.
- The signed-transaction verification endpoint now requires cryptographic verification, not only unlocking-script structure and transaction-output integrity.
- Verification remains non-broadcasting. The node's selected-network UTXO check and later mempool preflight remain separate requirements.

## Verification performed in this environment
- `npm run check`: passed.
- `npm test`: 87 passed, 0 failed, 0 skipped (these existing tests cover structural signing checks; they do not exercise the new libauth ECDSA verifier).
- `npm run build`: passed; 73 DOM bindings validated.
- Dependency installation timed out. Therefore the new libauth-backed ECDSA verification path has NOT been runtime-tested here.

## Limitations
- Supports standard legacy P2PKH inputs using BCH FORKID ALL, NONE, SINGLE and ANYONECANPAY variants currently accepted by the signature parser.
- This is not a complete BCH Script virtual machine or full consensus interpreter.
- No genuine WizardConnect wallet pairing, Chipnet signing, live node preflight, or broadcast was performed.
