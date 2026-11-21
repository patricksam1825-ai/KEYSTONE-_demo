# KEYSTONE v2.1.6

- Browser: WizardConnect/QR CDN libraries now load lazily with a clear error; the core flow no longer depends on esm.sh being reachable.
- Added tests-e2e/ui-resilience.e2e.mjs (Playwright, not yet executed by author; scenarios executed once via puppeteer: 10/10).
- Verified dist/ starts standalone.
