# WizardConnect simulator (local tests only)

Run from the project root:

```bash
npm test
```

The simulator is implemented in `tests/helpers/wizardconnect-wallet-simulator.js` and exercised by `tests/wizardconnect-simulator.test.js`.

It emulates the interface KEYSTONE consumes from a relay and wallet: relay status, key-exchange event, wallet events, `hdwalletv1` session paths, signing approval/rejection, disconnect and reconnect. The synthetic xpub strings and transaction hex are fixtures only.

**It is not a WizardConnect implementation or a substitute for a real compatible wallet.** It does not encrypt messages, connect to a relay, create BCH signatures, validate a BCH transaction cryptographically, or broadcast. Passing these tests only confirms KEYSTONE's local orchestration and guard handling against the test double.
