# KEYSTONE v2.1.7

- Guided BCH signing step: how-to panel, live signature format hint, pasted whitespace removed, bad format blocked before sending.
- Web footer version now comes from /api/health (was stale 2.1.3).
- scripts/add-wallet-fixture.mjs: saves a real wallet signature as a fixture, only after libauth verifies it.
- docs/DEMO-SCRIPT.md.
- Tests: 137 (132 pass, 5 skipped = libauth). Browser hint checks: 6/6 in real Chromium (puppeteer); Playwright version not yet executed.
