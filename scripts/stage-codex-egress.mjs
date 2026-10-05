import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { buildReleaseManifest, verifyRelease } from '../src/release-runtime.mjs';

const live = join(homedir(), '.cursor', 'matrix-mcp-e2ee');
const state = JSON.parse(readFileSync(join(live, 'state.json'), 'utf8'));
const publicKey = readFileSync(join(live, 'release-public.pem'), 'utf8');
const source = join(live, 'releases', state.current);
verifyRelease(source, { publicKey, expectedProtocolVersion: 2 });
const work = join(homedir(), '.hf-pipe', 'staging-codex', String(Date.now()));
mkdirSync(work, { recursive: true });
// DPAPI stays under the current Windows account; no key is written in plaintext.
// The local PowerShell host is unresponsive, so use the same DPAPI API directly.
const cs = join(work, 'dpapi.cs');
const exe = join(work, 'dpapi.exe');
writeFileSync(cs, 'using System; using System.IO; using System.Security.Cryptography; class Program { static void Main(string[] args) { Console.Write(Convert.ToBase64String(ProtectedData.Unprotect(File.ReadAllBytes(args[0]), null, DataProtectionScope.CurrentUser))); } }');
const compiler = join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const built = spawnSync(compiler, ['/nologo', '/r:System.Security.dll', `/out:${exe}`, cs], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
if (built.status !== 0) throw new Error(built.stderr || built.stdout || 'DPAPI helper compilation failed');
const key = spawnSync(exe, [join(homedir(), '.hf-pipe', 'keys', 'release-private.dpapi')], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
if (key.status !== 0) throw new Error('DPAPI key access failed');
const staging = join(work, 'release');
cpSync(source, staging, { recursive: true });
const overlays = ['egress-dialer.mjs', 'egress-mux.mjs', 'codex-egress.ps1'];
const digest = createHash('sha256').update(state.current);
for (const name of overlays) {
  cpSync(resolve('src', name), join(staging, 'src', name));
  digest.update(name).update(readFileSync(join(staging, 'src', name)));
}
const buildId = digest.digest('hex').slice(0, 16);
buildReleaseManifest(staging, { buildId, protocolVersion: 2, privateKey: Buffer.from(key.stdout.trim(), 'base64').toString('utf8') });
verifyRelease(staging, { publicKey, expectedProtocolVersion: 2 });
const target = join(live, 'releases', buildId);
if (!existsSync(target)) renameSync(staging, target);
verifyRelease(target, { publicKey, expectedProtocolVersion: 2 });
console.log(JSON.stringify({ buildId, previous: state.current, protocolVersion: 2, releaseDir: target }));
