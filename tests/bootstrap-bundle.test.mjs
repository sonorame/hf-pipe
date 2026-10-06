import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {copyFileSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {buildReleaseManifest,promoteRelease,verifyRelease} from '../src/release-runtime.mjs';
import {buildBootstrapBundle} from '../scripts/build-bootstrap-bundle.mjs';

test('fresh bootstrap bundle includes its relative modules and signed dependency bytes',()=>{
  const runtime=mkdtempSync(join(tmpdir(),'hf-full-bootstrap-'));
  try {
    const pair=generateKeyPairSync('ed25519');
    const privateKey=pair.privateKey.export({type:'pkcs8',format:'pem'});
    const publicKey=pair.publicKey.export({type:'spki',format:'pem'});
    writeFileSync(join(runtime,'release-public.pem'),publicKey);
    const dir=join(runtime,'releases','test');mkdirSync(join(dir,'src'),{recursive:true});
    mkdirSync(join(dir,'node_modules','test-dependency'),{recursive:true});
    writeFileSync(join(dir,'src','index.mjs'),'console.log("fixture")');
    writeFileSync(join(dir,'node_modules','test-dependency','index.js'),'module.exports = 42');
    buildReleaseManifest(dir,{buildId:'test',protocolVersion:3,privateKey});promoteRelease(runtime,'test');
    const names=['bootstrap.mjs','protocol-version.mjs','operational-board.mjs','start-hop.vbs','release-runtime.mjs','tray-status.mjs','process-job.ps1','task-host.ps1','supervisor-host.ps1','tray-viewer.ps1','install-watchdog.ps1','install-watchdog.cmd','start-clean.cmd','start-dirty.cmd','cursor-egress.ps1','cursor-egress-apply.mjs','cursor-proxy-config.mjs'];
    names.push('supervisor-recovery.mjs');
    for(const name of names) copyFileSync(fileURLToPath(new URL('../src/'+name,import.meta.url)),join(runtime,name));
    const bundle=buildBootstrapBundle({runtimeRoot:runtime,privateKey,protocolVersion:3});
    const manifest=verifyRelease(bundle.stage,{publicKey,expectedProtocolVersion:3});
    assert.equal(manifest.entrypoint,'bootstrap.mjs');
    assert.ok(manifest.files.some(f=>f.path==='supervisor-recovery.mjs'));
    assert.ok(manifest.files.some(f=>f.path.endsWith('node_modules/test-dependency/index.js')));
    assert.ok(manifest.files.some(f=>f.path==='releases/test/release-manifest.json'));
    const dep=join(bundle.stage,'releases','test','node_modules','test-dependency','index.js');
    writeFileSync(dep,'module.exports = 43');
    assert.throws(()=>verifyRelease(bundle.stage,{publicKey}),/hash mismatch/);
  } finally {rmSync(runtime,{recursive:true,force:true});}
});
