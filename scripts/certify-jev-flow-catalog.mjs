import { writeFileSync } from 'node:fs';
import { certifyCatalog } from '../services/jev-flow/compendium-catalog.mjs';

const certificate = certifyCatalog({ onProgress: (done, total) => {
  if (done % 50_000 === 0) process.stdout.write(`validated ${done}/${total}\n`);
} });
writeFileSync(new URL('../services/jev-flow/compendium-catalog.manifest.json', import.meta.url), `${JSON.stringify(certificate, null, 2)}\n`);
writeFileSync(new URL('../site/catalog-certification.json', import.meta.url), `${JSON.stringify({
  scope: 'standalone', version: certificate.version, passed: certificate.validCount === 388080,
  candidateCount: certificate.candidateCount, validCount: certificate.validCount,
  uniqueKeys: certificate.uniqueKeys, uniqueIds: certificate.uniqueIds,
  sourceFingerprint: certificate.sourceFingerprint, certifiedAt: certificate.certifiedAt,
}, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(certificate, null, 2)}\n`);
