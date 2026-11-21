# Release audit — 21 November 2026

Audited from the supplied v2.3.9 Windows deployment archive.

## Passed in the audit environment
- ZIP integrity: passed.
- `npm run check`: passed.
- `npm test`: 88 passed, 0 failed, 0 skipped.
- `npm run build`: passed; browser build and 73 static DOM bindings validated.
- Genuine BCH FORKID ECDSA fixture test: passed within the unit suite.

## Not verified in this environment
- Dependencies were not installed (`node_modules` absent). The live verification script therefore reported **0 passed, 0 failed, 14 skipped** and exited with its skip status. This is not a live integration pass.
- Real Paytaca WizardConnect pairing or wallet signing.
- Live Nostr relay publish/discovery using installed production dependencies.
- Chipnet node/mempool acceptance or confirmation.
- Public HTTPS hosting or production multi-user readiness.

The Windows launcher and start-here guide have been improved. The app remains an experimental competition demo. The deployment default is Chipnet. Do not switch to Mainnet or handle real funds as part of this setup.
