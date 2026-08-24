#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Full fresh Windows 11 baseline — updates, secure, light, creative stack.

.DESCRIPTION
  One elevated run does everything safe to automate for photo/video machines:
  Windows Update, hardening, BitLocker (when TPM allows), debloat, performance,
  service trim, Media folders, and the full winget creative utility set.

.PARAMETER WhatIf
  Print planned actions without changing the system.

.PARAMETER SkipUpdates
  Skip the Windows Update pass.

.PARAMETER SkipPackages
  Skip winget installs (still applies OS tweaks + Media folders).

.PARAMETER SkipBitLocker
  Skip disk encryption enable (still reports status from the security pass).

.EXAMPLE
  .\Invoke-Win11Baseline.ps1

.EXAMPLE
  .\Run-All.cmd
#>
[CmdletBinding(SupportsShouldProcess = $false)]
param(
  [switch]$WhatIf,
  [switch]$SkipUpdates,
  [switch]$SkipPackages,
  [switch]$SkipBitLocker
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$modules = Join-Path $PSScriptRoot 'modules'
. (Join-Path $modules 'Common.ps1')

Assert-Administrator

Write-Host ''
Write-Host 'Win11 baseline — FULL pass (updates + secure + light + creative)' -ForegroundColor White
Write-Host "Root: $PSScriptRoot"
Write-Host ''

$results = @()

function Invoke-BaselineModule {
  param(
    [Parameter(Mandatory)][string]$RelativePath,
    [hashtable]$Args = @{}
  )
  $path = Join-Path $modules $RelativePath
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Missing module: $path"
  }
  $argList = @{}
  foreach ($k in $Args.Keys) { $argList[$k] = $Args[$k] }
  if ($WhatIf) { $argList['WhatIf'] = $true }

  try {
    & $path @argList
    $script:results += [pscustomobject]@{ Module = $RelativePath; Status = 'ok' }
  } catch {
    $script:results += [pscustomobject]@{ Module = $RelativePath; Status = "FAIL: $($_.Exception.Message)" }
    throw
  }
}

if (-not $SkipUpdates) {
  Invoke-BaselineModule '01-Updates.ps1'
} else {
  Write-BaselineWarn 'Skipped updates (-SkipUpdates)'
}

Invoke-BaselineModule '02-Security.ps1'

if (-not $SkipBitLocker) {
  Invoke-BaselineModule '06-BitLocker.ps1'
} else {
  Write-BaselineWarn 'Skipped BitLocker (-SkipBitLocker)'
}

Invoke-BaselineModule '03-Debloat.ps1'
Invoke-BaselineModule '04-Performance.ps1'
Invoke-BaselineModule '07-Services.ps1'
Invoke-BaselineModule '05-CreativeReady.ps1' @{ SkipPackages = [bool]$SkipPackages }

Write-BaselineStep 'Summary'
$results | Format-Table -AutoSize | Out-String | Write-Host

$pending = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired' -ErrorAction SilentlyContinue)
$cbs = Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending'
if ($pending -or $cbs) {
  Write-BaselineWarn 'A reboot is pending. Restart, then install GPU drivers.'
} else {
  Write-BaselineOk 'No reboot flag detected (still reboot once for HAGS / optional features).'
}

Write-Host ''
Write-Host 'DONE. Reboot -> vendor GPU drivers -> Adobe/DaVinci/Capture One from your accounts.' -ForegroundColor Cyan
Write-Host 'If BitLocker ran: copy Desktop\BitLocker-Recovery-KEY.txt offline, then delete it.' -ForegroundColor Yellow
Write-Host ''
