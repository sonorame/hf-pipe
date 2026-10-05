import tls from 'node:tls';
import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const certificates = new Map();
for (const host of ['chatgpt.com', 'api.openai.com', 'auth.openai.com']) {
  await new Promise((resolve, reject) => {
    const socket = tls.connect({host, port:443, servername:host, family:4}, () => {
      let cert = socket.getPeerCertificate(true);
      const visited = new Set();
      while (cert?.raw && !visited.has(cert.fingerprint256)) {
        visited.add(cert.fingerprint256);
        console.log(host, cert.subject, cert.issuer, 'ca', cert.ca);
        if (cert.ca) certificates.set(cert.fingerprint256, cert.raw);
        cert = cert.issuerCertificate;
      }
      socket.end(); resolve();
    });
    socket.setTimeout(10000, () => socket.destroy(new Error('TLS timeout')));
    socket.once('error', reject);
  });
}
const pem = [...certificates.values()].map(raw => '-----BEGIN CERTIFICATE-----\n'+raw.toString('base64').match(/.{1,64}/g).join('\n')+'\n-----END CERTIFICATE-----\n').join('');
const dir = join(homedir(), '.hf-pipe');
mkdirSync(dir, {recursive:true});
const path = join(dir, 'codex-dirty-ca.pem');
writeFileSync(path, pem);
console.log('trusted CA bundle', path, certificates.size);
