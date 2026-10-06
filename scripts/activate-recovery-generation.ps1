param([ValidateSet('dirty','clean')][string]$Side,[string]$BuildId)
$ErrorActionPreference='Stop'
if ($BuildId -notmatch '^[a-f0-9]{16}$') { throw 'Invalid build identity' }
$pipeHome=Join-Path $env:USERPROFILE '.hf-pipe'
$receipt=Get-Content -LiteralPath (Join-Path $pipeHome "incoming\prepared-$BuildId.json") -Raw | ConvertFrom-Json
if ($receipt.side -ne $Side -or $receipt.buildId -ne $BuildId -or $receipt.protocolVersion -ne 3) { throw 'Prepared generation mismatch' }
$taskName="HFPipe-$Side"
$task=Get-ScheduledTask -TaskName $taskName
$backup=Join-Path $pipeHome "incoming\task-before-$BuildId-$Side.xml"
Export-ScheduledTask -TaskName $taskName | Set-Content -LiteralPath $backup -Encoding UTF8
$executable=Join-Path $receipt.root 'task-host.exe'
if (-not (Test-Path -LiteralPath $executable)) { throw 'Prepared task host missing' }
$action=New-ScheduledTaskAction -Execute $executable -Argument "--side $Side --root `"$($receipt.root)`"" -WorkingDirectory $receipt.root
Set-ScheduledTask -TaskName $taskName -Action $action | Out-Null
Stop-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName $taskName
@{side=$Side;buildId=$BuildId;root=$receipt.root;previousRoot=$receipt.previousRoot;activatedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $pipeHome "incoming\activated-$BuildId-$Side.json") -Encoding UTF8
