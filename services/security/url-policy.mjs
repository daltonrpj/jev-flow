import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { getExecutionScope } from './execution-scope.mjs';

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0)
    || (a === 198 && b >= 18 && b <= 19)
    || (a === 203 && b === 0 && parts[2] === 113)
    || a >= 224;
}

function parseIpv6Words(address) {
  const normalized = String(address || '').toLowerCase().split('%')[0];
  const halves = normalized.split('::');
  if (halves.length > 2 || !normalized) return null;

  const parseParts = (parts) => {
    const words = [];
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      if (part.includes('.')) {
        if (i !== parts.length - 1) return null;
        const octets = part.split('.').map(Number);
        if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
        words.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
        words.push(Number.parseInt(part, 16));
      }
    }
    return words;
  };

  const left = parseParts(halves[0] ? halves[0].split(':') : []);
  const right = parseParts(halves.length === 2 && halves[1] ? halves[1].split(':') : []);
  if (!left || !right) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  if (left.length + right.length >= 8) return null;
  return [...left, ...Array(8 - left.length - right.length).fill(0), ...right];
}

function ipv4FromWords(words, offset = 6) {
  if (!Array.isArray(words) || words.length < offset + 2) return null;
  return [
    words[offset] >>> 8,
    words[offset] & 255,
    words[offset + 1] >>> 8,
    words[offset + 1] & 255,
  ].join('.');
}

function isPrivateIpv6(address) {
  const words = parseIpv6Words(address);
  if (!words) return true;
  const first = words[0];
  if (words.every(word => word === 0) || (words.slice(0, 7).every(word => word === 0) && words[7] === 1)) return true;
  if ((first & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((first & 0xff00) === 0xff00) return true; // multicast ff00::/8

  const v4Mapped = words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff;
  // Some stacks emit ::ffff:0:w.x.y.z. The final 32 bits still carry IPv4.
  const v4Translated = words.slice(0, 4).every(word => word === 0) && words[4] === 0xffff && words[5] === 0;
  const v4Compatible = words.slice(0, 6).every(word => word === 0);
  const nat64 = words[0] === 0x0064 && words[1] === 0xff9b && (words[2] === 0 || words[2] === 1);
  const nat64Translated = words[0] === 0x0064 && words[1] === 0xff9b && words.slice(4).every(word => word === 0);
  const sixToFour = words[0] === 0x2002;
  const teredo = words[0] === 0x2001 && words[1] === 0;

  if (v4Mapped || v4Translated || v4Compatible || nat64) return isPrivateIpv4(ipv4FromWords(words));
  if (nat64Translated) return isPrivateIpv4(ipv4FromWords(words, 2));
  if (sixToFour) return isPrivateIpv4(ipv4FromWords(words, 1));
  if (teredo) {
    const embedded = ipv4FromWords(words);
    if (!embedded) return true;
    return isPrivateIpv4(embedded.split('.').map(octet => 255 - Number(octet)).join('.'));
  }
  return false;
}

export function isPrivateAddress(address) {
  const family = isIP(String(address || ''));
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

export async function inspectUrlPolicy(rawUrl, options = {}) {
  let url;
  try {
    url = new URL(String(rawUrl || ''));
  } catch {
    return { ok: false, code: 'URL_INVALID', reason: 'URL inválida' };
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { ok: false, code: 'URL_PROTOCOL_BLOCKED', reason: 'Somente HTTP(S) é permitido' };
  }
  if (url.username || url.password) {
    return { ok: false, code: 'URL_CREDENTIALS_BLOCKED', reason: 'Credenciais embutidas na URL não são permitidas' };
  }
  const scope = options.scope || getExecutionScope();
  if (scope.allowPrivateUrls === true) {
    return { ok: true, url, profileId: scope.profileId, privateAllowed: true, addresses: [] };
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    return {
      ok: false,
      code: 'PRIVATE_URL_BLOCKED',
      reason: 'Host local bloqueado pelo perfil de execução',
      profileId: scope.profileId,
    };
  }
  let addresses;
  try {
    addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return { ok: false, code: 'URL_DNS_FAILED', reason: 'Não foi possível resolver o host', profileId: scope.profileId };
  }
  const privateAddress = addresses.find(item => isPrivateAddress(item.address));
  if (privateAddress) {
    return {
      ok: false,
      code: 'PRIVATE_URL_BLOCKED',
      reason: 'Destino privado, loopback ou link-local bloqueado pelo perfil de execução',
      profileId: scope.profileId,
      address: privateAddress.address,
    };
  }
  return {
    ok: true,
    url,
    profileId: scope.profileId,
    privateAllowed: false,
    addresses: addresses.map(item => item.address),
  };
}

export async function assertUrlAllowed(rawUrl, options = {}) {
  const result = await inspectUrlPolicy(rawUrl, options);
  if (result.ok) return result.url;
  const error = new Error(`${result.code}: ${result.reason}`);
  error.code = result.code;
  error.profileId = result.profileId;
  throw error;
}
