# KEYSTONE v2.1.8

- Fixed tests/server-smoke.test.js on Windows: it used URL.pathname (gives /C:/Users/... on Windows) as the server working directory, so the server never started. Now uses fileURLToPath.
- Added tests/windows-paths.test.js so this cannot return.
- User run on Windows with real dependencies installed: 137 tests, 136 pass, 0 skipped, 1 fail (this one).
