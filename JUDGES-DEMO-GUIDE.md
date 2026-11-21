# KEYSTONE — 4-minute judge demonstration

## 0:00–0:35 — The problem
“Bitcoin Cash addresses and Nostr identities are separate identifiers. An app may need to know that the person controlling a BCH address also controls a particular Nostr identity. KEYSTONE creates a portable cryptographic proof of that relationship, so another party can verify it without trusting KEYSTONE's database.”

## 0:35–1:00 — The product
Show the home screen. Explain the three-step journey: choose identities, prove ownership, verify the link. Keep the explanation in plain language; do not start with signature algorithms.

## 1:00–2:15 — The identity proof
Demonstrate the challenge and the two ownership proofs using only test identities or a wallet account deliberately set up for Chipnet. Show the verification result and the portable proof bundle. Explain that the proof can be checked independently with the included verifier.

## 2:15–2:55 — Discovery
If live relay access is working, publish and retrieve the registry event and show the result. If it is not working, do not fake a live result: explain the relay workflow and clearly label any fixture as a test.

## 2:55–3:35 — BCH connection / transaction workflow
Show the Chipnet wallet connection and a signing request only if the real Paytaca session has been verified. Do not claim transaction acceptance without a Chipnet node/mempool result. Never use Mainnet funds for this demonstration.

## 3:35–4:00 — Why it matters
“KEYSTONE makes the relationship between a payment identity and a decentralised social identity portable and independently verifiable. It gives BCH and Nostr applications a reusable trust primitive rather than a centralised account lookup.”

## Judge-facing evidence checklist
- [ ] Real Paytaca WizardConnect pairing observed on camera.
- [ ] A genuine BCH wallet proof verified (do not use a fabricated proof).
- [ ] A Nostr event signature verified and tamper rejection shown.
- [ ] Portable proof bundle independently verified from a separate process.
- [ ] Relay publish/discovery demonstrated or explicitly labelled unverified.
- [ ] Chipnet node acceptance/confirmation shown only if actually observed.
- [ ] GitHub repository, README, and demo URL are accessible.

**Important:** Never present simulated wallet tests as a live Paytaca connection. Never claim a transaction was accepted or confirmed without node evidence.
