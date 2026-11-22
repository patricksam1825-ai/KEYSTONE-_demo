import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Small single-process JSON store for local evaluation. Use Supabase/Postgres for multi-instance production.
const STORE_COLLECTIONS = ['challenges', 'bindings', 'registry', 'paymentRequests'];
const MAX_STORE_BYTES = 50 * 1024 * 1024;

function validateStoreState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Store root must be a JSON object.');
  }
  for (const name of STORE_COLLECTIONS) {
    if (value[name] !== undefined && (!value[name] || typeof value[name] !== 'object' || Array.isArray(value[name]))) {
      throw new Error(`Store collection "${name}" must be a JSON object.`);
    }
  }
  return {
    challenges: value.challenges || {},
    bindings: value.bindings || {},
    registry: value.registry || {},
    paymentRequests: value.paymentRequests || {}
  };
}

export class JsonStore {
  constructor(dir) { this.dir = dir; this.file = path.join(dir, 'keystone-store.json'); this.state = { challenges: {}, bindings: {}, registry: {}, paymentRequests: {} }; this.queue = Promise.resolve(); }
  async init() {
    await fs.mkdir(this.dir, { recursive: true });
    try {
      const stat = await fs.stat(this.file);
      if (stat.size > MAX_STORE_BYTES) throw new Error('Store file exceeds the 50 MB safety limit.');
      this.state = validateStoreState(JSON.parse(await fs.readFile(this.file, 'utf8')));
    } catch (e) {
      if (e.code !== 'ENOENT') throw new Error(`Store file is invalid: ${e.message}`);
      await this.persist();
    }
  }
  async persist() {
    // Write a unique same-directory temp file, flush it, then atomically replace
    // the store. A fixed .tmp name can collide with stale files or another
    // process; fsync reduces the chance of acknowledging a write lost on crash.
    const tmp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await fs.open(tmp, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(this.state, null, 2), 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(tmp, this.file);
      // Best-effort directory sync: supported on POSIX, not uniformly on Windows.
      let directory;
      try {
        directory = await fs.open(this.dir, 'r');
        await directory.sync();
      } catch (error) {
        if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM'].includes(error?.code)) throw error;
      } finally {
        await directory?.close().catch(() => {});
      }
    } catch (error) {
      await handle?.close().catch(() => {});
      await fs.unlink(tmp).catch(() => {});
      throw error;
    }
  }
  serial(fn) {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }
  async putChallenge(record) { return this.serial(async () => { this.state.challenges[record.id] = record; await this.persist(); }); }
  async getChallenge(id) { return this.state.challenges[id] || null; }
  async consumeChallenge(id, tokenHash, now) {
    return this.serial(async () => {
      const c = this.state.challenges[id];
      if (!c || c.consumedAt || c.expiresAt <= now || c.tokenHash !== tokenHash) return null;
      c.consumedAt = now; await this.persist(); return structuredClone(c);
    });
  }
  async putBinding(binding) { return this.serial(async () => { this.state.bindings[binding.id] = binding; await this.persist(); }); }
  async completeBinding(challengeId, tokenHash, now, binding) {
    return this.serial(async () => {
      const c = this.state.challenges[challengeId];
      if (!c || c.consumedAt || c.expiresAt <= now || c.tokenHash !== tokenHash) return null;
      const dup = Object.values(this.state.bindings).some(x => x.chain === binding.chain && x.bchAddress === binding.bchAddress && x.nostrPubkey === binding.nostrPubkey);
      if (dup) { const e = new Error('This BCH address and Nostr key are already bound on this chain.'); e.code = 'DUPLICATE_BINDING'; throw e; }
      c.consumedAt = now; this.state.bindings[binding.id] = binding;
      try { await this.persist(); }
      catch (e) { c.consumedAt = null; delete this.state.bindings[binding.id]; throw e; } // undo in memory if the disk write failed
      return binding;
    });
  }
  async getBinding(id) { return this.state.bindings[id] || null; }
  async putRegistryEvent(event, payload) {
    return this.serial(async () => {
      const existing = this.state.registry[event.id];
      if (existing) {
        // Nostr event IDs are immutable identifiers. Treat an exact retry as idempotent,
        // but never silently replace the payload associated with an existing ID.
        const sameEvent = JSON.stringify(existing.event) === JSON.stringify(event);
        const samePayload = JSON.stringify(existing.payload) === JSON.stringify(payload);
        if (sameEvent && samePayload) return { inserted: false, duplicate: true };
        return { inserted: false, conflict: true };
      }
      this.state.registry[event.id] = { event, payload, receivedAt: new Date().toISOString() };
      await this.persist();
      return { inserted: true, duplicate: false };
    });
  }
  async listRegistryPageByPubkey(pubkey, { limit = 50, cursor = null } = {}) {
    const safeLimit = Number.isInteger(limit) ? Math.min(100, Math.max(1, limit)) : 50;
    const rows = Object.values(this.state.registry)
      .filter(r => r.event.pubkey === pubkey)
      .map(({ event, payload, receivedAt }) => ({ eventId: event.id, pubkey: event.pubkey, bindingId: payload.proofBundle.bindingId, bchAddress: payload.proofBundle.challenge.bchAddress, chain: payload.proofBundle.challenge.chain, createdAt: event.created_at, receivedAt }))
      .sort((a, b) => b.createdAt - a.createdAt || a.eventId.localeCompare(b.eventId));
    const cursorIndex = cursor ? rows.findIndex(row => row.eventId === cursor) : -1;
    if (cursor && cursorIndex < 0) return { records: [], nextCursor: null, hasMore: false, cursorError: 'Registry cursor was not found for this author.' };
    const start = cursor ? cursorIndex + 1 : 0;
    const page = rows.slice(start, start + safeLimit);
    const hasMore = start + page.length < rows.length;
    return { records: page, nextCursor: hasMore ? page[page.length - 1].eventId : null, hasMore };
  }
  async listRegistryByPubkey(pubkey) {
    return (await this.listRegistryPageByPubkey(pubkey, { limit: 100 })).records;
  }
  async putPaymentRequest(request) { return this.serial(async () => { this.state.paymentRequests[request.id] = request; await this.persist(); }); }
  async getPaymentRequest(id) { return this.state.paymentRequests[id] || null; }
}
