import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const wizardGuards = fs.readFileSync(new URL('../public/wizardconnect-guards.js', import.meta.url), 'utf8');
const required = ['id=\"create\"', 'id=\"verify\"', 'id=\"publishRegistry\"', 'id=\"verifyBundle\"'];
for (const marker of required) {
  if (!html.includes(marker)) throw new Error(`Build validation failed: missing UI marker ${marker}`);
}
for (const dependency of ['https://esm.sh/@wizardconnect/core@0.2.0', 'https://esm.sh/@wizardconnect/dapp@0.2.0', 'https://esm.sh/qrcode@1.5.4']) {
  if (!app.includes(dependency)) throw new Error(`Build validation failed: missing browser dependency ${dependency}`);
}
if (!html.includes('type=\"module\" src=\"/app.js\"')) throw new Error('Build validation failed: app.js is not loaded as an ES module.');
console.log('KEYSTONE browser build validation passed (native ES modules; pinned esm.sh dependencies).');
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
const appIds = new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]));
const missingIds = [...appIds].filter(id => !htmlIds.has(id));
if (missingIds.length) throw new Error(`Build validation failed: app.js references missing HTML IDs: ${missingIds.join(', ')}`);
console.log(`KEYSTONE DOM binding validation passed (${appIds.size} static IDs).`);
