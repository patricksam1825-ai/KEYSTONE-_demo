import fs from 'node:fs';

/** Load a small, dependency-free .env file without overriding process variables. */
export function loadEnvFile(filePath, target = process.env) {
  let source;
  try { source = fs.readFileSync(filePath, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return { loaded: false, count: 0 };
    throw error;
  }
  let count = 0;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key] = match;
    if (Object.prototype.hasOwnProperty.call(target, key)) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
      if (rawLine.trim().startsWith(`${key}="`)) value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    target[key] = value;
    count += 1;
  }
  return { loaded: true, count };
}
