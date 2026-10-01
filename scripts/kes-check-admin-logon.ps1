# Validate local Administrator password via LogonUser (no process spawn).
param([string]$User = "Administrator", [string]$Domain = ".")
$pass = $env:HF_LOCAL_ADMIN_PASS
if (-not $pass) { throw "HF_LOCAL_ADMIN_PASS required" }

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class NativeLogon {
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool LogonUser(string user, string domain, string pass, int logonType, int provider, out IntPtr token);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
}
"@

$token = [IntPtr]::Zero
# 2 = LOGON32_LOGON_INTERACTIVE, 0 = default provider
$ok = [NativeLogon]::LogonUser($User, $Domain, $pass, 2, 0, [ref]$token)
$err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
Write-Output ("interactive_ok=" + $ok + " err=" + $err)
if ($token -ne [IntPtr]::Zero) { [void][NativeLogon]::CloseHandle($token); $token = [IntPtr]::Zero }

$ok8 = [NativeLogon]::LogonUser($User, $Domain, $pass, 8, 0, [ref]$token)
$err8 = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
Write-Output ("network_ok=" + $ok8 + " err=" + $err8)
if ($token -ne [IntPtr]::Zero) { [void][NativeLogon]::CloseHandle($token) }
