import { StringDecoder } from 'node:string_decoder';

export function validatePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return port;
}

/** Keep challenge lifetime within the protocol's supported 60–900 second window. */
export function validateChallengeTtlSeconds(value) {
  const ttl = Number(value);
  if (!Number.isFinite(ttl) || !Number.isInteger(ttl) || ttl < 1) {
    throw new Error('CHALLENGE_TTL_SECONDS must be a positive whole number.');
  }
  return Math.min(900, Math.max(60, ttl));
}

/** Read a bounded JSON request without corrupting UTF-8 split across chunks. */
export async function readJsonBody(req, maxBytes = 3_000_000) {
  const contentType = String(req.headers?.['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new Error('Content-Type must be application/json.');

  const declaredLength = req.headers?.['content-length'];
  if (declaredLength !== undefined) {
    if (!/^\d+$/.test(String(declaredLength))) throw new Error('Invalid Content-Length header.');
    if (Number(declaredLength) > maxBytes) throw new Error('Request body too large.');
  }

  const decoder = new StringDecoder('utf8');
  let raw = '';
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error('Request body too large.');
    raw += decoder.write(chunk);
  }
  raw += decoder.end();
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('JSON request body must be an object.');
    }
    return parsed;
  } catch (error) {
    if (error.message === 'JSON request body must be an object.') throw error;
    throw new Error('Request body contains invalid JSON.');
  }
}
