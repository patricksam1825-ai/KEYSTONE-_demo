# KEYSTONE v2.3.6 — WizardConnect local wallet simulator

## Added
- A deterministic, dependency-free WizardConnect test double exposing the relay, wallet event, readiness, derivation-path and signing interfaces consumed by KEYSTONE's browser integration.
- End-to-end local simulation tests for relay/key-exchange events, `wallet_ready`, `hdwalletv1` readiness, shared public derivation paths, simulated signing approval, user rejection, malformed response rejection, unsupported protocol, disconnect and fresh-session reconnect.

## Verification boundaries
- The simulator uses synthetic public-key placeholders and a synthetic transaction hex response. It does not implement WizardConnect cryptography, encrypted relay transport, BCH signature generation, consensus validation or Mainnet/Chipnet broadcast.
- Passing simulator tests proves KEYSTONE's local event/guard workflow against the test double only. A compatible real wallet remains necessary for live interoperability verification.
