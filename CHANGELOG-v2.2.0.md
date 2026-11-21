# KEYSTONE v2.2.0

- Mainnet payment requests ("Pay a verified identity"), enabled when KEYSTONE_CHAIN=mainnet. Safety cap MAX_PAYMENT_SATOSHIS (default 0.01 BCH on mainnet).
- Fixed payment URI bug: it produced "bitcoincash:bchtest:..." and would have produced "bitcoincash:bitcoincash:..." on mainnet. The CashAddr already contains its prefix, so it is now used as the URI scheme.
- verify:live gets a mainnet stage (binding with a bitcoincash: address + payment request; no funds).
- docs/MAINNET-TRACK.md: honest status against the track rules.
- Page labels, placeholder and footer follow the server network; Chipnet-only developer panels are hidden on mainnet. Checked in real Chromium in both modes.
