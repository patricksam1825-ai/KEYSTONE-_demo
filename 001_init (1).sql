CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  nonce TEXT NOT NULL,
  bch_address TEXT NOT NULL,
  nostr_pubkey TEXT NOT NULL,
  chain TEXT NOT NULL CHECK (chain IN ('chipnet','mainnet')),
  verifier TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX idx_challenges_expires ON challenges (expires_at);

CREATE TABLE bindings (
  id TEXT PRIMARY KEY,
  chain TEXT NOT NULL CHECK (chain IN ('chipnet','mainnet')),
  bch_address TEXT NOT NULL,
  nostr_pubkey TEXT NOT NULL,
  created_at TEXT NOT NULL,
  json TEXT NOT NULL,
  UNIQUE (chain, bch_address, nostr_pubkey)
);

CREATE TABLE registry_events (
  event_id TEXT PRIMARY KEY,
  pubkey TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  bch_address TEXT NOT NULL,
  chain TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  received_at TEXT NOT NULL,
  event_json TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX idx_registry_pubkey ON registry_events (pubkey, created_at DESC);

CREATE TABLE payment_requests (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL
);
