#!/usr/bin/env node
// Shows EXACTLY what each relay says. Run:  node scripts/relay-diagnose.mjs wss://relay.damus.io wss://nos.lol
// For each relay: (1) can we open a secure WebSocket, (2) does it answer a read request, (3) what does it reply to
// a small signed KEYSTONE test event (kind 30078, tagged keystone-diagnostic). The reply is printed unchanged.
import WebSocket from 'ws';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';

const relays = process.argv.slice(2).filter(a => a.startsWith('wss://'));
if (!relays.length) { console.error('Usage: node scripts/relay-diagnose.mjs wss://relay.example [more relays]'); process.exit(1); }
const sk = generateSecretKey();
const event = finalizeEvent({ kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [['d', 'keystone-diagnostic'], ['alt', 'KEYSTONE connectivity test']], content: 'keystone relay diagnostic' }, sk);

function probe(url) {
  return new Promise(resolve => {
    const t0 = Date.now(), out = { url, opened: false, read: 'no reply', publish: 'no reply', notices: [] };
    let ws; const done = () => { try { ws?.terminate(); } catch {} resolve(out); };
    const timer = setTimeout(() => { out.note = 'stopped after 12 s'; done(); }, 12_000);
    try { ws = new WebSocket(url, { handshakeTimeout: 8000 }); } catch (e) { out.error = e.message; clearTimeout(timer); return resolve(out); }
    ws.on('error', e => { out.error = `${e.code || ''} ${e.message}`.trim(); clearTimeout(timer); done(); });
    ws.on('close', (code, reason) => { out.closed = `${code} ${String(reason)}`.trim(); });
    ws.on('open', () => { out.opened = true; out.openMs = Date.now() - t0; ws.send(JSON.stringify(['REQ', 'r1', { kinds: [1], limit: 1 }])); });
    ws.on('message', raw => {
      let m; try { m = JSON.parse(String(raw)); } catch { return; }
      if (m[0] === 'EOSE' && m[1] === 'r1') { out.read = 'ok (EOSE received)'; ws.send(JSON.stringify(['CLOSE', 'r1'])); ws.send(JSON.stringify(['EVENT', event])); }
      else if (m[0] === 'OK' && m[1] === event.id) { out.publish = m[2] ? `ACCEPTED ${m[3] || ''}`.trim() : `REFUSED: ${m[3] || '(no reason)'}`; clearTimeout(timer); done(); }
      else if (m[0] === 'NOTICE' || m[0] === 'AUTH' || m[0] === 'CLOSED') out.notices.push(m.map(x => String(x).slice(0, 120)).join(' | '));
    });
  });
}
for (const url of relays) {
  const r = await probe(url);
  console.log(`\n${r.url}\n  connection : ${r.opened ? `open (${r.openMs} ms)` : `FAILED ${r.error || ''}`}\n  read test  : ${r.read}\n  publish    : ${r.publish}${r.notices.length ? `\n  relay notes: ${r.notices.join(' // ')}` : ''}${r.closed ? `\n  closed     : ${r.closed}` : ''}${r.note ? `\n  note       : ${r.note}` : ''}`);
}
