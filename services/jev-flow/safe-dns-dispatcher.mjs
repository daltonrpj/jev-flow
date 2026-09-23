import dns from 'node:dns';
import { Agent, buildConnector } from 'undici';
import { isPrivateAddress } from '../security/url-policy.mjs';

/**
 * Native fetch performs its own connection lookup after URL policy inspection.
 * This lookup is the enforcement point: every new socket is resolved again,
 * private answers are rejected, and only the approved answer set reaches
 * net.connect/tls.connect. Undici keeps the original hostname in the
 * connector options, so Host and TLS SNI remain tied to the URL hostname.
 */
export function createSafeDnsDispatcher({ lookup = dns.lookup } = {}) {
  const guardedLookup = (hostname, options, callback) => {
    lookup(hostname, {
      family: options?.family,
      hints: options?.hints,
      all: true,
      verbatim: true,
    }, (error, answers) => {
      if (error) return callback(error);
      const records = (Array.isArray(answers) ? answers : [answers])
        .filter(record => record && typeof record.address === 'string')
        .map(record => ({ address: record.address, family: record.family }));
      if (!records.length) {
        const empty = new Error(`DNS lookup returned no addresses for ${hostname}`);
        empty.code = 'ENODATA';
        return callback(empty);
      }
      const privateAnswer = records.find(record => isPrivateAddress(record.address));
      if (privateAnswer) {
        const blocked = new Error(`PRIVATE_URL_BLOCKED: DNS resolved ${hostname} to a private address`);
        blocked.code = 'PRIVATE_URL_BLOCKED';
        blocked.address = privateAnswer.address;
        return callback(blocked);
      }
      if (options?.all) return callback(null, records);
      return callback(null, records[0].address, records[0].family);
    });
  };

  // No application DNS cache is introduced. A fresh lookup happens whenever
  // undici needs a new socket; the Agent is created per webhook and closed by
  // the caller after the request.
  return new Agent({ connect: buildConnector({ lookup: guardedLookup }) });
}
