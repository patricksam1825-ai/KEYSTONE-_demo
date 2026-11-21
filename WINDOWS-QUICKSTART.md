# KEYSTONE on Windows + Paytaca on Android

## Requirements
- Windows 10/11
- Node.js 22.13 or newer (64-bit)
- Internet access during dependency installation
- Laptop and phone on the same trusted Wi-Fi network

## Install
1. Extract this ZIP to a normal folder, e.g. `C:\KEYSTONE`.
2. Install Node.js 22.13+ from https://nodejs.org/ if needed.
3. Double-click `windows\SETUP-KEYSTONE.bat` and wait for npm to finish.
4. Double-click `windows\START-KEYSTONE.bat`.
5. On the laptop open `http://localhost:4173`.
6. Find the laptop's private IPv4 address: open Command Prompt and run `ipconfig`; use the IPv4 Address under the active Wi-Fi adapter.
7. On the phone, while connected to the same Wi-Fi, open `http://LAPTOP-IP:4173` (replace LAPTOP-IP with that address).

## WizardConnect test
- Keep Paytaca on Chipnet.
- Open KEYSTONE on the laptop or phone and use its WizardConnect pairing flow.
- If KEYSTONE shows a pairing QR, scan it with Paytaca on the phone. If Paytaca shows a pairing URI/QR instead, follow KEYSTONE's displayed connection instructions; do not assume the QR direction.
- Do not share pairing URLs/QR screenshots: they may contain temporary session credentials.
- First verify connection only. Reject unexpected signing requests. Do not import a wallet seed into KEYSTONE.

## Network and safety notes
- This package defaults to Chipnet. Do not change `KEYSTONE_CHAIN` to `mainnet` for this test.
- `ALLOW_PUBLIC_HOST=true` is required for another device on your LAN. It exposes the demo server to devices that can reach your laptop. Use only on a trusted private Wi-Fi network, keep Windows Firewall enabled, and stop the server when finished. Do not port-forward it to the internet.
- Plain HTTP on a local IP is suitable only for this controlled LAN test. Browser features requiring a secure context may require HTTPS; if pairing fails, capture the exact error rather than weakening wallet security.
- A successful page load is not proof of WizardConnect compatibility. A successful pairing is not proof of BCH transaction acceptance.
- Real Chipnet signing, BCH node/mempool acceptance, Nostr relay proof publication, and the complete bounty acceptance path remain external integration tests.

## Troubleshooting
- `npm install` fails: check internet/DNS and rerun setup.
- Phone cannot open page: confirm same Wi-Fi, laptop IP, port 4173, and allow Node.js through Windows Firewall on Private networks only.
- Check server status at `http://LAPTOP-IP:4173/api/health` and readiness at `/api/readiness`.
