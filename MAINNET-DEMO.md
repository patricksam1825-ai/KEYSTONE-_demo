# KEYSTONE Mainnet Demo Notes (BLAZE 2026)

## Goal
Make KEYSTONE a credible **Mainnet Track** submission by:
1. Running in `KEYSTONE_CHAIN=mainnet`
2. Exposing a **public HTTPS demo**
3. Showing WizardConnect + verified-identity payment flow
4. Keeping real-value risk extremely low

## Quick start for public demo

```bash
cp .env.example .env
# confirm:
#   KEYSTONE_CHAIN=mainnet
#   ALLOW_PUBLIC_HOST=true
#   DEMO_MODE=true

npm install
npm start
```

The server will listen on `0.0.0.0:4173` and accept external requests.

### Recommended free hosts
- Railway / Render / Fly.io (set the env vars above)
- Or temporary tunnel: `npx localtunnel --port 4173` / Cloudflare Tunnel / ngrok

**Judges need an HTTPS URL.**

## What to show judges (2–3 min demo)

1. **Identity binding on mainnet addresses**
   - Create challenge with a real `bitcoincash:` address
   - Sign the challenge message with a BCH wallet
   - Sign the matching Nostr event
   - Show successful binding + portable proof bundle
   - Run `npm run verify:proof -- ./your-proof.json`

2. **WizardConnect pairing**
   - Open the pairing panel
   - Connect with a WizardConnect-compatible wallet

3. **Pay a verified identity**
   - Create a payment request against a bound identity
   - Amount ≤ 0.01 BCH (safety cap)

4. **(Optional but strong)** One real tiny mainnet transaction + explorer link

## Safety
- `MAX_PAYMENT_SATOSHIS` defaults to 1 000 000 (0.01 BCH) on mainnet
- Mainnet broadcast requires explicit confirmation string
- Node network handshake prevents accidental Chipnet/Mainnet mix-ups (v2.2.7+)

## Readiness
`GET /api/readiness` reports `publicHostingEnabled` when `ALLOW_PUBLIC_HOST=true`.
