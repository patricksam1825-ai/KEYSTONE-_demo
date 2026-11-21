import net from 'node:net';

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1']);

export function isLoopbackHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return LOOPBACK_NAMES.has(host) || (net.isIP(host) === 4 && host.startsWith('127.'));
}

/**
 * Allow public binding only when ALLOW_PUBLIC_HOST=true is set.
 * This is intentional for demo / competition deployments.
 */
export function assertListenHost(hostname, { allowPublic = false } = {}) {
  const host = String(hostname || '127.0.0.1');
  if (allowPublic) return host;
  if (!isLoopbackHost(host)) {
    throw new Error(
      'Public network binding is disabled by default. ' +
      'Set ALLOW_PUBLIC_HOST=true (and preferably DEMO_MODE=true) to enable a public demo host. ' +
      'Default is loopback only (localhost / 127.0.0.1 / ::1).'
    );
  }
  return host;
}

/** @deprecated Use assertListenHost. Kept for compatibility. */
export function assertLoopbackListenHost(hostname) {
  return assertListenHost(hostname, { allowPublic: false });
}

/**
 * Request safety check.
 * - Local mode (default): only loopback Host + matching Origin.
 * - Public demo mode: allows non-loopback hosts when allowPublic is true.
 */
export function isSafeRequest(reqHost, origin, listenPort, { allowPublic = false } = {}) {
  if (typeof reqHost !== 'string' || !reqHost) return false;
  let hostUrl;
  try { hostUrl = new URL(`http://${reqHost}`); } catch { return false; }
  if (hostUrl.username || hostUrl.password || hostUrl.pathname !== '/' || hostUrl.search || hostUrl.hash) return false;

  const hostIsLoopback = isLoopbackHost(hostUrl.hostname);

  // Strict local mode
  if (!allowPublic) {
    if (!hostIsLoopback) return false;
    if (hostUrl.port && Number(hostUrl.port) !== Number(listenPort)) return false;
    if (origin === undefined) return true; // non-browser local clients
    if (typeof origin !== 'string' || origin === 'null') return false;
    try {
      const originUrl = new URL(origin);
      return originUrl.protocol === 'http:' &&
        isLoopbackHost(originUrl.hostname) &&
        Number(originUrl.port || 80) === Number(hostUrl.port || 80) &&
        originUrl.hostname.toLowerCase() === hostUrl.hostname.toLowerCase();
    } catch { return false; }
  }

  // Public demo mode: accept any reasonable Host.
  return true;
}

/** @deprecated Use isSafeRequest. */
export function isSafeLocalRequest(reqHost, origin, listenPort) {
  return isSafeRequest(reqHost, origin, listenPort, { allowPublic: false });
}

export function applySecurityHeaders(res, { allowPublic = false } = {}) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('cross-origin-resource-policy', allowPublic ? 'cross-origin' : 'same-origin');
  const csp = allowPublic
    ? "default-src 'self'; script-src 'self' https://esm.sh https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
    : "default-src 'self'; script-src 'self' https://esm.sh; style-src 'self'; img-src 'self' data:; connect-src 'self' https: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
  res.setHeader('content-security-policy', csp);
}
