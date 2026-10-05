import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {buildWindowlessHost} from '../scripts/build-windowless-host.mjs';

test('scheduled host is a GUI executable and runs PowerShell without allocating a console', {skip:process.platform !== 'win32'},()=>{
  const root=mkdtempSync(join(tmpdir(),'hf-windowless-'));
  try{
    const repo=join(dirname(fileURLToPath(import.meta.url)),'..');
    const exe=buildWindowlessHost(repo,root);
    const pe=readFileSync(exe);const header=pe.readUInt32LE(0x3c);
    assert.equal(pe.readUInt16LE(header+24+68),2,'PE subsystem must be Windows GUI');
    writeFileSync(join(root,'task-host.ps1'),`param([string]$Side,[string]$Root)
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ConsoleProbe { [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); }'
@{side=$Side;scriptRoot=$PSScriptRoot;console=[ConsoleProbe]::GetConsoleWindow().ToInt64()} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Root 'probe.json') -Encoding UTF8
`);
    // Deliberately do not hide the process: the executable itself must not allocate a console.
    const run=spawnSync(exe,['--side','clean','--root',root],{windowsHide:false,encoding:'utf8',timeout:30000});
    assert.equal(run.status,0,run.stderr||run.error?.message||'GUI host failed');
    const proof=JSON.parse(readFileSync(join(root,'probe.json'),'utf8').replace(/^\uFEFF/,''));
    assert.equal(proof.console,0);assert.equal(proof.side,'clean');assert.equal(realpathSync.native(proof.scriptRoot).toLowerCase(),realpathSync.native(root).toLowerCase());
  }finally{rmSync(root,{recursive:true,force:true});}
});
