#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Fresh Windows 11 baseline: updates, security, light debloat, creative-ready.

.DESCRIPTION
  Idempotent-ish prep for machines you will customize later (photo, video, etc.).
  Run once on a new install, reboot, then customize per machine.

.PARAMETER WhatIf
  Print planned actions without changing the system.

.PARAMETER SkipUpdates
  Skip the Windows Update pass (still run security / debloat / performance).

.PARAMETER InstallCreativeTools
  Install the winget package set in config/packages.winget.json.

.EXAMPLE
  .\Invoke-Win11Baseline.ps1

.EXAMPLE
  .\Invoke-Win11Baseline.ps1 -InstallCreativeTools

.EXAMPLE
  .\Invoke-Win11Baseline.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $false)]
param(
  [switch]$WhatIf,
  [switch]$SkipUpdates,
  [switch]$InstallCreativeTools
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$modules = Join-Path $PSScriptRoot 'modules'
. (Join-Path $modules 'Common.ps1')

Assert-Administrator

Write-Host ''
Write-Host 'Win11 baseline — light, secured, ready to customize' -ForegroundColor White
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
Invoke-BaselineModule '03-Debloat.ps1'
Invoke-BaselineModule '04-Performance.ps1'
Invoke-BaselineModule '05-CreativeReady.ps1' @{ InstallPackages = [bool]$InstallCreativeTools }

Write-BaselineStep 'Summary'
$results | Format-Table -AutoSize | Out-String | Write-Host

$pending = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired' -ErrorAction SilentlyContinue)
$cbs = Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending'
if ($pending -or $cbs) {
  Write-BaselineWarn 'A reboot is pending. Restart before heavy customization or driver installs.'
} else {
  Write-BaselineOk 'No reboot flag detected (GPU scheduling / feature disables may still want a restart).'
}

Write-Host ''
Write-Host 'Next: reboot, install GPU drivers from NVIDIA/AMD/Intel, then your Adobe/DaVinci/etc. stack.' -ForegroundColor Cyan
Write-Host ''
