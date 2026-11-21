import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs/promises';
import { JsonStore } from '../src/store.js';
import { createChallenge, canonicalMessage } from '../src/challenges.js';
import { sha256 } from '../src/crypto.js';

const cfg={chain:'chipnet',challengeTtlSeconds:300};
const address='bchtest:qz0testaddressplaceholder000000000000000000000000000';
const pubkey='a'.repeat(64);
async function setup(){const dir=await fs.mkdtemp(`${os.tmpdir()}/keystone-`);const store=new JsonStore(dir);await store.init();return {dir,store};}

test('creates challenge with token hash, public nonce and exact canonical message',async()=>{
 const {dir,store}=await setup();try{const c=await createChallenge(store,{bchAddress:address,nostrPubkey:pubkey},cfg);assert.ok(c.challengeId);assert.ok(c.challengeToken);assert.match(c.message,/KEYSTONE IDENTITY BINDING/);const saved=await store.getChallenge(c.challengeId);assert.equal(saved.tokenHash,sha256(c.challengeToken));assert.notEqual(saved.tokenHash,c.challengeToken);assert.equal(c.message,canonicalMessage(saved));}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('rejects mainnet address on chipnet server',async()=>{const {dir,store}=await setup();try{await assert.rejects(()=>createChallenge(store,{bchAddress:'bitcoincash:qz0testaddressplaceholder000000000000000000000000000',nostrPubkey:pubkey},cfg),/configured for chipnet/);}finally{await fs.rm(dir,{recursive:true,force:true});}});
test('challenge consumption is atomic and single-use',async()=>{const {dir,store}=await setup();try{const c=await createChallenge(store,{bchAddress:address,nostrPubkey:pubkey},cfg);const tokenHash=sha256(c.challengeToken);const results=await Promise.all([store.consumeChallenge(c.challengeId,tokenHash,Date.now()),store.consumeChallenge(c.challengeId,tokenHash,Date.now())]);assert.equal(results.filter(Boolean).length,1);}finally{await fs.rm(dir,{recursive:true,force:true});}});
test('rejects wrong token and expired challenge',async()=>{const {dir,store}=await setup();try{const c=await createChallenge(store,{bchAddress:address,nostrPubkey:pubkey},cfg);assert.equal(await store.consumeChallenge(c.challengeId,sha256('wrong'),Date.now()),null);assert.equal(await store.consumeChallenge(c.challengeId,sha256(c.challengeToken),Date.now()+400000),null);}finally{await fs.rm(dir,{recursive:true,force:true});}});

import { verifyProofBundle } from '../src/identity.js';

test('portable proof bundle can be independently re-verified with BCH and Nostr verifiers',async()=>{
 const challenge={id:'11111111-1111-4111-8111-111111111111',nonce:'0123456789abcdef0123456789abcdef',bchAddress:address,nostrPubkey:pubkey,chain:'chipnet',verifier:'KEYSTONE Local Verifier',createdAt:Date.now()-1000,expiresAt:Date.now()+300000};
 const bundle={protocol:'KEYSTONE-IDENTITY-PROOF-BUNDLE-v1',bindingId:'22222222-2222-4222-8222-222222222222',challenge,bchSignature:'mock-signature',nostrEvent:{pubkey,kind:30078,content:'mock'}};
 const result=await verifyProofBundle(bundle,{bchVerifier:async()=>true,nostrVerifier:()=>({valid:true})});
 assert.equal(result.valid,true);assert.equal(result.bchAddress,address);assert.equal(result.nostrPubkey,pubkey);
});

test('portable proof bundle rejects a chain/address mismatch before verification',async()=>{
 const bundle={protocol:'KEYSTONE-IDENTITY-PROOF-BUNDLE-v1',bindingId:'22222222-2222-4222-8222-222222222222',challenge:{id:'11111111-1111-4111-8111-111111111111',nonce:'0123456789abcdef',bchAddress:'bitcoincash:qz0testaddressplaceholder000000000000000000000000000',nostrPubkey:pubkey,chain:'chipnet',verifier:'KEYSTONE',createdAt:Date.now()-1000,expiresAt:Date.now()+300000},bchSignature:'x',nostrEvent:{pubkey}};
 const result=await verifyProofBundle(bundle,{bchVerifier:async()=>true,nostrVerifier:()=>({valid:true})});
 assert.equal(result.valid,false);assert.match(result.error,/prefix/);
});

test('portable proof bundle rejects a missing signature',async()=>{
 const bundle={protocol:'KEYSTONE-IDENTITY-PROOF-BUNDLE-v1',bindingId:'22222222-2222-4222-8222-222222222222',challenge:{id:'11111111-1111-4111-8111-111111111111',nonce:'0123456789abcdef',bchAddress:address,nostrPubkey:pubkey,chain:'chipnet',verifier:'KEYSTONE',createdAt:Date.now()-1000,expiresAt:Date.now()+300000},nostrEvent:{pubkey}};
 const result=await verifyProofBundle(bundle,{bchVerifier:async()=>true,nostrVerifier:()=>({valid:true})});
 assert.equal(result.valid,false);assert.match(result.error,/missing/);
});

test('stores and lists validated registry announcements by Nostr public key',async()=>{
 const {dir,store}=await setup();
 try {
  const event={id:'event-1',pubkey,kind:30078,created_at:Math.floor(Date.now()/1000),tags:[],content:'{}',sig:'signature'};
  const payload={protocol:'KEYSTONE-NOSTR-REGISTRY-v1',proofBundle:{bindingId:'binding-1',challenge:{bchAddress:address,chain:'chipnet'}}};
  await store.putRegistryEvent(event,payload);
  const records=await store.listRegistryByPubkey(pubkey);
  assert.equal(records.length,1);assert.equal(records[0].eventId,'event-1');assert.equal(records[0].bindingId,'binding-1');
 } finally { await fs.rm(dir,{recursive:true,force:true}); }
});


test('portable proof bundle rejects malformed binding identifiers before cryptographic checks',async()=>{
 const challenge={id:'11111111-1111-4111-8111-111111111111',nonce:'0123456789abcdef0123456789abcdef',bchAddress:address,nostrPubkey:pubkey,chain:'chipnet',verifier:'KEYSTONE Local Verifier',createdAt:Date.now()-1000,expiresAt:Date.now()+300000};
 const bundle={protocol:'KEYSTONE-IDENTITY-PROOF-BUNDLE-v1',bindingId:'not-a-uuid',challenge,bchSignature:'mock-signature',nostrEvent:{pubkey,kind:30078,content:'mock'}};
 const result=await verifyProofBundle(bundle,{bchVerifier:async()=>true,nostrVerifier:()=>({valid:true})});
 assert.equal(result.valid,false);assert.match(result.error,/binding ID/);
});

test('portable proof bundle rejects a Nostr event signed by a different public key',async()=>{
 const challenge={id:'11111111-1111-4111-8111-111111111111',nonce:'0123456789abcdef0123456789abcdef',bchAddress:address,nostrPubkey:pubkey,chain:'chipnet',verifier:'KEYSTONE Local Verifier',createdAt:Date.now()-1000,expiresAt:Date.now()+300000};
 const bundle={protocol:'KEYSTONE-IDENTITY-PROOF-BUNDLE-v1',bindingId:'22222222-2222-4222-8222-222222222222',challenge,bchSignature:'mock-signature',nostrEvent:{pubkey:'b'.repeat(64),kind:30078,content:'mock'}};
 const result=await verifyProofBundle(bundle,{bchVerifier:async()=>true,nostrVerifier:()=>({valid:true})});
 assert.equal(result.valid,false);assert.match(result.error,/does not match/);
});

test('portable proof rejects challenge lifetimes beyond protocol maximum',async()=>{
 const now=Date.now();const challenge={id:'11111111-1111-4111-8111-111111111111',nonce:'0123456789abcdef0123456789abcdef',bchAddress:address,nostrPubkey:pubkey,chain:'chipnet',verifier:'KEYSTONE verifier',createdAt:now-1000,expiresAt:now+900001};
 const bundle={protocol:'KEYSTONE-IDENTITY-PROOF-BUNDLE-v1',bindingId:'22222222-2222-4222-8222-222222222222',challenge,bchSignature:'sig',nostrEvent:{pubkey}};
 const result=await verifyProofBundle(bundle,{bchVerifier:async()=>true,nostrVerifier:()=>({valid:true})});assert.equal(result.valid,false);assert.match(result.error,/15-minute/);
});

test('portable proof rejects future-dated challenge creation',async()=>{
 const now=Date.now();const challenge={id:'11111111-1111-4111-8111-111111111111',nonce:'0123456789abcdef0123456789abcdef',bchAddress:address,nostrPubkey:pubkey,chain:'chipnet',verifier:'KEYSTONE verifier',createdAt:now+120000,expiresAt:now+180000};
 const bundle={protocol:'KEYSTONE-IDENTITY-PROOF-BUNDLE-v1',bindingId:'22222222-2222-4222-8222-222222222222',challenge,bchSignature:'sig',nostrEvent:{pubkey}};
 const result=await verifyProofBundle(bundle,{bchVerifier:async()=>true,nostrVerifier:()=>({valid:true})});assert.equal(result.valid,false);assert.match(result.error,/future/);
});

test('portable proof rejects oversized BCH signatures before external verification',async()=>{
 const now=Date.now();const challenge={id:'11111111-1111-4111-8111-111111111111',nonce:'0123456789abcdef0123456789abcdef',bchAddress:address,nostrPubkey:pubkey,chain:'chipnet',verifier:'KEYSTONE verifier',createdAt:now-1000,expiresAt:now+300000};
 const bundle={protocol:'KEYSTONE-IDENTITY-PROOF-BUNDLE-v1',bindingId:'22222222-2222-4222-8222-222222222222',challenge,bchSignature:'x'.repeat(2049),nostrEvent:{pubkey}};
 const result=await verifyProofBundle(bundle,{bchVerifier:async()=>true,nostrVerifier:()=>({valid:true})});assert.equal(result.valid,false);assert.match(result.error,/size/);
});
