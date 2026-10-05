import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {runCleanJob} from '../src/clean-jobs.mjs';

test('long shell leaves supervisor heartbeat and ping responsive', async () => {
  const root=mkdtempSync(join(tmpdir(),'hf-shell-async-'));
  try {
    writeFileSync(join(root,'wait.cjs'),"setTimeout(()=>{console.log('completed');console.error('diagnostic')},500)");
    let ticks=0;
    const timer=setInterval(()=>ticks++,20);
    try {
      const shell=runCleanJob({type:'shell',body:{cmd:`"${process.execPath}" wait.cjs`,cwd:root,timeout:3}});
      const ping=await runCleanJob({type:'ping',body:{}});
      assert.equal(ping.ok,true);
      const result=await shell;
      assert.equal(result.ok,true,JSON.stringify(result));
      assert.match(result.stdout,/completed/);
      assert.ok(ticks>=3,`heartbeat only ran ${ticks} times`);
      assert.match(result.stderr,/diagnostic/);
    } finally {clearInterval(timer);}
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('shell validates its timeout before executing a side effect', async () => {
  for(const timeout of [-1,Infinity,'invalid',0]) {
    const result=await runCleanJob({type:'shell',body:{cmd:'echo should-not-run',timeout}});
    assert.equal(result.ok,false);
    assert.match(result.error,/timeout/);
  }
});
