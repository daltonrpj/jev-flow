import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicOrigin, authorizeIncomingRequest } from './request-access.mjs';

const publicOrigin = parsePublicOrigin('https://flow.example.org');
const base = {
  host: 'flow.example.org', origin: 'https://flow.example.org',
  method: 'POST', remoteAddress: '127.0.0.1', port: 8723, publicOrigin,
  rawHeaders: ['Host', 'flow.example.org', 'Origin', 'https://flow.example.org'],
};
const rejects = (input) => assert.throws(() => authorizeIncomingRequest(input), error => error.status === 403);

test('public origin configuration requires one canonical HTTPS DNS origin', () => {
  assert.equal(parsePublicOrigin(undefined), null);
  assert.deepEqual(parsePublicOrigin('https://flow.example.org:8443'), {
    origin: 'https://flow.example.org:8443', host: 'flow.example.org:8443'
  });
  for (const invalid of ['', ' https://flow.example.org', 'http://flow.example.org',
    'https://flow.example.org/', 'https://flow.example.org/path',
    'https://flow.example.org?x=1', 'https://flow.example.org#x',
    'https://user:pass@flow.example.org', 'https://127.0.0.1', 'https://localhost',
    'https://flow.example.org:443', 'https://flow.example.org:0']) {
    assert.throws(() => parsePublicOrigin(invalid), /JEVFLOW_PUBLIC_ORIGIN/, invalid);
  }
});

test('proxy mode accepts exact Host and Origin from a loopback peer only', () => {
  assert.doesNotThrow(() => authorizeIncomingRequest(base));
  assert.doesNotThrow(() => authorizeIncomingRequest({ ...base, method: 'GET', origin: undefined,
    rawHeaders: ['Host', base.host] }));
  rejects({ ...base, host: 'evil.example.org' });
  rejects({ ...base, host: 'FLOW.EXAMPLE.ORG' });
  rejects({ ...base, origin: 'http://flow.example.org' });
  rejects({ ...base, origin: 'https://flow.example.org/' });
  rejects({ ...base, origin: 'https://other.example.org' });
  rejects({ ...base, origin: undefined });
  rejects({ ...base, remoteAddress: '203.0.113.8' });
  rejects({ ...base, rawHeaders: ['Host', base.host, 'Host', base.host, 'Origin', base.origin] });
  rejects({ ...base, rawHeaders: ['Host', base.host, 'Origin', base.origin, 'Origin', base.origin] });
});

test('forwarded headers cannot override Host, Origin, or socket peer checks', () => {
  const forwarded = ['X-Forwarded-Host', 'flow.example.org',
    'X-Forwarded-Proto', 'https', 'Forwarded', 'host=flow.example.org;proto=https'];
  rejects({ ...base, host: 'evil.example.org', rawHeaders: ['Host', 'evil.example.org', 'Origin', base.origin, ...forwarded] });
  rejects({ ...base, remoteAddress: '203.0.113.8', rawHeaders: [...base.rawHeaders, ...forwarded] });
  assert.doesNotThrow(() => authorizeIncomingRequest({ ...base, rawHeaders: [...base.rawHeaders,
    'X-Forwarded-Host', 'evil.example.org', 'X-Forwarded-Proto', 'http'] }));
});

test('without public origin the existing loopback browser and CLI mode remains', () => {
  const local = { host: '127.0.0.1:8723', method: 'POST', remoteAddress: '127.0.0.1', port: 8723 };
  assert.doesNotThrow(() => authorizeIncomingRequest(local));
  assert.doesNotThrow(() => authorizeIncomingRequest({ ...local, origin: 'http://127.0.0.1:8723' }));
  assert.doesNotThrow(() => authorizeIncomingRequest({ ...local, host: '[::1]:8723',
    origin: 'http://[::1]:8723', remoteAddress: '::1' }));
  rejects({ ...local, host: 'flow.example.org' });
  rejects({ ...local, origin: 'https://flow.example.org' });
  rejects({ ...local, remoteAddress: '203.0.113.8' });
});
