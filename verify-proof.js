import fs from 'node:fs/promises';
import path from 'node:path';
import { verifyProofBundle } from '../src/identity.js';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: npm run verify:proof -- <proof-bundle.json>');
  process.exit(2);
}

try {
  const absolutePath = path.resolve(process.cwd(), inputPath);
  const parsed = JSON.parse(await fs.readFile(absolutePath, 'utf8'));
  const result = await verifyProofBundle(parsed);
  if (!result.valid) {
    console.error(JSON.stringify({ verified: false, error: result.error }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ verified: true, ...result }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ verified: false, error: error.message || 'Could not verify proof bundle.' }, null, 2));
  process.exit(1);
}
