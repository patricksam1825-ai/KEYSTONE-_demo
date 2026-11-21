# KEYSTONE 2.3.11 — Start here (Windows + Paytaca)

**This release is configured for Chipnet. It does not require you to spend Mainnet BCH.**

## 1. One-time setup
1. Extract the entire ZIP to a normal folder, for example `C:\KEYSTONE`.
2. Install Node.js **22.13 or newer (64-bit)** if it is not already installed.
3. Double-click **`SETUP-KEYSTONE.bat`** in the main folder. Allow npm to download the pinned dependencies.
4. When setup finishes, double-click **`CHECK-KEYSTONE.bat`** to run the local checks, tests and build.

## 2. Start the app
1. Double-click **`START-KEYSTONE.bat`**.
2. On the Lenovo, open `http://localhost:4173` (it should open automatically).
3. The terminal prints a phone URL. Connect the phone and Lenovo to the same trusted Wi-Fi, then open that URL on the phone.
4. Keep the black terminal window open while using KEYSTONE. Close it with Ctrl+C when finished.

If Windows Firewall asks, allow Node.js on **Private networks only**. Do not enable public-network access or router port forwarding.

## 3. Simple navigation
- Start at **Prove two identities**. This is the main KEYSTONE feature.
- Follow the three on-screen steps: choose identities → prove ownership → verify the link.
- Use **Publish and discover** only after a proof has been created and verified.
- Use the payment and transaction tools only for the Chipnet demonstration, and review every wallet request before approving it.
- The **What this build does** and readiness panels explain what is implemented and what still needs a live integration test.

## 4. Paytaca / WizardConnect
- Confirm Paytaca is set to **Chipnet**.
- In KEYSTONE, open the wallet connection section and follow the pairing instructions shown there. If KEYSTONE displays a QR, scan it with Paytaca. If the wallet displays a URI/QR, follow the exact direction indicated by the two apps; do not assume the QR direction.
- First test connection only. Reject any signing request you did not initiate and do not import your recovery phrase or private key into KEYSTONE.
- Never share a pairing QR, pairing URL, recovery phrase or private key.

## 5. What success means (and does not mean)
- Page loads: local web app is running.
- Wallet pairs: pairing worked; this alone does not prove signing works.
- Wallet signs a request: wallet-side signing worked; this alone does not prove the network accepted a transaction.
- A Chipnet node accepts and confirms a transaction: separate network evidence.

The current automated test suite covers local logic, security guards, a genuine BCH FORKID ECDSA fixture, and a simulated WizardConnect flow. Real Paytaca pairing/signing, live Chipnet node/mempool acceptance, and public HTTPS deployment have **not** been verified in this package. Do not describe them as completed until tested.

## Troubleshooting
- Setup fails: check internet access, then rerun `SETUP-KEYSTONE.bat`.
- Phone cannot open the page: confirm same Wi-Fi; use the IP printed in the terminal; allow Node.js on Private networks; check port 4173.
- Pairing fails: report the exact on-screen error. Do not weaken wallet security or expose pairing secrets.
- For a clean stop, return to the terminal and press Ctrl+C.
