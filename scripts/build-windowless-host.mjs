import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

export function buildWindowlessHost(sourceRoot, runtimeRoot) {
  if(process.platform !== 'win32') return null;
  const windows = process.env.SystemRoot || 'C:\\Windows';
  const compiler = join(windows,'Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  const shell = join(windows,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const assembly = spawnSync(shell,['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command','[System.Management.Automation.PowerShell].Assembly.Location'],{windowsHide:true,encoding:'utf8',timeout:15000});
  const automation = assembly.stdout?.trim();
  if(!existsSync(compiler)||assembly.status!==0||!automation||!existsSync(automation)) throw Error('Windows .NET Framework and Windows PowerShell are required for the windowless host');
  const output = join(runtimeRoot,'task-host.exe');
  const result = spawnSync(compiler,['/nologo','/target:winexe','/platform:anycpu','/reference:'+automation,'/out:'+output,join(sourceRoot,'src','task-host.cs')],{windowsHide:true,encoding:'utf8',timeout:30000});
  if(result.status !== 0) throw Error('Windowless host build failed: '+(result.stdout||result.stderr||result.error?.message));
  return output;
}
