import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Persistent, transactional store backed by SQLite (node:sqlite, built into Node 22+).
// Same interface as JsonStore. Real database constraints give us atomic challenge
// consumption and unique identity bindings, even with several requests at once.
const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations', 'sqlite');

export class DuplicateBindingError extends Error {
  constructor() { super('This BCH address and Nostr key are already bound on this chain.'); this.code = 'DUPLICATE_BINDING'; }
}

export class SqliteStore {
  constructor(file) { this.file = file; this.db = null; }

  async init() {
    let DatabaseSync;
    try { ({ DatabaseSync } = await import('node:sqlite')); }
    catch { throw new Error('SQLite store needs Node.js 22.13 or newer (node:sqlite).'); }
    if (this.file !== ':memory:') fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.db = new DatabaseSync(this.file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  migrate() {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    const done = new Set(this.db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));
    const files = fs.readdirSync(migrationsDir).filter(f => /^\d+_.+\.sql$/.test(f)).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      this.db.exec('BEGIN');
      try {
        this.db.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
        this.db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(f, new Date().toISOString());
        this.db.exec('COMMIT');
      } catch (e) { this.db.exec('ROLLBACK'); throw new Error(`Migration ${f} failed: ${e.message}`); }
    }
  }

  close() { this.db?.close(); this.db = null; }

  rowToChallenge(r) {
    return r && { id: r.id, tokenHash: r.token_hash, nonce: r.nonce, bchAddress: r.bch_address, nostrPubkey: r.nostr_pubkey, chain: r.chain, verifier: r.verifier, createdAt: r.created_at, expiresAt: r.expires_at, consumedAt: r.consumed_at };
  }

  async putChallenge(c) {
    this.db.prepare('INSERT INTO challenges (id, token_hash, nonce, bch_address, nostr_pubkey, chain, verifier, created_at, expires_at, consumed_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(c.id, c.tokenHash, c.nonce, c.bchAddress, c.nostrPubkey, c.chain, c.verifier, c.createdAt, c.expiresAt, c.consumedAt ?? null);
  }
  async getChallenge(id) { return this.rowToChallenge(this.db.prepare('SELECT * FROM challenges WHERE id = ?').get(String(id))) || null; }

  // One UPDATE statement is atomic: only one caller can ever flip consumed_at from NULL.
  async consumeChallenge(id, tokenHash, now) {
    const res = this.db.prepare('UPDATE challenges SET consumed_at = ? WHERE id = ? AND token_hash = ? AND consumed_at IS NULL AND expires_at > ?').run(now, String(id), String(tokenHash), now);
    if (Number(res.changes) !== 1) return null;
    return this.getChallenge(id);
  }

  // Claim the challenge AND save the binding in ONE database transaction.
  // If saving fails for any reason, the claim is rolled back, so a storage fault
  // never burns a legitimate user's challenge. Returns the binding, or null if the
  // challenge could not be claimed (used, expired, wrong token).
  async completeBinding(challengeId, tokenHash, now, b) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const claim = this.db.prepare('UPDATE challenges SET consumed_at = ? WHERE id = ? AND token_hash = ? AND consumed_at IS NULL AND expires_at > ?').run(now, String(challengeId), String(tokenHash), now);
      if (Number(claim.changes) !== 1) { this.db.exec('ROLLBACK'); return null; }
      this.db.prepare('INSERT INTO bindings (id, chain, bch_address, nostr_pubkey, created_at, json) VALUES (?,?,?,?,?,?)')
        .run(b.id, b.chain, b.bchAddress, b.nostrPubkey, b.createdAt, JSON.stringify(b));
      this.db.exec('COMMIT');
      return b;
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch { /* transaction already closed */ }
      if (/UNIQUE constraint failed: bindings\./i.test(e.message)) throw new DuplicateBindingError();
      throw e;
    }
  }

  async putBinding(b) {
    try {
      this.db.prepare('INSERT INTO bindings (id, chain, bch_address, nostr_pubkey, created_at, json) VALUES (?,?,?,?,?,?)')
        .run(b.id, b.chain, b.bchAddress, b.nostrPubkey, b.createdAt, JSON.stringify(b));
    } catch (e) {
      if (/UNIQUE/i.test(e.message)) throw new DuplicateBindingError();
      throw e;
    }
  }
  async getBinding(id) { const r = this.db.prepare('SELECT json FROM bindings WHERE id = ?').get(String(id)); return r ? JSON.parse(r.json) : null; }

  async putRegistryEvent(event, payload) {
    const b = payload.proofBundle;
    const existing = this.db.prepare('SELECT event_json, payload_json FROM registry_events WHERE event_id = ?').get(event.id);
    const eventJson = JSON.stringify(event), payloadJson = JSON.stringify(payload);
    if (existing) return existing.event_json === eventJson && existing.payload_json === payloadJson ? { inserted: false, duplicate: true } : { inserted: false, conflict: true };
    try {
      this.db.prepare('INSERT INTO registry_events (event_id, pubkey, binding_id, bch_address, chain, created_at, received_at, event_json, payload_json) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(event.id, event.pubkey, b.bindingId, b.challenge.bchAddress, b.challenge.chain, event.created_at, new Date().toISOString(), eventJson, payloadJson);
    } catch (e) {
      if (/UNIQUE/i.test(e.message)) return { inserted: false, duplicate: true };
      throw e;
    }
    return { inserted: true, duplicate: false };
  }

  async listRegistryPageByPubkey(pubkey, { limit = 50, cursor = null } = {}) {
    const safeLimit = Number.isInteger(limit) ? Math.min(100, Math.max(1, limit)) : 50;
    const rows = this.db.prepare('SELECT event_id, pubkey, binding_id, bch_address, chain, created_at, received_at FROM registry_events WHERE pubkey = ? ORDER BY created_at DESC, event_id ASC').all(pubkey)
      .map(r => ({ eventId: r.event_id, pubkey: r.pubkey, bindingId: r.binding_id, bchAddress: r.bch_address, chain: r.chain, createdAt: r.created_at, receivedAt: r.received_at }));
    const cursorIndex = cursor ? rows.findIndex(r => r.eventId === cursor) : -1;
    if (cursor && cursorIndex < 0) return { records: [], nextCursor: null, hasMore: false, cursorError: 'Registry cursor was not found for this author.' };
    const start = cursor ? cursorIndex + 1 : 0;
    const page = rows.slice(start, start + safeLimit);
    const hasMore = start + page.length < rows.length;
    return { records: page, nextCursor: hasMore ? page[page.length - 1].eventId : null, hasMore };
  }
  async listRegistryByPubkey(pubkey) { return (await this.listRegistryPageByPubkey(pubkey, { limit: 100 })).records; }

  async putPaymentRequest(r) { this.db.prepare('INSERT OR REPLACE INTO payment_requests (id, json) VALUES (?, ?)').run(r.id, JSON.stringify(r)); }
  async getPaymentRequest(id) { const r = this.db.prepare('SELECT json FROM payment_requests WHERE id = ?').get(String(id)); return r ? JSON.parse(r.json) : null; }

  async ping() { this.db.prepare('SELECT 1').get(); return true; }
}
