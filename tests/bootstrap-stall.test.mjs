import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {buildReleaseManifest,promoteRelease} from '../src/release-runtime.mjs';

for (const phase of ['booted','ready']) test(`bootstrap terminates stalled ${phase} child without quarantining a network outage`, () => {
  const root=mkdtempSync(join(tmpdir(),'hf-stall-'));
  try {
    const pair=generateKeyPairSync('ed25519');
    writeFileSync(join(root,'release-public.pem'),pair.publicKey.export({type:'spki',format:'pem'}));
    const dir=join(root,'releases','stall');
    mkdirSync(join(dir,'src'),{recursive:true});
    writeFileSync(join(dir,'package.json'),'{"type":"module"}');
    writeFileSync(join(dir,'src','index.mjs'),`import {writeFileSync} from 'node:fs'; import {join} from 'node:path'; writeFileSync(join(process.env.HF_RUNTIME_ROOT,'test-child.pid'),String(process.pid)); process.send({kind:'supervisor-health',phase:'${phase}'}); for (;;) {}`);
    buildReleaseManifest(dir,{buildId:'stall',protocolVersion:2,privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'})});
    promoteRelease(root,'stall');
    const r=spawnSync(process.execPath,[fileURLToPath(new URL('../src/bootstrap.mjs',import.meta.url)),'clean'],{
      env:{...process.env,HF_RUNTIME_ROOT:root,HF_BOOTSTRAP_ONCE:'1',HF_PROTOCOL_VERSION:'2',HF_STARTUP_BOOT_MS:'1000',HF_SUPERVISOR_HEARTBEAT_MS:'1000',HF_SUPERVISOR_CHECK_MS:'50'},timeout:5000,encoding:'utf8'});
    assert.equal(r.error,undefined,'external watchdog must terminate the blocked child before test timeout');
    assert.equal(r.status,1);
    const state=JSON.parse(readFileSync(join(root,'state.json'),'utf8'));
    assert.equal(state.current,'stall');
    assert.deepEqual(state.bad,[]);
    assert.match(readFileSync(join(root,'logs','bootstrap-clean.log'),'utf8'),/watchdog/);
  } finally {
    try { process.kill(Number(readFileSync(join(root,'test-child.pid'),'utf8'))); } catch {}
    rmSync(root,{recursive:true,force:true});
  }
});
