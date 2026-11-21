# KEYSTONE 2.3.11 — deployment status

This package is prepared for a Windows laptop + Android Paytaca Chipnet integration test.

## Verified locally in this build
- `npm run check`: passed.
- `npm test`: 88 passed, 0 failed, 0 skipped.
- `npm run build`: passed; browser and DOM binding checks passed.
- BCH FORKID ECDSA has a genuine deterministic cryptographic fixture test using Node.js crypto/OpenSSL.
- WizardConnect tests include simulator coverage only.

## Not yet verified in a real environment
- `npm install` on the user's Lenovo (network/package availability).
- Real Paytaca WizardConnect pairing and live wallet signing.
- Live Chipnet node/mempool acceptance or confirmed transaction.
- Production HTTPS hosting, public internet hosting, and competition submission readiness.

Do not describe the project as fully live-verified until these external tests pass. Default deployment is Chipnet and must remain on Chipnet for the wallet test.
