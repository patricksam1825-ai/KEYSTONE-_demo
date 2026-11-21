# KEYSTONE v2.3.7 — P2PKH signing-envelope inspection

- Added P2PKH unlocking-script inspection after wallet response validation.
- Requires exactly two data pushes, canonical DER-shaped ECDSA signature encoding, and BCH FORKID hash-type flags.
- Checks compressed/uncompressed SEC public-key encoding and confirms HASH160(public key) matches the trusted P2PKH prevout script.
- Keeps transaction authorization invariants: input outpoints/sequences, outputs, locktime, version, and fee cannot change during signing.
- Explicit limitation: this is not ECDSA signature verification, BCH Script execution, consensus validation, UTXO freshness validation, or node acceptance. Real cryptographic/consensus validation still requires a BCH script/consensus VM and trusted prevout data.
