param([string]$BuildId,[ValidateRange(16,120)][int]$PauseSeconds=65)
$ErrorActionPreference='Stop'
if ($BuildId -notmatch '^[a-f0-9]{16}$') { throw 'Invalid build identity' }
$before=Invoke-RestMethod http://127.0.0.1:18764/status
if (-not $before.report.local.rtc -or $before.report.local.buildId -ne $BuildId) { throw 'Live target not ready' }
$root=Join-Path $env:USERPROFILE ".hf-pipe\runtime-generations\$BuildId"
$all=Get-CimInstance Win32_Process
$bootstrap=$all | Where-Object ProcessId -eq $before.bootstrap.pid
$worker=$all | Where-Object ProcessId -eq $before.report.local.pid
$rtc=$all | Where-Object { $_.ParentProcessId -eq $worker.ProcessId -and $_.Name -eq 'node.exe' }
$targets=@($bootstrap,$worker)+@($rtc)
if (-not $bootstrap -or -not $worker -or -not $rtc) { throw 'Incomplete process ancestry' }
foreach ($target in $targets) {
  if ($target.Name -ne 'node.exe' -or -not $target.CommandLine.Contains($root)) { throw 'Unexpected suspension target' }
}
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class HFPipeSuspend {
 [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr OpenProcess(uint rights,bool inherit,int pid);
 [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
 [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h);
 [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);
}
'@
$handles=@()
try {
  foreach ($target in $targets) {
    $h=[HFPipeSuspend]::OpenProcess(0x0800,$false,$target.ProcessId)
    if ($h -eq [IntPtr]::Zero) { throw 'Cannot open suspension target' }
    $handles+=,$h
    if ([HFPipeSuspend]::NtSuspendProcess($h) -ne 0) { throw 'Cannot suspend target' }
  }
  Start-Sleep -Seconds $PauseSeconds
} finally {
  [array]::Reverse($handles)
  foreach ($h in $handles) { [HFPipeSuspend]::NtResumeProcess($h) | Out-Null; [HFPipeSuspend]::CloseHandle($h) | Out-Null }
}
$clock=[Diagnostics.Stopwatch]::StartNew()
do {
  Start-Sleep -Seconds 1
  try { $after=Invoke-RestMethod http://127.0.0.1:18764/status -TimeoutSec 2 } catch { $after=$null }
} while (($null -eq $after -or -not $after.report.local.rtc -or $after.report.local.gen -le $before.report.local.gen) -and $clock.Elapsed.TotalSeconds -lt 60)
@{case='shared-scheduler-pause';pauseSeconds=$PauseSeconds;previousPid=$worker.ProcessId;currentPid=$after.report.local.pid;rtc=$after.report.local.rtc;previousGen=$before.report.local.gen;currentGen=$after.report.local.gen;recoverySeconds=[Math]::Round($clock.Elapsed.TotalSeconds,3)}|ConvertTo-Json
if (-not $after.report.local.rtc -or $after.report.local.pid -ne $worker.ProcessId -or $after.report.local.gen -le $before.report.local.gen) { throw 'Resume recovery contract failed' }
