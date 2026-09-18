param(
  [int]$HostRecoveryTimeoutSec = 75
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$id = [Guid]::NewGuid().ToString("N").Substring(0, 8)
$taskName = "HFPipe-TrayTest-$id"
$runtime = Join-Path $env:TEMP "hf-tray-smoke-$id"
$statusFile = Join-Path $runtime "fake-status.json"
$trayStateFile = Join-Path $runtime "tray-state.json"
$fakeServer = $null
$legacyHost = $null

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Wait-HfCondition {
  param(
    [string]$Description,
    [scriptblock]$Condition,
    [int]$TimeoutSec = 20
  )
  $until = [DateTime]::UtcNow.AddSeconds($TimeoutSec)
  do {
    if (& $Condition) { return }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $until)
  throw "timeout: $Description"
}

function Get-HfTestProcesses {
  $needle = [regex]::Escape($runtime)
  return @(Get-CimInstance Win32_Process | Where-Object {
    ([string]$_.CommandLine) -match $needle
  })
}

function Start-HiddenNode {
  param([string]$Script, [string[]]$Arguments)
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $node
  $psi.Arguments = (@("`"$Script`"") + $Arguments) -join " "
  $psi.WorkingDirectory = $runtime
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $psi
  [void]$process.Start()
  return $process
}

function Write-FakeStatus {
  param([hashtable]$Status)
  $temp = "$statusFile.tmp"
  $json = $Status | ConvertTo-Json -Depth 8 -Compress
  [System.IO.File]::WriteAllText(
    $temp,
    $json,
    [System.Text.UTF8Encoding]::new($false)
  )
  Move-Item -LiteralPath $temp -Destination $statusFile -Force
}

function Wait-TrayColor {
  param([string]$Color)
  Wait-HfCondition "tray color $Color" {
    if (-not (Test-Path -LiteralPath $trayStateFile)) { return $false }
    try {
      return ((Get-Content -LiteralPath $trayStateFile -Raw | ConvertFrom-Json).color -eq $Color)
    } catch {
      return $false
    }
  }
}

try {
  New-Item -ItemType Directory -Path $runtime -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $root "src\task-host.ps1") -Destination $runtime
  Copy-Item -LiteralPath (Join-Path $root "src\supervisor-host.ps1") -Destination $runtime
  Copy-Item -LiteralPath (Join-Path $root "src\process-job.ps1") -Destination $runtime
  Copy-Item -LiteralPath (Join-Path $root "src\tray-viewer.ps1") -Destination $runtime
  Set-Content -LiteralPath (Join-Path $runtime "bootstrap.mjs") -Encoding UTF8 -Value @'
setInterval(() => {}, 1000);
'@
  $legacyScript = Join-Path $runtime "hf-start-host.ps1"
  Set-Content -LiteralPath $legacyScript -Encoding UTF8 -Value @"
`$node = (Get-Command node.exe -ErrorAction Stop).Source
`$child = Start-Process -FilePath `$node -ArgumentList @('"$runtime\bootstrap.mjs"', 'dirty') -WindowStyle Hidden -PassThru
`$child.WaitForExit()
"@
  $legacyHost = Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", "`"$legacyScript`"") `
    -WindowStyle Hidden `
    -PassThru
  Wait-HfCondition "legacy bootstrap child" {
    @(Get-HfTestProcesses | Where-Object { $_.CommandLine -match "bootstrap\.mjs" }).Count -eq 1
  }

  $listener = [System.Net.Sockets.TcpListener]::new(
    [System.Net.IPAddress]::Loopback,
    0
  )
  $listener.Start()
  $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  $listener.Stop()

  Write-FakeStatus @{
    bootstrap = @{ side = "dirty" }
    report = @{ local = @{ side = "dirty"; rtc = $true; dc = "open"; signaling = "stable"; pongAgeMs = 1000 } }
  }
  $fakeServer = Start-HiddenNode (Join-Path $root "scripts\fake-tray-status.mjs") @($port, "`"$statusFile`"")
  Wait-HfCondition "fake status server" {
    try {
      $fakeStatus = Invoke-RestMethod -Uri "http://127.0.0.1:$port/status" -TimeoutSec 1
      return ($null -ne $fakeStatus -and [bool]($fakeStatus.report.local.rtc))
    } catch {
      return $false
    }
  } 10

  & (Join-Path $root "src\install-watchdog.ps1") `
    -Side dirty `
    -Root $runtime `
    -TaskName $taskName `
    -StatusUrl "http://127.0.0.1:$port/status" `
    -DetailsUrl "http://127.0.0.1:$port/" `
    -TrayStateFile $trayStateFile | Out-Null

  Wait-HfCondition "scheduled task running" {
    (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue).State -eq "Running"
  }
  Wait-HfCondition "legacy owner removed" {
    $null -eq (Get-Process -Id $legacyHost.Id -ErrorAction SilentlyContinue)
  }
  Wait-HfCondition "one bootstrap child" {
    @(Get-HfTestProcesses | Where-Object { $_.CommandLine -match "bootstrap\.mjs" }).Count -eq 1
  }
  Wait-TrayColor "green"

  $visible = @(Get-HfTestProcesses | ForEach-Object {
    Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
  } | Where-Object { $_.MainWindowHandle -ne 0 })
  Assert-True ($visible.Count -eq 0) "test runtime opened a visible window"

  Write-FakeStatus @{
    bootstrap = @{ side = "dirty" }
    report = @{ local = @{ side = "dirty"; rtc = $false; dc = "connecting"; signaling = "have-local-offer" } }
  }
  Wait-TrayColor "yellow"
  Write-FakeStatus @{
    bootstrap = @{ side = "dirty" }
    report = @{ local = @{ side = "dirty"; rtc = $false; dc = "closed"; signaling = "stable"; ice = "failed" } }
  }
  Wait-TrayColor "red"

  $fakeServer.Kill()
  $fakeServer.WaitForExit()
  Wait-TrayColor "gray"
  $fakeServer = Start-HiddenNode (Join-Path $root "scripts\fake-tray-status.mjs") @($port, "`"$statusFile`"")
  Wait-HfCondition "restarted fake status server" {
    try {
      $null = Invoke-RestMethod -Uri "http://127.0.0.1:$port/status" -TimeoutSec 1
      return $true
    } catch {
      return $false
    }
  } 10
  Wait-TrayColor "red"

  $childBefore = @(Get-HfTestProcesses | Where-Object { $_.CommandLine -match "bootstrap\.mjs" })[0]
  Stop-Process -Id $childBefore.ProcessId -Force
  Wait-HfCondition "bootstrap child recovery" {
    $children = @(Get-HfTestProcesses | Where-Object { $_.CommandLine -match "bootstrap\.mjs" })
    $children.Count -eq 1 -and $children[0].ProcessId -ne $childBefore.ProcessId
  } 15

  $hostBefore = @(Get-HfTestProcesses | Where-Object {
    $_.Name -eq "powershell.exe" -and $_.CommandLine -match "supervisor-host\.ps1"
  })[0]
  Assert-True ($null -ne $hostBefore) "supervisor host not found"
  Stop-Process -Id $hostBefore.ProcessId -Force
  Wait-HfCondition "scheduled host recovery" {
    $hosts = @(Get-HfTestProcesses | Where-Object {
      $_.Name -eq "powershell.exe" -and $_.CommandLine -match "supervisor-host\.ps1"
    })
    $hosts.Count -eq 1 -and $hosts[0].ProcessId -ne $hostBefore.ProcessId
  } $HostRecoveryTimeoutSec
  Wait-HfCondition "one bootstrap after host recovery" {
    @(Get-HfTestProcesses | Where-Object { $_.CommandLine -match "bootstrap\.mjs" }).Count -eq 1
  }
  Wait-TrayColor "red"
  Assert-True ((Get-ScheduledTask -TaskName $taskName).State -eq "Running") "task is not running"

  Stop-ScheduledTask -TaskName $taskName
  Wait-HfCondition "explicit stop clears hop process tree" {
    $hopProcesses = @(Get-HfTestProcesses | Where-Object {
      $_.CommandLine -match "task-host\.ps1|supervisor-host\.ps1|bootstrap\.mjs"
    })
    (Get-ScheduledTask -TaskName $taskName).State -eq "Ready" -and $hopProcesses.Count -eq 0
  } 15
  Start-Sleep -Seconds 5
  Assert-True ((Get-ScheduledTask -TaskName $taskName).State -eq "Ready") "explicitly stopped task restarted"
  Assert-True (@(Get-HfTestProcesses | Where-Object {
    $_.CommandLine -match "task-host\.ps1|supervisor-host\.ps1|bootstrap\.mjs"
  }).Count -eq 0) "explicitly stopped process tree returned"

  Start-ScheduledTask -TaskName $taskName
  Wait-HfCondition "manual task recovery" {
    (Get-ScheduledTask -TaskName $taskName).State -eq "Running" -and
      @(Get-HfTestProcesses | Where-Object { $_.CommandLine -match "bootstrap\.mjs" }).Count -eq 1
  } 20
  Wait-TrayColor "red"

  [pscustomobject]@{
    ok = $true
    task = $taskName
    hidden = $true
    colors = @("green", "yellow", "red", "gray")
    childRecovered = $true
    hostRecovered = $true
    legacyOwnerRemoved = $true
    explicitStopHeld = $true
    manualStartRecovered = $true
    bootstrapCount = 1
  } | ConvertTo-Json -Compress
} catch {
  [Console]::Error.WriteLine([string]$_)
  $failedTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  [Console]::Error.WriteLine([string]($failedTask |
    Select-Object TaskName, State, Actions, Settings |
    Format-List | Out-String))
  [Console]::Error.WriteLine([string](Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction SilentlyContinue |
    Format-List | Out-String))
  [Console]::Error.WriteLine([string](Get-HfTestProcesses |
    Select-Object ProcessId, ParentProcessId, Name, CommandLine |
    Format-List | Out-String))
  if ($null -ne $fakeServer) {
    [Console]::Error.WriteLine([string](Get-NetTCPConnection -OwningProcess $fakeServer.Id -ErrorAction SilentlyContinue |
      Select-Object State, LocalAddress, LocalPort, OwningProcess |
      Format-List | Out-String))
  }
  if (Test-Path -LiteralPath $statusFile) {
    [Console]::Error.WriteLine("fake status file: $(Get-Content -LiteralPath $statusFile -Raw)")
    try {
      $fakeResponse = Invoke-RestMethod -Uri "http://127.0.0.1:$port/status" -TimeoutSec 2
      [Console]::Error.WriteLine("fake response: $($fakeResponse | ConvertTo-Json -Depth 8 -Compress)")
    } catch {
      [Console]::Error.WriteLine("fake response error: $($_.Exception.Message)")
    }
  }
  if (Test-Path -LiteralPath $trayStateFile) {
    [Console]::Error.WriteLine("tray state: $(Get-Content -LiteralPath $trayStateFile -Raw)")
  } else {
    [Console]::Error.WriteLine("tray state missing: $trayStateFile")
  }
  $hostLog = Join-Path $runtime "supervisor-host.log"
  if (Test-Path -LiteralPath $hostLog) {
    [Console]::Error.WriteLine("host log: $(Get-Content -LiteralPath $hostLog -Raw)")
  }
  throw
} finally {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  foreach ($process in @(Get-HfTestProcesses)) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
  if ($null -ne $fakeServer -and -not $fakeServer.HasExited) {
    $fakeServer.Kill()
    $fakeServer.WaitForExit()
  }
  Remove-Item -LiteralPath $runtime -Recurse -Force -ErrorAction SilentlyContinue
}
