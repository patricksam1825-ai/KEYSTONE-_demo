import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
const sourcePackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// Produce a real, self-contained application source distribution. Runtime npm
// dependencies are installed in dist by the deployer; no node_modules or secrets
// are copied into the artifact.
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const directory of ['src', 'public', 'migrations']) {
  fs.cpSync(path.join(root, directory), path.join(out, directory), { recursive: true });
}
fs.mkdirSync(path.join(out, 'scripts'), { recursive: true });
fs.copyFileSync(path.join(root, 'scripts', 'verify-proof.js'), path.join(out, 'scripts', 'verify-proof.js'));
fs.copyFileSync(path.join(root, 'render.yaml'), path.join(out, 'render.yaml'));
fs.copyFileSync(path.join(root, 'deploy.gitignore'), path.join(out, '.gitignore'));
for (const file of ['README.md', '.env.example']) {
  fs.copyFileSync(path.join(root, file), path.join(out, file));
}
const runtimePackage = {
  name: sourcePackage.name,
  version: sourcePackage.version,
  private: true,
  type: 'module',
  engines: sourcePackage.engines,
  scripts: {
    start: 'node src/server.js',
    'verify:proof': 'node scripts/verify-proof.js'
  },
  dependencies: sourcePackage.dependencies
};
fs.writeFileSync(path.join(out, 'package.json'), `${JSON.stringify(runtimePackage, null, 2)}\n`);
fs.writeFileSync(path.join(out, 'BUILD-MANIFEST.json'), `${JSON.stringify({
  product: 'KEYSTONE',
  version: sourcePackage.version,
  generatedAt: new Date().toISOString(),
  runtime: 'Node.js',
  contents: ['src/', 'public/', 'migrations/', 'scripts/verify-proof.js', 'package.json', '.env.example', 'README.md', 'render.yaml', '.gitignore'],
  install: 'npm install',
  start: 'npm start',
  note: 'Install runtime dependencies in this directory before starting. Configure .env. This source distribution is not a public-hosting deployment.'
}, null, 2)}\n`);
console.log(`KEYSTONE production source distribution created: ${path.relative(root, out)}`);
console.log('Contents: backend source, browser assets, proof verifier, runtime manifest and environment template.');
