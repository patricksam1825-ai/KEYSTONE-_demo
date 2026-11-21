#!/usr/bin/env node
// Save a REAL wallet-made BCH message signature as a test fixture.
//   node scripts/add-wallet-fixture.mjs --address bchtest:q... --message-file challenge.txt --signature "H1x..="
// The message file must contain the exact text you signed in the wallet (no changes, no extra newline).
// If libauth is installed the signature is verified first and NOT saved when it fails.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCompactSignature, verifyBchMessageLocal, isLocalBchVerifierAvailable } from '../src/bch-local.js';

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const address = arg('address'), messageFile = arg('message-file'), signature = String(arg('signature') || '').replace(/\s+/g, '');
if (!address || !messageFile || !signature) { console.error('Usage: node scripts/add-wallet-fixture.mjs --address <bchtest:...> --message-file <file> --signature <base64>'); process.exit(1); }
const message = fs.readFileSync(messageFile, 'utf8');
if (!parseCompactSignature(signature)) { console.error('Not a valid compact BCH message signature (88-character base64, header 27-34).'); process.exit(1); }
if (!(await isLocalBchVerifierAvailable())) { console.error('libauth is not installed (run npm install). Nothing saved, because the signature cannot be verified yet.'); process.exit(2); }
if (!(await verifyBchMessageLocal({ address, signature, message }))) { console.error('The signature does NOT verify for this address and message. Nothing saved. Check that the message is exactly what the wallet signed.'); process.exit(1); }
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'wallet-bch-signature.json');
fs.writeFileSync(out, JSON.stringify({ name: 'real wallet signature', origin: 'wallet-made, supplied by the project owner', address, message, signature, expectValid: true }, null, 2) + '\n');
console.log('Verified with libauth and saved to', out);
