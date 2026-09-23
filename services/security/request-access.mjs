import { isIP } from 'node:net';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];
const LOOPBACK_PEERS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const SAFE_READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function forbidden(message) {
  return Object.assign(new Error(message), { status: 403, code: 'ORIGIN_REJECTED' });
}

export function parsePublicOrigin(raw) {
  if (raw === undefined) return null;
  if (typeof raw !== 'string' || !raw || raw.length > 2048 || raw.trim() !== raw) {
    throw new Error('JEVFLOW_PUBLIC_ORIGIN must be one exact canonical HTTPS origin');
  }
  let url;
  try { url = new URL(raw); }
  catch { throw new Error('JEVFLOW_PUBLIC_ORIGIN must be one exact canonical HTTPS origin'); }
  const labels = url.hostname.split('.');
  const dnsName = labels.length >= 2 && labels.every(label =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label));
  if (url.protocol !== 'https:' || url.origin !== raw || url.pathname !== '/' ||
      url.search || url.hash || url.username || url.password ||
      !dnsName || isIP(url.hostname) || url.hostname.endsWith('.') || url.port === '0') {
    throw new Error('JEVFLOW_PUBLIC_ORIGIN must be one exact canonical HTTPS origin with a DNS host, no path, query, fragment or credentials');
  }
  return Object.freeze({ origin: raw, host: url.host });
}

function countHeader(rawHeaders, name) {
  if (!Array.isArray(rawHeaders)) return 1;
  let count = 0;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (String(rawHeaders[index]).toLowerCase() === name) count++;
  }
  return count;
}

export function authorizeIncomingRequest({
  host, origin, method = 'GET', remoteAddress, port, publicOrigin = null, rawHeaders,
}) {
  if (!LOOPBACK_PEERS.has(remoteAddress)) throw forbidden('requests must arrive from a loopback socket peer');
  if (typeof host !== 'string' || !host ||
      countHeader(rawHeaders, 'host') !== 1 || countHeader(rawHeaders, 'origin') > 1) {
    throw forbidden('one valid Host header is required');
  }
  if (publicOrigin) {
    if (host !== publicOrigin.host) throw forbidden('Host must match the configured public origin exactly');
    if (origin !== undefined && origin !== publicOrigin.origin) {
      throw forbidden('Origin must match the configured public origin exactly');
    }
    if (!SAFE_READ_METHODS.has(method) && origin !== publicOrigin.origin) {
      throw forbidden('public mutations require the configured HTTPS Origin');
    }
    return;
  }
  const authorities = new Set(LOCAL_HOSTS.map(localHost => port === 80 ? localHost : localHost + ':' + port));
  if (port === 80) for (const localHost of LOCAL_HOSTS) authorities.add(localHost + ':80');
  if (!authorities.has(host.toLowerCase())) {
    throw forbidden('loopback requests must use the configured local host and port');
  }
  if (origin !== undefined) {
    let url;
    try { url = new URL(origin); }
    catch { throw forbidden('invalid request Origin'); }
    if (url.protocol !== 'http:' || url.origin !== origin ||
        url.host.toLowerCase() !== host.toLowerCase()) {
      throw forbidden('cross-origin requests are not allowed');
    }
  }
}
