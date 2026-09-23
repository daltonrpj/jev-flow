import { readFileSync, writeFileSync } from 'node:fs';
import { certifyCatalog } from '../services/jev-flow/compendium-catalog.mjs';

const certificate = certifyCatalog({ onProgress: (done, total) => {
  if (done % 50_000 === 0) process.stdout.write(`validated ${done}/${total}\n`);
} });
const publicCertificate = {
  scope: 'standalone', version: certificate.version, passed: certificate.validCount === 388080,
  candidateCount: certificate.candidateCount, validCount: certificate.validCount,
  uniqueKeys: certificate.uniqueKeys, uniqueIds: certificate.uniqueIds,
  sourceFingerprint: certificate.sourceFingerprint, certifiedAt: certificate.certifiedAt,
};
const manifestPath = new URL('../services/jev-flow/compendium-catalog.manifest.json', import.meta.url);
const publicPath = new URL('../catalog-certification.json', import.meta.url);
if (process.argv.includes('--check')) {
  for (const [path, expected] of [[manifestPath, certificate], [publicPath, publicCertificate]]) {
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    for (const key of ['version', 'sourceFingerprint', 'candidateCount', 'validCount', 'uniqueKeys', 'uniqueIds']) {
      if (saved[key] !== expected[key]) throw new Error(`catalog certificate mismatch: ${key}`);
    }
    if (path === publicPath && (saved.scope !== 'standalone' || saved.passed !== true)) throw new Error('public catalog certificate is not valid');
  }
} else {
  writeFileSync(manifestPath, `${JSON.stringify(certificate, null, 2)}\n`);
  writeFileSync(publicPath, `${JSON.stringify(publicCertificate, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(certificate, null, 2)}\n`);
