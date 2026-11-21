# KEYSTONE v2.2.9-mainnet-demo

Built on top of the v2.2.9 change-output / network-safety hardening.

- Controlled public hosting via `ALLOW_PUBLIC_HOST=true` (binds 0.0.0.0, relaxes Host/Origin checks for demos).
- `DEMO_MODE` flag for competition deployments.
- Mainnet-aware defaults and clearer console warnings.
- Readiness report receives `publicHostingEnabled`, `mainnetBroadcastImplemented`, and `confirmationTrackingImplemented`.
- New `.env.example` and `MAINNET-DEMO.md`.
- Security headers / CSP adjusted for public demo so WizardConnect CDN and Nostr relays work.
- Local-only mode remains the default when the flag is unset.
- Preserves all prior network handshake / change-output safety from v2.2.7–v2.2.9.
