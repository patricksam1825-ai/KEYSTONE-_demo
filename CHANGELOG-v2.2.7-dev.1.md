# KEYSTONE v2.2.7-dev.1

- Added an explicit BCH node network handshake before UTXO discovery.
- UTXO discovery now refuses to query wallet-known outputs unless `getblockchaininfo` reports the selected network (`main` for Mainnet, `chipnet` for Chipnet).
- Added Mainnet and wrong-node regression coverage.
- This is a safety hardening update, not completion of the WizardConnect/Mainnet payment workflow. No real Mainnet payment was sent or tested.
