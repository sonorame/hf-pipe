import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import https from 'node:https';
import dns from 'node:dns';
import tls from 'node:tls';
import test from 'node:test';
import {hopUndiciAgentOptions,loadUndici} from '../src/network-policy.js';

test('system-trusted TLS succeeds while unknown CA and wrong hostname remain rejected', async () => {
  const fixture=(name:string)=>readFileSync(new URL(`./fixtures/tls/${name}`,import.meta.url),'utf8');
  const server=https.createServer({key:fixture('server-key.pem'),cert:fixture('server.pem')},(req,res)=>res.end('trusted'));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=(server.address() as {port:number}).port;
  const lookup=((host:any,options:any,callback:any)=>{
    if(options.all) callback(null,[{address:'127.0.0.1',family:4}]);
    else callback(null,'127.0.0.1',4);
  }) as typeof dns.lookup;
  const undici=loadUndici() as any;
  const makeAgent=(system:string[])=>new undici.Agent(hopUndiciAgentOptions(lookup,
    type=>type==='system'?system:[...tls.rootCertificates]));
  const untrusted=makeAgent([]),trusted=makeAgent([fixture('ca.pem')]);
  try {
    await assert.rejects(undici.fetch(`https://localhost:${port}/`,{dispatcher:untrusted}), (e:any)=>e.cause?.code==='UNABLE_TO_VERIFY_LEAF_SIGNATURE');
    const response=await undici.fetch(`https://localhost:${port}/`,{dispatcher:trusted});
    assert.equal(await response.text(),'trusted');
    await assert.rejects(undici.fetch(`https://wrong-host.test:${port}/`,{dispatcher:trusted}), (e:any)=>e.cause?.code==='ERR_TLS_CERT_ALTNAME_INVALID');
  } finally {
    await Promise.all([untrusted.close(),trusted.close()]);
    await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
});
